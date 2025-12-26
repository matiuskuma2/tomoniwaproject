/**
 * Phase B: POST /api/threads/:id/remind
 * 
 * Purpose: Send reminder emails to pending invitees
 * Rate Limit: 60 minutes per thread per organizer
 */

import { Hono } from 'hono';
import { getUserIdLegacy } from '../middleware/auth';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { ReminderEmailJob } from '../services/emailQueue';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/threads/:id/remind
 * 
 * Body (optional):
 * {
 *   "target_invitee_keys": ["e:abc...", "u:xxx..."],
 *   "message": "Please respond soon!"
 * }
 */
app.post('/:id/remind', async (c) => {
  const { env } = c;
  
  try {
    // ====== (0) Authorization ======
    const userId = await getUserIdLegacy(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const threadId = c.req.param('id');
    
    // Parse body (safe)
    let body: any = {};
    try {
      body = await c.req.json();
    } catch (e) {
      // Body is optional
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
        message: 'Only organizer can send reminders'
      }, 403);
    }
    
    // Check if already finalized/cancelled
    if (thread.status === 'confirmed' || thread.status === 'cancelled') {
      return c.json({
        error: 'Cannot send reminder',
        message: `Thread is already ${thread.status}`
      }, 400);
    }
    
    // ====== (2) Rate Limit Check ======
    const lastRemind = await env.DB.prepare(`
      SELECT created_at
      FROM remind_log
      WHERE thread_id = ? AND created_by_user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(threadId, userId).first();
    
    if (lastRemind) {
      const lastTime = new Date(lastRemind.created_at as string);
      const now = new Date();
      const diffMinutes = (now.getTime() - lastTime.getTime()) / 1000 / 60;
      
      if (diffMinutes < 60) {
        const nextAvailable = new Date(lastTime.getTime() + 60 * 60 * 1000);
        return c.json({
          error: 'Rate limit exceeded',
          message: `Please wait ${Math.ceil(60 - diffMinutes)} minutes before sending another reminder`,
          next_available_at: nextAvailable.toISOString()
        }, 429);
      }
    }
    
    // ====== (3) Compute Pending ======
    // (3-1) Load invites
    const invitesResult = await env.DB.prepare(`
      SELECT 
        id,
        token,
        email,
        candidate_name,
        invitee_key,
        status,
        expires_at
      FROM thread_invites
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `).bind(threadId).all();
    
    const invites = invitesResult.results || [];
    
    // (3-2) Load selections (responded invitee_keys)
    const selectionsResult = await env.DB.prepare(`
      SELECT DISTINCT invitee_key
      FROM thread_selections
      WHERE thread_id = ?
    `).bind(threadId).all();
    
    const respondedKeys = new Set(
      (selectionsResult.results || []).map((s: any) => s.invitee_key)
    );
    
    // (3-3) Filter pending
    let pending = invites.filter((inv: any) =>
      (inv.status === 'pending' || inv.status === null) &&
      inv.invitee_key &&
      !respondedKeys.has(inv.invitee_key)
    );
    
    // Optional: filter by target_invitee_keys
    if (body.target_invitee_keys && Array.isArray(body.target_invitee_keys)) {
      const targetSet = new Set(body.target_invitee_keys);
      pending = pending.filter((inv: any) => targetSet.has(inv.invitee_key));
    }
    
    if (pending.length === 0) {
      return c.json({
        message: 'No pending invites to remind',
        reminded_count: 0
      });
    }
    
    // ====== (4) Send Emails ======
    const results: any[] = [];
    const warnings: any[] = [];
    const host = c.req.header('host') || 'webapp.snsrilarc.workers.dev';
    
    for (const invite of pending) {
      try {
        const emailJob: ReminderEmailJob = {
          job_id: `remind-${invite.id}-${Date.now()}`,
          type: 'reminder',
          to: String(invite.email),
          subject: `Reminder: ${thread.title} - Please respond`,
          created_at: Date.now(),
          data: {
            token: String(invite.token),
            invite_url: `https://${host}/i/${invite.token}`,
            thread_title: String(thread.title),
            inviter_name: 'Tomoniwao', // TODO: get from user
            custom_message: body.message || null,
            expires_at: String(invite.expires_at)
          }
        };
        
        await env.EMAIL_QUEUE.send(emailJob);
        
        results.push({
          invitee_key: invite.invitee_key,
          email: invite.email,
          status: 'sent'
        });
        
        console.log('[Remind] Sent to:', invite.email);
      } catch (error) {
        console.error('[Remind] Failed to send to:', invite.email, error);
        warnings.push({
          invitee_key: invite.invitee_key,
          email: invite.email,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // ====== (5) Log Reminder ======
    const logId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO remind_log (
        id,
        thread_id,
        created_by_user_id,
        reminded_count,
        created_at
      ) VALUES (?, ?, ?, ?, datetime('now'))
    `).bind(
      logId,
      threadId,
      userId,
      results.length
    ).run();
    
    // ====== (6) Organizer Inbox Notification ======
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
        ) VALUES (?, ?, 'thread_reminder_sent', ?, ?, 'normal', datetime('now'))
      `).bind(
        inboxId,
        userId,
        `Reminder sent for: ${thread.title}`,
        `Sent reminder to ${results.length} pending invitee(s)`
      ).run();
    } catch (error) {
      console.error('[Remind] Failed to create inbox notification:', error);
      warnings.push({
        type: 'inbox_notification_failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    // ====== (7) Response ======
    const nextAvailable = new Date(Date.now() + 60 * 60 * 1000);
    
    return c.json({
      thread_id: threadId,
      reminded_count: results.length,
      results: results,
      warnings: warnings.length > 0 ? warnings : undefined,
      next_reminder_available_at: nextAvailable.toISOString()
    });
    
  } catch (error) {
    console.error('[ThreadsRemind] Error:', error);
    return c.json({
      error: 'Failed to send reminders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
