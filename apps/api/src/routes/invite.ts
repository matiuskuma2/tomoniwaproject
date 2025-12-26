/**
 * External Invite Routes (Ticket 10)
 * 
 * Top-level /i/:token route for stranger invite acceptance
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * View invite (for /i/:token page)
 * 
 * @route GET /:token
 */
app.get('/:token', async (c) => {
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

    // Get available slots
    const { results: slots } = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE thread_id = ? ORDER BY start_time ASC
    `).bind(invite.thread_id).all();

    const slotsHtml = slots && slots.length > 0 ? `
      <div class="mb-6">
        <h3 class="font-semibold text-gray-800 mb-3">Available Time Slots:</h3>
        <div id="slots" class="space-y-2">
          ${slots.map((slot: any, index: number) => `
            <label class="flex items-center p-4 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition">
              <input 
                type="radio" 
                name="slot" 
                value="${slot.id}" 
                class="mr-3 w-4 h-4 text-blue-600"
                ${index === 0 ? 'checked' : ''}
              />
              <div>
                <div class="font-semibold text-gray-800">${new Date(slot.start_time).toLocaleString()}</div>
                <div class="text-sm text-gray-600">to ${new Date(slot.end_time).toLocaleString()}</div>
                ${slot.timezone ? `<div class="text-xs text-gray-500 mt-1">${slot.timezone}</div>` : ''}
              </div>
            </label>
          `).join('')}
        </div>
      </div>
    ` : '';

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

          ${slotsHtml}

          <div class="flex gap-4">
            <button 
              onclick="selectSlot()"
              class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              ${slots && slots.length > 0 ? 'Select This Slot' : 'Accept Invitation'}
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
          async function selectSlot() {
            try {
              const selectedSlotRadio = document.querySelector('input[name="slot"]:checked');
              const selectedSlotId = selectedSlotRadio ? selectedSlotRadio.value : null;

              const response = await fetch('/i/${token}/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'selected',
                  selected_slot_id: selectedSlotId
                })
              });
              
              if (response.ok) {
                document.body.innerHTML = \`
                  <div class="bg-gray-100 flex items-center justify-center min-h-screen">
                    <div class="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
                      <div class="text-green-600 text-6xl mb-4">✓</div>
                      <h1 class="text-2xl font-bold text-gray-800 mb-4">Slot Selected!</h1>
                      <p class="text-gray-700">Your selection has been recorded. You'll receive a notification once the meeting is confirmed.</p>
                    </div>
                  </div>
                \`;
              } else {
                alert('Failed to select slot. Please try again.');
              }
            } catch (error) {
              alert('Network error. Please try again.');
            }
          }

          async function declineInvite() {
            if (confirm('Are you sure you want to decline this invitation?')) {
              try {
                const response = await fetch('/i/${token}/respond', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    status: 'declined'
                  })
                });

                if (response.ok) {
                  document.body.innerHTML = \`
                    <div class="bg-gray-100 flex items-center justify-center min-h-screen">
                      <div class="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
                        <h1 class="text-2xl font-bold text-gray-800 mb-4">Invitation Declined</h1>
                        <p class="text-gray-700">Thank you for your response.</p>
                      </div>
                    </div>
                  \`;
                }
              } catch (error) {
                alert('Network error. Please try again.');
              }
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('[Invite] Error viewing invite:', error);
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
 * POST /:token/respond - Phase B API for RSVP with Attendance Engine
 * 
 * @route POST /:token/respond
 * @body { status: 'selected' | 'declined', selected_slot_id?: string, timezone?: string, comment?: string }
 */
app.post('/:token/respond', async (c) => {
  const { env } = c;
  const token = c.req.param('token');

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'VALIDATION_ERROR', details: 'Invalid JSON body' }, 400);
  }

  // 1) Invite取得
  const invite = await env.DB.prepare(`
    SELECT id, thread_id, email, invitee_key, status, expires_at
    FROM thread_invites
    WHERE token = ?
    LIMIT 1
  `).bind(token).first<{
    id: string;
    thread_id: string;
    email: string;
    invitee_key: string | null;
    status: string | null;
    expires_at: string | null;
  }>();

  if (!invite) {
    return c.json({ ok: false, error: 'INVITE_NOT_FOUND' }, 404);
  }

  // 期限切れチェック
  if (invite.expires_at) {
    const exp = Date.parse(invite.expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return c.json({ ok: false, error: 'INVITE_EXPIRED' }, 410);
    }
  }

  // 2) Finalize済みチェック（二重確定防止）
  const alreadyFinalized = await env.DB.prepare(`
    SELECT 1 FROM thread_finalize WHERE thread_id = ? LIMIT 1
  `).bind(invite.thread_id).first();
  
  if (alreadyFinalized) {
    return c.json({ ok: false, error: 'THREAD_ALREADY_FINALIZED' }, 409);
  }

  // 3) invitee_key確保（暫定：e:<lower(email)>）
  let inviteeKey = invite.invitee_key;
  if (!inviteeKey) {
    inviteeKey = `e:${(invite.email || '').toLowerCase()}`;
    await env.DB.prepare(`
      UPDATE thread_invites SET invitee_key = ? WHERE id = ? AND invitee_key IS NULL
    `).bind(inviteeKey, invite.id).run();
  }

  // 4) 入力バリデーション
  if (body.status === 'selected') {
    if (!body.selected_slot_id) {
      return c.json({ ok: false, error: 'VALIDATION_ERROR', details: 'selected_slot_id required' }, 400);
    }

    // Slot存在確認
    const slot = await env.DB.prepare(`
      SELECT 1 FROM scheduling_slots WHERE id = ? AND thread_id = ? LIMIT 1
    `).bind(body.selected_slot_id, invite.thread_id).first();
    
    if (!slot) {
      return c.json({ ok: false, error: 'VALIDATION_ERROR', details: 'slot not found for thread' }, 400);
    }
  } else if (body.status === 'declined') {
    if (body.selected_slot_id !== undefined) {
      return c.json({ ok: false, error: 'VALIDATION_ERROR', details: 'selected_slot_id must be omitted for declined' }, 400);
    }
  } else {
    return c.json({ ok: false, error: 'VALIDATION_ERROR', details: 'status must be selected or declined' }, 400);
  }

  // 5) thread_selections upsert
  const selectionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO thread_selections
      (id, thread_id, invite_id, invitee_key, status, selected_slot_id, responded_at, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id, invitee_key) DO UPDATE SET
      invite_id        = excluded.invite_id,
      status           = excluded.status,
      selected_slot_id = excluded.selected_slot_id,
      responded_at     = excluded.responded_at
  `).bind(
    selectionId,
    invite.thread_id,
    invite.id,
    inviteeKey,
    body.status,
    body.status === 'selected' ? body.selected_slot_id : null,
    nowIso,
    nowIso
  ).run();

  // Update invite status (backward compatibility)
  await env.DB.prepare(`
    UPDATE thread_invites 
    SET status = ?, accepted_at = ?
    WHERE id = ?
  `).bind(body.status === 'selected' ? 'accepted' : 'declined', nowIso, invite.id).run();

  // 6) AttendanceEngine評価
  const { AttendanceEngine } = await import('../services/attendanceEngine');
  const engine = new AttendanceEngine(env.DB);
  
  const evaluation = await engine.evaluateThread(invite.thread_id);

  // 7) Auto finalize
  let didFinalize = false;
  let finalSlotId: string | null = null;

  if (evaluation?.auto_finalize === true && evaluation?.is_satisfied === true && evaluation?.best_slot_id) {
    finalSlotId = evaluation.best_slot_id;

    // Idempotent finalize
    await env.DB.prepare(`
      INSERT OR IGNORE INTO thread_finalize
        (thread_id, final_slot_id, finalize_policy, finalized_by, finalized_at, final_participants_json)
      VALUES
        (?, ?, ?, ?, ?, ?)
    `).bind(
      invite.thread_id,
      finalSlotId,
      evaluation.finalize_policy || 'EARLIEST_VALID',
      'system',
      nowIso,
      JSON.stringify(evaluation.final_participants || [])
    ).run();

    // Update thread status
    await env.DB.prepare(`
      UPDATE scheduling_threads SET status = 'finalized' WHERE id = ?
    `).bind(invite.thread_id).run();

    didFinalize = true;

    // Notify thread owner
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(invite.thread_id).first<any>();

    if (thread) {
      const inboxRepo = new InboxRepository(env.DB);
      await inboxRepo.create({
        user_id: thread.host_user_id || thread.organizer_user_id,
        type: 'scheduling_finalized',
        title: `Thread "${thread.title}" has been finalized!`,
        message: `The scheduling thread has been automatically finalized with ${evaluation.final_participants?.length || 0} participants.`,
        action_type: 'view_thread',
        action_target_id: thread.id,
        action_url: `/threads/${thread.id}`,
        priority: 'high',
      });
    }
  }

  return c.json({
    ok: true,
    thread_id: invite.thread_id,
    invite_id: invite.id,
    invitee_key: inviteeKey,
    selection: {
      status: body.status,
      selected_slot_id: body.status === 'selected' ? body.selected_slot_id : null,
      responded_at: nowIso,
    },
    evaluation,
    finalize: {
      did_finalize: didFinalize,
      final_slot_id: finalSlotId,
    },
  });
});

/**
 * Accept invite (Legacy - backward compatibility)
 * 
 * @route POST /:token/accept
 */
app.post('/:token/accept', async (c) => {
  const { env } = c;
  const token = c.req.param('token');

  try {
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.acceptInvite(token);

    console.log('[Invite] Invite accepted:', invite.id);

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

    console.log('[Invite] Created inbox notification for owner');

    return c.json({
      success: true,
      message: 'Invitation accepted',
      thread: {
        id: thread.id,
        title: thread.title,
      },
    });
  } catch (error) {
    console.error('[Invite] Error accepting invite:', error);
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
