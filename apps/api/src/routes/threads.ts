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
// ============================================================

/**
 * Create new thread with AI-generated candidates OR bulk invite from list
 * 
 * @route POST /threads
 * @body { title: string, description?: string, target_list_id?: string }
 * @ratelimit 10 per minute by user
 * 
 * If target_list_id is provided:
 * - Load list_members → contacts → create invites
 * - Email queue for bulk sending
 * 
 * Otherwise:
 * - AI-generated candidates (original flow)
 */
app.post(
  '/',
  rateLimit({
    action: 'thread_create',
    scope: 'user',
    max: 10,
    windowSeconds: 60,
    identifierExtractor: (c) => c.req.header('x-user-id') || 'unknown',
  }),
  async (c) => {
    const { env } = c;
    const userId = await getUserIdFromContext(c as any);

    // P0-1: Get tenant context
    const { workspaceId, ownerUserId } = getTenant(c);

    try {
      const body = await c.req.json();
      const { title, description, target_list_id } = body;

      if (!title || typeof title !== 'string') {
        return c.json({ error: 'Missing or invalid field: title' }, 400);
      }

      // Step 1: Create thread in scheduling_threads (P0-1: tenant isolation)
      const threadId = crypto.randomUUID();
      const now = new Date().toISOString();
      
      // P3-TZ3: organizer timezone をスレッドにコピー
      const organizerTzRow = await env.DB.prepare(
        `SELECT timezone FROM users WHERE id = ? LIMIT 1`
      ).bind(ownerUserId).first<{ timezone: string }>();
      const organizerTimeZone = organizerTzRow?.timezone || 'Asia/Tokyo';
      
      await env.DB.prepare(`
        INSERT INTO scheduling_threads (id, workspace_id, organizer_user_id, title, description, status, mode, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'one_on_one', ?, ?, ?)
      `).bind(threadId, workspaceId, ownerUserId, title, description || null, THREAD_STATUS.DRAFT, organizerTimeZone, now, now).run();

      console.log('[Threads] Created thread in scheduling_threads:', threadId);

      // Step 1.5: Create default attendance rule (ALL type)
      const defaultRule = {
        version: '1.0',
        type: 'ALL',
        slot_policy: { multiple_slots_allowed: true },
        invitee_scope: { allow_unregistered: true },
        rule: {},
        finalize_policy: {
          auto_finalize: true,
          policy: 'EARLIEST_VALID',
        },
      };

      await env.DB.prepare(`
        INSERT INTO thread_attendance_rules (thread_id, rule_json)
        VALUES (?, ?)
      `).bind(threadId, JSON.stringify(defaultRule)).run();

      console.log('[Threads] Created default attendance rule');

      // Step 1.6: Create default scheduling slots (3 slots: tomorrow, day after, 3 days from now)
      const slotBaseTime = new Date();
      const tomorrow = new Date(slotBaseTime);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0); // 2 PM

      const dayAfter = new Date(slotBaseTime);
      dayAfter.setDate(dayAfter.getDate() + 2);
      dayAfter.setHours(14, 0, 0, 0);

      const threeDays = new Date(slotBaseTime);
      threeDays.setDate(threeDays.getDate() + 3);
      threeDays.setHours(14, 0, 0, 0);

      const slots = [
        { start: tomorrow, end: new Date(tomorrow.getTime() + 60 * 60 * 1000) }, // 1 hour
        { start: dayAfter, end: new Date(dayAfter.getTime() + 60 * 60 * 1000) },
        { start: threeDays, end: new Date(threeDays.getTime() + 60 * 60 * 1000) },
      ];

      for (const slot of slots) {
        const slotId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          slotId,
          threadId,
          slot.start.toISOString(),
          slot.end.toISOString(),
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
        ).run();
      }

      console.log('[Threads] Created 3 default scheduling slots');

      let candidates: any[] = [];
      let invites: any[] = [];
      let skippedCount = 0; // ローカル変数で管理（c.set/get は使わない）

      // ============================
      // Branch: Bulk invite from list OR AI-generated candidates
      // ============================
      if (target_list_id) {
        // Step 2A: Bulk invite from list
        console.log('[Threads] Bulk invite mode: target_list_id =', target_list_id);

        const listsRepo = new ListsRepository(env.DB);
        const contactsRepo = new ContactsRepository(env.DB);

        // Verify list ownership (P0-1: tenant isolation)
        const list = await listsRepo.getById(target_list_id, workspaceId, ownerUserId);
        if (!list) {
          return c.json({ error: 'List not found or access denied' }, 404);
        }

        // Get total count first (最重要ポイント 2: 上限1000件チェック)
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

        console.log(`[Threads] Bulk inviting ${members.length} contacts from list`);

        // 最重要ポイント 3: email が無い contact は除外
        const validMembers = members.filter((m) => m.contact_email);
        skippedCount = members.length - validMembers.length;

        if (skippedCount > 0) {
          console.warn(`[Threads] Skipped ${skippedCount} contacts without email`);
        }

        // Step 3A: Create invites in batch (P0-1: Transaction for performance)
        const threadsRepo = new ThreadsRepository(env.DB);
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

        // P0-3: Fetch only inserted invites (accurate tracking)
        if (batchResult.insertedIds.length > 0) {
          const placeholders = batchResult.insertedIds.map(() => '?').join(',');
          const inviteList = await env.DB.prepare(
            `SELECT * FROM thread_invites WHERE id IN (${placeholders}) ORDER BY created_at DESC`
          ).bind(...batchResult.insertedIds).all();

          invites = inviteList.results as any[];
        } else {
          invites = [];
        }

        // Convert to candidates format for response
        candidates = validMembers.map((m) => ({
          name: m.contact_display_name || m.contact_email!,
          email: m.contact_email!,
          reason: `From list: ${list.name}`,
        }));
      } else {
        // Step 2B: Generate candidates with AI (original flow)
        console.log('[Threads] AI candidate generation mode');

        const allowFallback = env.AI_FALLBACK_ENABLED === 'true';
        
        const aiRouter = new AIRouterService(
          env.GEMINI_API_KEY || '',
          env.OPENAI_API_KEY || '',
          env.DB,
          allowFallback
        );

        const candidateGen = new CandidateGeneratorService(aiRouter, userId);
        candidates = await candidateGen.generateCandidates(title, description);

        console.log('[Threads] Generated candidates:', candidates.length);

        // Step 3B: Create invites for each candidate
        const threadsRepo = new ThreadsRepository(env.DB);
        invites = await Promise.all(
          candidates.map((candidate) =>
            threadsRepo.createInvite({
              thread_id: threadId,
              email: candidate.email,
              candidate_name: candidate.name,
              candidate_reason: candidate.reason,
              expires_in_hours: 72, // 3 days
            })
          )
        );

        console.log('[Threads] Created invites:', invites.length);
      }

      // Step 4: Send invite emails via queue (共通)
      // Beta A: thread_title を追加してメール本文に表示
      for (const invite of invites) {
        const candidate = candidates.find((c) => c.email === invite.email);
        if (!candidate) continue;

        const emailJob: EmailJob = {
          job_id: `invite-${invite.id}`,
          type: 'invite',
          to: candidate.email,
          subject: `【日程調整】「${title}」のご依頼`,
          created_at: Date.now(),
          data: {
            token: invite.token,
            inviter_name: 'Tomoniwao',
            relation_type: 'thread_invite',
            thread_title: title,
          },
        };

        await env.EMAIL_QUEUE.send(emailJob);
        console.log('[Threads] Queued email for:', candidate.email);
      }

      return c.json({
        thread: {
          id: threadId,
          title,
          description,
          organizer_user_id: userId,
          status: 'draft',
          created_at: now
        },
        candidates: candidates.map((candidate, i) => {
          // Get the host from the request
          const host = c.req.header('host') || 'app.tomoniwao.jp';
          return {
            ...candidate,
            invite_token: invites[i].token,
            invite_url: `https://${host}/i/${invites[i].token}`,
          };
        }),
        message: `Thread created with ${candidates.length} candidate invitations sent`,
        // 最重要ポイント 3: skipped_count をレスポンスに含める（target_list_id モード時のみ）
        ...(target_list_id ? { skipped_count: skippedCount } : {}),
      });
    } catch (error) {
      console.error('[Threads] Error creating thread:', error);
      return c.json(
        {
          error: 'Failed to create thread',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      );
    }
  }
);

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
// Phase2: 追加候補機能 (Sprint 2-A)
// ============================================================
// NOTE: PendingActionsRepository は下部でインポート済み

/**
 * POST /threads/:id/proposals/prepare
 * Phase2: 追加候補の準備（pending_action 作成）
 * 
 * 安全装置:
 *   1. collecting (status = 'sent') のみ実行可
 *   2. 最大2回まで (additional_propose_count < 2)
 *   3. 既存回答は消さない（スロット追加のみ）
 *   4. 重複候補は除外（同一 start_at/end_at）
 * 
 * @route POST /threads/:id/proposals/prepare
 * @body slots: Array<{ start_at: string, end_at: string, label?: string }>
 * @returns { confirm_token, expires_at, summary, message_for_chat }
 */
app.post('/:id/proposals/prepare', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    // ====== (1) スレッド取得 & 権限チェック ======
    const thread = await env.DB.prepare(`
      SELECT 
        id, 
        organizer_user_id, 
        title, 
        status,
        COALESCE(proposal_version, 1) as proposal_version,
        COALESCE(additional_propose_count, 0) as additional_propose_count
      FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{
      id: string;
      organizer_user_id: string;
      title: string;
      status: string;
      proposal_version: number;
      additional_propose_count: number;
    }>();

    if (!thread) {
      return c.json({ 
        error: 'not_found',
        message: 'スレッドが見つかりません',
        request_id: requestId 
      }, 404);
    }

    // ====== (2) 安全装置: collecting のみ ======
    if (thread.status !== 'sent') {
      const statusMessages: Record<string, string> = {
        draft: '下書き状態では追加候補を出せません。まず招待を送信してください。',
        confirmed: '確定済みのスレッドには追加候補を出せません。',
        cancelled: 'キャンセル済みのスレッドには追加候補を出せません。',
      };
      return c.json({
        error: 'invalid_status',
        message: statusMessages[thread.status] || '追加候補を出せない状態です。',
        current_status: thread.status,
        request_id: requestId,
      }, 400);
    }

    // ====== (3) 安全装置: 最大2回まで ======
    if (thread.additional_propose_count >= 2) {
      return c.json({
        error: 'max_proposals_reached',
        message: '追加候補は最大2回までです。新しいスレッドを作成してください。',
        additional_propose_count: thread.additional_propose_count,
        request_id: requestId,
      }, 400);
    }

    // ====== (4) リクエストボディ検証 ======
    const body = await c.req.json<{
      slots: Array<{ start_at: string; end_at: string; label?: string }>;
    }>();

    if (!body.slots || !Array.isArray(body.slots) || body.slots.length === 0) {
      return c.json({ 
        error: 'missing_slots',
        message: '追加する候補日時を指定してください',
        request_id: requestId 
      }, 400);
    }

    if (body.slots.length > 10) {
      return c.json({
        error: 'too_many_slots',
        message: '一度に追加できる候補は10件までです',
        request_id: requestId,
      }, 400);
    }

    // ====== (5) 既存スロットとの重複チェック ======
    const existingSlots = await env.DB.prepare(`
      SELECT start_at, end_at FROM scheduling_slots WHERE thread_id = ?
    `).bind(threadId).all<{ start_at: string; end_at: string }>();

    const existingSet = new Set(
      (existingSlots.results || []).map((s) => `${s.start_at}|${s.end_at}`)
    );

    const newSlots = body.slots.filter((s) => !existingSet.has(`${s.start_at}|${s.end_at}`));
    const duplicateCount = body.slots.length - newSlots.length;

    if (newSlots.length === 0) {
      return c.json({
        error: 'all_duplicates',
        message: '全ての候補が既存の候補と重複しています。',
        duplicate_count: duplicateCount,
        request_id: requestId,
      }, 400);
    }

    // ====== (6) 次の proposal_version を計算 ======
    const nextVersion = thread.proposal_version + 1;

    // ====== (7) pending_action 作成 ======
    interface AddSlotsPayload extends PendingActionPayload {
      action_type: 'add_slots';
      slots: Array<{ start_at: string; end_at: string; label?: string }>;
      next_proposal_version: number;
    }

    const payload: AddSlotsPayload = {
      source_type: 'emails', // ダミー（スロット追加では使用しない）
      action_type: 'add_slots',
      slots: newSlots,
      next_proposal_version: nextVersion,
    };

    const summary: PendingActionSummary = {
      total_count: body.slots.length,
      valid_count: newSlots.length,
      preview: newSlots.slice(0, 5).map((s) => ({
        email: s.label || formatDateTime(s.start_at),
        is_app_user: false,
      })),
      preview_count: Math.min(newSlots.length, 5),
      skipped: {
        invalid_email: 0,
        duplicate_input: duplicateCount,
        missing_email: 0,
        already_invited: 0,
      },
      app_users_count: 0,
      external_count: 0,
    };

    const pendingRepo = new PendingActionsRepository(env.DB);
    const pendingId = crypto.randomUUID();
    const confirmToken = generateConfirmToken();
    const expiresAt = generateExpiresAt(15);

    // pending_actions テーブルに直接 INSERT（action_type は文字列として保存）
    await env.DB.prepare(`
      INSERT INTO pending_actions (
        id, workspace_id, owner_user_id, thread_id,
        action_type, source_type,
        payload_json, summary_json,
        confirm_token, status, expires_at,
        request_id, created_at
      ) VALUES (?, ?, ?, ?, 'add_slots', 'emails', ?, ?, ?, 'pending', ?, ?, datetime('now'))
    `).bind(
      pendingId,
      workspaceId,
      ownerUserId,
      threadId,
      JSON.stringify(payload),
      JSON.stringify(summary),
      confirmToken,
      expiresAt,
      requestId
    ).run();

    // ====== (8) レスポンス ======
    // ⚠️ toLocaleString の直書き禁止 → datetime.ts の関数を使用
    const slotLabels = newSlots.slice(0, 3).map((s) => 
      s.label || formatDateTime(s.start_at)
    );
    const allSlotLabels = newSlots.map((s) => 
      s.label || formatDateTime(s.start_at)
    );

    // P3-INV1 共通ソース化: メールモデル → プレビュー
    const emailModel = composeAdditionalSlotsEmailModel({
      threadTitle: thread.title,
      slotCount: newSlots.length,
      slotLabels: allSlotLabels,
    });
    const emailPreview = modelToPreview(emailModel);

    return c.json({
      request_id: requestId,
      confirm_token: confirmToken,
      expires_at: expiresAt,
      expires_in_seconds: 15 * 60,
      thread_id: threadId,
      thread_title: thread.title,
      next_proposal_version: nextVersion,
      summary: {
        total_slots: body.slots.length,
        new_slots: newSlots.length,
        duplicate_slots: duplicateCount,
        preview_labels: slotLabels,
      },
      remaining_proposals: 2 - thread.additional_propose_count - 1,
      default_decision: 'add',
      email_preview: emailPreview,  // P3-INV1 B案: 骨格ブロック
      message_for_chat: `「${thread.title}」に${newSlots.length}件の追加候補を出します。\n候補: ${slotLabels.join('、')}${newSlots.length > 3 ? ` 他${newSlots.length - 3}件` : ''}\n\n次に「追加」または「キャンセル」を入力してください。\n（残り追加回数: ${2 - thread.additional_propose_count - 1}回）`,
    });

  } catch (error) {
    console.error('[Threads] proposals/prepare error:', error);
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

/**
 * POST /threads/:id/slots
 * Add new scheduling slots to an existing thread
 * 
 * @route POST /threads/:id/slots
 * @body slots: Array<{ start_at: string, end_at: string, label?: string }>
 * @returns { success: true, slots_added: number, slot_ids: string[] }
 */
app.post('/:id/slots', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    // Verify thread exists and user has access
    const thread = await env.DB.prepare(`
      SELECT id, organizer_user_id, status FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{ id: string; organizer_user_id: string; status: string }>();

    if (!thread) {
      return c.json({ error: 'Thread not found or access denied' }, 404);
    }

    // Parse request body
    const body = await c.req.json<{ 
      slots: Array<{ start_at: string; end_at: string; label?: string }> 
    }>();

    if (!body.slots || !Array.isArray(body.slots) || body.slots.length === 0) {
      return c.json({ error: 'Missing or invalid field: slots' }, 400);
    }

    if (body.slots.length > 10) {
      return c.json({ error: 'Maximum 10 slots allowed per request' }, 400);
    }

    const slotIds: string[] = [];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

    for (const slot of body.slots) {
      if (!slot.start_at || !slot.end_at) {
        return c.json({ error: 'Each slot must have start_at and end_at' }, 400);
      }

      const slotId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        slotId,
        threadId,
        slot.start_at,
        slot.end_at,
        timezone,
        slot.label || null
      ).run();

      slotIds.push(slotId);
    }

    console.log(`[Threads] Added ${slotIds.length} slots to thread ${threadId}`);

    return c.json({
      success: true,
      slots_added: slotIds.length,
      slot_ids: slotIds,
    });
  } catch (error) {
    console.error('[Threads] Error adding slots:', error);
    return c.json(
      { error: 'Failed to add slots', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

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
