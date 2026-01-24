/**
 * Thread Executors
 * TD-002: Split from apiExecutor.ts
 * PROG-1: 進捗要約機能追加
 * 
 * Handles:
 * - schedule.create (P0-2a)
 * - schedule.status.check (P0-2)
 * - schedule.progress.summary (PROG-1) - 会話向け進捗要約
 * - schedule.finalize (P0-3)
 * - thread.create (P0-5)
 * - schedule.invite.list (P0-4)
 */

import { threadsApi, listsApi } from '../../api';
import type { ThreadSummaryResponse } from '../../api/threads';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import type { ThreadStatus_API } from '../../models';
import { formatDateTimeForViewer, DEFAULT_TIMEZONE } from '../../../utils/datetime';
import { threadStatusCache } from '../../cache';
// P0-2: Write 後の refresh 強制
import { getRefreshActions, type WriteOp } from '../../refresh/refreshMap';
import { runRefresh } from '../../refresh/runRefresh';
// P1-2: Structured logger
import { log } from '../../platform';

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get status with cache update
 * Always fetches fresh data and updates cache
 */
async function getStatusWithCache(threadId: string): Promise<ThreadStatus_API> {
  const status = await threadsApi.getStatus(threadId);
  threadStatusCache.setStatus(threadId, status);
  return status;
}

/**
 * P0-2: Write 操作後に必須の refresh を実行
 */
async function refreshAfterWrite(op: WriteOp, threadId: string): Promise<void> {
  try {
    await runRefresh(getRefreshActions(op, { threadId }));
  } catch (e) {
    // P1-2: 構造化ログで追跡可能に
    log.warn('refreshAfterWrite failed', { module: 'thread', writeOp: op, threadId, err: e });
  }
}

/**
 * Status label helper
 */
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: '下書き',
    active: '募集中',
    confirmed: '確定済み',
    cancelled: 'キャンセル',
  };
  return labels[status] || status;
}

/**
 * Format datetime for display
 */
function formatDateTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return formatDateTimeForViewer(date, DEFAULT_TIMEZONE);
  } catch {
    return dateStr;
  }
}

/**
 * Phase Next-5 Day3: Analyze status for additional proposal
 * Pure function: returns true if additional proposals are needed
 */
function analyzeStatusForPropose(status: ThreadStatus_API): boolean {
  const { invites } = status;
  const pendingCount = invites.filter((i) => i.status === 'pending' || i.status === null).length;
  return pendingCount >= 1;
}

/**
 * Phase Next-6 Day2: Analyze split votes
 */
function analyzeSplitVotes(status: ThreadStatus_API): {
  shouldPropose: boolean;
  summary: Array<{ label: string; votes: number }>;
} {
  const { slots } = status;
  
  if (!slots || slots.length < 2) {
    return { shouldPropose: false, summary: [] };
  }

  // Build vote summary
  const summary = slots.map((slot) => ({
    label: formatDateTime(slot.start_at),
    votes: slot.votes ?? 0,
  }));

  // Sort by votes descending
  summary.sort((a, b) => b.votes - a.votes);

  // Check for split: top 2 slots have same or close votes
  if (summary.length >= 2) {
    const top = summary[0].votes;
    const second = summary[1].votes;
    
    // Split if: both have votes AND difference is small
    if (top > 0 && second > 0 && (top === second || (top - second) <= 1)) {
      return { shouldPropose: true, summary };
    }
  }

  return { shouldPropose: false, summary };
}

// ============================================================
// Executors
// ============================================================

/**
 * P0-2a: schedule.create
 * Creates a thread with email invites
 */
export async function executeCreate(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const emails = intentResult.params.emails as string[] | undefined;
  
  if (!emails || emails.length === 0) {
    return {
      success: false,
      message: '送信先のメールアドレスを貼ってください。\n\n例: tanaka@example.com',
      needsClarification: {
        field: 'emails',
        message: '送信先のメールアドレスを貼ってください。',
      },
    };
  }

  try {
    const candidates = emails.map((email) => ({
      email,
      name: email.split('@')[0],
    }));

    const response = await threadsApi.create({
      title: '日程調整（自動生成）',
      description: '',
      candidates,
    });

    const inviteCount = response.candidates?.length || 0;
    let message = `✅ 調整を作成しました（${inviteCount}名）\n\n`;
    
    if (inviteCount > 0) {
      message += '招待リンク:\n';
      response.candidates?.forEach((c) => {
        message += `- ${c.email}: ${c.invite_url}\n`;
      });
    }

    const threadId = response.thread?.id;
    if (!threadId) {
      return {
        success: false,
        message: '❌ スレッド作成に失敗しました（threadId取得不可）',
      };
    }

    // P1-1: スレッド作成後に refresh
    await refreshAfterWrite('THREAD_CREATE', threadId);

    return {
      success: true,
      message,
      data: {
        kind: 'thread.create',
        payload: { threadId },
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
 * P0-2: schedule.status.check
 * PROG-1: mode='summary' の場合は会話向け要約を返す
 */
export async function executeStatusCheck(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId, scope, mode } = intentResult.params;

  try {
    // PROG-1: 会話向け要約モード
    if (mode === 'summary' && threadId) {
      return executeProgressSummary(threadId);
    }

    // All threads
    if (scope === 'all' || !threadId) {
      const response = await threadsApi.list();
      const activeThreads = response.threads.filter((t) => t.status === 'active');
      
      if (activeThreads.length === 0) {
        return {
          success: true,
          message: '現在、募集中の調整はありません。',
        };
      }

      let message = `📋 現在募集中の調整（${activeThreads.length}件）\n\n`;
      activeThreads.forEach((thread, index) => {
        message += `${index + 1}. ${thread.title}\n`;
        message += `   作成日: ${new Date(thread.created_at).toLocaleDateString('ja-JP')}\n\n`;
      });

      return {
        success: true,
        message,
        data: {
          kind: 'thread.status',
          payload: { threads: activeThreads },
        },
      };
    }

    // PROG-1: threadId がある場合はデフォルトで要約を返す
    // （従来の詳細表示が必要な場合は mode='detail' を指定）
    if (mode !== 'detail') {
      return executeProgressSummary(threadId);
    }

    // Single thread status (従来の詳細表示)
    const status = await getStatusWithCache(threadId);
    
    let message = `📊 ${status.thread.title}\n\n`;
    message += `状態: ${getStatusLabel(status.thread.status)}\n`;
    message += `招待: ${status.invites.length}名\n`;
    
    const acceptedCount = status.invites.filter((i) => i.status === 'accepted').length;
    const pendingCount = status.invites.filter((i) => i.status === 'pending').length;
    
    message += `承諾: ${acceptedCount}名\n`;
    message += `未返信: ${pendingCount}名\n\n`;

    if (status.slots && status.slots.length > 0) {
      message += '📅 候補日時:\n';
      status.slots.forEach((slot, index) => {
        const votes = slot.votes ?? 0;
        message += `${index + 1}. ${formatDateTime(slot.start_at)} (${votes}票)\n`;
      });
    }
    
    // Phase Next-6 Day2: 票割れ検知
    const split = analyzeSplitVotes(status);
    
    if (split.shouldPropose) {
      message += '\n\n💡 票が割れています。追加候補を出しますか？';
      message += '\n\n現在の投票状況:\n';
      split.summary.forEach((item) => {
        message += `- ${item.label}: ${item.votes}票\n`;
      });
      message += '\n「はい」で追加候補を3本提案します。';
      message += '\n「いいえ」でキャンセルします。';
      
      return {
        success: true,
        message,
        data: {
          kind: 'split.propose.generated',
          payload: {
            source: 'split',
            threadId: status.thread.id,
            voteSummary: split.summary,
          },
        },
      };
    }
    
    // Phase Next-5 Day3: 追加提案の判定
    const needsMoreProposals = analyzeStatusForPropose(status);
    
    if (needsMoreProposals) {
      message += '\n💡 未返信や票割れが発生しています。';
      message += '\n「追加候補出して」と入力すると、追加の候補日時を提案できます。';
    }

    return {
      success: true,
      message,
      data: {
        kind: 'thread.status',
        payload: status,
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
 * PROG-1: 進捗要約（会話向け）
 * 「今どうなってる？」に答えるための要約
 */
export async function executeProgressSummary(
  threadId: string
): Promise<ExecutionResult> {
  try {
    const response: ThreadSummaryResponse = await threadsApi.getSummary(threadId, 'chat');
    
    if (!response.success) {
      return {
        success: false,
        message: '❌ 進捗の取得に失敗しました。',
      };
    }

    // format=chat の場合、message が会話向けテキスト
    const message = response.message || formatSummaryFallback(response.data);

    return {
      success: true,
      message,
      data: {
        kind: 'thread.progress.summary',
        payload: response.data,
      },
    };
  } catch (error) {
    log.error('executeProgressSummary failed', { 
      module: 'thread', 
      threadId, 
      err: error 
    });
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * PROG-1: フォールバック用のフォーマット（APIがchatを返さない場合）
 */
function formatSummaryFallback(data: ThreadSummaryResponse['data']): string {
  const { thread, proposal, counts, failure, next_recommended_action, recommendation_reason, notes } = data;
  
  const statusLabels: Record<string, string> = {
    draft: '下書き',
    active: '募集中',
    confirmed: '確定済み',
    cancelled: 'キャンセル',
  };

  let message = `📌 **進捗: ${thread.title}**\n\n`;
  message += `状態: ${statusLabels[thread.status] || thread.status}（v${proposal.current_version}`;
  if (proposal.remaining_proposals > 0) {
    message += ` / 追加候補あと${proposal.remaining_proposals}回可`;
  }
  message += `）\n`;
  message += `候補数: ${proposal.total_slots}件\n\n`;

  message += `👥 **招待者: ${counts.total}名**\n`;
  if (counts.pending > 0) message += `• 未回答: ${counts.pending}名\n`;
  if (counts.responded_old > 0) message += `• 再回答必要: ${counts.responded_old}名\n`;
  if (counts.responded_latest > 0) message += `• 回答済み: ${counts.responded_latest}名\n`;
  if (counts.declined > 0) message += `• 辞退: ${counts.declined}名\n`;

  message += `\n✅ **次のおすすめ:**\n${recommendation_reason}\n`;

  const actionHints: Record<string, string> = {
    remind: '「リマインドして」と入力してください',
    remind_need_response: '「再回答リマインドして」と入力してください',
    propose_more: '「追加候補出して」と入力してください',
    finalize: '「確定して」と入力してください',
    reschedule: '「再調整して」と入力してください',
    wait: '回答をお待ちください',
    none: '',
  };
  const hint = actionHints[next_recommended_action];
  if (hint) message += `\n💡 ${hint}`;

  // FAIL-1: 失敗回数とエスカレーション
  if (failure && failure.total_failures > 0) {
    message += `\n\n❌ **失敗: ${failure.total_failures}回**\n`;
    if (failure.escalation_level === 2 && failure.recommended_actions?.length > 0) {
      message += '合わない状態が続いています。次の手を選んでください:\n';
      for (const action of failure.recommended_actions) {
        message += `• 「${action.label}」→ ${action.description}\n`;
      }
    }
  }

  if (notes && notes.length > 0) {
    message += `\n\n⚠️ 注意:\n`;
    for (const note of notes) {
      message += `• ${note}\n`;
    }
  }

  return message;
}

/**
 * P0-3: schedule.finalize
 */
export async function executeFinalize(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId, slotNumber } = intentResult.params;

  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドの日程を確定しますか？',
      },
    };
  }

  try {
    const status = await getStatusWithCache(threadId);
    
    if (!status.slots || status.slots.length === 0) {
      return {
        success: false,
        message: '候補日時が設定されていません。',
      };
    }

    let selectedSlotId: string | undefined;

    if (typeof slotNumber === 'number' && slotNumber > 0) {
      const slotIndex = slotNumber - 1;
      
      if (slotIndex >= 0 && slotIndex < status.slots.length) {
        selectedSlotId = status.slots[slotIndex].slot_id;
      } else {
        return {
          success: false,
          message: `候補番号が範囲外です。1〜${status.slots.length} の範囲で指定してください。`,
        };
      }
    }

    if (!selectedSlotId) {
      let message = 'どの候補日時で確定しますか？\n\n';
      status.slots.forEach((slot, index) => {
        const votes = slot.votes ?? 0;
        message += `${index + 1}. ${formatDateTime(slot.start_at)} (${votes}票)\n`;
      });
      message += '\n番号を入力してください（例: 1番で確定）';

      return {
        success: false,
        message,
        needsClarification: {
          field: 'slotId',
          message,
        },
      };
    }

    const response = await threadsApi.finalize(threadId, {
      selected_slot_id: selectedSlotId,
    });

    let message = `✅ 日程を確定しました\n\n`;
    message += `📅 日時: ${formatDateTime(response.selected_slot.start_at)} - ${formatDateTime(response.selected_slot.end_at)}\n`;
    message += `👥 参加者: ${response.participants_count}名\n`;

    if (response.meeting) {
      message += `\n🎥 Google Meet:\n${response.meeting.url}\n`;
    }

    // P0-2: Write 後の refresh 強制
    await refreshAfterWrite('FINALIZE', threadId);

    return {
      success: true,
      message,
      data: {
        kind: 'thread.finalize',
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
 * P0-5: thread.create
 * Creates a new empty thread
 */
export async function executeThreadCreate(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  try {
    const raw = (intentResult.params?.rawInput ?? '').toString();
    const title = '日程調整';
    const description = raw.length > 0 ? raw : '';

    const created: any = await threadsApi.create({ title, description });

    const threadId =
      created?.thread?.id ??
      created?.thread_id ??
      created?.id ??
      null;

    if (!threadId) {
      return {
        success: false,
        message: '❌ スレッドは作成されましたが、threadId が取得できませんでした',
      };
    }

    // P1-1: スレッド作成後に refresh
    await refreshAfterWrite('THREAD_CREATE', threadId);

    return {
      success: true,
      message: `✅ スレッドを作成しました。\nこのまま「候補出して」「来週の午後で」など入力してください。`,
      data: { kind: 'thread.create', payload: { threadId } },
    };
  } catch (e: any) {
    return {
      success: false,
      message: `❌ スレッド作成に失敗しました: ${e?.message ?? String(e)}`,
    };
  }
}

/**
 * P0-4: schedule.invite.list
 * Sends invites to all members of a list
 */
export async function executeInviteList(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { listName, threadId } = intentResult.params;

  try {
    const listsResponse = await listsApi.list() as any;
    const lists = listsResponse.lists || listsResponse.items || [];

    const targetList = lists.find((list: any) => list.name === listName);

    if (!targetList) {
      return {
        success: false,
        message: `❌ リスト「${listName}」が見つかりませんでした。\n\n利用可能なリスト:\n${lists.map((l: any) => `- ${l.name}`).join('\n')}`,
      };
    }

    let ensuredThreadId = threadId;

    if (!ensuredThreadId) {
      const created: any = await threadsApi.create({
        title: '日程調整',
        description: `招待: ${listName}`,
      });
      ensuredThreadId = created?.thread?.id ?? created?.thread_id ?? created?.id ?? null;

      if (!ensuredThreadId) {
        return { success: false, message: '❌ スレッド作成に失敗しました（threadId取得不可）' };
      }

      // P1-1: スレッド作成後に refresh
      await refreshAfterWrite('THREAD_CREATE', ensuredThreadId);
    }

    const membersResponse = await listsApi.getMembers(targetList.id) as any;
    const membersCount = membersResponse.members?.length || membersResponse.items?.length || 0;

    if (membersCount === 0) {
      return {
        success: false,
        message: `❌ リスト「${listName}」にメンバーがいません。\n先にメンバーを追加してください。`,
      };
    }

    // Execute batch invite
    const batchResponse = await threadsApi.addBulkInvites(ensuredThreadId, {
      target_list_id: targetList.id,
    });

    let message = `✅ ${listName}のメンバー${batchResponse.inserted}名に招待を送信しました`;

    if (batchResponse.skipped > 0) {
      message += `\n⚠️ ${batchResponse.skipped}名はスキップされました（重複など）`;
    }

    return {
      success: true,
      message,
      data: {
        kind: 'thread.invites.batch',
        payload: batchResponse,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
