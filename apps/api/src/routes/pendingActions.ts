/**
 * Pending Actions API Routes
 * Beta A: 送信確認フロー (confirm / execute)
 * 
 * POST /api/pending-actions/:token/confirm  - 3語固定で確認
 * POST /api/pending-actions/:token/execute  - 送信実行（冪等）
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { getTenant } from '../utils/workspaceContext';
import { getUserIdFromContext } from '../middleware/auth';
import {
  PendingActionsRepository,
  type ConfirmDecision,
  type PendingActionPayload,
} from '../repositories/pendingActionsRepository';
import {
  InviteDeliveriesRepository,
  checkIsAppUserBatch,
} from '../repositories/inviteDeliveriesRepository';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { ListsRepository } from '../repositories/listsRepository';
import type { EmailJob } from '../services/emailQueue';
import { THREAD_STATUS } from '../../../../packages/shared/src/types/thread';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// POST /api/pending-actions/:token/confirm
// 確認決定（3語固定: 送る / キャンセル / 別スレッドで）
// ============================================================
app.post('/:token/confirm', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
  }

  const token = c.req.param('token');
  const body = await c.req.json().catch(() => ({} as any));

  // 3語固定の decision マッピング
  const rawDecision = String(body.decision || '').trim();
  const decisionMap: Record<string, ConfirmDecision> = {
    '送る': 'send',
    'send': 'send',
    'キャンセル': 'cancel',
    'cancel': 'cancel',
    '別スレッドで': 'new_thread',
    'new_thread': 'new_thread',
  };

  const decision = decisionMap[rawDecision];
  if (!decision) {
    return c.json({
      error: 'invalid_decision',
      message: 'decision は「送る」「キャンセル」「別スレッドで」のいずれかを指定してください',
      request_id: requestId,
    }, 400);
  }

  try {
    const repo = new PendingActionsRepository(env.DB);
    const pa = await repo.getByToken(token);

    if (!pa) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // オーナーチェック（越境防止）
    if (pa.owner_user_id !== userId) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // 期限切れチェック
    if (repo.isExpired(pa.expires_at)) {
      await repo.markExpired(pa.id);
      return c.json({
        error: 'expired',
        message: '確認の有効期限が切れました。もう一度やり直してください。',
        request_id: requestId,
      }, 410);
    }

    // 既に確認済み
    if (pa.status !== 'pending') {
      return c.json({
        error: 'already_confirmed',
        status: pa.status,
        request_id: requestId,
      }, 409);
    }

    // 状態遷移
    const { success, newStatus } = await repo.confirm({ id: pa.id, decision });

    if (!success) {
      return c.json({
        error: 'confirm_failed',
        request_id: requestId,
      }, 500);
    }

    // メッセージ
    const messageMap: Record<ConfirmDecision, string> = {
      send: '送信を確定しました。',
      cancel: 'キャンセルしました。',
      new_thread: '別スレッドでの送信を確定しました。',
    };

    return c.json({
      request_id: requestId,
      success: true,
      status: newStatus,
      decision,
      can_execute: decision === 'send' || decision === 'new_thread',
      message_for_chat: messageMap[decision],
    });

  } catch (error) {
    console.error('[PendingActions] confirm error:', error);
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

// ============================================================
// POST /api/pending-actions/:token/execute
// 送信実行（冪等）
// ============================================================
app.post('/:token/execute', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);
  const token = c.req.param('token');

  try {
    const pendingRepo = new PendingActionsRepository(env.DB);
    const pa = await pendingRepo.getByToken(token);

    if (!pa) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // オーナーチェック
    if (pa.owner_user_id !== userId) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // 期限切れ
    if (pendingRepo.isExpired(pa.expires_at)) {
      await pendingRepo.markExpired(pa.id);
      return c.json({
        error: 'expired',
        message: '確認の有効期限が切れました。',
        request_id: requestId,
      }, 410);
    }

    // 既に execute 済み → 冪等（同じ結果を返す）
    if (pa.status === 'executed') {
      return c.json({
        request_id: pa.request_id || requestId,
        success: true,
        thread_id: pa.thread_id,
        result: { inserted: 0, skipped: 0, failed: 0, deliveries: { email_queued: 0, in_app_created: 0 } },
        message_for_chat: 'すでに送信済みです。',
      });
    }

    // execute 可能か
    if (!pendingRepo.canExecute(pa.status)) {
      return c.json({
        error: 'not_confirmed',
        message: `現在のステータス(${pa.status})では実行できません`,
        request_id: requestId,
      }, 409);
    }

    // ====== Payload 解析 ======
    const payload: PendingActionPayload = JSON.parse(pa.payload_json || '{}');
    let emails: string[] = payload.emails || [];

    // list_id がある場合は list_members から取得
    if (payload.source_type === 'list' && payload.list_id && emails.length === 0) {
      const listsRepo = new ListsRepository(env.DB);
      const list = await listsRepo.getById(payload.list_id, workspaceId, ownerUserId);
      if (list) {
        const { members } = await listsRepo.getMembers(payload.list_id, workspaceId, 1001, 0);
        emails = members
          .filter((m) => m.contact_email)
          .map((m) => m.contact_email!.trim().toLowerCase());
        emails = Array.from(new Set(emails)); // 重複除去
      }
    }

    if (emails.length === 0) {
      return c.json({
        error: 'no_recipients',
        message: '送信先がありません。',
        request_id: requestId,
      }, 400);
    }

    // ====== スレッド準備 ======
    const threadsRepo = new ThreadsRepository(env.DB);
    let threadId = pa.thread_id;
    let threadTitle = payload.title || '日程調整';

    // new_thread モード または thread_id が null → 新規作成
    if (pa.status === 'confirmed_new_thread' || !threadId) {
      threadId = crypto.randomUUID();
      const now = new Date().toISOString();

      // scheduling_threads 作成
      await env.DB.prepare(`
        INSERT INTO scheduling_threads (id, workspace_id, organizer_user_id, title, status, mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'one_on_one', ?, ?)
      `).bind(threadId, workspaceId, ownerUserId, threadTitle, THREAD_STATUS.DRAFT, now, now).run();

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

      // デフォルト slots 作成（3つ）
      const slotBase = new Date();
      const slots = [1, 2, 3].map((d) => {
        const start = new Date(slotBase);
        start.setDate(start.getDate() + d);
        start.setHours(14, 0, 0, 0);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        return { start, end };
      });

      for (const slot of slots) {
        await env.DB.prepare(`
          INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          threadId,
          slot.start.toISOString(),
          slot.end.toISOString(),
          'Asia/Tokyo'
        ).run();
      }

      console.log('[Execute] Created new thread:', threadId);
    } else {
      // 既存スレッドのタイトル取得
      const existingThread = await env.DB.prepare(`
        SELECT title FROM scheduling_threads WHERE id = ?
      `).bind(threadId).first<{ title: string }>();
      if (existingThread) {
        threadTitle = existingThread.title;
      }
    }

    // ====== already_invited チェック ======
    const existingInvites = await env.DB.prepare(`
      SELECT LOWER(email) as email FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all<{ email: string }>();
    const existingEmailSet = new Set((existingInvites.results || []).map((r) => r.email));

    const newEmails = emails.filter((e) => !existingEmailSet.has(e.toLowerCase()));
    const alreadyInvitedCount = emails.length - newEmails.length;

    if (newEmails.length === 0) {
      // 全員既に招待済み
      await pendingRepo.markExecuted(pa.id, threadId);
      return c.json({
        request_id: requestId,
        success: true,
        thread_id: threadId,
        result: {
          inserted: 0,
          skipped: alreadyInvitedCount,
          failed: 0,
          deliveries: { email_queued: 0, in_app_created: 0 },
        },
        message_for_chat: '全員すでに招待済みです。',
      });
    }

    // ====== Invite 作成 ======
    const inviteData = newEmails.map((email) => ({
      thread_id: threadId!,
      email,
      candidate_name: email.split('@')[0],
      candidate_reason: payload.source_type === 'list' ? `${payload.list_name || 'リスト'}から招待` : 'チャットから招待',
      expires_in_hours: 72,
    }));

    const batchResult = await threadsRepo.createInvitesBatch(inviteData);
    console.log('[Execute] Invite batch result:', batchResult);

    // ====== 作成した invite を取得 ======
    let invites: Array<{ id: string; token: string; email: string }> = [];
    if (batchResult.insertedIds.length > 0) {
      const placeholders = batchResult.insertedIds.map(() => '?').join(',');
      const inviteRows = await env.DB.prepare(
        `SELECT id, token, email FROM thread_invites WHERE id IN (${placeholders})`
      ).bind(...batchResult.insertedIds).all<{ id: string; token: string; email: string }>();
      invites = inviteRows.results || [];
    }

    // ====== アプリユーザー判定（バッチ）======
    const appUserMap = await checkIsAppUserBatch(env.DB, invites.map((i) => i.email));

    // ====== Deliveries + Queue + Inbox ======
    const deliveriesRepo = new InviteDeliveriesRepository(env.DB);
    const inboxRepo = new InboxRepository(env.DB);
    const host = c.req.header('host') || 'app.tomoniwao.jp';

    let emailQueuedCount = 0;
    let inAppCreatedCount = 0;
    const deliveryRecords: Array<{
      workspaceId: string;
      ownerUserId: string;
      threadId: string;
      inviteId: string;
      deliveryType: 'invite_sent';
      channel: 'email' | 'in_app';
      recipientEmail?: string;
      recipientUserId?: string;
      queueJobId?: string;
    }> = [];

    for (const invite of invites) {
      const appUser = appUserMap.get(invite.email.toLowerCase());
      const inviteUrl = `https://${host}/i/${invite.token}`;

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
        workspaceId,
        ownerUserId,
        threadId: threadId!,
        inviteId: invite.id,
        deliveryType: 'invite_sent',
        channel: 'email',
        recipientEmail: invite.email,
        queueJobId: emailJobId,
      });

      // アプリユーザーには Inbox 通知も
      if (appUser?.isAppUser && appUser.userId) {
        await inboxRepo.create({
          user_id: appUser.userId,
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
          workspaceId,
          ownerUserId,
          threadId: threadId!,
          inviteId: invite.id,
          deliveryType: 'invite_sent',
          channel: 'in_app',
          recipientUserId: appUser.userId,
        });
      }
    }

    // Deliveries 一括作成
    await deliveriesRepo.createBatch(deliveryRecords);

    // ====== pending_action を executed に更新 ======
    await pendingRepo.markExecuted(pa.id, threadId);

    // ====== レスポンス ======
    return c.json({
      request_id: requestId,
      success: true,
      thread_id: threadId,
      result: {
        inserted: batchResult.insertedIds.length,
        skipped: batchResult.skipped + alreadyInvitedCount,
        failed: 0,
        deliveries: {
          email_queued: emailQueuedCount,
          in_app_created: inAppCreatedCount,
        },
      },
      message_for_chat: `${batchResult.insertedIds.length}名に招待を送信しました。`,
    });

  } catch (error) {
    console.error('[PendingActions] execute error:', error);
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

export default app;
