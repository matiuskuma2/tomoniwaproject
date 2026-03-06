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
// Phase 1-3a: setCacheStatus は shared/cache.ts に移動
// P0-1: PendingState 正規化
import type { PendingState } from './pendingTypes';
// P0-2: Write 後の refresh 強制
// Phase 1-2: refreshAfterWrite は shared/ に一元化 (apiExecutor では未使用、pending/autoPropose で使用)
// P1-2: Structured logger
import { log } from '../platform';
// TD-REMIND-UNIFY: remind 系は executors に統一したため、以下の import は不要になった
// isPendingRemind, isPendingRemindNeedResponse, messageFormatter 関連
import { 
  // Phase 1-2: isPendingAction は executors/pending.ts に移動
  // Phase 1-3a: isPendingSplit, isPendingAutoPropose は executors/autoPropose.ts に移動
  isPendingNotify,
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
  // Phase 1-2: Pending executors
  executePendingDecision as executePendingDecisionFromExecutors,
  // Phase 1-3a: AutoPropose executors
  executeAutoPropose as executeAutoProposeFromExecutors,
  executeAutoProposeConfirm as executeAutoProposeConfirmFromExecutors,
  executeAutoProposeCancel as executeAutoProposeCancelFromExecutors,
  executeAdditionalPropose as executeAdditionalProposeFromExecutors,
  // executeAdditionalProposeByThreadId は内部呼び出し専用（executors/autoPropose.ts 内で使用）
  executeProposeForSplitConfirm as executeProposeForSplitConfirmFromExecutors,
  executeProposeForSplitCancel as executeProposeForSplitCancelFromExecutors,
  // Phase 1-3a: Shared helpers
  getStatusWithCache,
  // v1.0: 1対1予定調整
  executeOneOnOneFixed as executeOneOnOneFixedFromExecutors,
  // v1.1: Phase B-1 候補3つ
  executeOneOnOneCandidates as executeOneOnOneCandidatesFromExecutors,
  // v1.2: Phase B-2 freebusy から候補生成
  executeOneOnOneFreebusy as executeOneOnOneFreebusyFromExecutors,
  // v1.3: Phase B-4 Open Slots（公開枠）
  executeOneOnOneOpenSlots as executeOneOnOneOpenSlotsFromExecutors,
  // D0: 関係性管理
  executeRelationRequestWorkmate as executeRelationRequestWorkmateFromExecutors,
  executeRelationApprove as executeRelationApproveFromExecutors,
  executeRelationDecline as executeRelationDeclineFromExecutors,
  // G2-A: Pool Booking
  executePoolBook as executePoolBookFromExecutors,
  executePoolBookingCancel as executePoolBookingCancelFromExecutors,
  executePoolBookingList as executePoolBookingListFromExecutors,
  // G2-A: Pool Management
  executePoolCreate as executePoolCreateFromExecutors,
  executePoolAddSlots as executePoolAddSlotsFromExecutors,
  executePoolCreateFinalize,
  executePoolCreateCancel,
  executePoolMemberSelected,
  // PR-D-1.1: 連絡先取り込み
  executeContactImportPreview,
  executeContactImportConfirm,
  executeContactImportCancel,
  executeContactImportPersonSelect,
  // PR-D-FE-4: 取り込み後の次手選択
  executePostImportNextStepDecide,
  // FE-6: 1対N (Broadcast) スケジューリング
  executeOneToManySchedule as executeOneToManyScheduleFromExecutors,
  // PR-B6: 逆アベイラビリティ
  executeReverseAvailability,
} from './executors';
import type { PoolCreateDraft } from './executors/pool/create';
// PendingState import removed - already imported at line 23
// Phase 1-3b: buildPrepareMessage を shared から直接 import
import { buildPrepareMessage } from './executors/shared/prepareMessage';
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
// PERF-S1: getStatusWithCache は executors/shared/cache.ts に一元化済み
// P0-2: refreshAfterWrite は executors/shared/refresh.ts に一元化済み
// ============================================================

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
    } }
  // D0: 関係性管理 (仕事仲間申請/承諾/拒否)
  | { kind: 'relation.request.sent'; payload: {
      request_id: string;
      invitee_id?: string;
      invitee_email?: string;
      invitee_name?: string;
      requested_type: 'workmate' | 'family';
      expires_at: string;
    } }
  | { kind: 'relation.request.candidates'; payload: {
      candidates: Array<{
        id: string;
        email: string;
        display_name: string;
        can_request: boolean;
      }>;
      query_name: string;
    } }
  | { kind: 'relation.approved'; payload: {
      relationship_id: string;
      relation_type: string;
    } }
  | { kind: 'relation.declined'; payload: {
      token: string;
    } }
  // G2-A: Pool Booking (予約システム)
  | { kind: 'pool_booking.booked'; payload: {
      booking_id: string;
      pool_id: string;
      pool_name: string;
      slot_id: string;
      slot_label: string;
      slot_start_at: string;
      slot_end_at: string;
      assignee_user_id: string;
      status: string;
    } }
  | { kind: 'pool_booking.cancelled'; payload: {
      booking_id: string;
      pool_id: string;
      status: string;
    } }
  | { kind: 'pool_booking.list'; payload: {
      pool_id?: string;
      pool_name?: string;
      pools?: any[];
      bookings: any[];
    } }
  // G2-A: Pool Management
  | { kind: 'pool.created'; payload: {
      pool_id: string;
      pool_name: string;
      members_count: number;
      slots_count: number;
      public_url: string | null;
    } }
  | { kind: 'pool.slots_added'; payload: {
      pool_id: string;
      pool_name: string;
      slots_count: number;
    } }
  | { kind: 'pool.needs_workmate'; payload: {
      pool_name: string;
      needs_workmate: Array<{ name: string; email?: string }>;
      already_workmate: Array<{ user_id: string; display_name: string }>;
      not_found: string[];
    } }
  | { kind: 'pool_booking.pool_candidates'; payload: {
      candidates: Array<{
        id: string;
        name: string;
        description: string | null;
        is_active: boolean;
      }>;
      query_name: string;
    } }
  | { kind: 'pool_booking.slot_candidates'; payload: {
      pool_name: string;
      candidates: Array<{
        id: string;
        start_at: string;
        end_at: string;
        label: string;
      }>;
      query_label?: string;
    } }
  // PR-D-FE-1 + PR-D-3: Contact Import (business_card 追加)
  | { kind: 'contact_import.preview'; payload: {
      pending_action_id: string;
      expires_at: string;
      summary: any;
      parsed_entries: any[];
      next_pending_kind: string;
      source: 'text' | 'csv' | 'business_card';
      business_card_ids?: string[];
      contact_import_context?: import('./executors/types').ContactImportContext;
    } }
  | { kind: 'contact_import.person_selected'; payload: {
      pending_action_id: string;
      all_resolved: boolean;
      remaining_unresolved: number;
      next_pending_kind: string;
      updated_entry: any;
    } }
  | { kind: 'contact_import.confirmed'; payload: {
      created_count: number;
      updated_count: number;
      skipped_count: number;
      contact_import_context?: import('./executors/types').ContactImportContext;
      imported_contacts?: Array<{ display_name: string; email: string }>;
    } }
  | { kind: 'contact_import.cancelled'; payload: {} }
  | { kind: 'contact_import.expired'; payload: {} }
  | { kind: 'contact_import.ambiguous_remaining'; payload: {} }
  // PR-D-FE-3.1: 名刺取り込み完了後の次手フロー
  | { kind: 'post_import.next_step.created'; payload: {
      intent: import('./executors/types').PostImportIntent;
      userMessage?: string;
      importSummary: {
        created_count: number;
        updated_count: number;
        skipped_count: number;
        imported_contacts: Array<{ display_name: string; email: string }>;
      };
      source: 'text' | 'csv' | 'business_card';
    } }
  | { kind: 'post_import.next_step.selected'; payload: {
      action: 'send_invite' | 'schedule' | 'completed';
      emails: string[];
    } }
  | { kind: 'post_import.next_step.cancelled'; payload: {} };

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
    // BUG-1b: スケジューリング系のclarificationの場合、pending.scheduling.clarification を設定
    // これにより次の入力で日時を補完して再分類できる
    const isSchedulingIntent = intentResult.intent.startsWith('schedule.1on1.');
    if (isSchedulingIntent) {
      return {
        success: true, // clarification は成功扱い（エラーではなく質問）
        message: intentResult.needsClarification.message,
        needsClarification: intentResult.needsClarification,
        data: {
          kind: 'scheduling.clarification.needed' as any,
          payload: {
            originalIntent: intentResult.intent,
            originalParams: intentResult.params,
            missingField: intentResult.needsClarification.field,
          },
        },
      };
    }
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
    
    // Phase Next-5 (P2): Auto-propose (Phase 1-3a: executors/autoPropose.ts に分離)
    case 'schedule.auto_propose':
      return executeAutoProposeFromExecutors(intentResult);
    
    case 'schedule.auto_propose.confirm':
      return executeAutoProposeConfirmFromExecutors(context);
    
    case 'schedule.auto_propose.cancel':
      return executeAutoProposeCancelFromExecutors();
    
    case 'schedule.additional_propose':
      return executeAdditionalProposeFromExecutors(intentResult, context);
    
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
    
    // Phase Next-6 Day2: Split Vote Detection (Phase 1-3a: executors/autoPropose.ts に分離)
    case 'schedule.propose_for_split.confirm':
      return executeProposeForSplitConfirmFromExecutors(context);
    
    case 'schedule.propose_for_split.cancel':
      return executeProposeForSplitCancelFromExecutors();
    
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
    
    // v1.0: 1対1予定調整（固定日時スタート）
    case 'schedule.1on1.fixed':
      return executeOneOnOneFixedFromExecutors(intentResult);
    
    // v1.1: Phase B-1 候補3つ提示
    case 'schedule.1on1.candidates3':
      return executeOneOnOneCandidatesFromExecutors(intentResult);
    
    // v1.2: Phase B-2 freebusy から候補生成
    case 'schedule.1on1.freebusy':
      return executeOneOnOneFreebusyFromExecutors(intentResult);
    
    // v1.3: Phase B-4 Open Slots（公開枠）
    case 'schedule.1on1.open_slots':
      return executeOneOnOneOpenSlotsFromExecutors(intentResult);
    
    // D0: 関係性管理（仕事仲間申請/承諾/拒否）
    case 'relation.request.workmate':
      return executeRelationRequestWorkmateFromExecutors(intentResult, context);
    
    case 'relation.approve':
      return executeRelationApproveFromExecutors(intentResult, context);
    
    case 'relation.decline':
      return executeRelationDeclineFromExecutors(intentResult, context);
    
    // G2-A: Pool Booking（受付プール予約）
    case 'pool_booking.create':
      return executePoolCreateFromExecutors(intentResult, context);
    
    case 'pool_booking.add_slots':
      return executePoolAddSlotsFromExecutors(intentResult, context);
    
    case 'pool_booking.book':
      return executePoolBookFromExecutors(intentResult, context);
    
    case 'pool_booking.cancel':
      return executePoolBookingCancelFromExecutors(intentResult, context);
    
    case 'pool_booking.list':
    case 'pool_booking.slots':
      return executePoolBookingListFromExecutors(intentResult, context);
    
    case 'pool_booking.create_confirm':
      return executePoolCreateConfirmFromExecutors(intentResult, context);
    
    case 'pool_booking.create_cancel':
      return executePoolCreateCancelFromExecutors();
    
    case 'pool_booking.member_selected':
      return executePoolMemberSelectedFromExecutors(intentResult, context);
    
    // PR-D-1.1: 連絡先取り込み
    case 'contact.import.text':
      return executeContactImportPreview(intentResult);
    
    case 'contact.import.confirm':
      return executeContactImportConfirm(intentResult, context);
    
    case 'contact.import.cancel':
      return executeContactImportCancel();
    
    case 'contact.import.person_select':
      return executeContactImportPersonSelect(intentResult, context);
    
    // PR-D-FE-4: 取り込み後の次手選択
    case 'post_import.next_step.decide':
      return executePostImportNextStepDecide(intentResult);

    // FE-6: 1対N (Broadcast) スケジューリング
    case 'schedule.1toN.prepare':
      return executeOneToManyScheduleFromExecutors(intentResult);

    // PR-B6: 逆アベイラビリティ（ご都合伺い）
    case 'schedule.1on1.reverse_availability':
      return executeReverseAvailability(intentResult);

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
// G2-A: Pool Create confirm/cancel/member_selected helpers
// ============================================================

async function executePoolCreateConfirmFromExecutors(
  intentResult: IntentResult,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  const draft = intentResult.params.draft as PoolCreateDraft;
  if (!draft) {
    return {
      success: false,
      message: '確認中のプール作成がありません。',
    };
  }
  return executePoolCreateFinalize(draft, _context);
}

function executePoolCreateCancelFromExecutors(): ExecutionResult {
  return executePoolCreateCancel();
}

async function executePoolMemberSelectedFromExecutors(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const selectedMemberId = intentResult.params.selected_member_id as string;
  const pending = intentResult.params.pending as PendingState & { kind: 'pending.pool.member_select' };
  
  if (!selectedMemberId || !pending) {
    return {
      success: false,
      message: '選択されたメンバー情報がありません。',
    };
  }
  
  return executePoolMemberSelected(selectedMemberId, pending, context);
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

// Phase 1-3a: executeAutoPropose, executeAutoProposeConfirm, executeAutoProposeCancel は executors/autoPropose.ts に移動

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
// Phase 1-3a: analyzeStatusForPropose, executeAdditionalPropose,
// executeAdditionalProposeByThreadId, executeProposeForSplitConfirm,
// executeProposeForSplitCancel, generateProposalsWithoutBusy, formatProposalLabel
// は executors/autoPropose.ts に移動

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
 * PR-UX-11: nlRouter の needs_clarification メッセージをユーザーフレンドリーな日本語に変換
 * LLM が英語でエラーメッセージを生成する場合があるため、内部的なclarificationを
 * 日本語のガイダンスに変換する
 */
function sanitizeNlClarificationMessage(rawMessage: string, field: string): string {
  // 英語メッセージ or 内部用メッセージの検出パターン
  const internalPatterns = [
    /thread.?id/i,
    /please provide/i,
    /required.*parameter/i,
    /missing.*field/i,
    /operation.*requires/i,
  ];

  const isInternalMessage = internalPatterns.some(p => p.test(rawMessage));
  
  if (isInternalMessage) {
    // field に応じたユーザーフレンドリーなメッセージ
    const fieldMessages: Record<string, string> = {
      threadId: 'どの調整についてですか？\nスレッドを選択してから操作してください。',
      thread_id: 'どの調整についてですか？\nスレッドを選択してから操作してください。',
      person: '相手の名前かメールアドレスを教えてください。',
      date: 'いつがいいですか？（例: 来週木曜17時から）',
      time: '何時からがいいですか？（例: 17時から）',
      email: '相手のメールアドレスを教えてください。',
      emails: '送信先のメールアドレスを教えてください。',
    };

    return fieldMessages[field] || 'もう少し詳しく教えてください。\n\n以下のような指示ができます：\n• 「今日の予定」\n• 「来週の空き」\n• 「〇〇さんに日程調整送って」';
  }

  // 英語メッセージでも、非内部的なものは一般的なガイダンスに変換
  if (/^[a-zA-Z\s.,!?:;'"()-]+$/.test(rawMessage.trim())) {
    return 'もう少し詳しく教えてください。\n\n以下のような指示ができます：\n• 「今日の予定」\n• 「来週の空き」\n• 「〇〇さんに日程調整送って」';
  }

  // 日本語メッセージならそのまま返す
  return rawMessage;
}

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

    // needs_clarification がある場合はユーザーフレンドリーなメッセージに変換
    // PR-UX-11: LLM が英語で「Please provide the thread ID」等を返す場合があるため、
    // 内部的なclarificationは日本語ガイダンスに変換して返す
    if (nlResult.needs_clarification) {
      const sanitizedMessage = sanitizeNlClarificationMessage(
        nlResult.needs_clarification.message,
        nlResult.needs_clarification.field
      );
      return {
        success: true, // clarification は質問であってエラーではない
        message: sanitizedMessage,
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
