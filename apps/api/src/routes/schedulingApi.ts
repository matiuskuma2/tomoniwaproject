/**
 * Phase B: Scheduling API Routes with Attendance Engine
 * 
 * POST /i/:token/respond - External invite response (with slot selection)
 * GET /api/threads/:id/status - Thread progress/status
 * POST /api/threads/:id/remind - Send reminder to pending invitees
 * POST /api/threads/:id/finalize - Manually finalize thread
 * PUT /api/threads/:id/rule - Update attendance rule
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { evaluateRule, finalizeThread } from '../services/attendanceEngine';
import { getUserIdFromContext } from '../middleware/auth';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /i/:token/respond - External invite response with slot selection
 * 
 * @body { status: 'selected' | 'declined', selected_slot_id?: string }
 */
app.post('/i/:token/respond', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingAPI', handler: 'respond' });
  const token = c.req.param('token');

  try {
    const body = await c.req.json();
    const { status, selected_slot_id } = body;

    if (!status || !['selected', 'declined'].includes(status)) {
      return c.json({ error: 'Invalid status. Must be "selected" or "declined"' }, 400);
    }

    if (status === 'selected' && !selected_slot_id) {
      return c.json({ error: 'selected_slot_id is required when status is "selected"' }, 400);
    }

    // Get invite
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.json({ error: 'Invite not found' }, 404);
    }

    if (invite.status !== 'pending') {
      return c.json({ error: `Invite already ${invite.status}` }, 400);
    }

    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'Invite expired' }, 400);
    }

    // Get thread
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(invite.thread_id).first<any>();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    // Insert or update thread_selections
    if (status === 'selected' && selected_slot_id) {
      // Verify slot exists
      const slot = await env.DB.prepare(`
        SELECT * FROM scheduling_slots WHERE id = ? AND thread_id = ?
      `).bind(selected_slot_id, thread.id).first<any>();

      if (!slot) {
        return c.json({ error: 'Invalid slot_id' }, 400);
      }

      // Insert selection
      await env.DB.prepare(`
        INSERT OR REPLACE INTO thread_selections 
        (thread_id, invitee_key, slot_id, status, responded_at)
        VALUES (?, ?, ?, 'selected', datetime('now'))
      `).bind(thread.id, invite.invitee_key, selected_slot_id).run();

      log.debug('Selection recorded', { inviteeKey: invite.invitee_key, slotId: selected_slot_id });
    } else if (status === 'declined') {
      // Record decline (no slot selected)
      await env.DB.prepare(`
        INSERT OR REPLACE INTO thread_selections 
        (thread_id, invitee_key, slot_id, status, responded_at)
        VALUES (?, ?, NULL, 'declined', datetime('now'))
      `).bind(thread.id, invite.invitee_key).run();

      log.debug('Decline recorded', { inviteeKey: invite.invitee_key });
    }

    // Update invite status (backward compatibility)
    await env.DB.prepare(`
      UPDATE thread_invites 
      SET status = ?, accepted_at = datetime('now')
      WHERE token = ?
    `).bind(status === 'selected' ? 'accepted' : 'declined', token).run();

    // Notify thread owner
    const inboxRepo = new InboxRepository(env.DB);
    await inboxRepo.create({
      user_id: thread.organizer_user_id,
      type: 'scheduling_invite',
      title: `${invite.candidate_name} ${status === 'selected' ? 'selected a time slot' : 'declined'}`,
      message: `${invite.candidate_name} has ${status === 'selected' ? 'selected a time slot' : 'declined the invitation'} for "${thread.title}"`,
      action_type: 'view_thread',
      action_target_id: thread.id,
      action_url: `/threads/${thread.id}`,
      priority: 'high',
    });

    // Check if auto-finalize should trigger
    await checkAndAutoFinalize(env, thread.id);

    return c.json({
      success: true,
      message: status === 'selected' ? 'Slot selection recorded' : 'Decline recorded',
      thread: {
        id: thread.id,
        title: thread.title,
      },
    });
  } catch (error) {
    log.error('Error in /i/:token/respond', error);
    return c.json({
      error: 'Failed to process response',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * GET /api/threads/:id/status - Get thread progress/status
 * 
 * @route GET /api/threads/:id/status
 * @auth Bearer token required
 */
app.get('/:id/status', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingAPI', handler: 'status' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  try {
    // Get thread
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(threadId).first<any>();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get attendance rule
    const rule = await env.DB.prepare(`
      SELECT * FROM thread_attendance_rules WHERE thread_id = ?
    `).bind(threadId).first<any>();

    if (!rule) {
      return c.json({ error: 'Attendance rule not found' }, 404);
    }

    const ruleJson = JSON.parse(rule.rule_json);

    // Get slots
    const { results: slots } = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE thread_id = ? ORDER BY start_time ASC
    `).bind(threadId).all();

    // Get invites
    const { results: invites } = await env.DB.prepare(`
      SELECT * FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all();

    // Get selections
    const { results: selections } = await env.DB.prepare(`
      SELECT * FROM thread_selections WHERE thread_id = ?
    `).bind(threadId).all();

    // Evaluate rule
    const evalResult = evaluateRule(ruleJson, slots as any[], invites as any[], selections as any[]);

    // Get finalization status
    const finalized = await env.DB.prepare(`
      SELECT * FROM thread_finalize WHERE thread_id = ?
    `).bind(threadId).first<any>();

    // Count stats
    const totalInvites = invites.length;
    const respondedCount = selections.filter((s: any) => s.status !== 'pending').length;
    const selectedCount = selections.filter((s: any) => s.status === 'selected').length;
    const declinedCount = selections.filter((s: any) => s.status === 'declined').length;
    const pendingCount = totalInvites - respondedCount;

    return c.json({
      thread: {
        id: thread.id,
        title: thread.title,
        status: thread.status,
        organizer_user_id: thread.organizer_user_id,
      },
      rule: ruleJson,
      stats: {
        total_invites: totalInvites,
        responded: respondedCount,
        selected: selectedCount,
        declined: declinedCount,
        pending: pendingCount,
        response_rate: totalInvites > 0 ? (respondedCount / totalInvites * 100).toFixed(1) : '0',
      },
      evaluation: evalResult,
      finalized: finalized ? {
        finalized_at: finalized.finalized_at,
        finalized_by_user_id: finalized.finalized_by_user_id,
        selected_slot_id: finalized.selected_slot_id,
        reason: finalized.reason,
        auto_finalized: finalized.auto_finalized,
      } : null,
      slots: slots.map((slot: any) => {
        const slotResult = evalResult.slot_results.find((sr: any) => sr.slot_id === slot.id);
        return {
          ...slot,
          is_valid: slotResult?.is_valid || false,
          score: slotResult?.score || 0,
          selected_count: slotResult?.counts.selected || 0,
          missing_count: slotResult?.counts.missing?.length || 0,
        };
      }),
    });
  } catch (error) {
    log.error('Error in /status', { threadId, error });
    return c.json({
      error: 'Failed to get thread status',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /api/threads/:id/remind - Send reminder to pending invitees
 * 
 * @route POST /api/threads/:id/remind
 * @auth Bearer token required
 * @body { invitee_keys?: string[] } - Optional: specific invitees to remind (default: all pending)
 */
app.post('/:id/remind', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingAPI', handler: 'remind' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  try {
    const body = await c.req.json().catch(() => ({}));
    const { invitee_keys } = body;

    // Get thread
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(threadId).first<any>();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get pending invites
    let query = `
      SELECT ti.* FROM thread_invites ti
      LEFT JOIN thread_selections ts ON ts.thread_id = ti.thread_id AND ts.invitee_key = ti.invitee_key
      WHERE ti.thread_id = ? 
        AND ti.status = 'pending'
        AND (ts.status IS NULL OR ts.status = 'pending')
    `;
    const params: any[] = [threadId];

    if (invitee_keys && invitee_keys.length > 0) {
      query += ` AND ti.invitee_key IN (${invitee_keys.map(() => '?').join(',')})`;
      params.push(...invitee_keys);
    }

    const { results: pendingInvites } = await env.DB.prepare(query).bind(...params).all();

    if (pendingInvites.length === 0) {
      return c.json({
        success: true,
        message: 'No pending invites to remind',
        reminded_count: 0,
      });
    }

    // Send reminder emails (using EMAIL_QUEUE if available)
    let remindedCount = 0;
    for (const invite of pendingInvites as any[]) {
      try {
        // Queue reminder email
        if (env.EMAIL_QUEUE) {
          await env.EMAIL_QUEUE.send({
            job_id: `remind-${invite.id}-${Date.now()}`,
            type: 'remind',
            to: invite.email,
            subject: `Reminder: ${thread.title}`,
            created_at: Date.now(),
            data: {
              token: invite.token,
              inviter_name: 'Tomoniwao',
              relation_type: 'thread_remind',
              thread_title: thread.title,
            },
          });
        }

        // Create inbox notification for invitee (if registered user)
        if (invite.invitee_key?.startsWith('u:')) {
          const targetUserId = invite.invitee_key.replace('u:', '');
          const inboxRepo = new InboxRepository(env.DB);
          await inboxRepo.create({
            user_id: targetUserId,
            type: 'scheduling_reminder',
            title: `Reminder: ${thread.title}`,
            message: `You haven't responded to the invitation for "${thread.title}". Please select a time slot.`,
            action_type: 'view_invite',
            action_target_id: invite.id,
            action_url: `/i/${invite.token}`,
            priority: 'normal',
          });
        }

        remindedCount++;
        log.debug('Reminder sent', { email: invite.email });
      } catch (err) {
        log.error('Failed to send reminder', { email: invite.email, error: err });
      }
    }

    return c.json({
      success: true,
      message: `Reminder sent to ${remindedCount} invitees`,
      reminded_count: remindedCount,
    });
  } catch (error) {
    log.error('Error in /remind', { threadId, error });
    return c.json({
      error: 'Failed to send reminders',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /api/threads/:id/finalize - Manually finalize thread
 * 
 * @route POST /api/threads/:id/finalize
 * @auth Bearer token required
 * @body { selected_slot_id: string }
 */
app.post('/:id/finalize', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingAPI', handler: 'finalize' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  try {
    const body = await c.req.json();
    const { selected_slot_id } = body;

    if (!selected_slot_id) {
      return c.json({ error: 'selected_slot_id is required' }, 400);
    }

    // Get thread
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(threadId).first<any>();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Check if already finalized
    const existingFinalize = await env.DB.prepare(`
      SELECT * FROM thread_finalize WHERE thread_id = ?
    `).bind(threadId).first();

    if (existingFinalize) {
      return c.json({ error: 'Thread already finalized' }, 400);
    }

    // Verify slot exists
    const slot = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE id = ? AND thread_id = ?
    `).bind(selected_slot_id, threadId).first<any>();

    if (!slot) {
      return c.json({ error: 'Invalid slot_id' }, 400);
    }

    // Finalize using attendanceEngine
    const result = await finalizeThread(env.DB, threadId, selected_slot_id, userId, 'manual');

    // Update thread status
    await env.DB.prepare(`
      UPDATE scheduling_threads SET status = 'confirmed' WHERE id = ?
    `).bind(threadId).run();

    // Notify all participants
    const { results: invites } = await env.DB.prepare(`
      SELECT * FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all();

    const inboxRepo = new InboxRepository(env.DB);
    for (const invite of invites as any[]) {
      // Send email notification
      if (env.EMAIL_QUEUE) {
        await env.EMAIL_QUEUE.send({
          job_id: `finalized-${invite.id}-${Date.now()}`,
          type: 'finalized',
          to: invite.email,
          subject: `Confirmed: ${thread.title}`,
          created_at: Date.now(),
          data: {
            thread_title: thread.title,
            slot_start: slot.start_time,
            slot_end: slot.end_time,
            timezone: slot.timezone,
          },
        });
      }

      // Create inbox notification (if registered user)
      if (invite.invitee_key?.startsWith('u:')) {
        const targetUserId = invite.invitee_key.replace('u:', '');
        await inboxRepo.create({
          user_id: targetUserId,
          type: 'scheduling_confirmed',
          title: `Confirmed: ${thread.title}`,
          message: `The meeting "${thread.title}" has been confirmed for ${new Date(slot.start_time).toLocaleString()}`,
          action_type: 'view_thread',
          action_target_id: threadId,
          action_url: `/threads/${threadId}`,
          priority: 'high',
        });
      }
    }

    log.info('Thread finalized manually', { threadId, userId });

    return c.json({
      success: true,
      message: 'Thread finalized successfully',
      finalized: result,
      slot: {
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        timezone: slot.timezone,
      },
    });
  } catch (error) {
    log.error('Error in /finalize', { threadId, error });
    return c.json({
      error: 'Failed to finalize thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * PUT /api/threads/:id/rule - Update attendance rule
 * 
 * @route PUT /api/threads/:id/rule
 * @auth Bearer token required
 * @body { rule_json: object }
 */
app.put('/:id/rule', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingAPI', handler: 'rule' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  try {
    const body = await c.req.json();
    const { rule_json } = body;

    if (!rule_json || typeof rule_json !== 'object') {
      return c.json({ error: 'rule_json is required and must be an object' }, 400);
    }

    // Validate rule_json structure
    if (!rule_json.version || !rule_json.type) {
      return c.json({ error: 'rule_json must have version and type fields' }, 400);
    }

    // Get thread
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(threadId).first<any>();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Check if already finalized
    const finalized = await env.DB.prepare(`
      SELECT * FROM thread_finalize WHERE thread_id = ?
    `).bind(threadId).first();

    if (finalized) {
      return c.json({ error: 'Cannot update rule for finalized thread' }, 400);
    }

    // Update rule
    await env.DB.prepare(`
      UPDATE thread_attendance_rules 
      SET rule_json = ?, updated_at = datetime('now')
      WHERE thread_id = ?
    `).bind(JSON.stringify(rule_json), threadId).run();

    log.info('Updated attendance rule', { threadId });

    return c.json({
      success: true,
      message: 'Attendance rule updated successfully',
      rule: rule_json,
    });
  } catch (error) {
    log.error('Error in /rule', { threadId, error });
    return c.json({
      error: 'Failed to update attendance rule',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Helper: Check and auto-finalize if conditions met
 */
async function checkAndAutoFinalize(env: Env, threadId: string): Promise<void> {
  const log = createLogger(env, { module: 'SchedulingAPI', handler: 'autoFinalize' });
  try {
    // Get attendance rule
    const rule = await env.DB.prepare(`
      SELECT * FROM thread_attendance_rules WHERE thread_id = ?
    `).bind(threadId).first<any>();

    if (!rule) return;

    const ruleJson = JSON.parse(rule.rule_json);
    
    // Skip if auto_finalize is disabled
    if (ruleJson.finalize_policy?.auto_finalize === false) {
      return;
    }

    // Check if already finalized
    const existingFinalize = await env.DB.prepare(`
      SELECT * FROM thread_finalize WHERE thread_id = ?
    `).bind(threadId).first();

    if (existingFinalize) return;

    // Get slots, invites, selections
    const { results: slots } = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE thread_id = ?
    `).bind(threadId).all();

    const { results: invites } = await env.DB.prepare(`
      SELECT * FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all();

    const { results: selections } = await env.DB.prepare(`
      SELECT * FROM thread_selections WHERE thread_id = ?
    `).bind(threadId).all();

    // Evaluate rule
    const evalResult = evaluateRule(ruleJson, slots as any[], invites as any[], selections as any[]);

    // Check if any slot is valid
    const validSlots = evalResult.slot_results.filter((sr: any) => sr.is_valid);
    
    if (validSlots.length === 0) return;

    // Auto-finalize with recommended slot
    if (evalResult.recommendation?.slot_id) {
      await finalizeThread(
        env.DB,
        threadId,
        evalResult.recommendation.slot_id,
        null, // System auto-finalize
        'auto: ' + evalResult.recommendation.reason
      );

      // Update thread status
      await env.DB.prepare(`
        UPDATE scheduling_threads SET status = 'confirmed' WHERE id = ?
      `).bind(threadId).run();

      log.info('Auto-finalized thread', { threadId, slotId: evalResult.recommendation.slot_id });
    }
  } catch (error) {
    log.error('Error in checkAndAutoFinalize', { threadId, error });
  }
}

export default app;
