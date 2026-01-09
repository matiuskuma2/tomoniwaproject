/**
 * Invite Deliveries Repository
 * Beta A: 配信追跡機能
 * 
 * 用途:
 *   - メール/in_app通知の送達状況管理
 *   - 失敗時の再送対応
 *   - 監査（いつ誰にどのチャネルで送ったか）
 */

// ====== Types ======

export type DeliveryType = 'invite_sent' | 'finalized_notice' | 'reminder';
export type DeliveryChannel = 'email' | 'in_app';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped';

export interface InviteDeliveryRow {
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

export interface CreateDeliveryParams {
  id?: string;
  workspaceId: string;
  ownerUserId: string;
  threadId: string;
  inviteId?: string;
  deliveryType: DeliveryType;
  channel: DeliveryChannel;
  recipientEmail?: string;
  recipientUserId?: string;
  queueJobId?: string;
}

// ====== Repository ======

export class InviteDeliveriesRepository {
  constructor(private db: D1Database) {}

  /**
   * 配信レコード作成
   */
  async create(params: CreateDeliveryParams): Promise<InviteDeliveryRow> {
    const id = params.id || generateDeliveryId();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO invite_deliveries (
        id, workspace_id, owner_user_id, thread_id, invite_id,
        delivery_type, channel, recipient_email, recipient_user_id,
        status, queue_job_id, queued_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
    `).bind(
      id,
      params.workspaceId,
      params.ownerUserId,
      params.threadId,
      params.inviteId || null,
      params.deliveryType,
      params.channel,
      params.recipientEmail || null,
      params.recipientUserId || null,
      params.queueJobId || null,
      now,
      now
    ).run();

    return {
      id,
      workspace_id: params.workspaceId,
      owner_user_id: params.ownerUserId,
      thread_id: params.threadId,
      invite_id: params.inviteId || null,
      delivery_type: params.deliveryType,
      channel: params.channel,
      recipient_email: params.recipientEmail || null,
      recipient_user_id: params.recipientUserId || null,
      status: 'queued',
      provider: null,
      provider_message_id: null,
      queue_job_id: params.queueJobId || null,
      last_error: null,
      retry_count: 0,
      queued_at: now,
      sent_at: null,
      delivered_at: null,
      failed_at: null,
      created_at: now,
    };
  }

  /**
   * バッチ作成（複数配信を一括）
   */
  async createBatch(deliveries: CreateDeliveryParams[]): Promise<{ inserted: number; ids: string[] }> {
    if (deliveries.length === 0) {
      return { inserted: 0, ids: [] };
    }

    const now = new Date().toISOString();
    const ids: string[] = [];

    // D1のバッチ制限のため、100件ずつ処理
    const CHUNK_SIZE = 100;
    for (let i = 0; i < deliveries.length; i += CHUNK_SIZE) {
      const chunk = deliveries.slice(i, i + CHUNK_SIZE);
      
      const statements = chunk.map((d) => {
        const id = d.id || generateDeliveryId();
        ids.push(id);
        
        return this.db.prepare(`
          INSERT INTO invite_deliveries (
            id, workspace_id, owner_user_id, thread_id, invite_id,
            delivery_type, channel, recipient_email, recipient_user_id,
            status, queue_job_id, queued_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        `).bind(
          id,
          d.workspaceId,
          d.ownerUserId,
          d.threadId,
          d.inviteId || null,
          d.deliveryType,
          d.channel,
          d.recipientEmail || null,
          d.recipientUserId || null,
          d.queueJobId || null,
          now,
          now
        );
      });

      await this.db.batch(statements);
    }

    return { inserted: ids.length, ids };
  }

  /**
   * ステータス更新: sent
   */
  async markSent(id: string, provider?: string, providerMessageId?: string): Promise<void> {
    await this.db.prepare(`
      UPDATE invite_deliveries
      SET status = 'sent', provider = ?, provider_message_id = ?, sent_at = datetime('now')
      WHERE id = ?
    `).bind(provider || null, providerMessageId || null, id).run();
  }

  /**
   * ステータス更新: delivered（in_app用）
   */
  async markDelivered(id: string): Promise<void> {
    await this.db.prepare(`
      UPDATE invite_deliveries
      SET status = 'delivered', delivered_at = datetime('now')
      WHERE id = ?
    `).bind(id).run();
  }

  /**
   * ステータス更新: failed
   */
  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.db.prepare(`
      UPDATE invite_deliveries
      SET status = 'failed', last_error = ?, failed_at = datetime('now'), retry_count = retry_count + 1
      WHERE id = ?
    `).bind(errorMessage, id).run();
  }

  /**
   * ステータス更新: skipped
   */
  async markSkipped(id: string, reason: string): Promise<void> {
    await this.db.prepare(`
      UPDATE invite_deliveries
      SET status = 'skipped', last_error = ?
      WHERE id = ?
    `).bind(reason, id).run();
  }

  /**
   * スレッド別の配信サマリ取得
   */
  async getSummaryByThread(threadId: string): Promise<{
    total: number;
    email_queued: number;
    email_sent: number;
    email_failed: number;
    in_app_queued: number;
    in_app_delivered: number;
    in_app_failed: number;
  }> {
    const result = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN channel = 'email' AND status = 'queued' THEN 1 ELSE 0 END) as email_queued,
        SUM(CASE WHEN channel = 'email' AND status = 'sent' THEN 1 ELSE 0 END) as email_sent,
        SUM(CASE WHEN channel = 'email' AND status = 'failed' THEN 1 ELSE 0 END) as email_failed,
        SUM(CASE WHEN channel = 'in_app' AND status = 'queued' THEN 1 ELSE 0 END) as in_app_queued,
        SUM(CASE WHEN channel = 'in_app' AND status = 'delivered' THEN 1 ELSE 0 END) as in_app_delivered,
        SUM(CASE WHEN channel = 'in_app' AND status = 'failed' THEN 1 ELSE 0 END) as in_app_failed
      FROM invite_deliveries
      WHERE thread_id = ?
    `).bind(threadId).first<any>();

    return {
      total: result?.total || 0,
      email_queued: result?.email_queued || 0,
      email_sent: result?.email_sent || 0,
      email_failed: result?.email_failed || 0,
      in_app_queued: result?.in_app_queued || 0,
      in_app_delivered: result?.in_app_delivered || 0,
      in_app_failed: result?.in_app_failed || 0,
    };
  }

  /**
   * invite_id で配信リスト取得
   */
  async getByInviteId(inviteId: string): Promise<InviteDeliveryRow[]> {
    const result = await this.db.prepare(`
      SELECT * FROM invite_deliveries WHERE invite_id = ? ORDER BY created_at DESC
    `).bind(inviteId).all<InviteDeliveryRow>();

    return result.results || [];
  }

  /**
   * 失敗した配信を取得（再送用）
   */
  async getFailedDeliveries(limit: number = 100): Promise<InviteDeliveryRow[]> {
    const result = await this.db.prepare(`
      SELECT * FROM invite_deliveries
      WHERE status = 'failed' AND retry_count < 3
      ORDER BY failed_at ASC
      LIMIT ?
    `).bind(limit).all<InviteDeliveryRow>();

    return result.results || [];
  }
}

// ====== Helper Functions ======

/**
 * 配信ID生成
 */
export function generateDeliveryId(): string {
  return `dlv_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * アプリユーザー判定（メール一致）
 * Beta A: users.email と一致すれば is_app_user=true
 */
export async function checkIsAppUser(
  db: D1Database,
  email: string
): Promise<{ isAppUser: boolean; userId: string | null; displayName: string | null }> {
  const normalizedEmail = email.trim().toLowerCase();
  
  const result = await db.prepare(`
    SELECT id, display_name FROM users WHERE LOWER(email) = ? LIMIT 1
  `).bind(normalizedEmail).first<{ id: string; display_name: string | null }>();
  
  return {
    isAppUser: !!result,
    userId: result?.id || null,
    displayName: result?.display_name || null,
  };
}

/**
 * 複数メールのアプリユーザー判定（バッチ）
 */
export async function checkIsAppUserBatch(
  db: D1Database,
  emails: string[]
): Promise<Map<string, { isAppUser: boolean; userId: string | null; displayName: string | null }>> {
  const result = new Map<string, { isAppUser: boolean; userId: string | null; displayName: string | null }>();

  if (emails.length === 0) return result;

  // 正規化
  const normalizedEmails = emails.map((e) => e.trim().toLowerCase());

  // クエリ（最大100件ずつ）
  const CHUNK_SIZE = 100;
  for (let i = 0; i < normalizedEmails.length; i += CHUNK_SIZE) {
    const chunk = normalizedEmails.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    
    const rows = await db.prepare(`
      SELECT id, email, display_name FROM users WHERE LOWER(email) IN (${placeholders})
    `).bind(...chunk).all<{ id: string; email: string; display_name: string | null }>();

    // マップに追加
    for (const row of rows.results || []) {
      const email = row.email.toLowerCase();
      result.set(email, {
        isAppUser: true,
        userId: row.id,
        displayName: row.display_name,
      });
    }
  }

  // 見つからなかったものは isAppUser: false
  for (const email of normalizedEmails) {
    if (!result.has(email)) {
      result.set(email, { isAppUser: false, userId: null, displayName: null });
    }
  }

  return result;
}
