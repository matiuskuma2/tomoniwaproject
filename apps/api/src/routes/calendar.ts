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
 * Returns busy time slots (Day3: busy-only implementation)
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

    // Get access token
    const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, userId, env);
    if (!accessToken) {
      // No Google account linked - return empty with warning
      return c.json({
        range,
        timezone: 'Asia/Tokyo',
        busy: [],
        warning: 'google_account_not_linked',
      });
    }

    // Calculate time bounds based on range
    let timeMin: string;
    let timeMax: string;

    if (range === 'week') {
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

    return c.json({
      range,
      timezone: 'Asia/Tokyo',
      busy,
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
        warning: 'google_calendar_permission_missing',
      });
    }

    // Generic error
    return c.json({
      range,
      timezone: 'Asia/Tokyo',
      busy: [],
      warning: 'fetch_error',
    });
  }
});

export default app;
