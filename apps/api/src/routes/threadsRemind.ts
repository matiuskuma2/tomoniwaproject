/**
 * Phase B: POST /api/threads/:id/remind
 * 
 * Purpose: Send reminder emails to pending invitees
 * Rate Limit: 60 minutes per thread per organizer
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { INBOX_TYPE, INBOX_PRIORITY } from '../../../../packages/shared/src/types/inbox';
import { checkBillingGate } from '../utils/billingGate';
import { getTenant } from '../utils/workspaceContext';
import { sendReminderNotification } from '../services/notificationService';
import { createLogger } from '../utils/logger';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
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
  const log = createLogger(env, { module: 'ThreadsRemind', handler: 'remind' });
  
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
    
    // Parse body (safe)
    let body: any = {};
    try {
      body = await c.req.json();
    } catch (e) {
      // Body is optional
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
    
    // P3-TZ2: スレッドのタイムゾーンを取得（外部ユーザーのフォールバック用）
    const threadTzRow = await env.DB.prepare(
      `SELECT timezone FROM scheduling_threads WHERE id = ? LIMIT 1`
    ).bind(threadId).first<{ timezone: string }>();
    const threadTimeZone = threadTzRow?.timezone || 'Asia/Tokyo';
    
    // P2-B2: リマインドメールは 'reminder' タイプを使用
    // 統一フォーマットで「日程回答のお願い」文面を送信
    for (const invite of pending) {
      try {
        // 期限は招待の expires_at または 72 時間後
        const expiresAt = invite.expires_at 
          ? new Date(invite.expires_at as string).toISOString()
          : new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
        
        const inviteUrl = `${host.includes('localhost') ? 'http' : 'https'}://${host}/i/${invite.token}`;
        
        // P3-TZ2: 受信者のタイムゾーンを解決（アプリユーザー → users.timezone / 外部 → thread.timezone）
        const appUser = await env.DB.prepare(`
          SELECT id, timezone FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1
        `).bind(invite.email).first<{ id: string; timezone: string }>();
        const recipientTimezone = appUser?.timezone || threadTimeZone;
        
        const emailJob = {
          job_id: `remind-${invite.id}-${Date.now()}`,
          type: 'reminder' as const,  // P2-B2: Use 'reminder' type for unified format
          to: String(invite.email),
          subject: `【リマインド】「${thread.title}」日程のご回答をお願いします`,
          created_at: Date.now(),
          data: {
            token: String(invite.token),
            invite_url: inviteUrl,
            thread_title: String(thread.title),
            inviter_name: 'Tomoniwao',  // TODO: get organizer name from user
            custom_message: body.message || null,
            expires_at: expiresAt,
            recipient_timezone: recipientTimezone,  // P3-TZ2: 期限表示用
          }
        };
        
        await env.EMAIL_QUEUE.send(emailJob);
        
        results.push({
          invitee_key: invite.invitee_key,
          email: invite.email,
          status: 'sent'
        });
        
        log.debug('Sent reminder', { email: invite.email });
      } catch (error) {
        log.error('Failed to send reminder', { email: invite.email, error: error instanceof Error ? error.message : String(error) });
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
    // P2-B2: 統一フォーマットで Inbox 通知も整形
    try {
      const inboxId = crypto.randomUUID();
      const inviteeNames = pending
        .slice(0, 3)
        .map((inv: any) => inv.candidate_name || inv.email)
        .join('、');
      const moreCount = pending.length > 3 ? `、他${pending.length - 3}名` : '';
      
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
        `✅ リマインド送信完了：${thread.title}`,
        `${results.length}名にリマインドを送信しました\n対象: ${inviteeNames}${moreCount}`,
        INBOX_PRIORITY.NORMAL
      ).run();
    } catch (error) {
      log.error('Failed to create inbox notification', { error: error instanceof Error ? error.message : String(error) });
      warnings.push({
        type: 'inbox_notification_failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    // ====== P2-E1: Slack通知（並走・失敗しても本処理は落とさない） ======
    if (results.length > 0) {
      try {
        // inviterName を取得
        const inviterRow = await env.DB.prepare(
          `SELECT display_name, email FROM users WHERE id = ?`
        ).bind(userId).first<{ display_name: string | null; email: string }>();
        const inviterName = inviterRow?.display_name || inviterRow?.email || 'Tomoniwao';
        
        await sendReminderNotification(env.DB, workspaceId, {
          inviterName,
          threadTitle: thread.title as string,
          remindedCount: results.length,
          reminderType: 'pending', // デフォルト
        });
      } catch (slackError) {
        log.warn('Slack notification error (ignored)', { error: slackError instanceof Error ? slackError.message : String(slackError) });
      }
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
    log.error('Error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'Failed to send reminders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
