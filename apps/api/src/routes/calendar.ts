/**
 * Calendar API Routes (Phase Next-3)
 * Read-only calendar access: today, week, freebusy
 * 
 * @route GET /api/calendar/today
 * @route GET /api/calendar/week
 * @route GET /api/calendar/freebusy
 */

import { Hono } from 'hono';
import { getUserIdLegacy } from '../middleware/auth';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * Get today's calendar events
 * 
 * @route GET /api/calendar/today
 * @returns { range: "today", timezone: string, events: Event[] }
 */
app.get('/today', async (c) => {
  const { env } = c;
  const userId = await getUserIdLegacy(c as any);

  try {
    console.log('[Calendar] GET /today - userId:', userId);

    // TODO: Implement Google Calendar API integration
    // For now, return stub data
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    return c.json({
      range: 'today',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
      events: [
        // Stub data - will be replaced with actual Google Calendar API calls
        {
          id: 'stub-event-1',
          start: new Date(now.setHours(10, 0, 0, 0)).toISOString(),
          end: new Date(now.setHours(11, 0, 0, 0)).toISOString(),
          summary: 'Morning Meeting (stub)',
          meet_url: null,
        },
      ],
    });
  } catch (error) {
    console.error('[Calendar] Error fetching today:', error);
    return c.json({ error: 'Failed to fetch today\'s calendar' }, 500);
  }
});

/**
 * Get this week's calendar events (Monday - Sunday)
 * 
 * @route GET /api/calendar/week
 * @returns { range: "week", timezone: string, events: Event[] }
 */
app.get('/week', async (c) => {
  const { env } = c;
  const userId = await getUserIdLegacy(c as any);

  try {
    console.log('[Calendar] GET /week - userId:', userId);

    // TODO: Implement Google Calendar API integration
    // Calculate this week (Monday - Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 (Sun) - 6 (Sat)
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as start
    
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return c.json({
      range: 'week',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
      events: [
        // Stub data - will be replaced with actual Google Calendar API calls
        {
          id: 'stub-event-week-1',
          start: new Date(now.setHours(14, 0, 0, 0)).toISOString(),
          end: new Date(now.setHours(15, 0, 0, 0)).toISOString(),
          summary: 'Weekly Sync (stub)',
          meet_url: 'https://meet.google.com/stub-meet-url',
        },
      ],
    });
  } catch (error) {
    console.error('[Calendar] Error fetching week:', error);
    return c.json({ error: 'Failed to fetch week\'s calendar' }, 500);
  }
});

/**
 * Get free/busy time slots
 * 
 * @route GET /api/calendar/freebusy?range=today|week
 * @returns { range: string, timezone: string, free: Slot[], busy: Slot[] }
 */
app.get('/freebusy', async (c) => {
  const { env } = c;
  const userId = await getUserIdLegacy(c as any);
  const range = c.req.query('range') || 'today'; // today | week

  try {
    console.log('[Calendar] GET /freebusy - userId:', userId, 'range:', range);

    // TODO: Implement Google Calendar FreeBusy API
    // For now, return stub data
    const now = new Date();

    return c.json({
      range,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
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
