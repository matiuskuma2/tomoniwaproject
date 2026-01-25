/**
 * Thread Invites Routes (Phase 2-5)
 * 
 * POST /:id/invites/batch - Add bulk invites from list
 * POST /:id/invites/prepare - Prepare additional invites (creates pending_action)
 * 
 * Moved from threads.ts (no logic changes)
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../../repositories/threadsRepository';
import { ListsRepository } from '../../repositories/listsRepository';
import { getUserIdFromContext } from '../../middleware/auth';
import type { Env } from '../../../../../packages/shared/src/types/env';
import type { EmailJob } from '../../services/emailQueue';
import { getTenant } from '../../utils/workspaceContext';
import {
  PendingActionsRepository,
  generateConfirmToken,
  generateExpiresAt,
  type PendingActionPayload,
  type PendingActionSummary,
} from '../../repositories/pendingActionsRepository';
import {
  composeInviteEmailModel,
  modelToPreview,
} from '../../utils/emailModel';
import {
  checkIsAppUserBatch,
} from '../../repositories/inviteDeliveriesRepository';
import {
  normalizeAndValidateEmails,
  normalizeEmail,
} from '../../utils/emailNormalizer';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Add bulk invites to existing thread from list
 * 
 * @route POST /threads/:id/invites/batch
 * @body { target_list_id: string }
 * 
 * Phase P0-4: Chat-driven bulk invite
 * Use case: "リスト「営業部」に招待メールを送って"
 */
app.post('/:id/invites/batch', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json();
    const { target_list_id } = body;

    if (!target_list_id || typeof target_list_id !== 'string') {
      return c.json({ error: 'Missing or invalid field: target_list_id' }, 400);
    }

    // Step 1: Verify thread exists and user has access (P0-1: tenant isolation)
    const threadsRepo = new ThreadsRepository(env.DB);
    const thread = await env.DB.prepare(`
      SELECT id, title, status FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{ id: string; title: string; status: string }>();

    if (!thread) {
      return c.json({ error: 'Thread not found or access denied' }, 404);
    }

    // Step 2: Verify list exists and user has access (P0-1: tenant isolation)
    const listsRepo = new ListsRepository(env.DB);
    const list = await listsRepo.getById(target_list_id, workspaceId, ownerUserId);

    if (!list) {
      return c.json({ error: 'List not found or access denied' }, 404);
    }

    // Step 3: Get list members (max 1000)
    const { members, total } = await listsRepo.getMembers(target_list_id, workspaceId, 1001, 0);

    if (total > 1000) {
      return c.json({
        error: 'List size exceeds 1000 contacts. Please split into smaller lists.',
        total,
        limit: 1000
      }, 400);
    }

    if (members.length === 0) {
      return c.json({ error: 'List is empty. Add contacts first.' }, 400);
    }

    console.log(`[Threads] Adding ${members.length} bulk invites to thread ${threadId}`);

    // Step 4: Filter valid members (must have email)
    const validMembers = members.filter((m) => m.contact_email);
    const skippedCount = members.length - validMembers.length;

    if (skippedCount > 0) {
      console.warn(`[Threads] Skipped ${skippedCount} contacts without email`);
    }

    // Step 5: Create invites in batch (P0-1: Transaction for performance)
    const batchResult = await threadsRepo.createInvitesBatch(
      validMembers.map((member) => ({
        thread_id: threadId,
        email: member.contact_email!,
        candidate_name: member.contact_display_name || member.contact_email!,
        candidate_reason: `From list: ${list.name}`,
        expires_in_hours: 72, // 3 days
      }))
    );

    console.log('[Threads] Batch invite result:', batchResult);

    // Step 6: Fetch inserted invites for email queue
    let invites: any[] = [];
    if (batchResult.insertedIds.length > 0) {
      const placeholders = batchResult.insertedIds.map(() => '?').join(',');
      const inviteList = await env.DB.prepare(
        `SELECT * FROM thread_invites WHERE id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...batchResult.insertedIds).all();

      invites = inviteList.results as any[];
    }

    // Step 7: Send invite emails via queue
    for (const invite of invites) {
      const member = validMembers.find((m) => m.contact_email === invite.email);
      if (!member) continue;

      // Beta A: thread_title を追加してメール本文に表示
      const emailJob: EmailJob = {
        job_id: `invite-${invite.id}`,
        type: 'invite',
        to: member.contact_email!,
        subject: `【日程調整】「${thread.title}」のご依頼`,
        created_at: Date.now(),
        data: {
          token: invite.token,
          inviter_name: 'Tomoniwao',
          relation_type: 'thread_invite',
          thread_title: thread.title,
        },
      };

      await env.EMAIL_QUEUE.send(emailJob);
      console.log('[Threads] Queued email for:', member.contact_email);
    }

    return c.json({
      success: true,
      thread_id: threadId,
      list_name: list.name,
      inserted: batchResult.insertedIds.length,
      skipped: batchResult.skipped + skippedCount,
      failed: 0, // Currently no failed tracking
      total_invited: batchResult.insertedIds.length,
      message: `${batchResult.insertedIds.length}名に招待メールを送信しました。`,
    });

  } catch (error) {
    console.error('[Threads] Error adding bulk invites:', error);
    return c.json(
      {
        error: 'Failed to add bulk invites',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================
// Beta A: POST /threads/:id/invites/prepare
// 追加招待用の送信準備（pending_action作成）
// ============================================================
app.post('/:id/invites/prepare', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const threadId = c.req.param('id');
  
  console.log('[invites/prepare] Starting request:', requestId, 'threadId:', threadId);
  
  try {
    // Get authentication context (may throw)
    let userId: string;
    let workspaceId: string;
    let ownerUserId: string;
    
    try {
      userId = getUserIdFromContext(c as any);
      const tenant = getTenant(c);
      workspaceId = tenant.workspaceId;
      ownerUserId = tenant.ownerUserId;
      console.log('[invites/prepare] Auth context:', { userId, workspaceId, ownerUserId });
    } catch (authError) {
      console.error('[invites/prepare] Auth error:', authError);
      return c.json({ 
        error: 'Unauthorized', 
        message: authError instanceof Error ? authError.message : 'Authentication failed',
        request_id: requestId 
      }, 401);
    }
    // スレッド存在確認
    const thread = await env.DB.prepare(`
      SELECT id, title, status FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{ id: string; title: string; status: string }>();

    if (!thread) {
      return c.json({ error: 'thread_not_found', request_id: requestId }, 404);
    }

    const body = await c.req.json().catch(() => ({} as any));
    const sourceType = body.source_type as 'emails' | 'list';

    if (!sourceType || !['emails', 'list'].includes(sourceType)) {
      return c.json({
        error: 'invalid_source_type',
        request_id: requestId,
      }, 400);
    }

    // ====== 送信先メール取得 ======
    let emails: string[] = [];
    let invalidEmails: string[] = [];
    let duplicateCount = 0;
    let missingEmailCount = 0;
    let listName = '';

    if (sourceType === 'emails') {
      const { valid, invalid, duplicates } = normalizeAndValidateEmails(body.emails);
      emails = valid;
      invalidEmails = invalid;
      duplicateCount = duplicates.length;

    } else if (sourceType === 'list') {
      const listId = normalizeEmail(body.list_id);
      if (!listId) {
        return c.json({ error: 'invalid_list_id', request_id: requestId }, 400);
      }

      const listsRepo = new ListsRepository(env.DB);
      const list = await listsRepo.getById(listId, workspaceId, ownerUserId);
      if (!list) {
        return c.json({ error: 'list_not_found', request_id: requestId }, 404);
      }

      listName = list.name;

      const { members, total } = await listsRepo.getMembers(listId, workspaceId, 1001, 0);
      if (total > 1000) {
        return c.json({ error: 'list_too_large', total, limit: 1000, request_id: requestId }, 400);
      }

      const normalized = members
        .map((m) => normalizeEmail(m.contact_email))
        .filter((x): x is string => !!x);

      missingEmailCount = members.length - normalized.length;
      emails = Array.from(new Set(normalized));
    }

    if (emails.length === 0) {
      return c.json({
        error: 'no_valid_emails',
        request_id: requestId,
      }, 400);
    }

    // ====== already_invited チェック ======
    const existingInvites = await env.DB.prepare(`
      SELECT LOWER(email) as email FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all<{ email: string }>();
    const existingEmailSet = new Set((existingInvites.results || []).map((r) => r.email));

    const newEmails = emails.filter((e) => !existingEmailSet.has(e.toLowerCase()));
    const alreadyInvitedCount = emails.length - newEmails.length;

    // ====== アプリユーザー判定 ======
    const preview = newEmails.slice(0, 5);
    const appUserMap = await checkIsAppUserBatch(env.DB, preview);
    const appUsersInPreview = preview.filter((e) => appUserMap.get(e)?.isAppUser).length;

    // ====== サマリ生成 ======
    const summary: PendingActionSummary = {
      total_count: emails.length + invalidEmails.length + duplicateCount + missingEmailCount,
      valid_count: newEmails.length,
      preview: preview.map((e) => {
        const appUser = appUserMap.get(e);
        return {
          email: e,
          display_name: appUser?.displayName || undefined,
          is_app_user: appUser?.isAppUser || false,
        };
      }),
      preview_count: preview.length,
      skipped: {
        invalid_email: invalidEmails.length,
        duplicate_input: duplicateCount,
        missing_email: missingEmailCount,
        already_invited: alreadyInvitedCount,
      },
      app_users_count: appUsersInPreview,
      external_count: preview.length - appUsersInPreview,
    };

    // 全員already_invitedの場合
    if (newEmails.length === 0) {
      return c.json({
        request_id: requestId,
        confirm_token: null,
        expires_at: null,
        summary: {
          ...summary,
          source_label: sourceType === 'list' ? `${listName}リスト` : `${emails.length}件のメールアドレス`,
        },
        message_for_chat: `全員すでに招待済みです（${alreadyInvitedCount}件）。`,
      });
    }

    // ====== Payload 生成 ======
    const payload: PendingActionPayload = {
      source_type: sourceType,
      emails: newEmails,
      list_id: body.list_id || undefined,
      list_name: listName || undefined,
      title: thread.title,
    };

    // ====== pending_action 作成 ======
    const pendingRepo = new PendingActionsRepository(env.DB);
    const pendingId = crypto.randomUUID();
    const confirmToken = generateConfirmToken();
    const expiresAt = generateExpiresAt(15);

    await pendingRepo.create({
      id: pendingId,
      workspaceId,
      ownerUserId,
      threadId, // 既存スレッドのID
      actionType: 'add_invites',
      sourceType,
      payload,
      summary,
      confirmToken,
      expiresAtISO: expiresAt,
      requestId,
    });

    // ====== ユーザー名取得（プレビュー用） ======
    const user = await env.DB.prepare(`
      SELECT display_name FROM users WHERE id = ?
    `).bind(userId).first<{ display_name: string | null }>();
    const inviterName = user?.display_name || 'Tomoniwao';

    // ====== レスポンス ======
    const sourceLabel = sourceType === 'list'
      ? `${listName}リスト`
      : `${newEmails.length}件のメールアドレス`;

    // P3-INV1 共通ソース化: メールモデル → プレビュー
    const emailModel = composeInviteEmailModel({
      inviterName,
      threadTitle: thread.title,
    });
    const emailPreview = modelToPreview(emailModel);

    return c.json({
      request_id: requestId,
      confirm_token: confirmToken,
      expires_at: expiresAt,
      expires_in_seconds: 15 * 60,
      thread_id: threadId,
      thread_title: thread.title,
      summary: {
        ...summary,
        source_label: sourceLabel,
      },
      default_decision: 'send',
      email_preview: emailPreview,  // P3-INV1 B案: 骨格ブロック
      message_for_chat: `「${thread.title}」に${newEmails.length}名を追加招待します。\n\n次に「送る」「キャンセル」「別スレッドで」のいずれかを入力してください。`,
    });

  } catch (error) {
    console.error('[Threads] invites/prepare error:', error);
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

export default app;
