/**
 * Pending Actions Repository
 * Beta A: 送信確認機能
 * 
 * 用途:
 *   - メール送信前の確認待ち状態を管理
 *   - 3語固定（送る/キャンセル/別スレッドで）の状態遷移
 *   - 冪等性担保（request_id）
 */

// ====== Types ======

export type PendingActionStatus =
  | 'pending'              // 確認待ち
  | 'confirmed_send'       // 送信確定
  | 'confirmed_cancel'     // キャンセル確定
  | 'confirmed_new_thread' // 別スレッドで確定
  | 'executed'             // 実行完了
  | 'expired';             // 期限切れ

export type PendingActionMode = 'add_to_thread' | 'new_thread';
export type PendingActionSource = 'emails' | 'list';
export type ConfirmDecision = 'send' | 'cancel' | 'new_thread';

export interface PendingActionRow {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  thread_id: string | null;
  action_type: 'send_invites' | 'add_invites' | 'send_finalize_notice' | 'add_slots';
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

export interface PendingActionPayload {
  source_type: PendingActionSource;
  emails?: string[];
  list_id?: string;
  list_name?: string;
  title?: string;
}

export interface PendingActionSummary {
  total_count: number;
  valid_count: number;
  preview: Array<{ email: string; display_name?: string; is_app_user: boolean }>;
  preview_count: number;
  skipped: {
    invalid_email: number;
    duplicate_input: number;
    missing_email: number;
    already_invited: number;
  };
  app_users_count: number;
  external_count: number;
}

// ====== Repository ======

export class PendingActionsRepository {
  constructor(private db: D1Database) {}

  /**
   * pending_action 作成
   */
  async create(args: {
    id: string;
    workspaceId: string;
    ownerUserId: string;
    threadId: string | null;
    actionType: 'send_invites' | 'add_invites';
    sourceType: PendingActionSource;
    payload: PendingActionPayload;
    summary: PendingActionSummary;
    confirmToken: string;
    expiresAtISO: string;
    requestId: string;
  }): Promise<PendingActionRow> {
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO pending_actions (
        id, workspace_id, owner_user_id, thread_id,
        action_type, source_type,
        payload_json, summary_json,
        confirm_token, status, expires_at,
        request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(
      args.id,
      args.workspaceId,
      args.ownerUserId,
      args.threadId,
      args.actionType,
      args.sourceType,
      JSON.stringify(args.payload),
      JSON.stringify(args.summary),
      args.confirmToken,
      args.expiresAtISO,
      args.requestId,
      now
    ).run();

    return {
      id: args.id,
      workspace_id: args.workspaceId,
      owner_user_id: args.ownerUserId,
      thread_id: args.threadId,
      action_type: args.actionType,
      source_type: args.sourceType,
      payload_json: JSON.stringify(args.payload),
      summary_json: JSON.stringify(args.summary),
      confirm_token: args.confirmToken,
      status: 'pending',
      expires_at: args.expiresAtISO,
      confirmed_at: null,
      executed_at: null,
      request_id: args.requestId,
      last_error: null,
      created_at: now,
    };
  }

  /**
   * confirm_token で取得
   */
  async getByToken(confirmToken: string): Promise<PendingActionRow | null> {
    const result = await this.db.prepare(`
      SELECT * FROM pending_actions WHERE confirm_token = ? LIMIT 1
    `).bind(confirmToken).first<PendingActionRow>();

    return result || null;
  }

  /**
   * request_id で取得（冪等性チェック用）
   */
  async getByRequestId(requestId: string): Promise<PendingActionRow | null> {
    const result = await this.db.prepare(`
      SELECT * FROM pending_actions WHERE request_id = ? LIMIT 1
    `).bind(requestId).first<PendingActionRow>();

    return result || null;
  }

  /**
   * confirm（状態遷移）
   * @param decision 'send' | 'cancel' | 'new_thread'
   */
  async confirm(args: {
    id: string;
    decision: ConfirmDecision;
  }): Promise<{ success: boolean; newStatus: PendingActionStatus }> {
    const statusMap: Record<ConfirmDecision, PendingActionStatus> = {
      send: 'confirmed_send',
      cancel: 'confirmed_cancel',
      new_thread: 'confirmed_new_thread',
    };

    const newStatus = statusMap[args.decision];

    const result = await this.db.prepare(`
      UPDATE pending_actions
      SET status = ?, confirmed_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).bind(newStatus, args.id).run();

    return {
      success: (result.meta?.changes || 0) > 0,
      newStatus,
    };
  }

  /**
   * execute 完了（status = 'executed'）
   */
  async markExecuted(id: string, threadId?: string): Promise<boolean> {
    let sql = `
      UPDATE pending_actions
      SET status = 'executed', executed_at = datetime('now')
      WHERE id = ? AND status IN ('confirmed_send', 'confirmed_new_thread')
    `;
    const bindings: any[] = [id];

    // new_thread の場合、thread_id も更新
    if (threadId) {
      sql = `
        UPDATE pending_actions
        SET status = 'executed', executed_at = datetime('now'), thread_id = ?
        WHERE id = ? AND status IN ('confirmed_send', 'confirmed_new_thread')
      `;
      bindings.unshift(threadId);
    }

    const result = await this.db.prepare(sql).bind(...bindings).run();
    return (result.meta?.changes || 0) > 0;
  }

  /**
   * 期限切れに更新
   */
  async markExpired(id: string): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE pending_actions
      SET status = 'expired'
      WHERE id = ? AND status = 'pending'
    `).bind(id).run();

    return (result.meta?.changes || 0) > 0;
  }

  /**
   * エラー記録
   */
  async setError(id: string, errorMessage: string): Promise<void> {
    await this.db.prepare(`
      UPDATE pending_actions SET last_error = ? WHERE id = ?
    `).bind(errorMessage, id).run();
  }

  /**
   * 期限切れチェック
   */
  isExpired(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() < Date.now();
  }

  /**
   * execute 可能なステータスか判定
   */
  canExecute(status: PendingActionStatus): boolean {
    return status === 'confirmed_send' || status === 'confirmed_new_thread';
  }
}

// ====== Helper Functions ======

/**
 * confirm_token 生成（32文字）
 */
export function generateConfirmToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * 有効期限生成（デフォルト15分後）
 */
export function generateExpiresAt(minutesFromNow: number = 15): string {
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + minutesFromNow);
  return expires.toISOString();
}
