/**
 * Calendar API Routes (Phase Next-3 Day2)
 * Read-only calendar access: today, week, freebusy
 * 
 * @route GET /api/calendar/today
 * @route GET /api/calendar/week
 * @route GET /api/calendar/freebusy
 */

import { Hono } from 'hono';
import { GoogleCalendarService } from '../services/googleCalendar';
import type { Env } from '../../../../packages/shared/src/types/env';

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
 * GET /api/calendar/freebusy?range=today|week
 * Returns free/busy time slots
 * Phase Next-3: Stub for now (Day3 implementation)
 */
app.get('/freebusy', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
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
