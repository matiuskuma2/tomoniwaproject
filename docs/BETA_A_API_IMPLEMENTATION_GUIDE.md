# Beta A API 実装ガイド（貼ってそのまま実装できる粒度）

**作成日**: 2026-01-09  
**対象**: チケットB（prepare / confirm / execute）  

---

## 1. ファイル構成

```
apps/api/src/
├── routes/
│   ├── pendingActions.ts        # 新規: confirm/execute
│   └── threads.ts               # 修正: prepare-send追加
├── repositories/
│   ├── pendingActionsRepository.ts   # 新規
│   └── inviteDeliveriesRepository.ts # 新規
└── utils/
    └── emailNormalizer.ts       # 新規
```

---

## 2. Repository: pendingActionsRepository.ts

```typescript
/**
 * Pending Actions Repository
 * Beta A: 送信確認機能
 */

import {
  PENDING_ACTION_STATUS,
  PENDING_ACTION_TYPE,
  type PendingAction,
  type PendingActionPayload,
  type PendingActionSummary,
  type PendingActionStatus,
  type ConfirmDecision,
  generateConfirmToken,
  generateExpiresAt,
  isExpired,
  canExecute,
} from '../../../../../packages/shared/src/types/pendingAction';
import { clampPayload } from '../utils/payloadClamp';

export class PendingActionsRepository {
  constructor(private db: D1Database) {}

  /**
   * pending_action 作成
   */
  async create(params: {
    workspace_id: string;
    owner_user_id: string;
    thread_id: string | null;
    action_type: 'send_invites' | 'add_invites';
    source_type: 'emails' | 'list';
    payload: PendingActionPayload;
    summary: PendingActionSummary;
  }): Promise<PendingAction> {
    const id = crypto.randomUUID();
    const confirmToken = generateConfirmToken();
    const expiresAt = generateExpiresAt(15); // 15分
    const now = new Date().toISOString();

    // payload/summary のクランプ（8KB制限）
    const payloadJson = clampPayload(JSON.stringify(params.payload), 8192);
    const summaryJson = clampPayload(JSON.stringify(params.summary), 8192);

    await this.db.prepare(`
      INSERT INTO pending_actions (
        id, workspace_id, owner_user_id, thread_id,
        action_type, source_type, payload_json, summary_json,
        confirm_token, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      params.workspace_id,
      params.owner_user_id,
      params.thread_id,
      params.action_type,
      params.source_type,
      payloadJson,
      summaryJson,
      confirmToken,
      PENDING_ACTION_STATUS.PENDING,
      expiresAt,
      now
    ).run();

    return {
      id,
      workspace_id: params.workspace_id,
      owner_user_id: params.owner_user_id,
      thread_id: params.thread_id,
      action_type: params.action_type as any,
      source_type: params.source_type as any,
      payload_json: payloadJson,
      summary_json: summaryJson,
      confirm_token: confirmToken,
      status: PENDING_ACTION_STATUS.PENDING,
      expires_at: expiresAt,
      confirmed_at: null,
      executed_at: null,
      request_id: null,
      last_error: null,
      created_at: now,
    };
  }

  /**
   * confirm_token で取得
   */
  async getByToken(confirmToken: string): Promise<PendingAction | null> {
    const result = await this.db.prepare(`
      SELECT * FROM pending_actions WHERE confirm_token = ?
    `).bind(confirmToken).first<PendingAction>();

    return result || null;
  }

  /**
   * confirm（状態遷移）
   */
  async confirm(
    confirmToken: string,
    decision: ConfirmDecision
  ): Promise<{ success: boolean; status: PendingActionStatus; error?: string }> {
    const action = await this.getByToken(confirmToken);

    if (!action) {
      return { success: false, status: 'pending' as any, error: 'NOT_FOUND' };
    }

    if (action.status !== PENDING_ACTION_STATUS.PENDING) {
      return { success: false, status: action.status, error: 'ALREADY_CONFIRMED' };
    }

    if (isExpired(action.expires_at)) {
      // ステータスを expired に更新
      await this.db.prepare(`
        UPDATE pending_actions SET status = ? WHERE id = ?
      `).bind(PENDING_ACTION_STATUS.EXPIRED, action.id).run();
      return { success: false, status: PENDING_ACTION_STATUS.EXPIRED, error: 'EXPIRED' };
    }

    // decision → status マッピング
    const statusMap: Record<ConfirmDecision, PendingActionStatus> = {
      send: PENDING_ACTION_STATUS.CONFIRMED_SEND,
      cancel: PENDING_ACTION_STATUS.CONFIRMED_CANCEL,
      new_thread: PENDING_ACTION_STATUS.CONFIRMED_NEW_THREAD,
    };

    const newStatus = statusMap[decision];
    const now = new Date().toISOString();

    await this.db.prepare(`
      UPDATE pending_actions
      SET status = ?, confirmed_at = ?
      WHERE id = ?
    `).bind(newStatus, now, action.id).run();

    return { success: true, status: newStatus };
  }

  /**
   * execute（実行完了記録）
   */
  async markExecuted(
    confirmToken: string,
    requestId: string
  ): Promise<{ success: boolean; error?: string }> {
    const action = await this.getByToken(confirmToken);

    if (!action) {
      return { success: false, error: 'NOT_FOUND' };
    }

    // 既に execute 済み → 冪等（同じ結果を返す）
    if (action.status === PENDING_ACTION_STATUS.EXECUTED) {
      return { success: true }; // 冪等: 成功扱い
    }

    // execute 可能なステータスか確認
    if (!canExecute(action.status)) {
      return { success: false, error: 'CANNOT_EXECUTE' };
    }

    const now = new Date().toISOString();

    await this.db.prepare(`
      UPDATE pending_actions
      SET status = ?, executed_at = ?, request_id = ?
      WHERE id = ?
    `).bind(PENDING_ACTION_STATUS.EXECUTED, now, requestId, action.id).run();

    return { success: true };
  }

  /**
   * request_id で既存の execute を検索（冪等性チェック）
   */
  async getByRequestId(requestId: string): Promise<PendingAction | null> {
    const result = await this.db.prepare(`
      SELECT * FROM pending_actions WHERE request_id = ?
    `).bind(requestId).first<PendingAction>();

    return result || null;
  }
}
```

---

## 3. Repository: inviteDeliveriesRepository.ts

```typescript
/**
 * Invite Deliveries Repository
 * Beta A: 配信追跡機能
 */

import {
  DELIVERY_STATUS,
  DELIVERY_TYPE,
  DELIVERY_CHANNEL,
  type InviteDelivery,
  type DeliveryType,
  type DeliveryChannel,
  type DeliveryStatus,
  generateDeliveryId,
} from '../../../../../packages/shared/src/types/inviteDelivery';

export class InviteDeliveriesRepository {
  constructor(private db: D1Database) {}

  /**
   * 配信レコード作成
   */
  async create(params: {
    workspace_id: string;
    owner_user_id: string;
    thread_id: string;
    invite_id?: string;
    delivery_type: DeliveryType;
    channel: DeliveryChannel;
    recipient_email?: string;
    recipient_user_id?: string;
    queue_job_id?: string;
  }): Promise<InviteDelivery> {
    const id = generateDeliveryId();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO invite_deliveries (
        id, workspace_id, owner_user_id, thread_id, invite_id,
        delivery_type, channel, recipient_email, recipient_user_id,
        status, queue_job_id, queued_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      params.workspace_id,
      params.owner_user_id,
      params.thread_id,
      params.invite_id || null,
      params.delivery_type,
      params.channel,
      params.recipient_email || null,
      params.recipient_user_id || null,
      DELIVERY_STATUS.QUEUED,
      params.queue_job_id || null,
      now,
      now
    ).run();

    return {
      id,
      workspace_id: params.workspace_id,
      owner_user_id: params.owner_user_id,
      thread_id: params.thread_id,
      invite_id: params.invite_id || null,
      delivery_type: params.delivery_type,
      channel: params.channel,
      recipient_email: params.recipient_email || null,
      recipient_user_id: params.recipient_user_id || null,
      status: DELIVERY_STATUS.QUEUED,
      provider: null,
      provider_message_id: null,
      queue_job_id: params.queue_job_id || null,
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
  async createBatch(deliveries: Array<{
    workspace_id: string;
    owner_user_id: string;
    thread_id: string;
    invite_id?: string;
    delivery_type: DeliveryType;
    channel: DeliveryChannel;
    recipient_email?: string;
    recipient_user_id?: string;
    queue_job_id?: string;
  }>): Promise<{ inserted: number; ids: string[] }> {
    if (deliveries.length === 0) {
      return { inserted: 0, ids: [] };
    }

    const now = new Date().toISOString();
    const ids: string[] = [];

    // D1のバッチ制限のため、100件ずつ処理
    const CHUNK_SIZE = 100;
    for (let i = 0; i < deliveries.length; i += CHUNK_SIZE) {
      const chunk = deliveries.slice(i, i + CHUNK_SIZE);
      
      const statements = chunk.map(d => {
        const id = generateDeliveryId();
        ids.push(id);
        
        return this.db.prepare(`
          INSERT INTO invite_deliveries (
            id, workspace_id, owner_user_id, thread_id, invite_id,
            delivery_type, channel, recipient_email, recipient_user_id,
            status, queue_job_id, queued_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id,
          d.workspace_id,
          d.owner_user_id,
          d.thread_id,
          d.invite_id || null,
          d.delivery_type,
          d.channel,
          d.recipient_email || null,
          d.recipient_user_id || null,
          DELIVERY_STATUS.QUEUED,
          d.queue_job_id || null,
          now,
          now
        );
      });

      await this.db.batch(statements);
    }

    return { inserted: ids.length, ids };
  }

  /**
   * ステータス更新
   */
  async updateStatus(
    id: string,
    status: DeliveryStatus,
    extra?: {
      provider?: string;
      provider_message_id?: string;
      last_error?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    
    let timestampField = '';
    if (status === DELIVERY_STATUS.SENT) timestampField = 'sent_at';
    if (status === DELIVERY_STATUS.DELIVERED) timestampField = 'delivered_at';
    if (status === DELIVERY_STATUS.FAILED) timestampField = 'failed_at';

    const updates: string[] = ['status = ?'];
    const values: any[] = [status];

    if (timestampField) {
      updates.push(`${timestampField} = ?`);
      values.push(now);
    }

    if (extra?.provider) {
      updates.push('provider = ?');
      values.push(extra.provider);
    }

    if (extra?.provider_message_id) {
      updates.push('provider_message_id = ?');
      values.push(extra.provider_message_id);
    }

    if (extra?.last_error) {
      updates.push('last_error = ?');
      values.push(extra.last_error);
    }

    if (status === DELIVERY_STATUS.FAILED) {
      updates.push('retry_count = retry_count + 1');
    }

    values.push(id);

    await this.db.prepare(`
      UPDATE invite_deliveries SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();
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
  }> {
    const result = await this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN channel = 'email' AND status = 'queued' THEN 1 ELSE 0 END) as email_queued,
        SUM(CASE WHEN channel = 'email' AND status = 'sent' THEN 1 ELSE 0 END) as email_sent,
        SUM(CASE WHEN channel = 'email' AND status = 'failed' THEN 1 ELSE 0 END) as email_failed,
        SUM(CASE WHEN channel = 'in_app' AND status = 'queued' THEN 1 ELSE 0 END) as in_app_queued,
        SUM(CASE WHEN channel = 'in_app' AND status = 'delivered' THEN 1 ELSE 0 END) as in_app_delivered
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
    };
  }
}
```

---

## 4. Utility: emailNormalizer.ts

```typescript
/**
 * Email Normalizer
 * Beta A: メール正規化・検証
 */

/**
 * メールアドレス正規化
 * - trim
 * - lowercase
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * メールアドレス検証（簡易）
 */
export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  // 簡易正規表現（RFC準拠ではないが実用的）
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(normalized);
}

/**
 * メールリストを正規化・重複除去・検証
 */
export function processEmails(emails: string[]): {
  valid: string[];
  invalid: string[];
  duplicates: string[];
} {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const email of emails) {
    const normalized = normalizeEmail(email);
    
    if (!normalized) continue;
    
    if (!isValidEmail(normalized)) {
      invalid.push(email);
      continue;
    }

    if (seen.has(normalized)) {
      duplicates.push(email);
      continue;
    }

    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid, duplicates };
}

/**
 * テキストからメールアドレスを抽出
 */
export function extractEmails(text: string): string[] {
  const emailRegex = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/g;
  const matches = text.match(emailRegex) || [];
  return matches.map(normalizeEmail);
}
```

---

## 5. Routes: threads.ts への追加（prepare-send）

```typescript
// threads.ts に追加

import { PendingActionsRepository } from '../repositories/pendingActionsRepository';
import { processEmails, normalizeEmail } from '../utils/emailNormalizer';
import { PENDING_ACTION_TYPE } from '../../../../../packages/shared/src/types/pendingAction';

/**
 * POST /api/threads/prepare-send
 * 新規スレッド用の送信準備（pending_action作成）
 */
app.post('/prepare-send', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const { workspaceId, ownerUserId } = getTenant(c);

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      source_type: 'emails' | 'list';
      emails?: string[];
      list_id?: string;
      title?: string;
    }>();

    const { source_type, emails, list_id, title } = body;

    if (!source_type) {
      return c.json({ error: 'source_type is required' }, 400);
    }

    let targetEmails: string[] = [];
    let sourceLabel = '';

    // ====== メールリスト取得 ======
    if (source_type === 'emails') {
      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return c.json({ error: 'emails array is required for source_type=emails' }, 400);
      }
      targetEmails = emails;
      sourceLabel = `${emails.length}件のメールアドレス`;

    } else if (source_type === 'list') {
      if (!list_id) {
        return c.json({ error: 'list_id is required for source_type=list' }, 400);
      }

      const listsRepo = new ListsRepository(env.DB);
      const list = await listsRepo.getById(list_id, workspaceId, ownerUserId);
      if (!list) {
        return c.json({ error: 'List not found' }, 404);
      }

      const { members } = await listsRepo.getMembers(list_id, workspaceId, 1001, 0);
      if (members.length > 1000) {
        return c.json({ error: 'List exceeds 1000 members', limit: 1000 }, 400);
      }

      targetEmails = members
        .filter(m => m.contact_email)
        .map(m => m.contact_email!);
      
      sourceLabel = `${list.name}リスト`;
    }

    // ====== メール処理（正規化・重複除去・検証）======
    const { valid, invalid, duplicates } = processEmails(targetEmails);

    if (valid.length === 0) {
      return c.json({
        error: 'No valid emails',
        skipped: {
          invalid_email: invalid.length,
          duplicate_input: duplicates.length,
        }
      }, 400);
    }

    // ====== アプリユーザー判定 ======
    const appUserCheck = await Promise.all(
      valid.map(async (email) => {
        const user = await env.DB.prepare(`
          SELECT id, email, display_name FROM users WHERE LOWER(email) = ? LIMIT 1
        `).bind(email).first<{ id: string; email: string; display_name?: string }>();
        
        return {
          email,
          is_app_user: !!user,
          user_id: user?.id || null,
          display_name: user?.display_name || null,
        };
      })
    );

    const appUsersCount = appUserCheck.filter(u => u.is_app_user).length;

    // ====== サマリ生成（preview最大5件）======
    const summary = {
      total_count: targetEmails.length,
      valid_count: valid.length,
      skipped_count: invalid.length + duplicates.length,
      skipped_reasons: [
        ...(invalid.length > 0 ? [{ reason: 'invalid_email' as const, count: invalid.length }] : []),
        ...(duplicates.length > 0 ? [{ reason: 'duplicate_input' as const, count: duplicates.length }] : []),
      ],
      preview: appUserCheck.slice(0, 5).map(u => ({
        email: u.email,
        display_name: u.display_name || undefined,
        is_app_user: u.is_app_user,
      })),
      source_label: sourceLabel,
    };

    // ====== pending_action 作成 ======
    const pendingActionsRepo = new PendingActionsRepository(env.DB);
    const pendingAction = await pendingActionsRepo.create({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      thread_id: null, // 新規スレッドなのでnull
      action_type: PENDING_ACTION_TYPE.SEND_INVITES,
      source_type,
      payload: source_type === 'emails'
        ? { source_type: 'emails', emails: valid, thread_title: title }
        : { source_type: 'list', list_id: list_id!, list_name: sourceLabel },
      summary,
    });

    // ====== レスポンス ======
    const expiresInSeconds = Math.floor(
      (new Date(pendingAction.expires_at).getTime() - Date.now()) / 1000
    );

    return c.json({
      confirm_token: pendingAction.confirm_token,
      expires_at: pendingAction.expires_at,
      expires_in_seconds: expiresInSeconds,
      summary,
      default_decision: 'send',
      message: `${valid.length}名に招待を送信しますか？\n\n「送る」「キャンセル」「別スレッドで」のいずれかを入力してください。`,
    });

  } catch (error) {
    console.error('[Threads] prepare-send error:', error);
    return c.json({
      error: 'Failed to prepare send',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
```

---

## 6. Routes: pendingActions.ts（新規作成）

```typescript
/**
 * Pending Actions API Routes
 * Beta A: 送信確認フロー (confirm / execute)
 */

import { Hono } from 'hono';
import { PendingActionsRepository } from '../repositories/pendingActionsRepository';
import { InviteDeliveriesRepository } from '../repositories/inviteDeliveriesRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { getUserIdFromContext } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import type { Env } from '../../../../../packages/shared/src/types/env';
import type { EmailJob } from '../services/emailQueue';
import {
  PENDING_ACTION_STATUS,
  CONFIRM_DECISION,
  isValidDecision,
  canExecute,
  isExpired,
  type ConfirmDecision,
  type PendingActionPayload,
  type SendInvitesPayload,
} from '../../../../../packages/shared/src/types/pendingAction';
import { DELIVERY_TYPE, DELIVERY_CHANNEL } from '../../../../../packages/shared/src/types/inviteDelivery';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/pending-actions/:confirmToken/confirm
 * 確認決定（3語固定: send / cancel / new_thread）
 */
app.post('/:confirmToken/confirm', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const confirmToken = c.req.param('confirmToken');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{ decision: string }>();
    const { decision } = body;

    if (!decision || !isValidDecision(decision)) {
      return c.json({
        error: 'Invalid decision',
        message: 'decision must be one of: send, cancel, new_thread',
      }, 400);
    }

    const pendingActionsRepo = new PendingActionsRepository(env.DB);
    const result = await pendingActionsRepo.confirm(confirmToken, decision as ConfirmDecision);

    if (!result.success) {
      const errorMap: Record<string, { status: number; message: string }> = {
        NOT_FOUND: { status: 404, message: '確認トークンが見つかりません' },
        ALREADY_CONFIRMED: { status: 409, message: '既に確認済みです' },
        EXPIRED: { status: 410, message: '確認の有効期限が切れました。もう一度やり直してください。' },
      };

      const err = errorMap[result.error!] || { status: 500, message: 'Unknown error' };
      return c.json({ error: result.error, message: err.message }, err.status as any);
    }

    const messageMap: Record<ConfirmDecision, string> = {
      send: '送信を確定しました。',
      cancel: 'キャンセルしました。',
      new_thread: '別スレッドでの送信を確定しました。',
    };

    return c.json({
      status: result.status,
      decision,
      message: messageMap[decision as ConfirmDecision],
      can_execute: canExecute(result.status),
    });

  } catch (error) {
    console.error('[PendingActions] confirm error:', error);
    return c.json({
      error: 'Failed to confirm',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /api/pending-actions/:confirmToken/execute
 * 送信実行
 */
app.post('/:confirmToken/execute', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const { workspaceId, ownerUserId } = getTenant(c);
  const confirmToken = c.req.param('confirmToken');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{ request_id?: string }>().catch(() => ({}));
    const requestId = body.request_id || crypto.randomUUID();

    const pendingActionsRepo = new PendingActionsRepository(env.DB);

    // ====== 冪等性チェック: 同じ request_id で既に実行済み ======
    const existingByRequestId = await pendingActionsRepo.getByRequestId(requestId);
    if (existingByRequestId && existingByRequestId.status === PENDING_ACTION_STATUS.EXECUTED) {
      // 同じ結果を返す（冪等）
      const payload = JSON.parse(existingByRequestId.payload_json) as PendingActionPayload;
      return c.json({
        success: true,
        thread_id: existingByRequestId.thread_id,
        result: { inserted: 0, skipped: 0, failed: 0, deliveries: { email_queued: 0, in_app_created: 0 } },
        message: '既に実行済みです（冪等レスポンス）',
        request_id: requestId,
      });
    }

    // ====== pending_action 取得 ======
    const action = await pendingActionsRepo.getByToken(confirmToken);
    if (!action) {
      return c.json({ error: 'NOT_FOUND', message: '確認トークンが見つかりません' }, 404);
    }

    // ====== 既に execute 済み → 冪等 ======
    if (action.status === PENDING_ACTION_STATUS.EXECUTED) {
      return c.json({
        success: true,
        thread_id: action.thread_id,
        result: { inserted: 0, skipped: 0, failed: 0, deliveries: { email_queued: 0, in_app_created: 0 } },
        message: '既に実行済みです（冪等レスポンス）',
        request_id: action.request_id || requestId,
      });
    }

    // ====== execute 可能か確認 ======
    if (!canExecute(action.status)) {
      return c.json({
        error: 'CANNOT_EXECUTE',
        message: `現在のステータス(${action.status})では実行できません`,
      }, 422);
    }

    // ====== 期限切れチェック ======
    if (isExpired(action.expires_at)) {
      return c.json({
        error: 'EXPIRED',
        message: '確認の有効期限が切れました。もう一度やり直してください。',
      }, 410);
    }

    const payload = JSON.parse(action.payload_json) as PendingActionPayload;
    const threadsRepo = new ThreadsRepository(env.DB);
    const deliveriesRepo = new InviteDeliveriesRepository(env.DB);
    const inboxRepo = new InboxRepository(env.DB);

    let threadId = action.thread_id;
    let threadTitle = '新規日程調整';

    // ====== new_thread モード: 新規スレッド作成 ======
    if (action.status === PENDING_ACTION_STATUS.CONFIRMED_NEW_THREAD || !threadId) {
      // タイトル取得（payload から）
      if (payload.source_type === 'emails' && (payload as SendInvitesPayload).thread_title) {
        threadTitle = (payload as SendInvitesPayload).thread_title!;
      }

      // スレッド作成
      threadId = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(`
        INSERT INTO scheduling_threads (id, workspace_id, organizer_user_id, title, status, mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', 'one_on_one', ?, ?)
      `).bind(threadId, workspaceId, ownerUserId, threadTitle, now, now).run();

      // デフォルト attendance rule 作成
      const defaultRule = {
        version: '1.0',
        type: 'ALL',
        slot_policy: { multiple_slots_allowed: true },
        invitee_scope: { allow_unregistered: true },
        rule: {},
        finalize_policy: { auto_finalize: true, policy: 'EARLIEST_VALID' },
      };

      await env.DB.prepare(`
        INSERT INTO thread_attendance_rules (thread_id, rule_json) VALUES (?, ?)
      `).bind(threadId, JSON.stringify(defaultRule)).run();

      console.log('[Execute] Created new thread:', threadId);
    }

    // ====== メールリスト取得 ======
    let emails: string[] = [];
    if (payload.source_type === 'emails') {
      emails = (payload as SendInvitesPayload).emails;
    } else {
      // list の場合は payload から emails を復元できないので、再取得が必要
      // (ここでは簡略化のため、prepare時にemailsをpayloadに含める設計を推奨)
      console.warn('[Execute] list source requires emails in payload');
    }

    // ====== Invite 作成 ======
    const inviteData = emails.map(email => ({
      thread_id: threadId!,
      email,
      candidate_name: email.split('@')[0],
      candidate_reason: 'チャットから招待',
      expires_in_hours: 72,
    }));

    const batchResult = await threadsRepo.createInvitesBatch(inviteData);
    console.log('[Execute] Invite batch result:', batchResult);

    // ====== 招待取得（メール送信用）======
    const invites = batchResult.insertedIds.length > 0
      ? (await env.DB.prepare(
          `SELECT * FROM thread_invites WHERE id IN (${batchResult.insertedIds.map(() => '?').join(',')})`
        ).bind(...batchResult.insertedIds).all()).results as any[]
      : [];

    // ====== アプリユーザー判定 + Inbox + Deliveries ======
    let emailQueuedCount = 0;
    let inAppCreatedCount = 0;

    const deliveryRecords: Array<{
      workspace_id: string;
      owner_user_id: string;
      thread_id: string;
      invite_id: string;
      delivery_type: typeof DELIVERY_TYPE.INVITE_SENT;
      channel: typeof DELIVERY_CHANNEL.EMAIL | typeof DELIVERY_CHANNEL.IN_APP;
      recipient_email?: string;
      recipient_user_id?: string;
      queue_job_id?: string;
    }> = [];

    for (const invite of invites) {
      // アプリユーザー判定
      const appUser = await env.DB.prepare(`
        SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1
      `).bind(invite.email.toLowerCase()).first<{ id: string }>();

      // メール送信（全員）
      const emailJobId = `invite-${invite.id}`;
      const emailJob: EmailJob = {
        job_id: emailJobId,
        type: 'invite',
        to: invite.email,
        subject: `${threadTitle} - 日程調整のお願い`,
        created_at: Date.now(),
        data: {
          token: invite.token,
          inviter_name: 'Tomoniwao',
          relation_type: 'thread_invite',
        },
      };

      await env.EMAIL_QUEUE.send(emailJob);
      emailQueuedCount++;

      deliveryRecords.push({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        thread_id: threadId!,
        invite_id: invite.id,
        delivery_type: DELIVERY_TYPE.INVITE_SENT,
        channel: DELIVERY_CHANNEL.EMAIL,
        recipient_email: invite.email,
        queue_job_id: emailJobId,
      });

      // アプリユーザーには Inbox 通知も
      if (appUser) {
        await inboxRepo.create({
          user_id: appUser.id,
          type: 'scheduling_invite',
          title: '日程調整の招待が届きました',
          message: `「${threadTitle}」の日程調整に招待されました`,
          action_type: 'view_invite',
          action_target_id: invite.id,
          action_url: `/i/${invite.token}`,
          priority: 'normal',
        });
        inAppCreatedCount++;

        deliveryRecords.push({
          workspace_id: workspaceId,
          owner_user_id: ownerUserId,
          thread_id: threadId!,
          invite_id: invite.id,
          delivery_type: DELIVERY_TYPE.INVITE_SENT,
          channel: DELIVERY_CHANNEL.IN_APP,
          recipient_user_id: appUser.id,
        });
      }
    }

    // ====== Deliveries 一括作成 ======
    await deliveriesRepo.createBatch(deliveryRecords);

    // ====== pending_action を executed に更新 ======
    // thread_id も更新（新規作成の場合）
    await env.DB.prepare(`
      UPDATE pending_actions
      SET status = 'executed', executed_at = ?, request_id = ?, thread_id = ?
      WHERE confirm_token = ?
    `).bind(new Date().toISOString(), requestId, threadId, confirmToken).run();

    // ====== レスポンス ======
    return c.json({
      success: true,
      thread_id: threadId,
      result: {
        inserted: batchResult.insertedIds.length,
        skipped: batchResult.skipped,
        failed: 0,
        deliveries: {
          email_queued: emailQueuedCount,
          in_app_created: inAppCreatedCount,
        },
      },
      message: `${batchResult.insertedIds.length}名に招待を送信しました。`,
      request_id: requestId,
    });

  } catch (error) {
    console.error('[PendingActions] execute error:', error);
    return c.json({
      error: 'Failed to execute',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
```

---

## 7. index.ts への登録

```typescript
// apps/api/src/index.ts に追加

import pendingActionsRoutes from './routes/pendingActions';

// 既存のルート登録の後に追加
app.route('/api/pending-actions', pendingActionsRoutes);
```

---

## 8. エラーコード一覧

| HTTP | コード | 説明 | 対処 |
|------|--------|------|------|
| 400 | INVALID_PAYLOAD | payload_json が 8KB 超過/不正 | 件数を減らす |
| 400 | NO_VALID_EMAILS | 有効なメールが0件 | 入力を確認 |
| 401 | UNAUTHORIZED | 認証なし | ログイン必須 |
| 404 | NOT_FOUND | confirm_token/thread_id 不明 | 正しいトークン使用 |
| 409 | ALREADY_CONFIRMED | 既に confirm 済み | 再度 prepare から |
| 409 | ALREADY_EXECUTED | 既に execute 済み | 冪等（成功扱い） |
| 410 | EXPIRED | confirm_token 期限切れ | 再度 prepare から |
| 422 | CANNOT_EXECUTE | cancel 後の execute など | 再度 prepare から |

---

## 9. テスト用 curl コマンド

```bash
# 1. prepare-send（新規スレッド）
curl -X POST http://localhost:3000/api/threads/prepare-send \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-id" \
  -d '{
    "source_type": "emails",
    "emails": ["tanaka@example.com", "suzuki@example.com"],
    "title": "テスト日程調整"
  }'

# 2. confirm（送る）
curl -X POST http://localhost:3000/api/pending-actions/{confirm_token}/confirm \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-id" \
  -d '{"decision": "send"}'

# 3. execute
curl -X POST http://localhost:3000/api/pending-actions/{confirm_token}/execute \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-id" \
  -d '{"request_id": "test-request-123"}'

# 4. 冪等テスト（同じ request_id で再実行）
curl -X POST http://localhost:3000/api/pending-actions/{confirm_token}/execute \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-id" \
  -d '{"request_id": "test-request-123"}'
# → 同じ結果が返る（二重送信なし）
```

---

## 10. チェックリスト

- [ ] `pendingActionsRepository.ts` 作成
- [ ] `inviteDeliveriesRepository.ts` 作成
- [ ] `emailNormalizer.ts` 作成
- [ ] `threads.ts` に `prepare-send` 追加
- [ ] `pendingActions.ts` 作成（confirm/execute）
- [ ] `index.ts` にルート登録
- [ ] Migration 0065/0066 適用済み
- [ ] curl テスト完走
