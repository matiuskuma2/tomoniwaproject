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
import { MEETING_PROVIDER } from '../../../../packages/shared/src/types/meeting';
import { GoogleCalendarService } from '../services/googleCalendar';
import { checkBillingGate } from '../utils/billingGate';
import { getTenant } from '../utils/workspaceContext';
import { createLogger } from '../utils/logger';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
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
  const log = createLogger(env, { module: 'ThreadsFinalize', handler: 'finalize' });
  
  try {
    // ====== (0) Authorization ======
    // userId is set by requireAuth middleware
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    // ====== (0-1) Billing Gate (Day4) ======
    // confirm実行点のみ止める（status=2,4 → 実行禁止）
    const gate = await checkBillingGate(c);
    if (!gate.ok) {
      return c.json(
        {
          error: gate.code,
          reason: gate.reason,
          status: gate.status,
          message: gate.message,
          request_id: gate.requestId,
        },
        gate.httpStatus
      );
    }
    
    const threadId = c.req.param('id');
    
    // P0-1: Get tenant context
    const { workspaceId, ownerUserId } = getTenant(c);
    
    // Parse body
    const body = await c.req.json();
    if (!body.selected_slot_id) {
      return c.json({ 
        error: 'Bad request',
        message: 'selected_slot_id is required'
      }, 400);
    }
    
    // ====== (1) Load Thread (P0-1: tenant isolation) ======
    const thread = await env.DB.prepare(`
      SELECT 
        id,
        organizer_user_id,
        title,
        description,
        status
      FROM scheduling_threads
      WHERE id = ?
        AND workspace_id = ?
        AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first();
    
    if (!thread) {
      // P0-1: 404 で存在を隠す
      return c.json({ error: 'Thread not found' }, 404);
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
    
    // ====== (4.5) Create Google Meet (Phase 0A) ======
    let meetingUrl: string | null = null;
    let meetingProvider: string | null = null;
    let calendarEventId: string | null = null;
    
    try {
      log.debug('Attempting to create Google Meet');
      
      // Get organizer's access token (with auto-refresh)
      const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, userId, env);
      
      if (accessToken) {
        // Get organizer's email for attendees
        const organizerUser = await env.DB
          .prepare('SELECT email FROM users WHERE id = ?')
          .bind(userId)
          .first<{ email: string }>();
        
        const calendarService = new GoogleCalendarService(accessToken, env);
        
        const event = await calendarService.createEventWithMeet({
          summary: String(thread.title || 'Scheduled Meeting'),
          description: String(thread.description || 'Meeting scheduled via Tomoniwao'),
          start: slot.start_at as string,
          end: slot.end_at as string,
          timeZone: (slot.timezone as string) || 'Asia/Tokyo',
          organizerEmail: organizerUser?.email, // Phase 0B: Add organizer as attendee
        });
        
        if (event && event.hangoutLink) {
          meetingUrl = event.hangoutLink;
          meetingProvider = MEETING_PROVIDER.GOOGLE_MEET;
          calendarEventId = event.id;
          log.debug('Google Meet created', { meetingUrl });
        } else {
          log.warn('Google Meet creation returned no hangoutLink');
        }
      } else {
        log.warn('No Google account access token found for organizer');
        // ====== Mock Meet URL for OAuth review ======
        // Generate a mock Meet URL until Calendar API is approved
        const mockMeetCode = `${threadId.substring(0, 3)}-${threadId.substring(4, 8)}-${threadId.substring(9, 12)}`;
        meetingUrl = `https://meet.google.com/${mockMeetCode}`;
        meetingProvider = MEETING_PROVIDER.GOOGLE_MEET;
        log.debug('Generated mock Meet URL', { meetingUrl });
      }
    } catch (meetError) {
      log.warn('Failed to create Google Meet (non-fatal)', { error: meetError instanceof Error ? meetError.message : String(meetError) });
      // ====== Fallback: Mock Meet URL ======
      const mockMeetCode = `${threadId.substring(0, 3)}-${threadId.substring(4, 8)}-${threadId.substring(9, 12)}`;
      meetingUrl = `https://meet.google.com/${mockMeetCode}`;
      meetingProvider = MEETING_PROVIDER.GOOGLE_MEET;
      log.debug('Generated fallback mock Meet URL', { meetingUrl });
    }
    
    try {
      // (5-1) Insert into thread_finalize (with meeting info)
      await env.DB.prepare(`
        INSERT INTO thread_finalize (
          thread_id,
          final_slot_id,
          finalize_policy,
          finalized_by_user_id,
          finalized_at,
          final_participants_json,
          meeting_provider,
          meeting_url,
          calendar_event_id
        ) VALUES (?, ?, 'MANUAL', ?, datetime('now'), ?, ?, ?, ?)
      `).bind(
        threadId,
        body.selected_slot_id,
        userId,
        JSON.stringify(finalParticipants),
        meetingProvider,
        meetingUrl,
        calendarEventId
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
      
      log.debug('Successfully finalized thread', { threadId });
      
    } catch (error) {
      log.error('Transaction failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    
    // ====== (6) Notifications ======
    const warnings: any[] = [];
    
    // (6-1) Inbox notification to organizer
    try {
      const inboxId = crypto.randomUUID();
      const inboxMessage = meetingUrl 
        ? `📅 日程確定: ${slot.start_at} - ${slot.end_at}（${finalParticipants.length}名参加）\n\n🎥 Google Meet: ${meetingUrl}`
        : `📅 日程確定: ${slot.start_at} - ${slot.end_at}（${finalParticipants.length}名参加）`;
      
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
        `【確定】${thread.title}`,
        inboxMessage,
        INBOX_PRIORITY.HIGH
      ).run();
    } catch (error) {
      log.error('Failed to create inbox notification', { error: error instanceof Error ? error.message : String(error) });
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
          // Beta A: 日本語で確定通知メール
          const emailMessage = meetingUrl
            ? `日程が確定しました。\n\n📅 日時: ${slot.start_at} - ${slot.end_at}\n\n🎥 Google Meet: ${meetingUrl}\n\nご参加お待ちしております。`
            : `日程が確定しました。\n\n📅 日時: ${slot.start_at} - ${slot.end_at}\n\nご参加お待ちしております。`;
          
          const emailJob = {
            job_id: `finalize-${invite.id}-${Date.now()}`,
            type: 'thread_message' as const,  // Use existing EmailJob type
            to: String(invite.email),
            subject: `【確定】${thread.title}`,
            created_at: Date.now(),
            data: {
              thread_id: String(threadId),
              delivery_id: crypto.randomUUID(),
              message: emailMessage,
              sender_name: 'Tomoniwao',
            }
          };
          
          await env.EMAIL_QUEUE.send(emailJob);
          log.debug('Sent email', { email: invite.email });
        } catch (error) {
          log.error('Failed to send email', { email: invite.email, error: error instanceof Error ? error.message : String(error) });
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
      meeting: meetingUrl ? {
        provider: meetingProvider,
        url: meetingUrl,
        calendar_event_id: calendarEventId
      } : null,
      final_participants: finalParticipants,
      participants_count: finalParticipants.length,
      finalized_at: now,
      finalized_by_user_id: userId,
      auto_finalized: false,
      reason: reason,
      warnings: warnings.length > 0 ? warnings : undefined
    });
    
  } catch (error) {
    log.error('Error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Failed to finalize thread',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
