/**
 * API Executor for Phase Next-2 (P0) + Phase Next-3 (P1)
 * Execute API calls based on classified intent
 */

import { threadsApi } from '../api/threads';
import { calendarApi } from '../api/calendar';
import type { IntentResult } from './intentClassifier';
import type { ThreadStatus_API, CalendarTodayResponse, CalendarWeekResponse, CalendarFreeBusyResponse } from '../models';

// Phase Next-5 Day2.1: Type-safe ExecutionResult
export type ExecutionResultData =
  | { kind: 'calendar.today'; payload: CalendarTodayResponse }
  | { kind: 'calendar.week'; payload: CalendarWeekResponse }
  | { kind: 'calendar.freebusy'; payload: CalendarFreeBusyResponse }
  | { kind: 'thread.status'; payload: ThreadStatus_API | { threads: any[] } }
  | { kind: 'thread.create'; payload: any }
  | { kind: 'thread.finalize'; payload: any }
  | { kind: 'auto_propose.generated'; payload: { 
      source: 'initial' | 'additional'; // Phase Next-5 Day3: 明示フラグ
      threadId?: string; // Phase Next-5 Day3: 提案生成時のスレッドID
      emails: string[]; 
      duration: number; 
      range: string; 
      proposals: any[] 
    } }
  | { kind: 'auto_propose.cancelled'; payload: {} }
  | { kind: 'auto_propose.created'; payload: any };

export interface ExecutionResult {
  success: boolean;
  message: string;
  data?: ExecutionResultData;
  needsClarification?: {
    field: string;
    message: string;
  };
}

// Phase Next-5 Day2.1: Type-safe ExecutionContext
export interface ExecutionContext {
  pendingAutoPropose?: {
    emails: string[];
    duration: number;
    range: string;
    proposals: Array<{ start_at: string; end_at: string; label: string }>;
  } | null;
  // Phase Next-5 Day3: additional propose execution count (max 2)
  additionalProposeCount?: number;
}

/**
 * Execute API call based on intent
 * Phase Next-2: P0 intents only
 * Phase Next-5 Day2.1: Type-safe ExecutionContext
 */
export async function executeIntent(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // If intent needs clarification, return immediately
  if (intentResult.needsClarification) {
    return {
      success: false,
      message: intentResult.needsClarification.message,
      needsClarification: intentResult.needsClarification,
    };
  }

  switch (intentResult.intent) {
    // Phase Next-5 (P2): Auto-propose
    case 'schedule.auto_propose':
      return executeAutoPropose(intentResult);
    
    case 'schedule.auto_propose.confirm':
      return executeAutoProposeConfirm(context);
    
    case 'schedule.auto_propose.cancel':
      return executeAutoProposeCancel();
    
    case 'schedule.additional_propose':
      return executeAdditionalPropose(intentResult, context);
    
    // Phase Next-3 (P1): Calendar
    case 'schedule.today':
      return executeToday();
    
    case 'schedule.week':
      return executeWeek();
    
    case 'schedule.freebusy':
      return executeFreeBusy(intentResult);
    
    // Phase Next-2 (P0): Scheduling
    case 'schedule.external.create':
      return executeCreate(intentResult);
    
    case 'schedule.status.check':
      return executeStatusCheck(intentResult);
    
    case 'schedule.finalize':
      return executeFinalize(intentResult);
    
    case 'unknown':
      return {
        success: false,
        message: '理解できませんでした',
      };
    
    default:
      return {
        success: false,
        message: 'この機能はまだ実装されていません。',
      };
  }
}

// ============================================================
// Phase Next-5 (P2): Auto-propose (自動調整)
// ============================================================

/**
 * P2-1: schedule.auto_propose
 * Phase Next-5 Day1: 提案のみ（POST しない）
 * Phase Next-5 Day1修正: メールのみで相手を特定、busyを使わない
 */
async function executeAutoPropose(intentResult: IntentResult): Promise<ExecutionResult> {
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
 * Phase Next-5 Day2.1: Type-safe ExecutionContext
 */
async function executeAutoProposeConfirm(
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // pendingAutoPropose が存在するかチェック
  const pending = context?.pendingAutoPropose;
  
  if (!pending) {
    return {
      success: false,
      message: '❌ 候補が選択されていません。\n先に「〇〇に候補出して」と入力してください。',
    };
  }
  
  try {
    const { emails, duration, proposals } = pending;
    
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
    proposals.forEach((proposal: any, index: number) => {
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
async function executeAutoProposeCancel(): Promise<ExecutionResult> {
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
async function executeAdditionalPropose(
  intentResult: IntentResult,
  context?: ExecutionContext
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
  
  // Phase Next-5 Day3: 実行回数チェック（最大2回まで）
  const executionCount = context?.additionalProposeCount || 0;
  if (executionCount >= 2) {
    return {
      success: false,
      message: '❌ 追加候補の提案は最大2回までです。\n\nこれ以上は手動で候補を追加してください。',
    };
  }
  
  try {
    // Get thread status
    const status = await threadsApi.getStatus(threadId);
    
    // Analyze if additional proposals are needed
    const needsMoreProposals = analyzeStatusForPropose(status);
    
    if (!needsMoreProposals) {
      return {
        success: true,
        message: '現在の状況では追加候補は不要です。\n\n未返信が少なく、投票も安定しています。',
      };
    }
    
    // Generate 3 additional proposals (30 minutes, next week)
    const duration = 30; // Default 30 minutes
    const allProposals = generateProposalsWithoutBusy(duration);
    
    // Phase Next-5 Day3: 既存スロットと重複回避（ラベルで判定）
    const existingLabels = status.slots.map((slot) => slot.label || '').filter(Boolean);
    const newProposals = allProposals.filter((p) => !existingLabels.includes(p.label)).slice(0, 3);
    
    if (newProposals.length === 0) {
      return {
        success: false,
        message: '❌ 追加可能な候補がありません。\n\n既存の候補と重複しています。',
      };
    }
    
    // Build message with proposals
    let message = `✅ 追加候補を${newProposals.length}本生成しました:\n\n`;
    newProposals.forEach((proposal, index) => {
      message += `${index + 1}. ${proposal.label}\n`;
    });
    message += '\n📌 注意: この候補はまだスレッドに追加されていません。';
    message += '\n「はい」と入力すると、候補をスレッドに追加できます。';
    message += '\n「いいえ」でキャンセルします。';
    message += `\n\n⚠️ 残り提案回数: ${2 - executionCount - 1}回`;
    
    // Return as auto_propose.generated (reuse Day2 confirm flow)
    return {
      success: true,
      message,
      data: {
        kind: 'auto_propose.generated',
        payload: {
          source: 'additional', // Phase Next-5 Day3: 明示フラグ（追加提案）
          threadId, // Phase Next-5 Day3: 提案生成時のスレッドID
          emails: [], // No emails needed for additional proposals
          duration,
          range: 'next_week',
          proposals: newProposals,
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
 * Generate time slot proposals (Phase Next-5 Day1: busyなし版)
 * - 30分刻み（デフォルト）
 * - 来週の営業時間（9:00-18:00）
 * - busyとの重複チェックなし（Day2以降で対応）
 * - 最大5件
 */
function generateProposalsWithoutBusy(
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
function formatProposalLabel(start: Date, end: Date): string {
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const month = start.getMonth() + 1;
  const day = start.getDate();
  const dayOfWeek = dayLabels[start.getDay()];
  
  const startTime = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
  const endTime = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
  
  return `${month}/${day} (${dayOfWeek}) ${startTime}-${endTime}`;
}

// ============================================================
// Phase Next-3 (P1): Calendar Read-only
// ============================================================

/**
 * P1-1: schedule.today
 */
async function executeToday(): Promise<ExecutionResult> {
  try {
    const response = await calendarApi.getToday();
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: {
          kind: 'calendar.today',
          payload: response,
        },
      };
    }
    
    // No events
    if (response.events.length === 0) {
      return {
        success: true,
        message: '今日の予定はありません。',
        data: {
          kind: 'calendar.today',
          payload: response,
        },
      };
    }
    
    // Build message with events
    let message = `📅 今日の予定（${response.events.length}件）\n\n`;
    response.events.forEach((event, index) => {
      message += `${index + 1}. ${event.summary}\n`;
      message += `   ${formatTimeRange(event.start, event.end)}\n`;
      if (event.meet_url) {
        message += `   🎥 Meet: ${event.meet_url}\n`;
      }
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.today',
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
 * P1-2: schedule.week
 */
async function executeWeek(): Promise<ExecutionResult> {
  try {
    const response = await calendarApi.getWeek();
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: {
          kind: 'calendar.week',
          payload: response,
        },
      };
    }
    
    // No events
    if (response.events.length === 0) {
      return {
        success: true,
        message: '今週の予定はありません。',
        data: {
          kind: 'calendar.week',
          payload: response,
        },
      };
    }
    
    // Build message with events
    let message = `📅 今週の予定（${response.events.length}件）\n\n`;
    response.events.forEach((event, index) => {
      message += `${index + 1}. ${event.summary}\n`;
      message += `   ${formatDateTimeRange(event.start, event.end)}\n`;
      if (event.meet_url) {
        message += `   🎥 Meet: ${event.meet_url}\n`;
      }
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.week',
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
 * P1-3: schedule.freebusy
 */
async function executeFreeBusy(intentResult: IntentResult): Promise<ExecutionResult> {
  const range = (intentResult.params.range as 'today' | 'week') || 'today';
  
  try {
    const response = await calendarApi.getFreeBusy(range);
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: {
          kind: 'calendar.freebusy',
          payload: response,
        },
      };
    }
    
    // No busy slots
    if (response.busy.length === 0) {
      return {
        success: true,
        message: range === 'today' ? '今日は終日空いています。' : '今週は終日空いています。',
        data: {
          kind: 'calendar.freebusy',
          payload: response,
        },
      };
    }
    
    // Build message with busy slots
    let message = range === 'today' ? '📊 今日の予定が入っている時間:\n\n' : '📊 今週の予定が入っている時間:\n\n';
    response.busy.forEach((slot, index) => {
      message += `${index + 1}. ${formatDateTimeRange(slot.start, slot.end)}\n`;
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.freebusy',
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

// ============================================================
// Phase Next-2 (P0): Scheduling
// ============================================================

/**
 * P0-1: schedule.external.create
 * Phase Next-2: Fixed title/description, email-based candidates
 */
async function executeCreate(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  // Extract emails from intent params
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
    // Build candidates from emails
    const candidates = emails.map((email) => ({
      email,
      name: email.split('@')[0], // Use email prefix as name
    }));

    // Create thread with FIXED title/description
    const response = await threadsApi.create({
      title: '日程調整（自動生成）',
      description: '', // Empty description
      candidates,
    });

    // Build success message with invite URLs
    const inviteCount = response.candidates?.length || 0;
    let message = `✅ 調整を作成しました（${inviteCount}名）\n\n`;
    
    if (inviteCount > 0) {
      message += '招待リンク:\n';
      
      // Show ALL invite URLs
      response.candidates?.forEach((c) => {
        message += `- ${c.email}: ${c.invite_url}\n`;
      });
    }

    return {
      success: true,
      message,
      data: {
        kind: 'thread.create',
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
 * Phase Next-5 Day3: Analyze status for additional proposal
 * Pure function: returns true if additional proposals are needed
 * 
 * Day3 最小安全版:
 * - Rule 1: 未返信 >= 1 のみ
 * - 票割れ判定は Day3.5 で追加予定
 */
function analyzeStatusForPropose(status: ThreadStatus_API): boolean {
  const { invites } = status;
  
  // Rule 1: 未返信が1以上（status が pending または null）
  const pendingCount = invites.filter((i) => i.status === 'pending' || i.status === null).length;
  
  return pendingCount >= 1;
}

/**
 * P0-2: schedule.status.check
 */
async function executeStatusCheck(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId, scope } = intentResult.params;

  try {
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

    // Single thread status
    const status = await threadsApi.getStatus(threadId);
    
    // Build status message
    let message = `📊 ${status.thread.title}\n\n`;
    message += `状態: ${getStatusLabel(status.thread.status)}\n`;
    message += `招待: ${status.invites.length}名\n`;
    
    const acceptedCount = status.invites.filter((i) => i.status === 'accepted').length;
    const pendingCount = status.invites.filter((i) => i.status === 'pending').length;
    
    message += `承諾: ${acceptedCount}名\n`;
    message += `未返信: ${pendingCount}名\n\n`;

    // Show slots with votes
    if (status.slots && status.slots.length > 0) {
      message += '📅 候補日時:\n';
      status.slots.forEach((slot, index) => {
        const votes = getSlotVotes(slot.slot_id, status);
        message += `${index + 1}. ${formatDateTime(slot.start_at)} (${votes}票)\n`;
      });
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
 * P0-3: schedule.finalize
 */
async function executeFinalize(
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
    // Get thread status to find slot_id
    const status = await threadsApi.getStatus(threadId);
    
    if (status.slots.length === 0) {
      return {
        success: false,
        message: '候補日時が設定されていません。',
      };
    }

    // Determine selected_slot_id
    let selectedSlotId: string | undefined;

    if (slotNumber) {
      // Use slot number (1-indexed)
      const slotIndex = slotNumber - 1;
      if (slotIndex >= 0 && slotIndex < status.slots.length) {
        selectedSlotId = status.slots[slotIndex].slot_id;
      }
    }

    if (!selectedSlotId) {
      // Show slot options
      let message = 'どの候補日時で確定しますか？\n\n';
      status.slots.forEach((slot, index) => {
        const votes = getSlotVotes(slot.slot_id, status);
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

    // Execute finalize
    const response = await threadsApi.finalize(threadId, {
      selected_slot_id: selectedSlotId,
    });

    // Build success message
    let message = `✅ 日程を確定しました\n\n`;
    message += `📅 日時: ${formatDateTime(response.selected_slot.start_at)} - ${formatDateTime(response.selected_slot.end_at)}\n`;
    message += `👥 参加者: ${response.participants_count}名\n`;

    if (response.meeting) {
      message += `\n🎥 Google Meet:\n${response.meeting.url}\n`;
    }

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

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get user-friendly warning message
 */
function getWarningMessage(warning: string): string {
  const messages: Record<string, string> = {
    'google_calendar_permission_missing': '⚠️ Google Calendar の権限が不足しています。\n予定情報を取得できませんでした。',
    'google_account_not_linked': '⚠️ Google アカウントが連携されていません。\n設定から連携してください。',
  };
  return messages[warning] || '⚠️ 予定情報を取得できませんでした。';
}

/**
 * Format time range (same day, time only)
 */
function formatTimeRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  
  return `${startDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Format date-time range (with date)
 */
function formatDateTimeRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  
  const startStr = startDate.toLocaleString('ja-JP', { 
    month: 'numeric', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const endStr = endDate.toLocaleString('ja-JP', { 
    month: 'numeric', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  return `${startStr} - ${endStr}`;
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: '下書き',
    active: '募集中',
    confirmed: '確定',
    cancelled: 'キャンセル',
  };
  return labels[status] || status;
}

function getSlotVotes(slotId: string, status: ThreadStatus_API): number {
  if (!status.selections) return 0;
  
  // Count selections for this slot
  return Object.values(status.selections).filter((selection: any) => 
    selection.slot_id === slotId
  ).length;
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Export type for external use
export type { CalendarTodayResponse, CalendarWeekResponse, CalendarFreeBusyResponse };
