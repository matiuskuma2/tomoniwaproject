/**
 * Threads API Routes (Ticket 10)
 * 
 * POST /threads - Create thread with AI-generated candidates
 * GET /i/:token - View invite (for stranger selection page)
 * POST /i/:token/accept - Accept invite
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { AIRouterService } from '../services/aiRouter';
import { CandidateGeneratorService } from '../services/candidateGenerator';
import { getUserIdLegacy } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { EmailJob } from '../services/emailQueue';

const app = new Hono<{ Bindings: Env }>();

/**
 * Get user's threads
 * 
 * @route GET /threads
 * @query status?: 'draft' | 'sent' | 'confirmed' | 'cancelled'
 * @query limit?: number (default: 50)
 * @query offset?: number (default: 0)
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = await getUserIdLegacy(c as any);

  try {
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const threadsRepo = new ThreadsRepository(env.DB);
    
    // Get threads for user
    let query = `
      SELECT 
        t.id,
        t.organizer_user_id,
        t.title,
        t.description,
        t.status,
        t.mode,
        t.created_at,
        t.updated_at,
        COUNT(DISTINCT ti.id) as invite_count,
        COUNT(DISTINCT CASE WHEN ti.status = 'accepted' THEN ti.id END) as accepted_count
      FROM scheduling_threads t
      LEFT JOIN thread_invites ti ON ti.thread_id = t.id
      WHERE t.organizer_user_id = ?
    `;
    
    const params: any[] = [userId];
    
    if (status) {
      query += ` AND t.status = ?`;
      params.push(status);
    }
    
    query += ` 
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...params).all();

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM scheduling_threads
      WHERE organizer_user_id = ?
    `;
    const countParams: any[] = [userId];
    
    if (status) {
      countQuery += ` AND status = ?`;
      countParams.push(status);
    }

    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();
    const total = countResult?.total || 0;

    return c.json({
      threads: results,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('[Threads] List error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get thread details
 * 
 * @route GET /threads/:id
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const userId = await getUserIdLegacy(c as any);
  const threadId = c.req.param('id');

  try {
    // Get thread from scheduling_threads
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(threadId).first();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get invites
    const { results: invites } = await env.DB.prepare(`
      SELECT 
        ti.id,
        ti.thread_id,
        ti.candidate_name,
        ti.candidate_email,
        ti.candidate_reason,
        ti.invite_token,
        ti.status,
        ti.accepted_at,
        ti.created_at
      FROM thread_invites ti
      WHERE ti.thread_id = ?
      ORDER BY ti.created_at DESC
    `).bind(threadId).all();

    return c.json({
      thread,
      invites,
    });
  } catch (error) {
    console.error('[Threads] Get details error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Create new thread with AI-generated candidates
 * 
 * @route POST /threads
 * @body { title: string, description?: string }
 * @ratelimit 10 per minute by user
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
    const userId = await getUserIdLegacy(c as any);

    try {
      const body = await c.req.json();
      const { title, description } = body;

      if (!title || typeof title !== 'string') {
        return c.json({ error: 'Missing or invalid field: title' }, 400);
      }

      // Step 1: Create thread
      const threadsRepo = new ThreadsRepository(env.DB);
      const thread = await threadsRepo.create({
        user_id: userId,
        title,
        description,
      });

      console.log('[Threads] Created thread:', thread.id);

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
      `).bind(thread.id, JSON.stringify(defaultRule)).run();

      console.log('[Threads] Created default attendance rule');

      // Step 1.6: Create default scheduling slots (3 slots: tomorrow, day after, 3 days from now)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0); // 2 PM

      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 2);
      dayAfter.setHours(14, 0, 0, 0);

      const threeDays = new Date(now);
      threeDays.setDate(threeDays.getDate() + 3);
      threeDays.setHours(14, 0, 0, 0);

      const slots = [
        { start: tomorrow, end: new Date(tomorrow.getTime() + 60 * 60 * 1000) }, // 1 hour
        { start: dayAfter, end: new Date(dayAfter.getTime() + 60 * 60 * 1000) },
        { start: threeDays, end: new Date(threeDays.getTime() + 60 * 60 * 1000) },
      ];

      for (const slot of slots) {
        await env.DB.prepare(`
          INSERT INTO scheduling_slots (thread_id, start_time, end_time, timezone)
          VALUES (?, ?, ?, ?)
        `).bind(
          thread.id,
          slot.start.toISOString(),
          slot.end.toISOString(),
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        ).run();
      }

      console.log('[Threads] Created 3 default scheduling slots');

      // Step 2: Generate candidates with AI
      // Check if AI fallback is allowed (default: false for free tier)
      const allowFallback = env.AI_FALLBACK_ENABLED === 'true';
      
      const aiRouter = new AIRouterService(
        env.GEMINI_API_KEY || '',
        env.OPENAI_API_KEY || '',
        env.DB,
        allowFallback
      );

      const candidateGen = new CandidateGeneratorService(aiRouter, userId);
      const candidates = await candidateGen.generateCandidates(title, description);

      console.log('[Threads] Generated candidates:', candidates.length);

      // Step 3: Create invites for each candidate
      const invites = await Promise.all(
        candidates.map((candidate) =>
          threadsRepo.createInvite({
            thread_id: thread.id,
            email: candidate.email,
            candidate_name: candidate.name,
            candidate_reason: candidate.reason,
            expires_in_hours: 72, // 3 days
          })
        )
      );

      console.log('[Threads] Created invites:', invites.length);

      // Step 4: Send invite emails via queue
      for (const invite of invites) {
        const candidate = candidates.find((c) => c.email === invite.email);
        if (!candidate) continue;

        const emailJob: EmailJob = {
          job_id: `invite-${invite.id}`,
          type: 'invite',
          to: candidate.email,
          subject: `${title} - You're invited to join a conversation`,
          created_at: Date.now(),
          data: {
            token: invite.token,
            inviter_name: 'Tomoniwao',
            relation_type: 'thread_invite',
          },
        };

        await env.EMAIL_QUEUE.send(emailJob);
        console.log('[Threads] Queued email for:', candidate.email);
      }

      return c.json({
        thread,
        candidates: candidates.map((candidate, i) => ({
          ...candidate,
          invite_token: invites[i].token,
          invite_url: `https://webapp.snsrilarc.workers.dev/i/${invites[i].token}`,
        })),
        message: `Thread created with ${candidates.length} candidate invitations sent`,
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

export default app;
