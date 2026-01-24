/**
 * Calendar API Routes (Phase Next-3 Day2 + P3-SLOTGEN1)
 * Read-only calendar access: today, week, freebusy
 * 
 * @route GET /api/calendar/today
 * @route GET /api/calendar/week
 * @route GET /api/calendar/freebusy
 */

import { Hono } from 'hono';
import { GoogleCalendarService } from '../services/googleCalendar';
import { generateAvailableSlots, getTimeWindowFromPrefer } from '../utils/slotGenerator';
import { getBatchFreeBusy, getThreadParticipants } from '../services/freebusyBatch';
import type { ParticipantInfo } from '../services/freebusyBatch';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createThreadFailuresRepository } from '../repositories/threadFailuresRepository';
import { getTenant } from '../utils/workspaceContext';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Helper: Get today's time bounds (JST)
 * FIXED: Correctly convert JST midnight to UTC
 */
function getTodayBounds(timezone: string = 'Asia/Tokyo'): { timeMin: string; timeMax: string } {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  
  // Get current time in JST
  const jstNow = new Date(now.getTime() + jstOffset);
  
  // JST today 00:00:00
  jstNow.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(jstNow.getTime() - jstOffset); // Convert back to UTC
  
  // JST today 23:59:59
  jstNow.setUTCHours(23, 59, 59, 999);
  const todayEnd = new Date(jstNow.getTime() - jstOffset); // Convert back to UTC
  
  return {
    timeMin: todayStart.toISOString(),
    timeMax: todayEnd.toISOString(),
  };
}

/**
 * Helper: Get this week's time bounds (Monday - Sunday JST)
 * FIXED: Correctly convert JST week bounds to UTC
 */
function getWeekBounds(timezone: string = 'Asia/Tokyo'): { timeMin: string; timeMax: string } {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  
  // Get current time in JST
  const jstNow = new Date(now.getTime() + jstOffset);
  
  // Calculate day of week in JST
  const dayOfWeek = jstNow.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as start
  
  // Monday 00:00:00 JST
  jstNow.setUTCDate(jstNow.getUTCDate() + diff);
  jstNow.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(jstNow.getTime() - jstOffset); // Convert back to UTC
  
  // Sunday 23:59:59 JST
  jstNow.setUTCDate(jstNow.getUTCDate() + 6);
  jstNow.setUTCHours(23, 59, 59, 999);
  const weekEnd = new Date(jstNow.getTime() - jstOffset); // Convert back to UTC
  
  return {
    timeMin: weekStart.toISOString(),
    timeMax: weekEnd.toISOString(),
  };
}

/**
 * Helper: Get next week's time bounds (Monday - Sunday JST)
 * P3-SLOTGEN1: For "来週" queries
 */
function getNextWeekBounds(timezone: string = 'Asia/Tokyo'): { timeMin: string; timeMax: string } {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  
  // Get current time in JST
  const jstNow = new Date(now.getTime() + jstOffset);
  
  // Calculate day of week in JST
  const dayOfWeek = jstNow.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as start
  
  // Next week's Monday 00:00:00 JST (current Monday + 7 days)
  jstNow.setUTCDate(jstNow.getUTCDate() + diff + 7);
  jstNow.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(jstNow.getTime() - jstOffset); // Convert back to UTC
  
  // Next week's Sunday 23:59:59 JST
  jstNow.setUTCDate(jstNow.getUTCDate() + 6);
  jstNow.setUTCHours(23, 59, 59, 999);
  const weekEnd = new Date(jstNow.getTime() - jstOffset); // Convert back to UTC
  
  return {
    timeMin: weekStart.toISOString(),
    timeMax: weekEnd.toISOString(),
  };
}

/**
 * GET /api/calendar/today
 * Returns today's calendar events
 * Phase Next-3 Day2: Real Google Calendar integration
 */
app.get('/today', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    console.log('[Calendar] GET /today - userId:', userId);

    // Get access token
    const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, userId, env);
    if (!accessToken) {
      // No Google account linked - return empty with warning
      return c.json({
        range: 'today',
        timezone: 'Asia/Tokyo',
        events: [],
        warning: 'google_account_not_linked',
      });
    }

    // Calculate today's bounds (JST)
    const { timeMin, timeMax } = getTodayBounds('Asia/Tokyo');

    // Fetch events
    const calendarService = new GoogleCalendarService(accessToken, env);
    const { events, error } = await calendarService.fetchEvents(timeMin, timeMax, 'Asia/Tokyo');

    if (error === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (error === 'google_calendar_permission_missing') {
      return c.json({
        range: 'today',
        timezone: 'Asia/Tokyo',
        events: [],
        warning: 'google_calendar_permission_missing',
      });
    }

    return c.json({
      range: 'today',
      timezone: 'Asia/Tokyo',
      events,
    });
  } catch (error) {
    console.error('[Calendar] Error fetching today:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/calendar/week
 * Returns this week's calendar events (Monday - Sunday)
 * Phase Next-3 Day2: Real Google Calendar integration
 */
app.get('/week', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    console.log('[Calendar] GET /week - userId:', userId);

    // Get access token
    const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, userId, env);
    if (!accessToken) {
      // No Google account linked - return empty with warning
      return c.json({
        range: 'week',
        timezone: 'Asia/Tokyo',
        events: [],
        warning: 'google_account_not_linked',
      });
    }

    // Calculate this week's bounds (Monday - Sunday JST)
    const { timeMin, timeMax } = getWeekBounds('Asia/Tokyo');

    // Fetch events
    const calendarService = new GoogleCalendarService(accessToken, env);
    const { events, error } = await calendarService.fetchEvents(timeMin, timeMax, 'Asia/Tokyo');

    if (error === 'Unauthorized') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (error === 'google_calendar_permission_missing') {
      return c.json({
        range: 'week',
        timezone: 'Asia/Tokyo',
        events: [],
        warning: 'google_calendar_permission_missing',
      });
    }

    return c.json({
      range: 'week',
      timezone: 'Asia/Tokyo',
      events,
    });
  } catch (error) {
    console.error('[Calendar] Error fetching week:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/calendar/freebusy?range=today|week|next_week&prefer=afternoon|morning|evening|business
 * Returns busy time slots + available slots (P3-SLOTGEN1)
 * 
 * @query range - 'today' | 'week' | 'next_week' (default: 'today')
 * @query prefer - 'morning' | 'afternoon' | 'evening' | 'business' (optional time window filter)
 * @query meeting_length - meeting duration in minutes (default: 60)
 */
app.get('/freebusy', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const range = c.req.query('range') || 'today'; // today | week | next_week
  const prefer = c.req.query('prefer'); // morning | afternoon | evening | business
  const meetingLengthParam = c.req.query('meeting_length');
  const meetingLength = meetingLengthParam ? parseInt(meetingLengthParam, 10) : 60;

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    console.log('[Calendar] GET /freebusy - userId:', userId, 'range:', range, 'prefer:', prefer);

    // Get access token
    const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, userId, env);
    if (!accessToken) {
      // No Google account linked - return empty with warning
      return c.json({
        range,
        timezone: 'Asia/Tokyo',
        busy: [],
        available_slots: [],
        warning: 'google_account_not_linked',
      });
    }

    // Calculate time bounds based on range
    let timeMin: string;
    let timeMax: string;

    if (range === 'next_week') {
      const bounds = getNextWeekBounds('Asia/Tokyo');
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    } else if (range === 'week') {
      const bounds = getWeekBounds('Asia/Tokyo');
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    } else {
      // Default: today
      const bounds = getTodayBounds('Asia/Tokyo');
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    }

    // Fetch busy periods from Google Calendar
    const calendarService = new GoogleCalendarService(accessToken, env);
    const busy = await calendarService.getFreeBusy(timeMin, timeMax);

    // P3-SLOTGEN1: Generate available slots
    const dayTimeWindow = getTimeWindowFromPrefer(prefer);
    const slotResult = generateAvailableSlots({
      timeMin,
      timeMax,
      busy,
      meetingLengthMin: meetingLength,
      stepMin: 30,
      maxResults: 8,
      dayTimeWindow,
      timezone: 'Asia/Tokyo',
    });

    return c.json({
      range,
      timezone: 'Asia/Tokyo',
      busy,
      available_slots: slotResult.available_slots,
      coverage: slotResult.coverage,
      prefer: prefer || null,
      warning: null,
    });
  } catch (error) {
    console.error('[Calendar] Error fetching freebusy:', error);
    
    // Check if it's a permission error
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('403') || errorMessage.includes('permission')) {
      return c.json({
        range,
        timezone: 'Asia/Tokyo',
        busy: [],
        available_slots: [],
        warning: 'google_calendar_permission_missing',
      });
    }

    // Generic error
    return c.json({
      range,
      timezone: 'Asia/Tokyo',
      busy: [],
      available_slots: [],
      warning: 'fetch_error',
    });
  }
});

/**
 * POST /api/calendar/freebusy/batch
 * P3-INTERSECT1: 複数参加者の共通空き枠を計算
 * 
 * @body threadId - スレッドIDから参加者を自動取得（優先）
 * @body participants - 参加者リスト（threadIdがない場合に使用）
 * @body range - 'today' | 'week' | 'next_week' (default: 'week')
 * @body prefer - 'morning' | 'afternoon' | 'evening' | 'business' (optional)
 * @body meeting_length - ミーティング長（分、default: 60）
 */
app.post('/freebusy/batch', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      threadId?: string;
      participants?: ParticipantInfo[];
      range?: 'today' | 'week' | 'next_week';
      prefer?: string;
      meeting_length?: number;
    }>();

    const range = body.range || 'week';
    const prefer = body.prefer;
    const meetingLength = body.meeting_length || 60;

    console.log('[Calendar] POST /freebusy/batch - userId:', userId, 'range:', range, 'prefer:', prefer);

    // 1. 参加者リストを取得
    let participants: ParticipantInfo[];
    
    if (body.threadId) {
      // スレッドから参加者を取得
      participants = await getThreadParticipants(env.DB, body.threadId, userId);
    } else if (body.participants && body.participants.length > 0) {
      // 直接指定された参加者を使用
      participants = body.participants;
    } else {
      // 主催者のみ
      participants = [{ type: 'self', userId }];
    }

    // 2. 期間を計算
    let timeMin: string;
    let timeMax: string;

    if (range === 'next_week') {
      const bounds = getNextWeekBounds('Asia/Tokyo');
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    } else if (range === 'week') {
      const bounds = getWeekBounds('Asia/Tokyo');
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    } else {
      const bounds = getTodayBounds('Asia/Tokyo');
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    }

    // 3. バッチfreebusyを実行
    const result = await getBatchFreeBusy(env.DB, env, {
      organizerUserId: userId,
      participants,
      timeMin,
      timeMax,
      meetingLengthMin: meetingLength,
      stepMin: 30,
      maxResults: 8,
      prefer,
      timezone: 'Asia/Tokyo',
    });

    // FAIL-1: スレッドに関連付けた空き検索で候補0件の場合、失敗を記録
    let failureSummary = null;
    if (body.threadId && result.available_slots.length === 0) {
      try {
        const { workspaceId, ownerUserId } = getTenant(c);
        const failuresRepo = createThreadFailuresRepository(env.DB);
        
        await failuresRepo.incrementFailure({
          workspaceId,
          ownerUserId,
          threadId: body.threadId,
          type: 'no_common_slot',
          stage: 'propose',
          meta: {
            range,
            prefer: prefer || null,
            meeting_length: meetingLength,
            linked_count: result.linked_count,
            excluded_count: result.excluded_count,
          },
        });
        
        // 更新後のサマリーを取得
        failureSummary = await failuresRepo.getFailureSummaryByThread(body.threadId);
        console.log('[Calendar] FAIL-1: No common slots found, failure recorded for thread:', body.threadId);
      } catch (failError) {
        // 失敗記録のエラーはログのみ（メイン処理を止めない）
        console.error('[Calendar] FAIL-1: Error recording failure:', failError);
      }
    }

    return c.json({
      range,
      timezone: 'Asia/Tokyo',
      available_slots: result.available_slots,
      scored_slots: result.scored_slots,
      busy_union: result.busy_union,
      per_participant: result.per_participant,
      coverage: result.coverage,
      excluded_count: result.excluded_count,
      linked_count: result.linked_count,
      prefer: result.prefer,
      warning: result.warning,
      has_preferences: result.has_preferences,
      // FAIL-1: 失敗サマリーを追加（候補0件の場合のみ）
      failure_summary: failureSummary,
    });
  } catch (error) {
    console.error('[Calendar] Error in freebusy/batch:', error);
    return c.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
