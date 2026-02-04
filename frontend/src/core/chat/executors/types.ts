/**
 * Executor Types - 共通型定義
 * 
 * P1-1: apiExecutor.ts から分離
 * ロジック変更なし、型のみ
 */

import type { CalendarTodayResponse, CalendarWeekResponse, CalendarFreeBusyResponse, ThreadStatus_API } from '../../models';

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
      source: 'initial' | 'additional';
      threadId?: string;
      emails: string[]; 
      duration: number; 
      range: string; 
      proposals: any[] 
    } }
  | { kind: 'auto_propose.cancelled'; payload: {} }
  | { kind: 'auto_propose.created'; payload: any }
  | { kind: 'auto_propose.slots_added'; payload: { thread_id: string; slots_added: number; slot_ids: string[] } }
  | { kind: 'remind.pending.generated'; payload: {
      source: 'remind';
      threadId: string;
      pendingInvites: Array<{ email: string; name?: string }>;
      count: number;
    } }
  | { kind: 'remind.pending.cancelled'; payload: {} }
  | { kind: 'remind.pending.sent'; payload: any }
  | { kind: 'notify.confirmed.generated'; payload: {
      source: 'notify';
      threadId: string;
      invites: Array<{ email: string; name?: string }>;
      finalSlot: { start_at: string; end_at: string; label?: string };
      meetingUrl?: string;
    } }
  | { kind: 'notify.confirmed.cancelled'; payload: {} }
  | { kind: 'notify.confirmed.sent'; payload: any }
  | { kind: 'split.propose.generated'; payload: {
      source: 'split';
      threadId: string;
      voteSummary: Array<{ label: string; votes: number }>;
    } }
  | { kind: 'split.propose.cancelled'; payload: {} }
  // Beta A / Phase2: 送信確認フロー
  | { kind: 'pending.action.created'; payload: {
      confirmToken: string;
      expiresAt: string;
      summary: any;
      mode: 'new_thread' | 'add_to_thread' | 'add_slots' | 'preference_set';  // PREF-SET-1
      threadId?: string;
      threadTitle?: string;
      actionType?: 'send_invites' | 'add_invites' | 'add_slots' | 'prefs.pending';  // PREF-SET-1
      proposalVersion?: number;
      remainingProposals?: number;
      // PREF-SET-1: 好み設定用
      proposed_prefs?: Record<string, unknown>;
      merged_prefs?: Record<string, unknown>;
    } }
  | { kind: 'pending.action.decided'; payload: {
      decision: 'send' | 'cancel' | 'new_thread' | 'add';
      canExecute: boolean;
    } }
  | { kind: 'pending.action.executed'; payload: {
      threadId: string;
      inserted?: number;
      emailQueued?: number;
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
  | { kind: 'preference.set'; payload: any }
  | { kind: 'preference.set.confirmed'; payload: any }
  | { kind: 'preference.set.cancelled'; payload: {} }
  | { kind: 'preference.show'; payload: any }
  | { kind: 'preference.clear'; payload: {} }
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

// Phase Next-5 Day2.1: Type-safe ExecutionContext
export interface ExecutionContext {
  pendingAutoPropose?: {
    emails: string[];
    duration: number;
    range: string;
    proposals: Array<{ start: string; end: string; label: string }>;
    source?: 'initial' | 'additional';
    threadId?: string;
  } | null;
  additionalProposeCount?: number;
  pendingRemind?: {
    threadId: string;
    pendingInvites: Array<{ email: string; name?: string }>;
    count: number;
  } | null;
  remindCount?: number;
  pendingNotify?: {
    threadId: string;
    invites: Array<{ email: string; name?: string }>;
    finalSlot: { start_at: string; end_at: string; label?: string };
    meetingUrl?: string;
  } | null;
  pendingSplit?: {
    threadId: string;
  } | null;
  pendingAction?: {
    confirmToken: string;
    expiresAt: string;
    summary: any;
    mode: 'new_thread' | 'add_to_thread' | 'add_slots' | 'preference_set';
    threadId?: string;
    threadTitle?: string;
    actionType?: 'send_invites' | 'add_invites' | 'add_slots' | 'prefs.pending';
    // PREF-SET-1: 好み設定フロー用
    proposed_prefs?: Record<string, unknown>;
    merged_prefs?: Record<string, unknown>;
  } | null;
  // P0-1: 正規化された pending (ChatLayout から渡される)
  pendingForThread?: import('../pendingTypes').PendingState | null;
  globalPendingAction?: import('../pendingTypes').PendingState | null;
  pendingRemindNeedResponse?: {
    threadId: string;
    targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
    count: number;
  } | null;
}
