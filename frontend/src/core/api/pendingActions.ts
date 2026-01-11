/**
 * PendingActions API Client
 * Beta A: 送信確認フロー (prepare → confirm → execute)
 * 
 * Flow:
 * 1. prepare: emails/list → pending_action作成 → confirm_token返却
 * 2. confirm: 3語固定（送る/キャンセル/別スレッドで）
 * 3. execute: 実際の招待送信
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

/**
 * 決定タイプ
 * 通常: 3語固定（送る/キャンセル/別スレッドで）
 * 追加候補: 2語固定（追加/キャンセル）
 */
export type PendingDecision = 
  | '送る' | 'キャンセル' | '別スレッドで' | 'send' | 'cancel' | 'new_thread'
  | '追加' | '追加する' | 'add' | 'やめる';  // Phase2: 追加候補用

/**
 * 送信先のサマリ情報
 */
export interface PendingActionSummary {
  total_count: number;
  valid_count: number;
  preview: Array<{
    email: string;
    display_name?: string;
    is_app_user: boolean;
  }>;
  preview_count: number;
  skipped: {
    invalid_email: number;
    duplicate_input: number;
    missing_email: number;
    already_invited: number;
  };
  app_users_count: number;
  external_count: number;
  source_label: string;
}

/**
 * prepare API のレスポンス
 */
export interface PrepareSendResponse {
  request_id: string;
  confirm_token: string;
  expires_at: string;
  expires_in_seconds: number;
  summary: PendingActionSummary;
  default_decision: 'send';
  message_for_chat: string;
  thread_id?: string;
  thread_title?: string;
}

/**
 * confirm API のレスポンス
 */
export interface ConfirmResponse {
  request_id: string;
  success: boolean;
  status: string;
  decision: 'send' | 'cancel' | 'new_thread';
  can_execute: boolean;
  message_for_chat: string;
}

/**
 * execute API のレスポンス
 */
export interface ExecuteResponse {
  request_id: string;
  success: boolean;
  thread_id: string;
  result: {
    inserted: number;
    skipped: number;
    failed: number;
    deliveries: {
      email_queued: number;
      in_app_created: number;
    };
  };
  message_for_chat: string;
}

// Phase2: 追加候補の execute レスポンス
export interface ExecuteAddSlotsResponse {
  request_id: string;
  success: boolean;
  thread_id: string;
  proposal_version: number;
  remaining_proposals: number;
  result: {
    slots_added: number;
    slot_ids: string[];
    notifications: {
      email_queued: number;
      in_app_created: number;
      total_recipients: number;
    };
  };
  message_for_chat: string;
}

// ============================================================
// API Client
// ============================================================

export const pendingActionsApi = {
  /**
   * 確認（3語固定）
   * POST /api/pending-actions/:token/confirm
   * 
   * @param token - confirm_token from prepare response
   * @param decision - '送る' | 'キャンセル' | '別スレッドで'
   */
  async confirm(token: string, decision: PendingDecision): Promise<ConfirmResponse> {
    return api.post(`/api/pending-actions/${token}/confirm`, { decision });
  },

  /**
   * 実行（招待送信）
   * POST /api/pending-actions/:token/execute
   * 
   * @param token - confirm_token from prepare response
   * @param requestId - optional request_id for idempotency
   */
  async execute(token: string, requestId?: string): Promise<ExecuteResponse> {
    const body = requestId ? { request_id: requestId } : {};
    return api.post(`/api/pending-actions/${token}/execute`, body);
  },
};
