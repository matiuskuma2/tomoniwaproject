/**
 * Pending Action Types and Constants
 * Beta A: 送信確認機能の型定義
 * 
 * Usage:
 *   - POST /api/threads/prepare-send (新規スレッド)
 *   - POST /api/threads/:id/invites/prepare (追加招待)
 *   - POST /api/pending-actions/:token/confirm
 *   - POST /api/pending-actions/:token/execute
 */

// ====== アクション種別 ======
export const PENDING_ACTION_TYPE = {
  SEND_INVITES: 'send_invites',           // 新規スレッド作成＋招待送信
  ADD_INVITES: 'add_invites',             // 既存スレッドへの追加招待
  SEND_FINALIZE_NOTICE: 'send_finalize_notice', // 確定通知送信
} as const;

export type PendingActionType = typeof PENDING_ACTION_TYPE[keyof typeof PENDING_ACTION_TYPE];

// ====== ソース種別 ======
export const PENDING_ACTION_SOURCE = {
  EMAILS: 'emails',   // メール直接入力
  LIST: 'list',       // リストから
} as const;

export type PendingActionSource = typeof PENDING_ACTION_SOURCE[keyof typeof PENDING_ACTION_SOURCE];

// ====== ステータス ======
export const PENDING_ACTION_STATUS = {
  PENDING: 'pending',                       // 確認待ち
  CONFIRMED_SEND: 'confirmed_send',         // 送信確定
  CONFIRMED_CANCEL: 'confirmed_cancel',     // キャンセル確定
  CONFIRMED_NEW_THREAD: 'confirmed_new_thread', // 別スレッドで
  EXECUTED: 'executed',                     // 実行完了
  EXPIRED: 'expired',                       // 期限切れ
} as const;

export type PendingActionStatus = typeof PENDING_ACTION_STATUS[keyof typeof PENDING_ACTION_STATUS];

// ====== 確認決定 (3語固定) ======
export const CONFIRM_DECISION = {
  SEND: 'send',             // 「送る」
  CANCEL: 'cancel',         // 「キャンセル」
  NEW_THREAD: 'new_thread', // 「別スレッドで」
} as const;

export type ConfirmDecision = typeof CONFIRM_DECISION[keyof typeof CONFIRM_DECISION];

// ====== ペイロード型 ======
export interface SendInvitesPayload {
  source_type: 'emails';
  emails: string[];
  thread_title?: string;  // 新規の場合
}

export interface AddFromListPayload {
  source_type: 'list';
  list_id: string;
  list_name: string;
}

export type PendingActionPayload = SendInvitesPayload | AddFromListPayload;

// ====== サマリ型 ======
export interface SkippedReason {
  reason: 'invalid_email' | 'duplicate_input' | 'missing_email' | 'already_invited';
  count: number;
}

export interface RecipientPreview {
  email: string;
  display_name?: string;
  is_app_user: boolean;
}

export interface PendingActionSummary {
  total_count: number;           // 総件数
  valid_count: number;           // 有効件数
  skipped_count: number;         // スキップ件数
  skipped_reasons: SkippedReason[];
  preview: RecipientPreview[];   // 最大5件
  source_label: string;          // "3件のメールアドレス" or "営業部リスト"
}

// ====== DB行型 ======
export interface PendingAction {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  thread_id: string | null;
  action_type: PendingActionType;
  source_type: PendingActionSource;
  payload_json: string;
  summary_json: string;
  confirm_token: string;
  status: PendingActionStatus;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  request_id: string | null;
  last_error: string | null;
  created_at: string;
}

// ====== API レスポンス型 ======
export interface PrepareResponse {
  confirm_token: string;
  expires_at: string;
  expires_in_seconds: number;
  summary: PendingActionSummary;
  default_decision: ConfirmDecision;
  thread_id?: string;  // 追加招待の場合
  message: string;     // UI表示用メッセージ
}

export interface ConfirmResponse {
  status: PendingActionStatus;
  decision: ConfirmDecision;
  message: string;
  can_execute: boolean;  // execute可能か
}

export interface ExecuteResult {
  inserted: number;
  skipped: number;
  failed: number;
  deliveries: {
    email_queued: number;
    in_app_created: number;
  };
}

export interface ExecuteResponse {
  success: boolean;
  thread_id: string;
  result: ExecuteResult;
  message: string;
  request_id: string;
}

// ====== Utility Functions ======

/**
 * 有効なアクション種別か検証
 */
export function isValidActionType(type: string): type is PendingActionType {
  return Object.values(PENDING_ACTION_TYPE).includes(type as PendingActionType);
}

/**
 * 有効なソース種別か検証
 */
export function isValidSourceType(source: string): source is PendingActionSource {
  return Object.values(PENDING_ACTION_SOURCE).includes(source as PendingActionSource);
}

/**
 * 有効なステータスか検証
 */
export function isValidStatus(status: string): status is PendingActionStatus {
  return Object.values(PENDING_ACTION_STATUS).includes(status as PendingActionStatus);
}

/**
 * 有効な確認決定か検証
 */
export function isValidDecision(decision: string): decision is ConfirmDecision {
  return Object.values(CONFIRM_DECISION).includes(decision as ConfirmDecision);
}

/**
 * execute可能なステータスか判定
 */
export function canExecute(status: PendingActionStatus): boolean {
  return status === PENDING_ACTION_STATUS.CONFIRMED_SEND ||
         status === PENDING_ACTION_STATUS.CONFIRMED_NEW_THREAD;
}

/**
 * 期限切れか判定
 */
export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

/**
 * confirm_token生成（32文字以上）
 */
export function generateConfirmToken(): string {
  // crypto.randomUUID() のハイフン除去で32文字
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * 有効期限生成（15分後）
 */
export function generateExpiresAt(minutesFromNow: number = 15): string {
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + minutesFromNow);
  return expires.toISOString();
}
