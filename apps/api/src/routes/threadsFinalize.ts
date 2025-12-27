/**
 * Phase B: POST /api/threads/:id/finalize
 * 
 * Purpose: Manual finalization by organizer
 * Idempotent: Returns existing finalization if already done
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { THREAD_STATUS } from '../../../../packages/shared/src/types/thread';
import { INBOX_TYPE, INBOX_PRIORITY } from '../../../../packages/shared/src/types/inbox';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/threads/:id/finalize
 * 
 * Body:
 * {
 *   "selected_slot_id": "uuid",
 *   "reason": "Manual finalization by organizer" (optional)
 * }
 */
app.post('/:id/finalize', async (c) => {
  const { env } = c;
  
  try {
    // ====== (0) Authorization ======
    // userId is set by requireAuth middleware
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const threadId = c.req.param('id');
    
    // Parse body
    const body = await c.req.json();
    if (!body.selected_slot_id) {
      return c.json({ 
        error: 'Bad request',
        message: 'selected_slot_id is required'
      }, 400);
    }
    
    // ====== (1) Load Thread ======
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
        message: 'Only organizer can finalize thread'
      }, 403);
    }
    
    // ====== (2) Idempotent Check ======
    const existing = await env.DB.prepare(`
      SELECT 
        thread_id,
        final_slot_id,
        finalize_policy,
        finalized_by_user_id as finalized_by,
        finalized_at,
        final_participants_json
      FROM thread_finalize
      WHERE thread_id = ?
      LIMIT 1
    `).bind(threadId).first();
    
    if (existing) {
      // Already finalized - return existing (idempotent)
      return c.json({
        message: 'Thread already finalized',
        finalized: true,
        thread_id: existing.thread_id,
        selected_slot_id: existing.final_slot_id,
        finalized_at: existing.finalized_at,
        finalized_by_user_id: existing.finalized_by,
        finalize_policy: existing.finalize_policy,
        final_participants: JSON.parse((existing.final_participants_json as string) || '[]')
      });
    }
    
    // ====== (3) Verify Slot ======
    const slot = await env.DB.prepare(`
      SELECT 
        slot_id,
        start_at,
        end_at,
        timezone,
        label
      FROM scheduling_slots
      WHERE slot_id = ? AND thread_id = ?
    `).bind(body.selected_slot_id, threadId).first();
    
    if (!slot) {
      return c.json({
        error: 'Invalid slot',
        message: 'Selected slot does not belong to this thread'
      }, 400);
    }
    
    // ====== (4) Determine Final Participants ======
    const selectionsResult = await env.DB.prepare(`
      SELECT invitee_key
      FROM thread_selections
      WHERE thread_id = ? 
        AND selected_slot_id = ? 
        AND status = 'selected'
    `).bind(threadId, body.selected_slot_id).all();
    
    const finalParticipants = (selectionsResult.results || []).map(
      (s: any) => s.invitee_key
    );
    
    // ====== (5) Transaction: Finalize ======
    const finalizeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const reason = body.reason || 'Manual finalization by organizer';
    
    try {
      // (5-1) Insert into thread_finalize
      await env.DB.prepare(`
        INSERT INTO thread_finalize (
          thread_id,
          final_slot_id,
          finalize_policy,
          finalized_by_user_id,
          finalized_at,
          final_participants_json
        ) VALUES (?, ?, 'MANUAL', ?, datetime('now'), ?)
      `).bind(
        threadId,
        body.selected_slot_id,
        userId,
        JSON.stringify(finalParticipants)
      ).run();
      
      // (5-2) Update thread status to 'confirmed'
      await env.DB.prepare(`
        UPDATE scheduling_threads
        SET status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(THREAD_STATUS.CONFIRMED, threadId).run();
      
      // (5-3) Update thread_participants (internal users only)
      for (const key of finalParticipants) {
        if (key.startsWith('u:')) {
          const internalUserId = key.substring(2);
          const participantId = crypto.randomUUID();
          
          await env.DB.prepare(`
            INSERT OR IGNORE INTO thread_participants (
              id,
              thread_id,
              user_id,
              role,
              joined_at
            ) VALUES (?, ?, ?, 'member', datetime('now'))
          `).bind(
            participantId,
            threadId,
            internalUserId
          ).run();
        }
      }
      
      console.log('[Finalize] Successfully finalized thread:', threadId);
      
    } catch (error) {
      console.error('[Finalize] Transaction failed:', error);
      throw error;
    }
    
    // ====== (6) Notifications ======
    const warnings: any[] = [];
    
    // (6-1) Inbox notification to organizer
    try {
      const inboxId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO inbox (
          id,
          user_id,
          type,
          title,
          message,
          priority,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        inboxId,
        userId,
        INBOX_TYPE.SYSTEM_MESSAGE,
        `Thread finalized: ${thread.title}`,
        `Selected slot: ${slot.start_at} - ${slot.end_at} (${finalParticipants.length} participants)`,
        INBOX_PRIORITY.HIGH
      ).run();
    } catch (error) {
      console.error('[Finalize] Failed to create inbox notification:', error);
      warnings.push({
        type: 'inbox_notification_failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    // (6-2) Email notifications to final participants
    const invitesResult = await env.DB.prepare(`
      SELECT 
        id,
        email,
        invitee_key,
        token
      FROM thread_invites
      WHERE thread_id = ?
    `).bind(threadId).all();
    
    const invites = invitesResult.results || [];
    
    for (const invite of invites) {
      if (finalParticipants.includes(invite.invitee_key)) {
        try {
          const emailJob = {
            job_id: `finalize-${invite.id}-${Date.now()}`,
            type: 'thread_message' as const,  // Use existing EmailJob type
            to: String(invite.email),
            subject: `Confirmed: ${thread.title}`,
            created_at: Date.now(),
            data: {
              thread_id: String(threadId),
              delivery_id: crypto.randomUUID(),
              message: `Your scheduling has been confirmed. Time: ${slot.start_at} - ${slot.end_at}`,
              sender_name: 'Tomoniwao',
            }
          };
          
          await env.EMAIL_QUEUE.send(emailJob);
          console.log('[Finalize] Sent email to:', invite.email);
        } catch (error) {
          console.error('[Finalize] Failed to send email to:', invite.email, error);
          warnings.push({
            type: 'email_failed',
            invitee_key: invite.invitee_key,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    // ====== (7) Response ======
    return c.json({
      finalized: true,
      thread_id: threadId,
      selected_slot_id: body.selected_slot_id,
      selected_slot: {
        slot_id: slot.slot_id,
        start_at: slot.start_at,
        end_at: slot.end_at,
        timezone: slot.timezone,
        label: slot.label
      },
      final_participants: finalParticipants,
      participants_count: finalParticipants.length,
      finalized_at: now,
      finalized_by_user_id: userId,
      auto_finalized: false,
      reason: reason,
      warnings: warnings.length > 0 ? warnings : undefined
    });
    
  } catch (error) {
    console.error('[ThreadsFinalize] Error:', error);
    return c.json({
      error: 'Failed to finalize thread',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
