/**
 * InviteDelivery Types and Constants (Beta A)
 * 
 * 配信追跡の状態管理
 * Matches invite_deliveries table constraints
 */

// ====== Delivery Types ======
export const DELIVERY_TYPE = {
  INVITE_SENT: 'invite_sent',           // 招待送信
  FINALIZED_NOTICE: 'finalized_notice', // 確定通知
  REMINDER: 'reminder',                 // リマインダー
} as const;

export type DeliveryType = typeof DELIVERY_TYPE[keyof typeof DELIVERY_TYPE];

// ====== Channels ======
export const DELIVERY_CHANNEL = {
  EMAIL: 'email',
  IN_APP: 'in_app',
} as const;

export type DeliveryChannel = typeof DELIVERY_CHANNEL[keyof typeof DELIVERY_CHANNEL];

// ====== Status ======
export const DELIVERY_STATUS = {
  QUEUED: 'queued',       // キュー投入済み
  SENT: 'sent',           // 送信完了
  DELIVERED: 'delivered', // 配達確認済み
  FAILED: 'failed',       // 失敗
  SKIPPED: 'skipped',     // スキップ
} as const;

export type DeliveryStatus = typeof DELIVERY_STATUS[keyof typeof DELIVERY_STATUS];

// ====== Entity Type ======

/**
 * InviteDelivery エンティティ
 */
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

// ====== Helper Functions ======

export function isValidDeliveryType(type: string): type is DeliveryType {
  return Object.values(DELIVERY_TYPE).includes(type as DeliveryType);
}

export function isValidDeliveryChannel(channel: string): channel is DeliveryChannel {
  return Object.values(DELIVERY_CHANNEL).includes(channel as DeliveryChannel);
}

export function isValidDeliveryStatus(status: string): status is DeliveryStatus {
  return Object.values(DELIVERY_STATUS).includes(status as DeliveryStatus);
}

/**
 * アプリユーザー判定（メール一致）
 */
export async function checkIsAppUser(
  db: D1Database,
  email: string
): Promise<{ is_app_user: boolean; user_id: string | null }> {
  const result = await db.prepare(`
    SELECT id FROM users WHERE email = ? LIMIT 1
  `).bind(email.toLowerCase().trim()).first<{ id: string }>();
  
  return {
    is_app_user: !!result,
    user_id: result?.id || null,
  };
}

/**
 * 配信チャネル決定
 * - アプリユーザー: email + in_app 両方
 * - 外部ユーザー: email のみ
 */
export function determineDeliveryChannels(
  isAppUser: boolean
): DeliveryChannel[] {
  if (isAppUser) {
    return [DELIVERY_CHANNEL.EMAIL, DELIVERY_CHANNEL.IN_APP];
  }
  return [DELIVERY_CHANNEL.EMAIL];
}

/**
 * InviteDelivery 作成パラメータ
 */
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
  provider?: string;
}

/**
 * ID生成
 */
export function generateDeliveryId(): string {
  return `dlv-${crypto.randomUUID()}`;
}
