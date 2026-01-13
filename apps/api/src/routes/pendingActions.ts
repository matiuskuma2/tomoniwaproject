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
import { generateSlotLabels } from '../utils/datetime';

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

  try {
    const repo = new PendingActionsRepository(env.DB);
    const pa = await repo.getByToken(token);

    if (!pa) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // decision マッピング（action_type によって異なる）
    const rawDecision = String(body.decision || '').trim();
    
    // Phase2: add_slots の場合は2語（追加/キャンセル）
    let decisionMap: Record<string, ConfirmDecision>;
    let errorMessage: string;
    
    if (pa.action_type === 'add_slots') {
      decisionMap = {
        '追加': 'send',        // 追加 → send として扱う
        'add': 'send',
        '追加する': 'send',
        'キャンセル': 'cancel',
        'cancel': 'cancel',
        'やめる': 'cancel',
      };
      errorMessage = 'decision は「追加」「キャンセル」のいずれかを指定してください';
    } else {
      // 既存: 3語固定（送る/キャンセル/別スレッドで）
      decisionMap = {
        '送る': 'send',
        'send': 'send',
        'キャンセル': 'cancel',
        'cancel': 'cancel',
        '別スレッドで': 'new_thread',
        'new_thread': 'new_thread',
      };
      errorMessage = 'decision は「送る」「キャンセル」「別スレッドで」のいずれかを指定してください';
    }

    const decision = decisionMap[rawDecision];
    if (!decision) {
      return c.json({
        error: 'invalid_decision',
        message: errorMessage,
        action_type: pa.action_type,
        request_id: requestId,
      }, 400);
    }

    // add_slots では new_thread は使用不可
    if (pa.action_type === 'add_slots' && decision === 'new_thread') {
      return c.json({
        error: 'invalid_decision',
        message: '追加候補では「別スレッドで」は使用できません',
        request_id: requestId,
      }, 400);
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

    // ====== Phase2: add_slots の場合は別処理 ======
    if (pa.action_type === 'add_slots') {
      return await executeAddSlots(c, env, pa, pendingRepo, requestId, workspaceId, ownerUserId);
    }

    // ====== Payload 解析（招待送信用） ======
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

      // P3-TZ3: organizer timezone をスレッドにコピー
      const organizerTzRow = await env.DB.prepare(
        `SELECT timezone FROM users WHERE id = ? LIMIT 1`
      ).bind(ownerUserId).first<{ timezone: string }>();
      const organizerTimeZone = organizerTzRow?.timezone || 'Asia/Tokyo';

      // scheduling_threads 作成
      await env.DB.prepare(`
        INSERT INTO scheduling_threads (id, workspace_id, organizer_user_id, title, status, mode, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'one_on_one', ?, ?, ?)
      `).bind(threadId, workspaceId, ownerUserId, threadTitle, THREAD_STATUS.DRAFT, organizerTimeZone, now, now).run();

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
      // Beta A: thread_title を追加してメール本文に表示
      const emailJobId = `invite-${invite.id}`;
      const emailJob: EmailJob = {
        job_id: emailJobId,
        type: 'invite',
        to: invite.email,
        subject: `【日程調整】「${threadTitle}」のご依頼`,
        created_at: Date.now(),
        data: {
          token: invite.token,
          inviter_name: 'Tomoniwao',
          relation_type: 'thread_invite',
          thread_title: threadTitle,
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

// ============================================================
// Phase2: 追加候補実行ロジック
// ============================================================

interface AddSlotsPayload {
  action_type: 'add_slots';
  slots: Array<{ start_at: string; end_at: string; label?: string }>;
  next_proposal_version: number;
}

/**
 * executeAddSlots: 追加候補の実行
 * 
 * 処理:
 *   1. スロット追加（proposal_version 付き）
 *   2. スレッドの proposal_version / additional_propose_count を更新
 *   3. 全員に再通知（declined 除外）
 *   4. pending_action を executed に更新
 */
async function executeAddSlots(
  c: any,
  env: Env,
  pa: any,
  pendingRepo: PendingActionsRepository,
  requestId: string,
  workspaceId: string,
  ownerUserId: string
) {
  const threadId = pa.thread_id;
  
  if (!threadId) {
    return c.json({
      error: 'no_thread',
      message: 'スレッドが指定されていません',
      request_id: requestId,
    }, 400);
  }

  // ====== (1) Payload 解析 ======
  const payload: AddSlotsPayload = JSON.parse(pa.payload_json || '{}');
  const slots = payload.slots || [];
  const nextVersion = payload.next_proposal_version || 2;

  if (slots.length === 0) {
    return c.json({
      error: 'no_slots',
      message: '追加するスロットがありません',
      request_id: requestId,
    }, 400);
  }

  // ====== (2) スレッド状態の再確認（collecting のみ） ======
  const thread = await env.DB.prepare(`
    SELECT 
      id, 
      title,
      status,
      COALESCE(proposal_version, 1) as proposal_version,
      COALESCE(additional_propose_count, 0) as additional_propose_count
    FROM scheduling_threads
    WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
  `).bind(threadId, workspaceId, ownerUserId).first<{
    id: string;
    title: string;
    status: string;
    proposal_version: number;
    additional_propose_count: number;
  }>();

  if (!thread) {
    return c.json({
      error: 'thread_not_found',
      message: 'スレッドが見つかりません',
      request_id: requestId,
    }, 404);
  }

  if (thread.status !== 'sent') {
    return c.json({
      error: 'invalid_status',
      message: '現在のステータスでは追加候補を実行できません',
      current_status: thread.status,
      request_id: requestId,
    }, 400);
  }

  if (thread.additional_propose_count >= 2) {
    return c.json({
      error: 'max_proposals_reached',
      message: '追加候補は最大2回までです',
      request_id: requestId,
    }, 400);
  }

  // ====== (3) スロット追加（トランザクション） ======
  const slotIds: string[] = [];
  const timezone = 'Asia/Tokyo';

  for (const slot of slots) {
    const slotId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label, proposal_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      slotId,
      threadId,
      slot.start_at,
      slot.end_at,
      timezone,
      slot.label || null,
      nextVersion
    ).run();
    slotIds.push(slotId);
  }

  console.log(`[AddSlots] Added ${slotIds.length} slots (v${nextVersion}) to thread ${threadId}`);

  // ====== (4) スレッド更新 ======
  await env.DB.prepare(`
    UPDATE scheduling_threads
    SET proposal_version = ?,
        additional_propose_count = additional_propose_count + 1,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(nextVersion, threadId).run();

  console.log(`[AddSlots] Updated thread ${threadId}: proposal_version=${nextVersion}, additional_propose_count=${thread.additional_propose_count + 1}`);

  // ====== (5) 再通知対象を取得（declined 除外） ======
  const invites = await env.DB.prepare(`
    SELECT 
      ti.id,
      ti.token,
      ti.email,
      ti.candidate_name,
      ts.status as selection_status,
      ts.proposal_version_at_response
    FROM thread_invites ti
    LEFT JOIN thread_selections ts ON ts.invite_id = ti.id
    WHERE ti.thread_id = ?
      AND (ts.status IS NULL OR ts.status != 'declined')
  `).bind(threadId).all<{
    id: string;
    token: string;
    email: string;
    candidate_name: string;
    selection_status: string | null;
    proposal_version_at_response: number | null;
  }>();

  const recipients = invites.results || [];
  console.log(`[AddSlots] Notify targets: ${recipients.length} (declined excluded)`);

  // ====== (6) 通知送信（Email + Inbox） ======
  const inboxRepo = new InboxRepository(env.DB);
  const host = c.req.header('host') || 'app.tomoniwao.jp';
  let emailQueuedCount = 0;
  let inAppCreatedCount = 0;

  // P3-TZ2: スレッドの基準タイムゾーンを取得（外部ユーザーのフォールバック用）
  const threadTzRow = await env.DB.prepare(
    `SELECT timezone FROM scheduling_threads WHERE id = ? LIMIT 1`
  ).bind(threadId).first<{ timezone: string }>();
  const threadTimeZone = threadTzRow?.timezone || 'Asia/Tokyo';

  for (const invite of recipients) {
    const inviteUrl = `https://${host}/i/${invite.token}`;

    // P3-TZ2: 受信者のタイムゾーンを解決
    // アプリユーザー → users.timezone / 外部ユーザー → thread.timezone
    const appUser = await env.DB.prepare(`
      SELECT id, timezone FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1
    `).bind(invite.email).first<{ id: string; timezone: string }>();

    const recipientTimeZone = appUser?.timezone || threadTimeZone;

    // 受信者のタイムゾーンでスロットラベルを生成
    const slotDescription = generateSlotLabels(slots, 3, recipientTimeZone);

    // メール送信（追加候補通知）
    const emailJobId = `add-slots-${invite.id}-v${nextVersion}`;
    const emailJob: EmailJob = {
      job_id: emailJobId,
      type: 'additional_slots',
      to: invite.email,
      subject: `【追加候補】「${thread.title}」に新しい候補日が追加されました`,
      created_at: Date.now(),
      data: {
        token: invite.token,
        thread_title: thread.title,
        slot_count: slots.length,
        slot_description: slotDescription,
        invite_url: inviteUrl,
        proposal_version: nextVersion,
      },
    };

    await env.EMAIL_QUEUE.send(emailJob);
    emailQueuedCount++;

    // アプリユーザーには Inbox 通知も
    if (appUser) {
      // P2-B2: 必須3要素を含むInbox通知文面
      await inboxRepo.create({
        user_id: appUser.id,
        type: 'system_message',
        title: `📅【追加候補】${thread.title}`,
        message: `新しい候補日が追加されました: ${slotDescription}\n\n📌 重要なお知らせ\n・これまでの回答は保持されています\n・追加された候補についてのみ、ご回答をお願いします\n・辞退された方にはこの通知は送信されていません`,
        action_type: 'view_invite',
        action_target_id: invite.id,
        action_url: `/i/${invite.token}`,
        priority: 'high',
      });
      inAppCreatedCount++;
    }
  }

  // ====== (7) pending_action を executed に更新 ======
  await pendingRepo.markExecuted(pa.id, threadId);

  // ====== (8) レスポンス ======
  return c.json({
    request_id: requestId,
    success: true,
    thread_id: threadId,
    proposal_version: nextVersion,
    remaining_proposals: 2 - (thread.additional_propose_count + 1),
    result: {
      slots_added: slotIds.length,
      slot_ids: slotIds,
      notifications: {
        email_queued: emailQueuedCount,
        in_app_created: inAppCreatedCount,
        total_recipients: recipients.length,
      },
    },
    message_for_chat: `✅ ${slots.length}件の追加候補を追加しました。\n${recipients.length}名に通知を送信しました。\n\n既存の回答は保持されています。残り追加回数: ${2 - (thread.additional_propose_count + 1)}回`,
  });
}

export default app;
