/**
 * Thread Actions Routes (Phase 2-6)
 * 
 * POST /:id/remind - Send reminder to pending invites
 * POST /prepare-send - Prepare new thread send (creates pending_action)
 * GET /:id/reschedule/info - Get reschedule info for confirmed thread
 * 
 * Moved from threads.ts (no logic changes)
 */

import { Hono } from 'hono';
import { ListsRepository } from '../../repositories/listsRepository';
import { getUserIdFromContext } from '../../middleware/auth';
import type { Env } from '../../../../../packages/shared/src/types/env';
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
import { createLogger } from '../../utils/logger';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /threads/:id/remind
 * Phase Next-6 Day1.5: Send reminder to pending invites
 * 
 * A案（事故ゼロ）: メール送信しない、送信用セットを返す
 * 
 * @route POST /threads/:id/remind
 * @body invitee_keys?: string[] (optional, if empty: remind all pending)
 * @returns {
 *   success: true,
 *   reminded_count: number,
 *   reminded_invites: Array<{
 *     email: string,
 *     name?: string,
 *     invite_url: string,
 *     template_message: string
 *   }>
 * }
 */
app.post('/:id/remind', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Threads', handler: 'remind' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  try {
    // ====== (1) Authorization ======
    const thread = await env.DB.prepare(`
      SELECT 
        id,
        organizer_user_id,
        title,
        description,
        status
      FROM scheduling_threads
      WHERE id = ?
    `).bind(threadId).first();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ 
        error: 'Access denied',
        message: 'Only organizer can send reminders'
      }, 403);
    }

    // ====== (2) Get pending invites ======
    const body = await c.req.json<{ invitee_keys?: string[] }>();
    const targetKeys = body.invitee_keys;

    let query = `
      SELECT 
        ti.id,
        ti.invitee_key,
        ti.email,
        ti.status,
        ti.token,
        c.display_name as candidate_name
      FROM thread_invites ti
      LEFT JOIN contacts c ON c.invitee_key = ti.invitee_key
      WHERE ti.thread_id = ?
        AND (ti.status = 'pending' OR ti.status IS NULL)
    `;
    
    const params: any[] = [threadId];
    
    if (targetKeys && targetKeys.length > 0) {
      const placeholders = targetKeys.map(() => '?').join(',');
      query += ` AND ti.invitee_key IN (${placeholders})`;
      params.push(...targetKeys);
    }

    const { results: pendingInvites } = await env.DB.prepare(query).bind(...params).all();

    if (!pendingInvites || pendingInvites.length === 0) {
      return c.json({
        success: true,
        reminded_count: 0,
        reminded_invites: [],
        message: '未返信者がいません。'
      });
    }

    // ====== (3) Build reminder data (A案: メール送信しない) ======
    const remindedInvites = pendingInvites.map((invite: any) => {
      const baseUrl = 'https://app.tomoniwao.jp'; // Phase Next-6 Day1.5: 固定URL
      const inviteUrl = `${baseUrl}/i/${invite.token}`;
      const templateMessage = `
こんにちは${invite.candidate_name ? ` ${invite.candidate_name}さん` : ''}、

「${thread.title}」の日程調整にご協力ください。
まだ回答をいただいていないようです。

以下のリンクから希望日時を選択してください：
${inviteUrl}

よろしくお願いいたします。
      `.trim();

      return {
        email: invite.email,
        name: invite.candidate_name || undefined,
        invite_url: inviteUrl,
        template_message: templateMessage
      };
    });

    // ====== (4) Return reminder set (A案: 人が送る) ======
    return c.json({
      success: true,
      reminded_count: remindedInvites.length,
      reminded_invites: remindedInvites,
      message: `${remindedInvites.length}名の未返信者に送信する準備ができました。\n\n以下の内容をコピーしてメールで送信してください。`
    });

  } catch (error) {
    log.error('Error sending reminder', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to send reminder',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================
// Beta A: POST /threads/prepare-send
// 新規スレッド用の送信準備（pending_action作成）
// ============================================================
app.post('/prepare-send', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'Threads', handler: 'prepare-send', requestId });
  
  log.debug('Starting request');
  
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
      log.debug('Auth context', { userId, workspaceId, ownerUserId });
    } catch (authError) {
      log.error('Auth error', authError);
      return c.json({ 
        error: 'Unauthorized', 
        message: authError instanceof Error ? authError.message : 'Authentication failed',
        request_id: requestId 
      }, 401);
    }
    
    const body = await c.req.json().catch(() => ({} as any));
    log.debug('Request body', { body });
    
    const sourceType = body.source_type as 'emails' | 'list';
    const title = body.title || '日程調整';

    if (!sourceType || !['emails', 'list'].includes(sourceType)) {
      return c.json({
        error: 'invalid_source_type',
        message: 'source_type は "emails" または "list" を指定してください',
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
        return c.json({
          error: 'invalid_list_id',
          request_id: requestId,
        }, 400);
      }

      const listsRepo = new ListsRepository(env.DB);
      const list = await listsRepo.getById(listId, workspaceId, ownerUserId);
      if (!list) {
        return c.json({ error: 'list_not_found', request_id: requestId }, 404);
      }

      listName = list.name;

      const { members, total } = await listsRepo.getMembers(listId, workspaceId, 1001, 0);
      if (total > 1000) {
        return c.json({
          error: 'list_too_large',
          total,
          limit: 1000,
          request_id: requestId,
        }, 400);
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
        skipped: {
          invalid_email: invalidEmails.length,
          duplicate_input: duplicateCount,
          missing_email: missingEmailCount,
        },
        request_id: requestId,
      }, 400);
    }

    // ====== アプリユーザー判定（preview用） ======
    const preview = emails.slice(0, 5);
    const appUserMap = await checkIsAppUserBatch(env.DB, preview);

    const appUsersInPreview = preview.filter((e) => appUserMap.get(e)?.isAppUser).length;

    // ====== サマリ生成 ======
    const summary: PendingActionSummary = {
      total_count: emails.length + invalidEmails.length + duplicateCount + missingEmailCount,
      valid_count: emails.length,
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
        already_invited: 0, // 新規スレッドなので0
      },
      app_users_count: appUsersInPreview,
      external_count: preview.length - appUsersInPreview,
    };

    // ====== Payload 生成 ======
    const payload: PendingActionPayload = {
      source_type: sourceType,
      emails,
      list_id: body.list_id || undefined,
      list_name: listName || undefined,
      title,
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
      threadId: null, // 新規スレッドなのでnull
      actionType: 'send_invites',
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
      : `${emails.length}件のメールアドレス`;

    // P3-INV1 共通ソース化: メールモデル → プレビュー
    const emailModel = composeInviteEmailModel({
      inviterName,
      threadTitle: title,
    });
    const emailPreview = modelToPreview(emailModel);

    return c.json({
      request_id: requestId,
      confirm_token: confirmToken,
      expires_at: expiresAt,
      expires_in_seconds: 15 * 60,
      summary: {
        ...summary,
        source_label: sourceLabel,
      },
      default_decision: 'send',
      email_preview: emailPreview,  // P3-INV1 B案: 骨格ブロック
      message_for_chat: `送信先: ${emails.length}件 / スキップ: ${summary.skipped.invalid_email + summary.skipped.missing_email}件\n\n次に「送る」「キャンセル」「別スレッドで」のいずれかを入力してください。`,
    });

  } catch (error) {
    log.error('prepare-send error', { error: error instanceof Error ? error.message : String(error) });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.debug('prepare-send stack', { stack: errorStack });
    return c.json({
      error: 'internal_error',
      message: `サーバーエラー: ${errorMessage}`,  // message フィールドを追加
      details: errorMessage,
      stack: errorStack,
      request_id: requestId,
    }, 500);
  }
});

// ============================================================
// P2-D3: 確定後やり直し（再調整）
// GET /threads/:id/reschedule/info
// ============================================================
app.get('/:id/reschedule/info', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const threadId = c.req.param('id');
  const log = createLogger(env, { module: 'Threads/actions', handler: 'reschedule/info', requestId });
  
  log.debug('Starting request', { threadId });
  
  try {
    // Get authentication context
    let workspaceId: string;
    let ownerUserId: string;
    
    try {
      const tenant = getTenant(c);
      workspaceId = tenant.workspaceId;
      ownerUserId = tenant.ownerUserId;
    } catch (authError) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    
    // スレッド存在確認（P0-1: tenant isolation）
    const thread = await env.DB.prepare(`
      SELECT 
        id, 
        title, 
        status,
        COALESCE(proposal_version, 1) as proposal_version
      FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{
      id: string;
      title: string;
      status: string;
      proposal_version: number;
    }>();
    
    if (!thread) {
      return c.json({ error: 'thread_not_found', request_id: requestId }, 404);
    }
    
    // 確定情報を取得
    const finalized = await env.DB.prepare(`
      SELECT finalized_at, selected_slot_id, reason
      FROM thread_finalized
      WHERE thread_id = ?
    `).bind(threadId).first<{
      finalized_at: string;
      selected_slot_id: string;
      reason: string | null;
    }>();
    
    // 参加者リストを取得（declined を除く）
    const invitesResult = await env.DB.prepare(`
      SELECT 
        ti.email,
        ti.candidate_name as name,
        COALESCE(ts.status, 'pending') as selection_status
      FROM thread_invites ti
      LEFT JOIN thread_selections ts ON ts.invite_id = ti.id
      WHERE ti.thread_id = ?
        AND (ts.status IS NULL OR ts.status != 'declined')
      ORDER BY ti.created_at ASC
    `).bind(threadId).all<{
      email: string;
      name: string | null;
      selection_status: string;
    }>();
    
    const participants = (invitesResult.results || []).map(p => ({
      email: p.email,
      name: p.name || undefined,
      selection_status: p.selection_status,
    }));
    
    // 提案タイトル
    const suggestedTitle = `${thread.title}（再調整）`;
    
    // メッセージ生成
    const statusLabel = thread.status === 'confirmed' ? '確定済み' : 
                       thread.status === 'cancelled' ? 'キャンセル済み' : '進行中';
    
    let messageForChat = `📅 「${thread.title}」の再調整\n\n`;
    messageForChat += `**元のスレッド:**\n`;
    messageForChat += `- ステータス: ${statusLabel}\n`;
    if (finalized) {
      messageForChat += `- 確定日時: ${finalized.finalized_at}\n`;
    }
    messageForChat += `\n**参加者（${participants.length}名）:**\n`;
    participants.slice(0, 5).forEach(p => {
      messageForChat += `- ${p.name || p.email}\n`;
    });
    if (participants.length > 5) {
      messageForChat += `... 他${participants.length - 5}名\n`;
    }
    messageForChat += `\n💡 同じメンバーで新しい日程調整を開始しますか？\n`;
    messageForChat += `「はい」で開始、「いいえ」でキャンセルします。`;
    
    return c.json({
      original_thread: {
        id: thread.id,
        title: thread.title,
        status: thread.status,
        finalized_at: finalized?.finalized_at,
      },
      participants,
      suggested_title: suggestedTitle,
      message_for_chat: messageForChat,
      request_id: requestId,
    });
    
  } catch (error) {
    log.error('Error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

export default app;
