/**
 * R1: Internal Scheduling API
 * 
 * Workmate 1:1 scheduling within the app (no external /i/:token links)
 * 
 * Flow:
 * 1. Organizer calls POST /api/scheduling/internal/prepare
 * 2. System calculates freebusy intersection for both users
 * 3. Invitee receives inbox notification
 * 4. Invitee opens thread detail and selects a slot
 * 5. Thread is confirmed, both users see the result
 * 
 * @route POST /api/scheduling/internal/prepare - Start internal scheduling
 * @route GET /api/scheduling/internal/:threadId - Get thread details
 * @route POST /api/scheduling/internal/:threadId/respond - Invitee responds
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';
import { requireAuth, type Variables } from '../middleware/auth';
import { getBatchFreeBusy, type ParticipantInfo } from '../services/freebusyBatch';
import { createRelationshipAccessService } from '../services/relationshipAccess';
import { InboxRepository } from '../repositories/inboxRepository';
import { THREAD_KIND } from '../../../../packages/shared/src/types/thread';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Types
// ============================================================

interface InternalPrepareRequest {
  /** Target user ID (must be a workmate/family with view_freebusy permission) */
  invitee_user_id: string;
  /** Meeting title */
  title: string;
  /** Constraints for slot generation */
  constraints: {
    time_min: string;    // ISO8601
    time_max: string;    // ISO8601
    prefer?: 'morning' | 'afternoon' | 'evening' | 'business' | 'any';
    days?: string[];     // ['mon','tue','wed','thu','fri']
    duration?: number;   // minutes, default 60
    candidate_count?: number; // default 3, max 5
  };
  /** Optional description */
  description?: string;
}

interface InternalPrepareResponse {
  success: boolean;
  thread_id: string;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  inbox_item_id: string;
  message_for_chat: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Calculate time window from constraints
 */
function calculateTimeWindow(constraints: InternalPrepareRequest['constraints']) {
  const now = new Date();
  const timezone = 'Asia/Tokyo';
  
  // Default: tomorrow to 2 weeks from now
  let timeMin = constraints.time_min;
  let timeMax = constraints.time_max;
  
  if (!timeMin) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    timeMin = tomorrow.toISOString();
  }
  
  if (!timeMax) {
    const twoWeeks = new Date(now);
    twoWeeks.setDate(twoWeeks.getDate() + 14);
    twoWeeks.setHours(23, 59, 59, 999);
    timeMax = twoWeeks.toISOString();
  }
  
  return { timeMin, timeMax, timezone };
}

/**
 * Get user display name
 */
async function getUserDisplayName(db: D1Database, userId: string): Promise<string> {
  const user = await db
    .prepare('SELECT display_name, email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ display_name: string | null; email: string }>();
  
  return user?.display_name || user?.email || 'ユーザー';
}

// ============================================================
// POST /api/scheduling/internal/prepare
// Start internal scheduling with a workmate/family
// ============================================================
app.post('/prepare', requireAuth, async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingInternal', handler: 'prepare' });
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'unauthorized', message: '認証が必要です' }, 401);
  }
  
  // Parse request body
  let body: InternalPrepareRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_request', message: 'リクエストボディが不正です' }, 400);
  }
  
  // Validate required fields
  const { invitee_user_id, title, constraints } = body;
  
  if (!invitee_user_id || !title || !constraints) {
    return c.json({ 
      error: 'invalid_request', 
      message: 'invitee_user_id, title, constraints は必須です' 
    }, 400);
  }
  
  if (!constraints.time_min || !constraints.time_max) {
    return c.json({
      error: 'invalid_request',
      message: 'constraints.time_min と constraints.time_max は必須です'
    }, 400);
  }
  
  // Cannot schedule with self
  if (invitee_user_id === userId) {
    return c.json({
      error: 'invalid_request',
      message: '自分自身との日程調整はできません'
    }, 400);
  }
  
  log.info('Internal scheduling prepare started', { 
    organizer: userId, 
    invitee: invitee_user_id,
    title 
  });
  
  // ============================================================
  // 1. Permission check (view_freebusy required)
  // ============================================================
  const accessService = createRelationshipAccessService(env.DB);
  
  try {
    // This throws 403 if no permission
    await accessService.requirePermission(userId, invitee_user_id, 'view_freebusy');
  } catch (error: any) {
    log.warn('Permission denied for internal scheduling', { 
      organizer: userId, 
      invitee: invitee_user_id,
      error: error.message
    });
    return c.json({
      error: 'no_permission',
      message: 'この相手の空き時間を見る権限がありません。先につながり申請を行ってください。'
    }, 403);
  }
  
  // ============================================================
  // 2. Verify invitee exists
  // ============================================================
  const inviteeUser = await env.DB
    .prepare('SELECT id, display_name, email FROM users WHERE id = ?')
    .bind(invitee_user_id)
    .first<{ id: string; display_name: string | null; email: string }>();
  
  if (!inviteeUser) {
    return c.json({
      error: 'user_not_found',
      message: '指定されたユーザーが見つかりません'
    }, 404);
  }
  
  // ============================================================
  // 3. Calculate freebusy intersection
  // ============================================================
  const { timeMin, timeMax, timezone } = calculateTimeWindow(constraints);
  const duration = constraints.duration || 60;
  const candidateCount = Math.min(constraints.candidate_count || 3, 5);
  
  const participants: ParticipantInfo[] = [
    { type: 'self', userId: userId },
    { type: 'app_user', userId: invitee_user_id, email: inviteeUser.email }
  ];
  
  let freebusyResult;
  try {
    freebusyResult = await getBatchFreeBusy(env.DB, env, {
      organizerUserId: userId,
      participants,
      timeMin,
      timeMax,
      meetingLengthMin: duration,
      stepMin: 30,
      maxResults: candidateCount * 3, // Get extra to allow filtering
      prefer: constraints.prefer,
      timezone,
      isThreadContext: false  // R1: Force permission check
    });
  } catch (error: any) {
    log.error('Freebusy calculation failed', { error: error.message });
    return c.json({
      error: 'freebusy_error',
      message: '空き時間の計算に失敗しました。しばらく待ってから再試行してください。'
    }, 500);
  }
  
  // Check if we have enough slots
  const availableSlots = freebusyResult.available_slots.slice(0, candidateCount);
  
  if (availableSlots.length === 0) {
    log.warn('No common slots found', { 
      organizer: userId, 
      invitee: invitee_user_id,
      excluded_count: freebusyResult.excluded_count,
      warning: freebusyResult.warning
    });
    return c.json({
      error: 'no_common_slots',
      message: '共通の空き時間が見つかりませんでした。条件を変更して再度お試しください。',
      details: {
        excluded_count: freebusyResult.excluded_count,
        warning: freebusyResult.warning
      }
    }, 400);
  }
  
  // ============================================================
  // 4. Create scheduling_thread with kind='internal'
  // ============================================================
  const threadId = uuidv4();
  const now = new Date().toISOString();
  
  try {
    await env.DB
      .prepare(`
        INSERT INTO scheduling_threads (
          id, organizer_user_id, title, description, status, kind, 
          mode, proposal_version, timezone, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'sent', 'internal', 'one_on_one', 1, ?, ?, ?)
      `)
      .bind(
        threadId,
        userId,
        title,
        body.description || null,
        timezone,
        now,
        now
      )
      .run();
  } catch (error: any) {
    log.error('Failed to create thread', { error: error.message });
    return c.json({
      error: 'db_error',
      message: 'スレッドの作成に失敗しました'
    }, 500);
  }
  
  // ============================================================
  // 5. Create scheduling_slots
  // ============================================================
  const slotInserts: Array<{ slot_id: string; start_at: string; end_at: string }> = [];
  
  for (const slot of availableSlots) {
    const slotId = uuidv4();
    try {
      await env.DB
        .prepare(`
          INSERT INTO scheduling_slots (
            id, thread_id, start_time, end_time, timezone, status, proposal_version, created_at
          ) VALUES (?, ?, ?, ?, ?, 'available', 1, ?)
        `)
        .bind(slotId, threadId, slot.start_at, slot.end_at, timezone, now)
        .run();
      
      slotInserts.push({
        slot_id: slotId,
        start_at: slot.start_at,
        end_at: slot.end_at
      });
    } catch (error: any) {
      log.error('Failed to create slot', { error: error.message });
    }
  }
  
  // ============================================================
  // 6. Create thread_participants
  // ============================================================
  const organizerParticipantId = uuidv4();
  const inviteeParticipantId = uuidv4();
  
  try {
    // Organizer as owner
    await env.DB
      .prepare(`
        INSERT INTO thread_participants (id, thread_id, user_id, role, joined_at)
        VALUES (?, ?, ?, 'owner', ?)
      `)
      .bind(organizerParticipantId, threadId, userId, now)
      .run();
    
    // Invitee as member
    await env.DB
      .prepare(`
        INSERT INTO thread_participants (id, thread_id, user_id, email, role, joined_at)
        VALUES (?, ?, ?, ?, 'member', ?)
      `)
      .bind(inviteeParticipantId, threadId, invitee_user_id, inviteeUser.email, now)
      .run();
  } catch (error: any) {
    log.error('Failed to create participants', { error: error.message });
    // Continue - thread is created, participants are nice-to-have for now
  }
  
  // ============================================================
  // 7. Create inbox notification for invitee
  // ============================================================
  const organizerName = await getUserDisplayName(env.DB, userId);
  const inboxRepo = new InboxRepository(env.DB);
  
  let inboxItemId: string;
  try {
    inboxItemId = await inboxRepo.create({
      user_id: invitee_user_id,
      type: 'scheduling_request_received',
      title: '日程調整の依頼',
      message: `${organizerName}さんから「${title}」の日程調整依頼が届きました`,
      action_type: 'scheduling_respond',
      action_target_id: threadId,
      action_url: `/scheduling/${threadId}`,
      priority: 'high'
    });
    
    log.info('Inbox notification created', { inboxItemId, invitee: invitee_user_id });
  } catch (error: any) {
    log.error('Failed to create inbox notification', { error: error.message });
    inboxItemId = 'error-creating-inbox';
  }
  
  // ============================================================
  // 8. Return response
  // ============================================================
  const response: InternalPrepareResponse = {
    success: true,
    thread_id: threadId,
    slots: slotInserts,
    inbox_item_id: inboxItemId,
    message_for_chat: `${inviteeUser.display_name || inviteeUser.email}さんに候補を送りました。相手がアプリ内で選択すると確定します。`
  };
  
  log.info('Internal scheduling prepare completed', { 
    threadId, 
    slotCount: slotInserts.length,
    inboxItemId
  });
  
  return c.json(response, 201);
});

// ============================================================
// GET /api/scheduling/internal/:threadId
// Get thread details (for both organizer and invitee)
// ============================================================
app.get('/:threadId', requireAuth, async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingInternal', handler: 'detail' });
  const userId = c.get('userId');
  const threadId = c.req.param('threadId');
  
  if (!userId) {
    return c.json({ error: 'unauthorized', message: '認証が必要です' }, 401);
  }
  
  // Get thread
  const thread = await env.DB
    .prepare(`
      SELECT id, organizer_user_id, title, description, status, kind, 
             mode, proposal_version, timezone, created_at, updated_at
      FROM scheduling_threads
      WHERE id = ? AND kind = 'internal'
    `)
    .bind(threadId)
    .first<{
      id: string;
      organizer_user_id: string;
      title: string;
      description: string | null;
      status: string;
      kind: string;
      mode: string;
      proposal_version: number;
      timezone: string;
      created_at: string;
      updated_at: string;
    }>();
  
  if (!thread) {
    return c.json({ error: 'not_found', message: 'スレッドが見つかりません' }, 404);
  }
  
  // Check if user is a participant
  const participant = await env.DB
    .prepare(`
      SELECT id, role FROM thread_participants
      WHERE thread_id = ? AND user_id = ?
    `)
    .bind(threadId, userId)
    .first<{ id: string; role: string }>();
  
  if (!participant) {
    return c.json({ 
      error: 'forbidden', 
      message: 'このスレッドへのアクセス権限がありません' 
    }, 403);
  }
  
  // Get all participants
  const participantsResult = await env.DB
    .prepare(`
      SELECT tp.id, tp.user_id, tp.email, tp.role,
             u.display_name, u.email as user_email
      FROM thread_participants tp
      LEFT JOIN users u ON tp.user_id = u.id
      WHERE tp.thread_id = ?
    `)
    .bind(threadId)
    .all<{
      id: string;
      user_id: string | null;
      email: string | null;
      role: string;
      display_name: string | null;
      user_email: string | null;
    }>();
  
  // Get slots
  const slotsResult = await env.DB
    .prepare(`
      SELECT id, start_time, end_time, timezone, status, proposal_version
      FROM scheduling_slots
      WHERE thread_id = ? AND proposal_version = ?
      ORDER BY start_time ASC
    `)
    .bind(threadId, thread.proposal_version)
    .all<{
      id: string;
      start_time: string;
      end_time: string;
      timezone: string;
      status: string;
      proposal_version: number;
    }>();
  
  // Get selections (if any)
  const selectionsResult = await env.DB
    .prepare(`
      SELECT ts.id, ts.slot_id, ts.status, ts.created_at,
             tp.user_id as selector_user_id
      FROM thread_selections ts
      LEFT JOIN thread_participants tp ON ts.invite_id = tp.id
      WHERE ts.thread_id = ? AND ts.proposal_version = ?
    `)
    .bind(threadId, thread.proposal_version)
    .all<{
      id: string;
      slot_id: string;
      status: string;
      created_at: string;
      selector_user_id: string | null;
    }>();
  
  return c.json({
    thread: {
      id: thread.id,
      organizer_user_id: thread.organizer_user_id,
      title: thread.title,
      description: thread.description,
      status: thread.status,
      kind: thread.kind,
      mode: thread.mode,
      proposal_version: thread.proposal_version,
      timezone: thread.timezone,
      created_at: thread.created_at,
      updated_at: thread.updated_at
    },
    participants: (participantsResult.results || []).map(p => ({
      id: p.id,
      user_id: p.user_id,
      email: p.email || p.user_email,
      display_name: p.display_name,
      role: p.role,
      is_me: p.user_id === userId
    })),
    slots: (slotsResult.results || []).map(s => ({
      slot_id: s.id,
      start_at: s.start_time,
      end_at: s.end_time,
      timezone: s.timezone,
      status: s.status
    })),
    selections: (selectionsResult.results || []).map(s => ({
      id: s.id,
      slot_id: s.slot_id,
      status: s.status,
      selector_user_id: s.selector_user_id,
      created_at: s.created_at
    })),
    my_role: participant.role
  });
});

// ============================================================
// POST /api/scheduling/internal/:threadId/respond
// Invitee selects a slot (R1-API-2 scope, stub for now)
// ============================================================
app.post('/:threadId/respond', requireAuth, async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'SchedulingInternal', handler: 'respond' });
  const userId = c.get('userId');
  const threadId = c.req.param('threadId');
  
  if (!userId) {
    return c.json({ error: 'unauthorized', message: '認証が必要です' }, 401);
  }
  
  // Parse request
  let body: { selected_slot_id: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_request', message: 'リクエストボディが不正です' }, 400);
  }
  
  if (!body.selected_slot_id) {
    return c.json({ error: 'invalid_request', message: 'selected_slot_id は必須です' }, 400);
  }
  
  // Get thread
  const thread = await env.DB
    .prepare(`
      SELECT id, organizer_user_id, title, status, kind, proposal_version
      FROM scheduling_threads
      WHERE id = ? AND kind = 'internal'
    `)
    .bind(threadId)
    .first<{
      id: string;
      organizer_user_id: string;
      title: string;
      status: string;
      kind: string;
      proposal_version: number;
    }>();
  
  if (!thread) {
    return c.json({ error: 'not_found', message: 'スレッドが見つかりません' }, 404);
  }
  
  if (thread.status === 'confirmed') {
    return c.json({ error: 'already_confirmed', message: 'この日程調整は既に確定しています' }, 400);
  }
  
  if (thread.status === 'cancelled') {
    return c.json({ error: 'cancelled', message: 'この日程調整はキャンセルされています' }, 400);
  }
  
  // Check if user is invitee (not organizer)
  const participant = await env.DB
    .prepare(`
      SELECT id, role FROM thread_participants
      WHERE thread_id = ? AND user_id = ?
    `)
    .bind(threadId, userId)
    .first<{ id: string; role: string }>();
  
  if (!participant) {
    return c.json({ error: 'forbidden', message: 'このスレッドへのアクセス権限がありません' }, 403);
  }
  
  if (participant.role === 'owner') {
    return c.json({ 
      error: 'invalid_request', 
      message: '主催者は候補を選択できません。相手の選択をお待ちください。' 
    }, 400);
  }
  
  // Verify slot exists
  const slot = await env.DB
    .prepare(`
      SELECT id, start_time, end_time, timezone
      FROM scheduling_slots
      WHERE id = ? AND thread_id = ? AND proposal_version = ?
    `)
    .bind(body.selected_slot_id, threadId, thread.proposal_version)
    .first<{ id: string; start_time: string; end_time: string; timezone: string }>();
  
  if (!slot) {
    return c.json({ error: 'invalid_slot', message: '指定された候補が見つかりません' }, 400);
  }
  
  const now = new Date().toISOString();
  
  // ============================================================
  // 1. Create thread_selection
  // ============================================================
  const selectionId = uuidv4();
  try {
    await env.DB
      .prepare(`
        INSERT INTO thread_selections (id, thread_id, invite_id, slot_id, status, proposal_version, created_at)
        VALUES (?, ?, ?, ?, 'selected', ?, ?)
      `)
      .bind(selectionId, threadId, participant.id, slot.id, thread.proposal_version, now)
      .run();
  } catch (error: any) {
    log.error('Failed to create selection', { error: error.message });
    return c.json({ error: 'db_error', message: '選択の記録に失敗しました' }, 500);
  }
  
  // ============================================================
  // 2. Update thread status to confirmed
  // ============================================================
  try {
    await env.DB
      .prepare(`
        UPDATE scheduling_threads
        SET status = 'confirmed', updated_at = ?
        WHERE id = ?
      `)
      .bind(now, threadId)
      .run();
  } catch (error: any) {
    log.error('Failed to update thread status', { error: error.message });
  }
  
  // ============================================================
  // 3. Update slot status to selected
  // ============================================================
  try {
    await env.DB
      .prepare(`
        UPDATE scheduling_slots
        SET status = 'selected'
        WHERE id = ?
      `)
      .bind(slot.id)
      .run();
  } catch (error: any) {
    log.error('Failed to update slot status', { error: error.message });
  }
  
  // ============================================================
  // 4. Create inbox notifications for both parties
  // ============================================================
  const inboxRepo = new InboxRepository(env.DB);
  const inviteeName = await getUserDisplayName(env.DB, userId);
  const organizerName = await getUserDisplayName(env.DB, thread.organizer_user_id);
  
  // Notification for organizer
  try {
    await inboxRepo.create({
      user_id: thread.organizer_user_id,
      type: 'scheduling_confirmed',
      title: '日程が確定しました',
      message: `${inviteeName}さんが「${thread.title}」の日程を選択しました`,
      action_type: 'view_thread',
      action_target_id: threadId,
      action_url: `/scheduling/${threadId}`,
      priority: 'high'
    });
  } catch (error: any) {
    log.error('Failed to create organizer notification', { error: error.message });
  }
  
  // Notification for invitee (confirmation)
  try {
    await inboxRepo.create({
      user_id: userId,
      type: 'scheduling_confirmed',
      title: '日程が確定しました',
      message: `「${thread.title}」の日程が確定しました`,
      action_type: 'view_thread',
      action_target_id: threadId,
      action_url: `/scheduling/${threadId}`,
      priority: 'normal'
    });
  } catch (error: any) {
    log.error('Failed to create invitee notification', { error: error.message });
  }
  
  log.info('Internal scheduling confirmed', { 
    threadId, 
    selectedSlotId: slot.id,
    invitee: userId,
    organizer: thread.organizer_user_id
  });
  
  return c.json({
    success: true,
    thread_status: 'confirmed',
    confirmed_slot: {
      slot_id: slot.id,
      start_at: slot.start_time,
      end_at: slot.end_time,
      timezone: slot.timezone
    },
    message: '日程が確定しました'
  });
});

export default app;
