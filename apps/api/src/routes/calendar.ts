/**
 * Calendar API Routes (Phase Next-3 Day2)
 * Read-only calendar access: today, week, freebusy
 * 
 * @route GET /api/calendar/today
 * @route GET /api/calendar/week
 * @route GET /api/calendar/freebusy
 */

import { Hono } from 'hono';
import { getUserIdLegacy } from '../middleware/auth';
import { GoogleCalendarService } from '../services/googleCalendar';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * Helper: Get today's time bounds (JST)
 */
function getTodayBounds(timezone: string = 'Asia/Tokyo'): { timeMin: string; timeMax: string } {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  
  // Today 00:00:00 JST
  const todayStart = new Date(now.getTime() + jstOffset);
  todayStart.setUTCHours(0, 0, 0, 0);
  
  // Today 23:59:59 JST
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCHours(23, 59, 59, 999);
  
  return {
    timeMin: todayStart.toISOString(),
    timeMax: todayEnd.toISOString(),
  };
}

/**
 * Helper: Get this week's time bounds (Monday - Sunday JST)
 */
function getWeekBounds(timezone: string = 'Asia/Tokyo'): { timeMin: string; timeMax: string } {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  
  // Calculate Monday 00:00:00 JST
  const dayOfWeek = now.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as start
  
  const weekStart = new Date(now.getTime() + jstOffset);
  weekStart.setUTCDate(weekStart.getUTCDate() + diff);
  weekStart.setUTCHours(0, 0, 0, 0);
  
  // Calculate Sunday 23:59:59 JST
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);
  
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
  const userId = await getUserIdLegacy(c as any);

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
  const userId = await getUserIdLegacy(c as any);

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
 * GET /api/calendar/freebusy?range=today|week
 * Returns free/busy time slots
 * Phase Next-3: Stub for now (Day3 implementation)
 */
app.get('/freebusy', async (c) => {
  const { env } = c;
  const userId = await getUserIdLegacy(c as any);
  const range = c.req.query('range') || 'today'; // today | week

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    console.log('[Calendar] GET /freebusy - userId:', userId, 'range:', range);

    // TODO: Day3 - Implement Google Calendar FreeBusy API
    // For now, return stub data
    const now = new Date();

    return c.json({
      range,
      timezone: 'Asia/Tokyo',
      free: [
        // Stub data - free slots
        {
          start: new Date(now.setHours(9, 0, 0, 0)).toISOString(),
          end: new Date(now.setHours(10, 0, 0, 0)).toISOString(),
        },
        {
          start: new Date(now.setHours(15, 0, 0, 0)).toISOString(),
          end: new Date(now.setHours(17, 0, 0, 0)).toISOString(),
        },
      ],
      busy: [
        // Stub data - busy slots (no details, just time ranges)
        {
          start: new Date(now.setHours(10, 0, 0, 0)).toISOString(),
          end: new Date(now.setHours(11, 0, 0, 0)).toISOString(),
        },
      ],
    });
  } catch (error) {
    console.error('[Calendar] Error fetching freebusy:', error);
    return c.json({ error: 'Failed to fetch free/busy information' }, 500);
  }
});

export default app;
