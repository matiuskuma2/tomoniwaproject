/**
 * API Executor for Phase Next-2 (P0) + Phase Next-3 (P1)
 * Execute API calls based on classified intent
 */

/**
 * API Executor for Phase Next-2 (P0) + Phase Next-3 (P1)
 * Execute API calls based on classified intent
 * 
 * P1-1: 一部の executor を executors/ に分割
 * - calendar.ts: schedule.today, schedule.week, schedule.freebusy
 * - list.ts: list.create, list.list, list.members, list.add_member
 */

import { threadsApi } from '../api/threads';
// Phase 1-1: listsApi, contactsApi は executors/invite.ts に移動
// Phase 1-2: pendingActionsApi, PendingDecision は executors/pending.ts に移動
import type { IntentResult } from './intentClassifier';
import type { ThreadStatus_API, CalendarTodayResponse, CalendarWeekResponse, CalendarFreeBusyResponse } from '../models';
import { formatDateTimeForViewer, DEFAULT_TIMEZONE } from '../../utils/datetime';
import { setStatus as setCacheStatus } from '../cache';
// P0-1: PendingState 正規化
import type { PendingState } from './pendingTypes';
// P0-2: Write 後の refresh 強制
import { getRefreshActions, type WriteOp } from '../refresh/refreshMap';
import { runRefresh } from '../refresh/runRefresh';
// P1-2: Structured logger
import { log } from '../platform';
// TD-REMIND-UNIFY: remind 系は executors に統一したため、以下の import は不要になった
// isPendingRemind, isPendingRemindNeedResponse, messageFormatter 関連
import { 
  // Phase 1-2: isPendingAction は executors/pending.ts に移動
  isPendingNotify,
  isPendingSplit,
  isPendingAutoPropose,
} from './pendingTypes';

// P1-1: 分割した executor をインポート
// TD-REMIND-UNIFY: remind 系も executors に統一
import {
  executeToday,
  executeWeek,
  executeFreeBusy,
  executeFreeBusyBatch,  // P3-INTERSECT1
  executeListCreate,
  executeListList,
  executeListMembers,
  executeListAddMember,
  // TD-002: Thread executors
  executeCreate as executeCreateFromThread,
  executeStatusCheck as executeStatusCheckFromThread,
  executeFinalize as executeFinalizeFromThread,
  executeThreadCreate as executeThreadCreateFromThread,
  executeInviteList as executeInviteListFromThread,
  // TD-REMIND-UNIFY: Remind executors (全て executors/remind.ts に統一)
  executeRemindPending as executeRemindPendingFromExecutors,
  executeRemindPendingConfirm as executeRemindPendingConfirmFromExecutors,
  executeRemindPendingCancel as executeRemindPendingCancelFromExecutors,
  executeNeedResponseList as executeNeedResponseListFromExecutors,
  executeRemindNeedResponse as executeRemindNeedResponseFromExecutors,
  executeRemindNeedResponseConfirm as executeRemindNeedResponseConfirmFromExecutors,
  executeRemindNeedResponseCancel as executeRemindNeedResponseCancelFromExecutors,
  executeRemindResponded as executeRemindRespondedFromExecutors,
  executeRemindRespondedConfirm as executeRemindRespondedConfirmFromExecutors,
  executeRemindRespondedCancel as executeRemindRespondedCancelFromExecutors,
  // Phase 1-1: Invite executors
  executeInvitePrepareEmails as executeInvitePrepareEmailsFromExecutors,
  executeInvitePrepareList as executeInvitePrepareListFromExecutors,
  buildPrepareMessage,
  // Phase 1-2: Pending executors
  executePendingDecision as executePendingDecisionFromExecutors,
} from './executors';
// P3-PREF: 好み設定 executor (PREF-SET-1: AI確認フロー追加)
import {
  executePreferenceSet,
  executePreferenceShow,
  executePreferenceClear,
} from './executors/preference';
// CONV-1.0: nlRouter API client
// CONV-1.1: assist API追加
// CONV-1.2: multi-intent API追加
import { 
  nlRouterApi, 
  isCalendarIntent, 
  isPendingFlowIntent,
  type NlRouterCalendarIntent,
} from '../api/nlRouter';
// CONV-CHAT: 雑談API client
import { chatApi } from '../api/chat';

// ============================================================
// PERF-S1: キャッシュ連携ヘルパー
// ============================================================

/**
 * getStatus を呼んでキャッシュも更新する
 * executor 内では常に最新データを使用しつつ、キャッシュも更新
 */
async function getStatusWithCache(threadId: string): Promise<ThreadStatus_API> {
  const status = await threadsApi.getStatus(threadId);
  // キャッシュを更新（他の画面でも最新に）
  setCacheStatus(threadId, status);
  return status;
}

/**
 * P0-2: Write 操作後に必須の refresh を実行
 * refresh 失敗で Write を失敗扱いにしない（運用インシデント回避）
 */
async function refreshAfterWrite(op: WriteOp, threadId?: string): Promise<void> {
  try {
    const actions = getRefreshActions(op, threadId ? { threadId } : undefined);
    await runRefresh(actions);
  } catch (e) {
    // P1-2: 構造化ログで追跡可能に
    log.warn('refreshAfterWrite failed', { module: 'apiExecutor', writeOp: op, threadId, err: e });
  }
}

// ============================================================
// CONV-1.1: calendar系intentのparams補完
// ============================================================

/**
 * calendar系intentで params が弱い場合、AIで補完を試みる
 * 
 * 設計原則:
 * - intentは絶対に変更しない
 * - 失敗しても従来通り動く（エラー時はそのまま返す）
 * - 既存paramsは上書きしない
 */
async function maybeAssistParams(intentResult: IntentResult): Promise<IntentResult> {
  const { intent, params } = intentResult;
  
  // calendar系以外はスキップ
  if (!isCalendarIntent(intent)) {
    return intentResult;
  }
  
  // rawInput がなければスキップ
  const rawInput = params?.rawInput || params?.rawText;
  if (!rawInput || typeof rawInput !== 'string' || rawInput.length < 3) {
    return intentResult;
  }
  
  // paramsが十分ある場合はスキップ（補完不要）
  const hasRange = !!params?.range;
  const hasPrefer = !!params?.prefer || !!params?.dayTimeWindow;
  const hasDuration = !!params?.meetingLength || !!params?.durationMinutes;
  
  // 2つ以上のパラメータがあれば補完不要
  if ([hasRange, hasPrefer, hasDuration].filter(Boolean).length >= 2) {
    log.info('[CONV-1.1] params already sufficient, skipping assist', {
      module: 'apiExecutor',
      intent,
      hasRange,
      hasPrefer,
      hasDuration,
    });
    return intentResult;
  }
  
  try {
    log.info('[CONV-1.1] attempting params assist', {
      module: 'apiExecutor',
      intent,
      rawInputLength: rawInput.length,
    });
    
    const response = await nlRouterApi.assist({
      text: rawInput,
      detected_intent: intent as NlRouterCalendarIntent,
      existing_params: params || {},
      viewer_timezone: 'Asia/Tokyo',
      now_iso: new Date().toISOString(),
    });
    
    // 失敗または低confidence時はそのまま返す
    if (!response.success || !response.data || response.data.confidence < 0.6) {
      log.info('[CONV-1.1] assist returned low confidence or failed', {
        module: 'apiExecutor',
        success: response.success,
        confidence: response.data?.confidence,
      });
      return intentResult;
    }
    
    // params_patchをマージ（既存優先）
    const mergedParams = {
      ...response.data.params_patch,  // AI補完（下位）
      ...params,                       // 既存（上位、上書き）
    };
    
    log.info('[CONV-1.1] params assist success', {
      module: 'apiExecutor',
      intent,
      confidence: response.data.confidence,
      patchKeys: Object.keys(response.data.params_patch),
      rationale: response.data.rationale,
    });
    
    return {
      ...intentResult,
      params: mergedParams,
    };
    
  } catch (error) {
    // エラー時は従来通り動く
    log.warn('[CONV-1.1] params assist error, continuing without assist', {
      module: 'apiExecutor',
      intent,
      error: error instanceof Error ? error.message : String(error),
    });
    return intentResult;
  }
}

// ============================================================
// P2-E2: Email + Phone パーサー（SMS送信用）
// Phase 1-1: executors/invite.ts に分離済み
// ============================================================

// Phase Next-5 Day2.1: Type-safe ExecutionResult
export type ExecutionResultData =
  | { kind: 'calendar.today'; payload: CalendarTodayResponse }
  | { kind: 'calendar.week'; payload: CalendarWeekResponse }
  | { kind: 'calendar.freebusy'; payload: CalendarFreeBusyResponse }
  | { kind: 'calendar.freebusy.batch'; payload: any }  // P3-INTERSECT1
  | { kind: 'thread.status'; payload: ThreadStatus_API | { threads: any[] } }
  | { kind: 'thread.progress.summary'; payload: any }  // PROG-1
  | { kind: 'thread.create'; payload: { threadId: string } }
  | { kind: 'thread.finalize'; payload: any }
  | { kind: 'thread.invites.batch'; payload: any }
  | { kind: 'auto_propose.generated'; payload: { 
      source: 'initial' | 'additional'; // Phase Next-5 Day3: 明示フラグ
      threadId?: string; // Phase Next-5 Day3: 提案生成時のスレッドID
      emails: string[]; 
      duration: number; 
      range: string; 
      proposals: any[] 
    } }
  | { kind: 'auto_propose.cancelled'; payload: {} }
  | { kind: 'auto_propose.created'; payload: any }
  | { kind: 'auto_propose.slots_added'; payload: { thread_id: string; slots_added: number; slot_ids: string[] } }
  | { kind: 'remind.pending.generated'; payload: {
      source: 'remind'; // Phase Next-6 Day1: 明示フラグ
      threadId: string; // Phase Next-6 Day1: 提案生成時のスレッドID
      pendingInvites: Array<{ email: string; name?: string }>;
      count: number;
    } }
  | { kind: 'remind.pending.cancelled'; payload: {} }
  | { kind: 'remind.pending.sent'; payload: any }
  | { kind: 'notify.confirmed.generated'; payload: {
      source: 'notify'; // Phase Next-6 Day3: 明示フラグ
      threadId: string; // Phase Next-6 Day3: 提案生成時のスレッドID
      invites: Array<{ email: string; name?: string }>;
      finalSlot: { start_at: string; end_at: string; label?: string };
      meetingUrl?: string;
    } }
  | { kind: 'notify.confirmed.cancelled'; payload: {} }
  | { kind: 'notify.confirmed.sent'; payload: any }
  | { kind: 'split.propose.generated'; payload: {
      source: 'split'; // Phase Next-6 Day2: 明示フラグ
      threadId: string; // Phase Next-6 Day2: 提案生成時のスレッドID
      voteSummary: Array<{ label: string; votes: number }>;
    } }
  | { kind: 'split.propose.cancelled'; payload: {} }
  // Beta A / Phase2: 送信確認フロー
  | { kind: 'pending.action.created'; payload: {
      confirmToken: string;
      expiresAt: string;
      summary: any;
      mode: 'new_thread' | 'add_to_thread' | 'add_slots' | 'preference_set'; // Phase2: add_slots, PREF-SET-1: preference_set 追加
      threadId?: string;
      threadTitle?: string;
      actionType?: 'send_invites' | 'add_invites' | 'add_slots' | 'prefs.pending'; // Phase2: action_type, PREF-SET-1: prefs.pending 追加
      proposalVersion?: number; // Phase2: 次の proposal_version
      remainingProposals?: number; // Phase2: 残り提案回数
      // PREF-SET-1: 好み設定用
      proposed_prefs?: Record<string, unknown>;
      merged_prefs?: Record<string, unknown>;
    } }
  | { kind: 'pending.action.decided'; payload: {
      decision: 'send' | 'cancel' | 'new_thread' | 'add'; // Phase2: add 追加
      canExecute: boolean;
    } }
  | { kind: 'pending.action.executed'; payload: {
      threadId: string;
      inserted?: number;
      emailQueued?: number;
      // Phase2: add_slots の場合
      actionType?: 'add_slots';
      slotsAdded?: number;
      proposalVersion?: number;
      remainingProposals?: number;
      notifications?: {
        email_queued: number;
        in_app_created: number;
        total_recipients: number;
      };
    } }
  | { kind: 'pending.action.cleared'; payload: {} }
  // Beta A: リスト5コマンド
  | { kind: 'list.created'; payload: { listId: string; listName: string } }
  | { kind: 'list.listed'; payload: { lists: any[] } }
  | { kind: 'list.members'; payload: { listName: string; members: any[] } }
  | { kind: 'list.member_added'; payload: { listName: string; email: string } }
  // Phase2 P2-D0: 再回答必要者リスト表示
  | { kind: 'need_response.list'; payload: {
      threadId: string;
      threadTitle: string;
      currentVersion: number;
      inviteesNeedingResponse: Array<{ email: string; name?: string; respondedVersion?: number }>;
      inviteesNeedingResponseCount: number;
      remainingProposals: number;
    } }
  // Phase2 P2-D1: 再回答必要者へのリマインド
  | { kind: 'remind.need_response.generated'; payload: {
      threadId: string;
      threadTitle: string;
      targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
      count: number;
    } }
  | { kind: 'remind.need_response.sent'; payload: {
      threadId: string;
      remindedCount: number;
      results: Array<{ email: string; status: string }>;
    } }
  | { kind: 'remind.need_response.cancelled'; payload: {} }
  // P2-R1: リマインダー強化
  | { kind: 'remind.status'; payload: any }
  | { kind: 'remind.pending.none'; payload: { threadId: string; message: string } }
  | { kind: 'remind.need_response.none'; payload: { threadId: string; message: string } }
  // P2-D2: 回答済みリマインド
  | { kind: 'remind.responded.generated'; payload: {
      threadId: string;
      threadTitle: string;
      targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
      count: number;
    } }
  | { kind: 'remind.responded.sent'; payload: {
      threadId: string;
      remindedCount: number;
      results: Array<{ email: string; status: string }>;
    } }
  | { kind: 'remind.responded.cancelled'; payload: {} }
  | { kind: 'remind.responded.none'; payload: { threadId: string; message: string } }
  // P2-D3: 再調整
  | { kind: 'reschedule.pending'; payload: {
      originalThreadId: string;
      originalThreadTitle: string;
      suggestedTitle: string;
      participants: Array<{ email: string; name?: string; selection_status: string }>;
      emails: string[];
    }}
  // reschedule.confirm は pending.action.created を返す（既存フローに合流）
  | { kind: 'reschedule.cancelled'; payload: {} }
  // P2-B1: バッチ処理
  | { kind: 'batch.add_members.completed'; payload: {
      listName: string;
      totalCount: number;
      successCount: number;
      errorCount: number;
      errors?: Array<{ email: string; error: string }>;
    } }
  | { kind: 'list.member_added.batch'; payload: { listName: string; addedCount: number } }
  // P3-PREF: 好み設定
  | { kind: 'preference.set'; payload: { prefs: Record<string, unknown> } }
  | { kind: 'preference.set.pending'; payload: { proposed_prefs: Record<string, unknown>; merged_prefs: Record<string, unknown>; confirmPrompt: string } }
  | { kind: 'preference.set.confirmed'; payload: { saved_prefs: Record<string, unknown> } }
  | { kind: 'preference.set.cancelled'; payload: {} }
  | { kind: 'preference.show'; payload: { prefs: Record<string, unknown> | null } }
  | { kind: 'preference.clear'; payload: {} }
  // CONV-1.2: AI確認待ち
  | { kind: 'ai.confirm.pending'; payload: {
      intent: string;
      params: Record<string, unknown>;
      sideEffect: string;
      confirmationPrompt?: string;
    } }
  // CONV-CHAT: 雑談レスポンス
  | { kind: 'chat.response'; payload: {
      intent_detected?: string;
      should_execute?: boolean;
    } };

export interface ExecutionResult {
  success: boolean;
  message: string;
  data?: ExecutionResultData;
  needsClarification?: {
    field: string;
    message: string;
  };
}

// P0-1: 正規化された ExecutionContext
export interface ExecutionContext {
  // P0-1: 正規化された pending（threadId に紐づく）
  pendingForThread?: PendingState | null;
  // P0-1: threadId 未選択時の pending.action
  globalPendingAction?: PendingState | null;
  // カウンター
  additionalProposeCount?: number;
  remindCount?: number;
}

/**
 * Execute API call based on intent
 * Phase Next-2: P0 intents only
 * Phase Next-5 Day2.1: Type-safe ExecutionContext
 * CONV-1.1: calendar系intentのparams補完
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

  // CONV-1.1: calendar系intentのparams補完
  const enhancedIntentResult = await maybeAssistParams(intentResult);

  switch (enhancedIntentResult.intent) {
    // NOTE: CONV-1.1 - 以下のintentResultはenhancedIntentResultに置換済み
    // ============================================================
    // Beta A: 送信確認フロー
    // ============================================================
    case 'pending.action.decide':
      // Phase 1-2: executors/pending.ts に分離
      return executePendingDecisionFromExecutors(intentResult, context);
    
    case 'invite.prepare.emails':
      // Phase 1-1: executors/invite.ts に分離
      return executeInvitePrepareEmailsFromExecutors(intentResult);
    
    case 'invite.prepare.list':
      // Phase 1-1: executors/invite.ts に分離
      return executeInvitePrepareListFromExecutors(intentResult);
    
    // Beta A: リスト5コマンド
    case 'list.create':
      return executeListCreate(intentResult);
    
    case 'list.list':
      return executeListList();
    
    case 'list.members':
      return executeListMembers(intentResult);
    
    case 'list.add_member':
      return executeListAddMember(intentResult);
    
    // Phase Next-5 (P2): Auto-propose
    case 'schedule.auto_propose':
      return executeAutoPropose(intentResult);
    
    case 'schedule.auto_propose.confirm':
      return executeAutoProposeConfirm(context);
    
    case 'schedule.auto_propose.cancel':
      return executeAutoProposeCancel();
    
    case 'schedule.additional_propose':
      return executeAdditionalPropose(intentResult, context);
    
    // TD-REMIND-UNIFY: Reminder executors (全て executors/remind.ts に統一)
    case 'schedule.remind.pending':
      return executeRemindPendingFromExecutors(intentResult);
    
    case 'schedule.remind.pending.confirm':
      return executeRemindPendingConfirmFromExecutors(intentResult);
    
    case 'schedule.remind.pending.cancel':
      return executeRemindPendingCancelFromExecutors(intentResult);
    
    case 'schedule.remind.need_response':
      return executeRemindNeedResponseFromExecutors(intentResult);
    
    case 'schedule.remind.need_response.confirm':
      return executeRemindNeedResponseConfirmFromExecutors(intentResult);
    
    case 'schedule.remind.need_response.cancel':
      return executeRemindNeedResponseCancelFromExecutors(intentResult);
    
    // Phase2 P2-D2: 回答済みの人へのリマインド
    case 'schedule.remind.responded':
      return executeRemindRespondedFromExecutors(intentResult);
    
    case 'schedule.remind.responded.confirm':
      return executeRemindRespondedConfirmFromExecutors(intentResult);
    
    case 'schedule.remind.responded.cancel':
      return executeRemindRespondedCancelFromExecutors(intentResult);
    
    case 'schedule.notify.confirmed':
      return executeNotifyConfirmed(intentResult);
    
    case 'schedule.notify.confirmed.confirm':
      return executeNotifyConfirmedConfirm(context);
    
    case 'schedule.notify.confirmed.cancel':
      return executeNotifyConfirmedCancel();
    
    // Phase Next-6 Day2: Split Vote Detection
    case 'schedule.propose_for_split.confirm':
      return executeProposeForSplitConfirm(context);
    
    case 'schedule.propose_for_split.cancel':
      return executeProposeForSplitCancel();
    
    // Phase Next-3 (P1): Calendar - CONV-1.1: params補完済み
    case 'schedule.today':
      return executeToday();
    
    case 'schedule.week':
      return executeWeek();
    
    case 'schedule.freebusy':
      return executeFreeBusy(enhancedIntentResult);  // CONV-1.1
    
    // P3-INTERSECT1: 共通空き（複数参加者）
    case 'schedule.freebusy.batch':
      return executeFreeBusyBatch(enhancedIntentResult);  // CONV-1.1
    
    // Phase Next-2 (P0): Scheduling - TD-002: Use split executors
    case 'thread.create':
      return executeThreadCreateFromThread(intentResult);
    
    case 'schedule.external.create':
      return executeCreateFromThread(intentResult);
    
    case 'schedule.status.check':
      return executeStatusCheckFromThread(intentResult);
    
    case 'schedule.finalize':
      return executeFinalizeFromThread(intentResult);
    
    case 'schedule.invite.list':
      return executeInviteListFromThread(intentResult);
    
    // TD-REMIND-UNIFY: 再回答必要者リスト表示 (executors に統一)
    case 'schedule.need_response.list':
      return executeNeedResponseListFromExecutors(intentResult);
    
    // P2-D3: 確定後やり直し（再調整）
    case 'schedule.reschedule':
      return executeReschedule(intentResult);
    
    case 'schedule.reschedule.confirm':
      return executeRescheduleConfirm(intentResult);
    
    case 'schedule.reschedule.cancel':
      return executeRescheduleCancel();
    
    // P3-PREF: 好み設定
    case 'preference.set':
      return executePreferenceSet(intentResult);
    
    case 'preference.show':
      return executePreferenceShow();
    
    case 'preference.clear':
      return executePreferenceClear();
    
    case 'unknown':
      // CONV-1.0: nlRouter フォールバック（calendar限定）
      return executeUnknownWithNlRouter(intentResult, context);
    
    default:
      return {
        success: false,
        message: 'この機能はまだ実装されていません。',
      };
  }
}

// ============================================================
// Beta A: 送信確認フロー (prepare → confirm → execute)
// Phase 1-1: executeInvitePrepareEmails, executeInvitePrepareList は
// executors/invite.ts に分離済み
// Phase 1-2: executePendingDecision は executors/pending.ts に分離済み
// ============================================================

// ============================================================
// Beta A: buildPrepareMessage
// Phase 1-1: executors/invite.ts に分離済み（上部の import 参照）
// ============================================================

// ============================================================
// Beta A: リスト5コマンド
// P1-1: executors/list.ts に分離済み
// ============================================================

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
 * P0-1: 正規化された pending を使用
 */
async function executeAutoProposeConfirm(
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

// TD-REMIND-UNIFY: remind.pending 系は executors/remind.ts に統一
// 削除: executeRemindPending, executeRemindPendingConfirm, executeRemindPendingCancel

// ============================================================
// Phase Next-6 Day3: Confirmed Notification (確定通知)
// ============================================================

/**
 * P3-4: schedule.notify.confirmed
 * Phase Next-6 Day3: 確定通知提案（提案のみ、POSTなし）
 * 
 * Flow:
 * 1. status を取得
 * 2. status が confirmed かチェック
 * 3. confirmed でない場合: 「まだ確定していません」
 * 4. confirmed の場合: 確定通知提案を表示（まだPOSTしない）
 * 5. 「はい」で confirm フロー → POST（Day3.5）
 */
async function executeNotifyConfirmed(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドの確定通知を送りますか？\n左のスレッド一覧から選択してください。',
      },
    };
  }
  
  try {
    // Get thread status
    const status = await getStatusWithCache(threadId);
    
    // Check if thread is confirmed
    if (status.thread.status !== 'confirmed') {
      return {
        success: false,
        message: `❌ このスレッドはまだ確定していません。\n\n現在の状態: ${status.thread.status}\n先に日程を確定してください。`,
      };
    }
    
    // Check if evaluation has finalized data
    if (!status.evaluation.finalized || !status.evaluation.final_slot_id) {
      return {
        success: false,
        message: '❌ 確定情報が見つかりません。\n先に日程を確定してください。',
      };
    }
    
    // Get final slot
    const finalSlot = status.slots.find(slot => slot.slot_id === status.evaluation.final_slot_id);
    if (!finalSlot) {
      return {
        success: false,
        message: '❌ 確定日時が見つかりません。',
      };
    }
    
    // Get all invites (accepted or pending)
    const allInvites = status.invites.map((invite) => ({
      email: invite.email,
      name: invite.candidate_name,
    }));
    
    if (allInvites.length === 0) {
      return {
        success: true,
        message: '✅ 招待者がいません。\n\n通知は不要です。',
      };
    }
    
    // Build notification message
    let message = `💡 日程が確定しました！\n\n`;
    message += `📅 確定日時: ${formatDateTime(finalSlot.start_at)}${finalSlot.label ? ` (${finalSlot.label})` : ''}\n`;
    
    if (status.evaluation.meeting?.url) {
      message += `🎥 Meet URL: ${status.evaluation.meeting.url}\n`;
    }
    
    message += `\n参加者（${allInvites.length}名）:\n`;
    allInvites.forEach((invite) => {
      message += `- ${invite.email}`;
      if (invite.name) {
        message += ` (${invite.name})`;
      }
      message += '\n';
    });
    
    message += '\n全員に確定通知を送りますか？\n\n';
    message += '「はい」で通知送信\n';
    message += '「いいえ」でキャンセル';
    
    return {
      success: true,
      message,
      data: {
        kind: 'notify.confirmed.generated',
        payload: {
          source: 'notify', // Phase Next-6 Day3: 明示フラグ
          threadId, // Phase Next-6 Day3: 提案生成時のスレッドID
          invites: allInvites,
          finalSlot: {
            start_at: finalSlot.start_at,
            end_at: finalSlot.end_at,
            label: finalSlot.label || undefined,
          },
          meetingUrl: status.evaluation.meeting?.url,
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
 * P3-5: schedule.notify.confirmed.confirm
 * Phase Next-6 Day3: 確定通知確定 → POST（Day3.5で実装）
 * P0-1: 正規化された pending を使用
 */
async function executeNotifyConfirmedConfirm(
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // P0-1: 正規化された pending から notify.confirmed を取得
  const activePending = context?.pendingForThread ?? context?.globalPendingAction ?? null;
  const pending = isPendingNotify(activePending) ? activePending : null;
  
  if (!pending) {
    return {
      success: false,
      message: '❌ 通知対象が選択されていません。\n先に「確定通知送って」と入力してください。',
    };
  }
  
  try {
    // Phase Next-6 Day3: A案（送信用セット返すだけ、メール送信しない）
    const { threadId, invites, finalSlot, meetingUrl } = pending;
    
    // Build template message
    const templateMessage = `
こんにちは、

日程調整が完了しましたのでお知らせします。

📅 確定日時: ${formatDateTime(finalSlot.start_at)}${finalSlot.label ? ` (${finalSlot.label})` : ''}
${meetingUrl ? `🎥 Meet URL: ${meetingUrl}` : ''}

ご参加をお待ちしております。
よろしくお願いいたします。
    `.trim();
    
    // A案: 送信用セットを表示（コピー用）
    let message = `✅ 確定通知用の文面を生成しました（${invites.length}名）\n\n`;
    message += '📋 以下をコピーして各自にメールで送信してください:\n\n';
    message += '────────────────────────────\n\n';
    
    invites.forEach((invite: { email: string; name?: string }, index: number) => {
      message += `【${index + 1}. ${invite.email}${invite.name ? ` (${invite.name})` : ''}】\n\n`;
      message += `件名: 日程調整完了のお知らせ\n\n`;
      message += templateMessage;
      message += '\n\n────────────────────────────\n\n';
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'notify.confirmed.sent',
        payload: {
          threadId,
          invites,
          count: invites.length,
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
 * P3-6: schedule.notify.confirmed.cancel
 * Phase Next-6 Day3: 確定通知キャンセル
 */
async function executeNotifyConfirmedCancel(): Promise<ExecutionResult> {
  return {
    success: true,
    message: '✅ 確定通知をキャンセルしました。',
    data: {
      kind: 'notify.confirmed.cancelled',
      payload: {},
    },
  };
}

// ============================================================
// Phase Next-6 Day2: Split Vote Detection (票割れ通知)
// ============================================================

/**
 * Phase Next-5 Day3: Analyze status for additional proposal
 * Pure function: returns true if additional proposals are needed
 */
function analyzeStatusForPropose(status: ThreadStatus_API): boolean {
  const { invites } = status;
  const pendingCount = invites.filter((i) => i.status === 'pending' || i.status === null).length;
  return pendingCount >= 1;
}

// NOTE: analyzeSplitVotes moved to executors/thread.ts

/**
 * Wrapper for executeAdditionalPropose (Phase Next-6 Day2)
 * This allows calling from split.confirm without IntentResult dependency
 */
async function executeAdditionalProposeByThreadId(
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
/**
 * Phase2: schedule.additional_propose
 * 追加候補機能（Sprint 2-A 実装）
 * 
 * フロー:
 *   1. 候補を生成
 *   2. POST /api/threads/:id/proposals/prepare で pending_action 作成
 *   3. 「追加/キャンセル」の入力待ち
 *   4. confirm → execute
 */
async function executeAdditionalPropose(
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
 * P3-7: schedule.propose_for_split.confirm
 * Phase Next-6 Day2: 票割れ提案確定 → Day3 に誘導
 * P0-1: 正規化された pending を使用
 */
async function executeProposeForSplitConfirm(
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
async function executeProposeForSplitCancel(): Promise<ExecutionResult> {
  return {
    success: true,
    message: '✅ 票割れの追加提案をキャンセルしました。',
    data: {
      kind: 'split.propose.cancelled',
      payload: {},
    },
  };
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
// REFACTORED: Moved to executors/calendar.ts
// ============================================================

// ============================================================
// Phase Next-2 (P0): Scheduling
// TD-002: Moved to executors/thread.ts
// - executeCreate
// - executeStatusCheck
// - executeFinalize
// - executeThreadCreate
// - executeInviteList
// ============================================================

// ============================================================
// Helper Functions
// NOTE: getWarningMessage, formatTimeRange, formatDateTimeRange は
//       executors/calendar.ts に移動済み
// ============================================================
// NOTE: getStatusLabel moved to executors/thread.ts
// NOTE: getSlotVotes() removed - votes are now server-side (Phase Next-6 Day2)

/**
 * ⚠️ toLocaleString 直書き禁止: datetime.ts の関数を使用
 */
function formatDateTime(dateStr: string): string {
  return formatDateTimeForViewer(dateStr, DEFAULT_TIMEZONE);
}

// TD-REMIND-UNIFY: need_response 系は executors/remind.ts に統一
// 削除: executeNeedResponseList, executeRemindNeedResponse, executeRemindNeedResponseConfirm, executeRemindNeedResponseCancel

// ============================================================
// P2-D3: 確定後やり直し（再調整）
// ============================================================

/**
 * P2-D3: schedule.reschedule
 * 確定済み/進行中のスレッドを再調整
 * 同じ参加者で新しいスレッドを作成する準備
 */
async function executeReschedule(intentResult: IntentResult): Promise<ExecutionResult> {
  const { threadId } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: '❌ 再調整するスレッドを選択してください。\n左のスレッド一覧から選択後、再度「再調整」と入力してください。',
      needsClarification: {
        field: 'threadId',
        message: '再調整するスレッドを選択してください。',
      },
    };
  }
  
  try {
    // 再調整情報を取得
    const info = await threadsApi.getRescheduleInfo(threadId);
    
    // 参加者のメールアドレスリストを抽出
    const emails = info.participants.map(p => p.email);
    
    if (emails.length === 0) {
      return {
        success: false,
        message: '❌ このスレッドには参加者がいません。',
      };
    }
    
    return {
      success: true,
      message: info.message_for_chat,
      data: {
        kind: 'reschedule.pending',
        payload: {
          originalThreadId: info.original_thread.id,
          originalThreadTitle: info.original_thread.title,
          suggestedTitle: info.suggested_title,
          participants: info.participants,
          emails,
        },
      },
    };
  } catch (error) {
    console.error('[executeReschedule] Error:', error);
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P2-D3: schedule.reschedule.confirm
 * 再調整を確定し、新スレッドを作成して同じ参加者に招待準備
 * 
 * 重要: pending.action.created を返して既存フローに合流させる
 * → その後「送る/キャンセル/別スレッドで」で pending.action.decide に流れる
 */
async function executeRescheduleConfirm(intentResult: IntentResult): Promise<ExecutionResult> {
  // originalThreadId は今後のログ/追跡用に予約（現時点では使用しない）
  const { originalTitle, participants, suggestedTitle } = intentResult.params;
  
  if (!participants || participants.length === 0) {
    return {
      success: false,
      message: '❌ 参加者情報がありません。再度「再調整」と入力してください。',
    };
  }
  
  const emails = participants.map((p: { email: string }) => p.email);
  const newTitle = suggestedTitle || `【再調整】${originalTitle || '日程調整'}`;
  
  try {
    // prepareSend を使用して新規スレッド作成を準備
    const response = await threadsApi.prepareSend({
      source_type: 'emails',
      emails,
      title: newTitle,
    });
    
    // 成功メッセージを作成（既存の buildPrepareMessage と同形式）
    const message = [
      '🔄 再調整の準備ができました',
      '',
      `📋 新しいスレッド: 「${newTitle}」`,
      `📧 送信先: ${emails.length}名`,
      '',
      buildPrepareMessage(response),
    ].join('\n');
    
    // pending.action.created を返して既存フローに合流
    // → 「送る/キャンセル/別スレッドで」で pending.action.decide に流れる
    return {
      success: true,
      message,
      data: {
        kind: 'pending.action.created',
        payload: {
          confirmToken: response.confirm_token,
          expiresAt: response.expires_at,
          summary: response.summary,
          mode: 'new_thread',
          threadId: response.thread_id,
          threadTitle: newTitle,
          // 再調整元の情報（デバッグ/ログ用）
          // actionType は 'send_invites' のまま（新規招待と同じ扱い）
        },
      },
    };
  } catch (error) {
    console.error('[executeRescheduleConfirm] Error:', error);
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P2-D3: schedule.reschedule.cancel
 * 再調整をキャンセル
 */
function executeRescheduleCancel(): ExecutionResult {
  return {
    success: true,
    message: '✅ 再調整をキャンセルしました。',
    data: {
      kind: 'reschedule.cancelled',
      payload: {},
    },
  };
}

// ============================================================
// CONV-1.2: nlRouter フォールバック（multi-intent対応）
// ============================================================

/**
 * CONV-1.2: unknown 時に nlRouter/multi を呼び出すフォールバック
 * 
 * - calendar系は即実行
 * - write_local系は即実行（確認不要のもの）
 * - write_external系/確認必要系は既存intentフローへ合流
 * - chat.general は雑談フォールバック
 * 
 * @param intentResult - 元の unknown IntentResult
 * @param context - ExecutionContext
 */
async function executeUnknownWithNlRouter(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // 元の rawInput がなければフォールバック不可
  const rawInput = intentResult.params?.rawInput;
  if (!rawInput || typeof rawInput !== 'string' || rawInput.trim().length < 3) {
    return {
      success: false,
      message: '理解できませんでした。\n\n以下のような指示ができます：\n- 「今日の予定」\n- 「来週の空き」\n- 「〇〇さんに日程調整送って」',
    };
  }

  try {
    // CONV-1.2: nlRouter/multi を呼び出し
    const nlResult = await nlRouterApi.multi({
      text: rawInput,
      context: {
        selected_thread_id: intentResult.params?.threadId || null,
        viewer_timezone: 'Asia/Tokyo',
        has_pending_action: !!(context?.pendingForThread || context?.globalPendingAction),
      },
    });

    // needs_clarification がある場合はそれを返す
    if (nlResult.needs_clarification) {
      return {
        success: false,
        message: nlResult.needs_clarification.message,
        needsClarification: {
          field: nlResult.needs_clarification.field,
          message: nlResult.needs_clarification.message,
        },
      };
    }

    // chat.general は雑談フォールバックへ
    if (nlResult.intent === 'chat.general') {
      log.info('[CONV-1.2] chat.general, falling back to chat', {
        module: 'apiExecutor',
        confidence: nlResult.confidence,
      });
      return executeChatFallback(rawInput, intentResult.params?.threadId);
    }

    // unknown のままなら雑談フォールバックへ
    if (nlResult.intent === 'unknown' || nlResult.confidence < 0.5) {
      log.info('[CONV-1.2] unknown or low confidence, falling back to chat', {
        module: 'apiExecutor',
        intent: nlResult.intent,
        confidence: nlResult.confidence,
      });
      return executeChatFallback(rawInput, intentResult.params?.threadId);
    }

    log.info('[CONV-1.2] nlRouter/multi success', {
      module: 'apiExecutor',
      intent: nlResult.intent,
      confidence: nlResult.confidence,
      sideEffect: nlResult.side_effect,
      requiresConfirmation: nlResult.requires_confirmation,
    });

    // 確認が必要で、pendingフロー対象のintent
    if (nlResult.requires_confirmation && isPendingFlowIntent(nlResult.intent)) {
      // 確認プロンプトを表示（まだ実行しない）
      return {
        success: true,
        message: nlResult.confirmation_prompt || '実行しますか？（はい/いいえ）',
        data: {
          kind: 'ai.confirm.pending',
          payload: {
            intent: nlResult.intent,
            params: nlResult.params,
            sideEffect: nlResult.side_effect,
            confirmationPrompt: nlResult.confirmation_prompt,
          },
        },
      };
    }

    // 既存のintentとしてマッピングして再実行
    const mappedIntent = mapMultiIntentToExisting(nlResult.intent);
    
    const newIntentResult: IntentResult = {
      intent: mappedIntent,
      confidence: nlResult.confidence,
      params: {
        ...nlResult.params,
        rawInput,  // 元の入力を保持
      },
    };

    // 再帰的に executeIntent を呼び出す
    return executeIntent(newIntentResult, context);

  } catch (error) {
    log.warn('[CONV-1.2] nlRouter/multi fallback error', {
      module: 'apiExecutor',
      error: error instanceof Error ? error.message : String(error),
    });
    
    // エラー時は雑談フォールバック
    return executeChatFallback(rawInput, intentResult.params?.threadId);
  }
}

/**
 * CONV-1.2: multi-intent を既存の IntentType にマッピング
 */
function mapMultiIntentToExisting(intent: string): IntentResult['intent'] {
  // 直接マッピングできるものはそのまま返す
  const directMap: Record<string, IntentResult['intent']> = {
    // Calendar
    'schedule.today': 'schedule.today',
    'schedule.week': 'schedule.week',
    'schedule.freebusy': 'schedule.freebusy',
    'schedule.freebusy.batch': 'schedule.freebusy.batch',
    // Thread
    'schedule.status.check': 'schedule.status.check',
    // Invite
    'invite.prepare.emails': 'invite.prepare.emails',
    'invite.prepare.list': 'invite.prepare.list',
    // Remind
    'schedule.remind.pending': 'schedule.remind.pending',
    'schedule.remind.need_response': 'schedule.remind.need_response',
    'schedule.remind.responded': 'schedule.remind.responded',
    // Notify
    'schedule.notify.confirmed': 'schedule.notify.confirmed',
    // List
    'list.create': 'list.create',
    'list.list': 'list.list',
    'list.members': 'list.members',
    'list.add_member': 'list.add_member',
    // Preference
    'preference.set': 'preference.set',
    'preference.show': 'preference.show',
    'preference.clear': 'preference.clear',
  };

  if (intent in directMap) {
    return directMap[intent];
  }

  // 未対応のintentは unknown として返す
  return 'unknown';
}

// ============================================================
// CONV-CHAT: 雑談フォールバック
// ============================================================

/**
 * 機能に該当しない入力を雑談APIへフォールバック
 * AI秘書として自然な会話を実現
 */
async function executeChatFallback(
  text: string,
  threadId?: string | null
): Promise<ExecutionResult> {
  try {
    log.info('[CONV-CHAT] Executing chat fallback', {
      module: 'apiExecutor',
      textLength: text.length,
      hasThreadId: !!threadId,
    });

    const response = await chatApi.sendMessage({
      text,
      context: {
        thread_id: threadId ?? null,
      },
    });

    return {
      success: true,
      message: response.message,
      data: {
        kind: 'chat.response',
        payload: {
          intent_detected: response.intent_detected,
          should_execute: response.should_execute,
        },
      },
    };
  } catch (error) {
    log.warn('[CONV-CHAT] Chat fallback error', {
      module: 'apiExecutor',
      error: error instanceof Error ? error.message : String(error),
    });

    // エラー時もユーザーフレンドリーに応答
    return {
      success: true,
      message: '申し訳ありません、少し問題が発生しました。\n\n以下のような指示ができます：\n• 「今日の予定」\n• 「来週の空き」\n• 「〇〇さんに日程調整送って」',
    };
  }
}

// Export type for external use
export type { CalendarTodayResponse, CalendarWeekResponse, CalendarFreeBusyResponse };
