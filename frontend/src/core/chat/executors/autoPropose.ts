/**
 * AutoPropose Executors - Phase 1-3a
 * 
 * apiExecutor.ts から auto_propose / additional_propose / split 系ロジックを分離
 * 
 * 責務:
 * - 候補日時の自動生成・提案
 * - 追加候補の提案
 * - 票割れ時の追加提案
 */

import { threadsApi } from '../../api/threads';
import { isPendingAutoPropose, isPendingSplit } from '../pendingTypes';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult, ExecutionContext } from './types';
import type { ThreadStatus_API } from '../../models';
import { refreshAfterWrite } from './shared/refresh';
import { getStatusWithCache } from './shared/cache';

// ============================================================
// Helper Functions
// ============================================================

/**
 * Phase Next-5 Day3: Analyze status for additional proposal
 * Pure function: returns true if additional proposals are needed
 */
export function analyzeStatusForPropose(status: ThreadStatus_API): boolean {
  const { invites } = status;
  const pendingCount = invites.filter((i) => i.status === 'pending' || i.status === null).length;
  return pendingCount >= 1;
}

/**
 * Generate time slot proposals (Phase Next-5 Day1: busyなし版)
 * - 30分刻み（デフォルト）
 * - 来週の営業時間（9:00-18:00）
 * - busyとの重複チェックなし（Day2以降で対応）
 * - 最大5件
 */
export function generateProposalsWithoutBusy(
  duration: number = 30
): Array<{ start_at: string; end_at: string; label: string }> {
  const proposals: Array<{ start_at: string; end_at: string; label: string }> = [];
  
  // 来週の月曜日を取得
  const today = new Date();
  const nextWeekMonday = new Date(today);
  nextWeekMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7) + 7);
  nextWeekMonday.setHours(0, 0, 0, 0);
  
  // 月〜金の9:00-18:00でスロット生成（busyチェックなし）
  for (let day = 0; day < 5; day++) {
    const currentDate = new Date(nextWeekMonday);
    currentDate.setDate(currentDate.getDate() + day);
    
    for (let hour = 9; hour < 18; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(currentDate);
        slotStart.setHours(hour, minute, 0, 0);
        
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + duration);
        
        // 18:00を超える場合はスキップ
        if (slotEnd.getHours() >= 18 && slotEnd.getMinutes() > 0) {
          continue;
        }
        
        proposals.push({
          start_at: slotStart.toISOString(),
          end_at: slotEnd.toISOString(),
          label: formatProposalLabel(slotStart, slotEnd),
        });
        
        // 最大5件で終了
        if (proposals.length >= 5) return proposals;
      }
    }
  }
  
  return proposals;
}

/**
 * Format proposal label
 * Example: "12/30 (月) 10:00-10:30"
 */
export function formatProposalLabel(start: Date, end: Date): string {
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const month = start.getMonth() + 1;
  const day = start.getDate();
  const dayOfWeek = dayLabels[start.getDay()];
  
  const startTime = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
  const endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
  
  return `${month}/${day} (${dayOfWeek}) ${startTime}-${endTime}`;
}

// ============================================================
// Executors
// ============================================================

/**
 * P2-1: schedule.auto_propose
 * Phase Next-5 Day1: 提案のみ（POST しない）
 * Phase Next-5 Day1修正: メールのみで相手を特定、busyを使わない
 */
export async function executeAutoPropose(intentResult: IntentResult): Promise<ExecutionResult> {
  const { emails, duration } = intentResult.params;
  
  try {
    // Phase Next-5 Day1: busyを使わない（来週候補、busy無し扱い）
    // Step 1: Generate proposals (30分刻み、最大5件、busy無し）
    const proposals = generateProposalsWithoutBusy(duration || 30);
    
    if (proposals.length === 0) {
      return {
        success: false,
        message: '❌ 来週の候補日時が見つかりませんでした。\n別の期間で再度お試しください。',
      };
    }
    
    // Step 2: Build message with proposals
    let message = `📅 候補日時を生成しました\n\n`;
    message += `📧 送信先: ${emails.join(', ')}\n`;
    message += `⏱️ 所要時間: ${duration || 30}分\n\n`;
    message += '候補日時:\n';
    proposals.forEach((proposal, index) => {
      message += `${index + 1}. ${proposal.label}\n`;
    });
    message += '\n';
    
    // Phase Next-5 Day1: busyを使わないことを明示
    message += 'ℹ️ 来週の営業時間（9:00-18:00）から候補を生成しています。\n';
    message += '（カレンダーの予定との重複チェックは Day2 以降で対応予定）\n\n';
    
    // Phase Next-5 Day2: 確認メッセージ統一
    message += '💡 この内容でスレッドを作成しますか？\n';
    message += '「はい」で作成、「いいえ」でキャンセルします。';
    
    return {
      success: true,
      message,
      data: {
        kind: 'auto_propose.generated',
        payload: {
          source: 'initial', // Phase Next-5 Day3: 明示フラグ
          threadId: undefined, // Phase Next-5 Day3: Day1 は threadId なし
          emails,
          duration: duration || 30,
          range: 'next_week',
          proposals,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P2-2: schedule.auto_propose.confirm
 * Phase Next-5 Day2: 提案確定 → POST /api/threads
 * P0-1: 正規化された pending を使用
 */
export async function executeAutoProposeConfirm(
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // P0-1: 正規化された pending から auto_propose を取得
  const activePending = context?.pendingForThread ?? context?.globalPendingAction ?? null;
  const pending = isPendingAutoPropose(activePending) ? activePending : null;
  
  if (!pending) {
    return {
      success: false,
      message: '❌ 候補が選択されていません。\n先に「〇〇に候補出して」と入力してください。',
    };
  }
  
  try {
    // P0-1: PendingState の auto_propose 形式から取得
    const { emails = [], duration, proposals, source, threadId } = pending;
    
    // Phase Next-5 Day3: 追加候補の場合は既存スレッドにスロットを追加
    if (source === 'additional' && threadId) {
      // Convert proposals to slots format (start_at/end_at 形式)
      const slots = proposals.map((proposal) => ({
        start_at: proposal.start_at,
        end_at: proposal.end_at,
        label: proposal.label,
      }));
      
      // Add slots to existing thread
      const response = await threadsApi.addSlots(threadId, slots);
      
      let message = `✅ ${response.slots_added}件の候補を追加しました:\n\n`;
      proposals.forEach((proposal: any, index: number) => {
        message += `${index + 1}. ${proposal.label}\n`;
      });
      message += '\n💡 既存の回答は保持されています。新しい候補について再回答を依頼してください。';
      
      return {
        success: true,
        message,
        data: {
          kind: 'auto_propose.slots_added',
          payload: {
            thread_id: threadId,
            slots_added: response.slots_added,
            slot_ids: response.slot_ids,
          },
        },
      };
    }
    
    // Default: 新規スレッド作成
    // Build candidates from emails
    const candidates = emails.map((email: string) => ({
      email,
      name: email.split('@')[0], // Use email prefix as name
    }));
    
    // Create thread with proposals as slots
    const response = await threadsApi.create({
      title: '日程調整（自動生成）',
      description: `所要時間: ${duration}分`,
      candidates,
      // Note: If backend doesn't accept slots, this will be ignored
      // In that case, slots will be empty and need manual addition
    });
    
    // Build success message with invite URLs
    const inviteCount = response.candidates?.length || 0;
    let message = `✅ スレッドを作成しました（${inviteCount}名）\n\n`;
    
    message += `📅 候補日時（${proposals.length}件）:\n`;
    proposals.forEach((proposal, index) => {
      message += `${index + 1}. ${proposal.label}\n`;
    });
    message += '\n';
    
    if (inviteCount > 0) {
      message += '📧 招待リンク:\n';
      
      // Show ALL invite URLs
      response.candidates?.forEach((c: any) => {
        message += `- ${c.email}: ${c.invite_url}\n`;
      });
      
      message += '\n💡 リンクをコピーして送信してください。';
    }

    // P1-1: スレッド作成後に refresh
    const createdThreadId = response.thread?.id;
    if (createdThreadId) {
      await refreshAfterWrite('THREAD_CREATE', createdThreadId);
    }
    
    return {
      success: true,
      message,
      data: {
        kind: 'auto_propose.created',
        payload: response,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P2-3: schedule.auto_propose.cancel
 * Phase Next-5 Day2: 提案キャンセル
 * Phase Next-5 Day2.1: Type-safe result
 */
export async function executeAutoProposeCancel(): Promise<ExecutionResult> {
  return {
    success: true,
    message: '✅ 候補をキャンセルしました。\n新しく候補を生成する場合は「〇〇に候補出して」と入力してください。',
    data: {
      kind: 'auto_propose.cancelled',
      payload: {},
    },
  };
}

/**
 * P2-4: schedule.additional_propose
 * Phase Next-5 Day3: 追加候補提案（提案のみ、POSTなし）
 * 
 * Flow:
 * 1. 実行回数チェック（最大2回まで）
 * 2. status を取得
 * 3. analyzeStatusForPropose で判定
 * 4. 条件を満たす場合: 追加候補を3本生成（既存スロットと重複回避）
 * 5. 「この候補を追加しますか？」を表示
 * 6. 「はい」で confirm フローに乗る（POST は confirm 時のみ）
 */
export async function executeAdditionalPropose(
  intentResult: IntentResult,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  const { threadId } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドに追加候補を提案しますか？\n左のスレッド一覧から選択してください。',
      },
    };
  }
  
  try {
    // (1) スレッド状態を取得
    const status = await getStatusWithCache(threadId);
    
    // (2) 追加候補が必要か判定
    const needsMoreProposals = analyzeStatusForPropose(status);
    
    if (!needsMoreProposals) {
      return {
        success: true,
        message: '現在の状況では追加候補は不要です。\n\n未返信が少なく、投票も安定しています。',
      };
    }
    
    // (3) 候補を生成（30分、来週分）
    const duration = 30;
    const allProposals = generateProposalsWithoutBusy(duration);
    
    // 既存スロットと重複回避
    const existingTimes = status.slots.map((slot) => `${slot.start_at}|${slot.end_at}`);
    const newProposals = allProposals.filter((p) => 
      !existingTimes.includes(`${p.start_at}|${p.end_at}`)
    ).slice(0, 3);
    
    if (newProposals.length === 0) {
      return {
        success: false,
        message: '❌ 追加可能な候補がありません。\n\n既存の候補と重複しています。',
      };
    }
    
    // (4) POST /api/threads/:id/proposals/prepare
    const response = await threadsApi.prepareAdditionalSlots(
      threadId,
      newProposals.map((p) => ({
        start_at: p.start_at,
        end_at: p.end_at,
        label: p.label,
      }))
    );
    
    // (5) pending_action.created として返す
    return {
      success: true,
      message: response.message_for_chat,
      data: {
        kind: 'pending.action.created',
        payload: {
          actionType: 'add_slots',
          confirmToken: response.confirm_token,
          expiresAt: response.expires_at,
          summary: response.summary,
          mode: 'add_slots',
          threadId: response.thread_id,
          threadTitle: response.thread_title,
          proposalVersion: response.next_proposal_version,
          remainingProposals: response.remaining_proposals,
        },
      },
    };
  } catch (error: any) {
    // エラーレスポンスの処理
    if (error?.error === 'invalid_status') {
      return {
        success: false,
        message: `❌ ${error.message || '追加候補を出せない状態です。'}`,
      };
    }
    if (error?.error === 'max_proposals_reached') {
      return {
        success: false,
        message: `❌ ${error.message || '追加候補は最大2回までです。'}`,
      };
    }
    if (error?.error === 'all_duplicates') {
      return {
        success: false,
        message: `❌ ${error.message || '全ての候補が既存と重複しています。'}`,
      };
    }
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
    };
  }
}

/**
 * Wrapper for executeAdditionalPropose (Phase Next-6 Day2)
 * This allows calling from split.confirm without IntentResult dependency
 */
export async function executeAdditionalProposeByThreadId(
  threadId: string,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // Call executeAdditionalPropose with a synthetic IntentResult
  return executeAdditionalPropose(
    {
      intent: 'schedule.additional_propose',
      confidence: 1.0,
      params: { threadId },
    },
    context
  );
}

/**
 * P3-7: schedule.propose_for_split.confirm
 * Phase Next-6 Day2: 票割れ提案確定 → Day3 に誘導
 * P0-1: 正規化された pending を使用
 */
export async function executeProposeForSplitConfirm(
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // P0-1: 正規化された pending から split.propose を取得
  const activePending = context?.pendingForThread ?? context?.globalPendingAction ?? null;
  const pending = isPendingSplit(activePending) ? activePending : null;
  
  if (!pending?.threadId) {
    return {
      success: false,
      message: '❌ 票割れの提案がありません。\n先に状況を確認してください。',
    };
  }
  
  // A案: 内部的に Day3 の追加候補提案を呼ぶ（提案のみ、POSTなし）
  return executeAdditionalProposeByThreadId(pending.threadId, context);
}

/**
 * P3-8: schedule.propose_for_split.cancel
 * Phase Next-6 Day2: 票割れ提案キャンセル
 */
export async function executeProposeForSplitCancel(): Promise<ExecutionResult> {
  return {
    success: true,
    message: '✅ 票割れの追加提案をキャンセルしました。',
    data: {
      kind: 'split.propose.cancelled',
      payload: {},
    },
  };
}
