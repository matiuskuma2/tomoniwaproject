/**
 * Invite Delivery Types and Constants
 * Beta A: 配信追跡機能の型定義
 * 
 * Usage:
 *   - メール/in_app通知の送達状況管理
 *   - 失敗時の再送対応
 *   - 監査（いつ誰にどのチャネルで送ったか）
 */

// ====== 配信種別 ======
export const DELIVERY_TYPE = {
  INVITE_SENT: 'invite_sent',           // 招待送信
  FINALIZED_NOTICE: 'finalized_notice', // 確定通知
  REMINDER: 'reminder',                 // リマインダー（将来用）
} as const;

export type DeliveryType = typeof DELIVERY_TYPE[keyof typeof DELIVERY_TYPE];

// ====== 配信チャネル ======
export const DELIVERY_CHANNEL = {
  EMAIL: 'email',     // メール
  IN_APP: 'in_app',   // Inbox通知
} as const;

export type DeliveryChannel = typeof DELIVERY_CHANNEL[keyof typeof DELIVERY_CHANNEL];

// ====== 配信ステータス ======
export const DELIVERY_STATUS = {
  QUEUED: 'queued',       // キュー投入済み
  SENT: 'sent',           // 送信完了（プロバイダに渡した）
  DELIVERED: 'delivered', // 配達確認済み
  FAILED: 'failed',       // 失敗
  SKIPPED: 'skipped',     // スキップ（重複など）
} as const;

export type DeliveryStatus = typeof DELIVERY_STATUS[keyof typeof DELIVERY_STATUS];

// ====== DB行型 ======
export interface InviteDelivery {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  thread_id: string;
  invite_id: string | null;
  delivery_type: DeliveryType;
  channel: DeliveryChannel;
  recipient_email: string | null;
  recipient_user_id: string | null;
  status: DeliveryStatus;
  provider: string | null;
  provider_message_id: string | null;
  queue_job_id: string | null;
  last_error: string | null;
  retry_count: number;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  created_at: string;
}

// ====== 配信作成パラメータ ======
export interface CreateDeliveryParams {
  workspace_id: string;
  owner_user_id: string;
  thread_id: string;
  invite_id?: string;
  delivery_type: DeliveryType;
  channel: DeliveryChannel;
  recipient_email?: string;
  recipient_user_id?: string;
  queue_job_id?: string;
}

// ====== 配信更新パラメータ ======
export interface UpdateDeliveryParams {
  status?: DeliveryStatus;
  provider?: string;
  provider_message_id?: string;
  last_error?: string;
  sent_at?: string;
  delivered_at?: string;
  failed_at?: string;
  retry_count?: number;
}

// ====== 配信サマリ ======
export interface DeliverySummary {
  total: number;
  by_channel: {
    email: { queued: number; sent: number; failed: number; };
    in_app: { queued: number; delivered: number; failed: number; };
  };
  by_status: Record<DeliveryStatus, number>;
}

// ====== Utility Functions ======

/**
 * 有効な配信種別か検証
 */
export function isValidDeliveryType(type: string): type is DeliveryType {
  return Object.values(DELIVERY_TYPE).includes(type as DeliveryType);
}

/**
 * 有効なチャネルか検証
 */
export function isValidChannel(channel: string): channel is DeliveryChannel {
  return Object.values(DELIVERY_CHANNEL).includes(channel as DeliveryChannel);
}

/**
 * 有効なステータスか検証
 */
export function isValidDeliveryStatus(status: string): status is DeliveryStatus {
  return Object.values(DELIVERY_STATUS).includes(status as DeliveryStatus);
}

/**
 * 再送可能か判定（failedかつretry_count < 3）
 */
export function canRetry(delivery: Pick<InviteDelivery, 'status' | 'retry_count'>): boolean {
  return delivery.status === DELIVERY_STATUS.FAILED && delivery.retry_count < 3;
}

/**
 * アプリユーザー判定（メール一致）
 * Beta A: users.email と一致すれば is_app_user=true
 */
export async function checkIsAppUser(
  db: D1Database,
  email: string
): Promise<{ isAppUser: boolean; userId: string | null }> {
  const normalizedEmail = email.trim().toLowerCase();
  
  const result = await db.prepare(`
    SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1
  `).bind(normalizedEmail).first<{ id: string }>();
  
  return {
    isAppUser: !!result,
    userId: result?.id || null,
  };
}

/**
 * 配信ID生成
 */
export function generateDeliveryId(): string {
  return `dlv_${crypto.randomUUID().replace(/-/g, '')}`;
}
