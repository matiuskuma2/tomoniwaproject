/**
 * PendingAction Types and Constants (Beta A)
 * 
 * 送信確認の状態管理とペイロード型定義
 * Matches pending_actions table constraints
 */

// ====== Action Types ======
export const PENDING_ACTION_TYPE = {
  SEND_INVITES: 'send_invites',           // 新規スレッド作成＋招待送信
  ADD_INVITES: 'add_invites',             // 既存スレッドへの追加招待
  SEND_FINALIZE_NOTICE: 'send_finalize_notice', // 確定通知送信
} as const;

export type PendingActionType = typeof PENDING_ACTION_TYPE[keyof typeof PENDING_ACTION_TYPE];

// ====== Source Types ======
export const PENDING_ACTION_SOURCE = {
  EMAILS: 'emails',   // メール直接入力
  LIST: 'list',       // リストから
} as const;

export type PendingActionSource = typeof PENDING_ACTION_SOURCE[keyof typeof PENDING_ACTION_SOURCE];

// ====== Status ======
export const PENDING_ACTION_STATUS = {
  PENDING: 'pending',                       // 確認待ち
  CONFIRMED_SEND: 'confirmed_send',         // 送信確定
  CONFIRMED_CANCEL: 'confirmed_cancel',     // キャンセル確定
  CONFIRMED_NEW_THREAD: 'confirmed_new_thread', // 別スレッドで
  EXECUTED: 'executed',                     // 実行完了
  EXPIRED: 'expired',                       // 期限切れ
} as const;

export type PendingActionStatus = typeof PENDING_ACTION_STATUS[keyof typeof PENDING_ACTION_STATUS];

// ====== Decision (3語固定) ======
export const CONFIRM_DECISION = {
  SEND: 'send',           // 「送る」
  CANCEL: 'cancel',       // 「キャンセル」
  NEW_THREAD: 'new_thread', // 「別スレッドで」
} as const;

export type ConfirmDecision = typeof CONFIRM_DECISION[keyof typeof CONFIRM_DECISION];

// ====== Payload Types ======

/**
 * メール直接入力時のペイロード
 */
export interface EmailsPayload {
  source_type: 'emails';
  emails: string[];           // 入力されたメールアドレス
  title?: string;             // スレッドタイトル（新規の場合）
  description?: string;       // スレッド説明
}

/**
 * リスト指定時のペイロード
 */
export interface ListPayload {
  source_type: 'list';
  list_id: string;
  list_name: string;
  title?: string;
  description?: string;
}

export type PendingActionPayload = EmailsPayload | ListPayload;

// ====== Summary Types ======

/**
 * スキップ理由
 */
export interface SkippedReason {
  reason: 'invalid_email' | 'duplicate_input' | 'missing_email' | 'already_invited';
  count: number;
  examples?: string[];  // 最大3件
}

/**
 * プレビュー項目
 */
export interface PreviewItem {
  email: string;
  name?: string;
  is_app_user: boolean;
}

/**
 * サマリ（UI表示用）
 */
export interface PendingActionSummary {
  total_count: number;          // 送信予定総数
  valid_count: number;          // 有効な宛先数
  skipped_count: number;        // スキップ数
  skipped_reasons: SkippedReason[];
  preview: PreviewItem[];       // 最大5件
  source_description: string;   // 「メール3件」「営業部リスト（10名）」など
}

// ====== Entity Type ======

/**
 * PendingAction エンティティ
 */
export interface PendingAction {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  thread_id: string | null;
  action_type: PendingActionType;
  source_type: PendingActionSource;
  payload_json: string;   // JSON.stringify(PendingActionPayload)
  summary_json: string;   // JSON.stringify(PendingActionSummary)
  confirm_token: string;
  status: PendingActionStatus;
  expires_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
  request_id: string | null;
  last_error: string | null;
  created_at: string;
}

// ====== Helper Functions ======

export function isValidActionType(type: string): type is PendingActionType {
  return Object.values(PENDING_ACTION_TYPE).includes(type as PendingActionType);
}

export function isValidActionStatus(status: string): status is PendingActionStatus {
  return Object.values(PENDING_ACTION_STATUS).includes(status as PendingActionStatus);
}

export function isValidConfirmDecision(decision: string): decision is ConfirmDecision {
  return Object.values(CONFIRM_DECISION).includes(decision as ConfirmDecision);
}

/**
 * 決定から次のステータスへのマッピング
 */
export function decisionToStatus(decision: ConfirmDecision): PendingActionStatus {
  switch (decision) {
    case CONFIRM_DECISION.SEND:
      return PENDING_ACTION_STATUS.CONFIRMED_SEND;
    case CONFIRM_DECISION.CANCEL:
      return PENDING_ACTION_STATUS.CONFIRMED_CANCEL;
    case CONFIRM_DECISION.NEW_THREAD:
      return PENDING_ACTION_STATUS.CONFIRMED_NEW_THREAD;
    default:
      throw new Error(`Invalid decision: ${decision}`);
  }
}

/**
 * confirm_token 生成（32文字以上）
 */
export function generateConfirmToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + 
         crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  // 結果: 32 + 8 = 40文字
}

/**
 * 有効期限計算（15分後）
 */
export function calculateExpiresAt(fromDate: Date = new Date()): string {
  const expiresAt = new Date(fromDate.getTime() + 15 * 60 * 1000);
  return expiresAt.toISOString();
}

/**
 * 期限切れチェック
 */
export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
