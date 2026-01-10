/**
 * Executor Types - 共通型定義
 * 
 * apiExecutor.ts から抽出した型定義
 */

import type { 
  ThreadStatus_API, 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse 
} from '../../core/models';

// ============================================================
// Execution Result Types
// ============================================================

export type ExecutionResultData =
  | { kind: 'calendar.today'; payload: CalendarTodayResponse }
  | { kind: 'calendar.week'; payload: CalendarWeekResponse }
  | { kind: 'calendar.freebusy'; payload: CalendarFreeBusyResponse }
  | { kind: 'thread.status'; payload: ThreadStatus_API | { threads: any[] } }
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
  | { kind: 'auto_propose.cancelled'; payload: Record<string, never> }
  | { kind: 'auto_propose.created'; payload: any }
  | { kind: 'remind.pending.generated'; payload: {
      source: 'remind';
      threadId: string;
      pendingInvites: Array<{ email: string; name?: string }>;
      count: number;
    } }
  | { kind: 'remind.pending.cancelled'; payload: Record<string, never> }
  | { kind: 'remind.pending.sent'; payload: any }
  | { kind: 'notify.confirmed.generated'; payload: {
      source: 'notify';
      threadId: string;
      invites: Array<{ email: string; name?: string }>;
      finalSlot: { start_at: string; end_at: string; label?: string };
      meetingUrl?: string;
    } }
  | { kind: 'notify.confirmed.cancelled'; payload: Record<string, never> }
  | { kind: 'notify.confirmed.sent'; payload: any }
  | { kind: 'split.propose.generated'; payload: {
      source: 'split';
      threadId: string;
      voteSummary: Array<{ label: string; votes: number }>;
    } }
  | { kind: 'split.propose.cancelled'; payload: Record<string, never> }
  // Beta A: 送信確認フロー
  | { kind: 'pending.action.created'; payload: {
      confirmToken: string;
      expiresAt: string;
      summary: any;
      mode: 'new_thread' | 'add_to_thread';
      threadId?: string;
      threadTitle?: string;
    } }
  | { kind: 'pending.action.decided'; payload: {
      decision: 'send' | 'cancel' | 'new_thread';
      canExecute: boolean;
    } }
  | { kind: 'pending.action.executed'; payload: {
      threadId: string;
      inserted: number;
      emailQueued: number;
    } }
  | { kind: 'pending.action.cleared'; payload: Record<string, never> }
  // Beta A: リスト5コマンド
  | { kind: 'list.created'; payload: { listId: string; listName: string } }
  | { kind: 'list.listed'; payload: { lists: any[] } }
  | { kind: 'list.members'; payload: { listName: string; members: any[] } }
  | { kind: 'list.member_added'; payload: { listName: string; email: string } };

export interface ExecutionResult {
  success: boolean;
  message: string;
  data?: ExecutionResultData;
  needsClarification?: {
    field: string;
    message: string;
  };
}

// ============================================================
// Execution Context
// ============================================================

export interface ExecutionContext {
  pendingAutoPropose?: {
    emails: string[];
    duration: number;
    range: string;
    proposals: Array<{ start_at: string; end_at: string; label: string }>;
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
    mode: 'new_thread' | 'add_to_thread';
    threadId?: string;
    threadTitle?: string;
  } | null;
}

// ============================================================
// Re-exports
// ============================================================

export type { 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse,
  ThreadStatus_API 
};
