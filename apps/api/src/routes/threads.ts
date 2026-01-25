/**
 * Threads API Routes (Ticket 10)
 * 
 * POST /threads - Create thread with AI-generated candidates
 * GET /i/:token - View invite (for stranger selection page)
 * POST /i/:token/accept - Accept invite
 * 
 * ============================================================
 * Phase 2 リファクタリング計画
 * ============================================================
 * 
 * このファイルは Phase 2 で分割予定（1870行 → 各200-500行）
 * 
 * 分割先:
 * - routes/threads/list.ts: GET /, GET /:id
 * - routes/threads/create.ts: POST /
 * - routes/threads/proposals.ts: POST /:id/proposals/prepare, POST /:id/slots
 * - routes/threads/invites.ts: POST /:id/invites/batch, POST /:id/invites/prepare
 * - routes/threads/actions.ts: POST /:id/remind, POST /prepare-send, GET /:id/reschedule/info
 * 
 * Note: /i/:token 系は既に routes/invite.ts に分離済み
 * threads.ts 内の /i/* は Phase 2.5 で削除検討（重複の可能性）
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { AIRouterService } from '../services/aiRouter';
import { CandidateGeneratorService } from '../services/candidateGenerator';
import { ContactsRepository } from '../repositories/contactsRepository';
import { ListsRepository } from '../repositories/listsRepository';
import { getUserIdFromContext } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { EmailJob } from '../services/emailQueue';
import { THREAD_STATUS, isValidThreadStatus } from '../../../../packages/shared/src/types/thread';
import { getTenant } from '../utils/workspaceContext';
import { encodeCursor, decodeCursor } from '../utils/cursor';
import { formatDateTime, generateSlotLabels } from '../utils/datetime';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Phase 2-2: GET / と GET /:id は threads/list.ts に移動
// Phase 2-3: POST / は threads/create.ts に移動
// Phase 2-4: POST /:id/proposals/prepare, POST /:id/slots は threads/proposals.ts に移動
// ============================================================

/**
 * View invite (for /i/:token page)
 * 
 * @route GET /i/:token
 */
app.get('/i/:token', async (c) => {
  const { env } = c;
  const token = c.req.param('token');

  try {
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invitation Not Found</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
          <div class="bg-white p-8 rounded-lg shadow-lg max-w-md">
            <h1 class="text-2xl font-bold text-red-600 mb-4">Invitation Not Found</h1>
            <p class="text-gray-700">This invitation link is invalid or has been removed.</p>
          </div>
        </body>
        </html>
      `, 404);
    }

    if (invite.status !== 'pending') {
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invitation Already Processed</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
          <div class="bg-white p-8 rounded-lg shadow-lg max-w-md">
            <h1 class="text-2xl font-bold text-yellow-600 mb-4">Already Processed</h1>
            <p class="text-gray-700">This invitation has already been ${invite.status}.</p>
          </div>
        </body>
        </html>
      `);
    }

    if (new Date(invite.expires_at) < new Date()) {
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Invitation Expired</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
          <div class="bg-white p-8 rounded-lg shadow-lg max-w-md">
            <h1 class="text-2xl font-bold text-red-600 mb-4">Invitation Expired</h1>
            <p class="text-gray-700">This invitation has expired. Please contact the thread owner for a new invitation.</p>
          </div>
        </body>
        </html>
      `);
    }

    const thread = await threadsRepo.getById(invite.thread_id);

    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Thread Invitation</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
        <div class="bg-white p-8 rounded-lg shadow-lg max-w-2xl">
          <h1 class="text-3xl font-bold text-gray-800 mb-4">You're Invited!</h1>
          
          <div class="bg-blue-50 p-4 rounded-lg mb-6">
            <h2 class="text-xl font-semibold text-blue-900 mb-2">${thread?.title || 'Conversation'}</h2>
            ${thread?.description ? `<p class="text-gray-700">${thread.description}</p>` : ''}
          </div>

          <div class="mb-6">
            <h3 class="font-semibold text-gray-800 mb-2">Why you were selected:</h3>
            <p class="text-gray-700 italic">"${invite.candidate_reason || 'You would be a great fit for this conversation.'}"</p>
          </div>

          <div class="flex gap-4">
            <button 
              onclick="acceptInvite()"
              class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              Accept Invitation
            </button>
            <button 
              onclick="declineInvite()"
              class="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-3 px-6 rounded-lg transition"
            >
              Decline
            </button>
          </div>

          <p class="text-sm text-gray-500 mt-4">
            This invitation expires on ${new Date(invite.expires_at).toLocaleString()}
          </p>
        </div>

        <script>
          async function acceptInvite() {
            try {
              const response = await fetch('/api/threads/i/${token}/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              });
              
              if (response.ok) {
                document.body.innerHTML = \`
                  <div class="bg-gray-100 flex items-center justify-center min-h-screen">
                    <div class="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
                      <div class="text-green-600 text-6xl mb-4">✓</div>
                      <h1 class="text-2xl font-bold text-gray-800 mb-4">Invitation Accepted!</h1>
                      <p class="text-gray-700">You'll receive a notification once the thread owner confirms.</p>
                    </div>
                  </div>
                \`;
              } else {
                alert('Failed to accept invitation. Please try again.');
              }
            } catch (error) {
              alert('Network error. Please try again.');
            }
          }

          function declineInvite() {
            if (confirm('Are you sure you want to decline this invitation?')) {
              document.body.innerHTML = \`
                <div class="bg-gray-100 flex items-center justify-center min-h-screen">
                  <div class="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
                    <h1 class="text-2xl font-bold text-gray-800 mb-4">Invitation Declined</h1>
                    <p class="text-gray-700">Thank you for your response.</p>
                  </div>
                </div>
              \`;
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('[Threads] Error viewing invite:', error);
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 class="text-2xl font-bold text-red-600 mb-4">Error</h1>
          <p class="text-gray-700">An error occurred while loading this invitation.</p>
        </div>
      </body>
      </html>
    `, 500);
  }
});

/**
 * Accept invite
 * 
 * @route POST /i/:token/accept
 */
app.post('/i/:token/accept', async (c) => {
  const { env } = c;
  const token = c.req.param('token');

  try {
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.acceptInvite(token);

    console.log('[Threads] Invite accepted:', invite.id);

    // Get thread details
    const thread = await threadsRepo.getById(invite.thread_id);
    if (!thread) {
      throw new Error('Thread not found');
    }

    // Create inbox notification for thread owner
    const inboxRepo = new InboxRepository(env.DB);
    await inboxRepo.create({
      user_id: thread.user_id,
      type: 'scheduling_invite', // Thread acceptance notification as scheduling_invite
      title: `${invite.candidate_name} accepted your invitation`,
      message: `${invite.candidate_name} has accepted your invitation to join "${thread.title}"`,
      action_type: 'view_thread',
      action_target_id: thread.id,
      action_url: `/threads/${thread.id}`,
      priority: 'high',
    });

    console.log('[Threads] Created inbox notification for owner');

    return c.json({
      success: true,
      message: 'Invitation accepted',
      thread: {
        id: thread.id,
        title: thread.title,
      },
    });
  } catch (error) {
    console.error('[Threads] Error accepting invite:', error);
    return c.json(
      {
        error: 'Failed to accept invitation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================
// Phase 2-4: POST /:id/proposals/prepare, POST /:id/slots は threads/proposals.ts に移動
// ============================================================

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
    console.error('[Threads] Error sending reminder:', error);
    return c.json(
      {
        error: 'Failed to send reminder',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

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
// Beta A: POST /threads/prepare-send
// 新規スレッド用の送信準備（pending_action作成）
// ============================================================
import {
  PendingActionsRepository,
  generateConfirmToken,
  generateExpiresAt,
  type PendingActionPayload,
  type PendingActionSummary,
} from '../repositories/pendingActionsRepository';
import {
  composeInviteEmailModel,
  composeAdditionalSlotsEmailModel,
  modelToPreview,
} from '../utils/emailModel';
import {
  checkIsAppUserBatch,
} from '../repositories/inviteDeliveriesRepository';
import {
  normalizeAndValidateEmails,
  normalizeEmail,
} from '../utils/emailNormalizer';

app.post('/prepare-send', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  
  console.log('[prepare-send] Starting request:', requestId);
  
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
      console.log('[prepare-send] Auth context:', { userId, workspaceId, ownerUserId });
    } catch (authError) {
      console.error('[prepare-send] Auth error:', authError);
      return c.json({ 
        error: 'Unauthorized', 
        message: authError instanceof Error ? authError.message : 'Authentication failed',
        request_id: requestId 
      }, 401);
    }
    
    const body = await c.req.json().catch(() => ({} as any));
    console.log('[prepare-send] Request body:', JSON.stringify(body));
    
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
    console.error('[Threads] prepare-send error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[Threads] prepare-send stack:', errorStack);
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

// ============================================================
// P2-D3: 確定後やり直し（再調整）
// GET /threads/:id/reschedule/info
// ============================================================
app.get('/:id/reschedule/info', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const threadId = c.req.param('id');
  
  console.log('[reschedule/info] Starting request:', requestId, 'threadId:', threadId);
  
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
    console.error('[reschedule/info] Error:', error);
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

export default app;
