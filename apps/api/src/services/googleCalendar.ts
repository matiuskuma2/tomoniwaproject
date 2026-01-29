/**
 * Google Calendar Service
 * 
 * Handles Google Calendar Event creation with Meet integration.
 * 
 * Phase D-1 ACCESS-3: Proxy Calendar Write Support
 * - createEventOnBehalf() allows writing to another user's calendar
 * - Requires write_calendar permission (family_can_write preset)
 * - Use with RelationshipAccessService.requirePermission() guard
 * 
 * For proxy booking (代理予約), use createProxyEvent() helper which:
 * 1. Checks write_calendar permission
 * 2. Gets target user's access token
 * 3. Creates event on target's calendar
 */

import type { Env } from '../../../../packages/shared/src/types/env';
import { RelationshipAccessService } from './relationshipAccess';

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  hangoutLink?: string;
  htmlLink?: string;
}

export interface CreateEventParams {
  summary: string;
  description?: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  timeZone?: string;
  attendees?: string[]; // Email addresses
  organizerEmail?: string; // Phase 0B: Organizer email for attendees
}

export class GoogleCalendarService {
  constructor(
    private accessToken: string,
    private env: Env
  ) {}

  /**
   * Create a Calendar Event with Google Meet
   * 
   * Phase 0B: Add organizer as attendee + reminders
   */
  async createEventWithMeet(params: CreateEventParams): Promise<CalendarEvent | null> {
    try {
      // Phase 0B: Build attendees list (organizer only for now)
      const attendees = [];
      if (params.organizerEmail) {
        attendees.push({
          email: params.organizerEmail,
          organizer: true,
          responseStatus: 'accepted',
        });
      }
      
      const requestBody = {
        summary: params.summary,
        description: params.description || '',
        start: {
          dateTime: params.start,
          timeZone: params.timeZone || 'Asia/Tokyo',
        },
        end: {
          dateTime: params.end,
          timeZone: params.timeZone || 'Asia/Tokyo',
        },
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet',
            },
          },
        },
        attendees: attendees,
        // Phase 0B: Custom reminders (24 hours + 1 hour before)
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 24 hours before
            { method: 'popup', minutes: 60 },      // 1 hour before
          ],
        },
      };

      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleCalendar] Create event failed:', response.status, errorText);
        return null;
      }

      const event = await response.json() as any;

      return {
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start,
        end: event.end,
        hangoutLink: event.hangoutLink,
        htmlLink: event.htmlLink,
      };
    } catch (error) {
      console.error('[GoogleCalendar] Create event error:', error);
      return null;
    }
  }

  /**
   * Delete a Calendar Event
   */
  async deleteEvent(eventId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      return response.ok || response.status === 404; // 404 = already deleted
    } catch (error) {
      console.error('[GoogleCalendar] Delete event error:', error);
      return false;
    }
  }

  /**
   * Update a Calendar Event
   */
  async updateEvent(eventId: string, params: Partial<CreateEventParams>): Promise<CalendarEvent | null> {
    try {
      const updateBody: any = {};

      if (params.summary) updateBody.summary = params.summary;
      if (params.description !== undefined) updateBody.description = params.description;
      if (params.start && params.end) {
        updateBody.start = {
          dateTime: params.start,
          timeZone: params.timeZone || 'Asia/Tokyo',
        };
        updateBody.end = {
          dateTime: params.end,
          timeZone: params.timeZone || 'Asia/Tokyo',
        };
      }

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateBody),
        }
      );

      if (!response.ok) {
        console.error('[GoogleCalendar] Update event failed:', response.status);
        return null;
      }

      const event = await response.json() as any;

      return {
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start,
        end: event.end,
        hangoutLink: event.hangoutLink,
        htmlLink: event.htmlLink,
      };
    } catch (error) {
      console.error('[GoogleCalendar] Update event error:', error);
      return null;
    }
  }

  /**
   * Fetch calendar events from Google Calendar API (events.list)
   * 
   * Phase Next-3 Day2: Read-only calendar integration
   */
  async fetchEvents(
    timeMin: string, // ISO 8601
    timeMax: string, // ISO 8601
    timezone: string = 'Asia/Tokyo'
  ): Promise<{ events: any[]; error?: string }> {
    try {
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('timeZone', timezone);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '50');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        console.error('[GoogleCalendar] Unauthorized (401)');
        return { events: [], error: 'Unauthorized' };
      }

      if (response.status === 403) {
        console.warn('[GoogleCalendar] Forbidden (403) - Permission missing');
        return { events: [], error: 'google_calendar_permission_missing' };
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleCalendar] Fetch events failed:', response.status, errorText);
        return { events: [], error: 'fetch_failed' };
      }

      const data = await response.json() as any;
      const events = (data.items || []).map((item: any) => ({
        id: item.id,
        summary: item.summary || 'No Title',
        start: item.start?.dateTime || item.start?.date,
        end: item.end?.dateTime || item.end?.date,
        meet_url: item.hangoutLink || null,
      }));

      return { events };
    } catch (error) {
      console.error('[GoogleCalendar] Fetch events error:', error);
      return { events: [], error: 'exception' };
    }
  }

  /**
   * Get user's Google account access token with auto-refresh
   * 
   * Phase 0B: Token refresh implementation
   */
  static async getOrganizerAccessToken(
    db: D1Database,
    organizerUserId: string,
    env: Env
  ): Promise<string | null> {
    try {
      const account = await db
        .prepare(
          `SELECT id, access_token_enc, refresh_token_enc, token_expires_at
           FROM google_accounts
           WHERE user_id = ? AND is_primary = 1
           LIMIT 1`
        )
        .bind(organizerUserId)
        .first<{
          id: string;
          access_token_enc: string;
          refresh_token_enc: string | null;
          token_expires_at: string;
        }>();

      if (!account) {
        console.error('[GoogleCalendar] No Google account found for user:', organizerUserId);
        return null;
      }

      // Check if token is expired or about to expire (within 5 minutes)
      const expiresAt = new Date(account.token_expires_at);
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

      if (expiresAt > fiveMinutesFromNow) {
        // Token is still valid
        return account.access_token_enc;
      }

      // Token expired or about to expire - refresh it
      if (!account.refresh_token_enc) {
        console.error('[GoogleCalendar] No refresh token available for user:', organizerUserId);
        return null;
      }

      console.log('[GoogleCalendar] Refreshing access token...');

      const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID || '',
          client_secret: env.GOOGLE_CLIENT_SECRET || '',
          refresh_token: account.refresh_token_enc,
          grant_type: 'refresh_token',
        }),
      });

      if (!refreshResponse.ok) {
        const errorText = await refreshResponse.text();
        console.error('[GoogleCalendar] Token refresh failed:', refreshResponse.status, errorText);
        return null;
      }

      const refreshData = await refreshResponse.json() as {
        access_token: string;
        expires_in: number;
      };

      const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

      // Update access token in database
      await db
        .prepare(
          `UPDATE google_accounts
           SET access_token_enc = ?,
               token_expires_at = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(refreshData.access_token, newExpiresAt, account.id)
        .run();

      console.log('[GoogleCalendar] Access token refreshed successfully');
      return refreshData.access_token;
    } catch (error) {
      console.error('[GoogleCalendar] Get access token error:', error);
      return null;
    }
  }

  // ============================================================
  // Phase D-1 ACCESS-3: Proxy Calendar Write (代理予約)
  // ============================================================

  /**
   * Create a Calendar Event on behalf of another user (代理予約)
   * 
   * IMPORTANT: Caller MUST verify write_calendar permission BEFORE calling this method.
   * Use RelationshipAccessService.requirePermission(requesterId, targetId, 'write_calendar')
   * 
   * @example
   * ```typescript
   * // 1. Check permission first
   * const accessService = new RelationshipAccessService(env.DB);
   * await accessService.requirePermission(requesterId, targetUserId, 'write_calendar');
   * 
   * // 2. Get target user's access token
   * const targetToken = await GoogleCalendarService.getOrganizerAccessToken(db, targetUserId, env);
   * if (!targetToken) throw new Error('Target user has no linked Google Calendar');
   * 
   * // 3. Create event on target's calendar
   * const calendarService = new GoogleCalendarService(targetToken, env);
   * const event = await calendarService.createEventOnBehalf({
   *   summary: 'Meeting',
   *   start: '2024-01-15T10:00:00+09:00',
   *   end: '2024-01-15T11:00:00+09:00',
   *   onBehalfOf: requesterId,
   * });
   * ```
   * 
   * Phase D-1: This method is prepared for future proxy booking feature (R2).
   * Currently no route calls this method - it will be used when proxy booking UI is implemented.
   * 
   * @param params Event parameters including onBehalfOf (requester user ID)
   * @returns Created calendar event or null if failed
   */
  async createEventOnBehalf(params: CreateEventParams & {
    /** User ID of the person requesting the proxy booking (for audit) */
    onBehalfOf: string;
  }): Promise<CalendarEvent | null> {
    // Note: Permission check should happen BEFORE this method is called
    // The caller is responsible for calling:
    //   await relationshipAccess.requirePermission(onBehalfOf, targetUserId, 'write_calendar')
    
    console.log(`[GoogleCalendar] Creating event on behalf of user: ${params.onBehalfOf}`);
    
    // Use existing createEventWithMeet with extended description for audit
    const auditDescription = params.description 
      ? `${params.description}\n\n[代理予約: ${params.onBehalfOf}]`
      : `[代理予約: ${params.onBehalfOf}]`;
    
    return this.createEventWithMeet({
      ...params,
      description: auditDescription,
    });
  }

  /**
   * Get FreeBusy information (Day3: busy periods only)
   * 
   * @param timeMin Start time (ISO 8601)
   * @param timeMax End time (ISO 8601)
   * @returns Array of busy periods
   */
  async getFreeBusy(timeMin: string, timeMax: string): Promise<{ start: string; end: string }[]> {
    try {
      const requestBody = {
        timeMin,
        timeMax,
        items: [{ id: 'primary' }],
      };

      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleCalendar] FreeBusy API error:', response.status, errorText);
        throw new Error(`FreeBusy API error: ${response.status}`);
      }

      const data = await response.json() as {
        calendars: {
          primary: {
            busy: Array<{ start: string; end: string }>;
          };
        };
      };

      return data.calendars?.primary?.busy || [];
    } catch (error) {
      console.error('[GoogleCalendar] getFreeBusy error:', error);
      throw error;
    }
  }
}

// ============================================================
// Phase D-1 ACCESS-3: Proxy Booking Helper (代理予約)
// ============================================================

/**
 * Error type for proxy booking operations
 */
export class ProxyBookingError extends Error {
  constructor(
    message: string,
    public readonly code: 'no_permission' | 'target_no_calendar' | 'create_failed',
    public readonly status: number = 403
  ) {
    super(message);
    this.name = 'ProxyBookingError';
  }
}

/**
 * Result of a successful proxy booking
 */
export interface ProxyBookingResult {
  success: true;
  event: CalendarEvent;
  targetUserId: string;
  requesterId: string;
}

/**
 * Create a calendar event on behalf of another user (代理予約)
 * 
 * This is the main entry point for proxy booking. It:
 * 1. Verifies write_calendar permission (requires family_can_write preset)
 * 2. Gets target user's Google Calendar access token
 * 3. Creates the event on target's calendar
 * 
 * @example
 * ```typescript
 * try {
 *   const result = await createProxyEvent(env.DB, env, {
 *     requesterId: currentUserId,
 *     targetUserId: familyMemberId,
 *     event: {
 *       summary: 'Doctor Appointment',
 *       start: '2024-01-15T10:00:00+09:00',
 *       end: '2024-01-15T11:00:00+09:00',
 *     },
 *   });
 *   console.log('Event created:', result.event.id);
 * } catch (error) {
 *   if (error instanceof ProxyBookingError) {
 *     return c.json({ error: error.code, message: error.message }, error.status);
 *   }
 *   throw error;
 * }
 * ```
 * 
 * @param db - D1 database instance
 * @param env - Environment bindings
 * @param params - Proxy booking parameters
 * @returns Created event details
 * @throws ProxyBookingError if permission denied or calendar not linked
 */
export async function createProxyEvent(
  db: D1Database,
  env: Env,
  params: {
    requesterId: string;
    targetUserId: string;
    event: CreateEventParams;
  }
): Promise<ProxyBookingResult> {
  const { requesterId, targetUserId, event } = params;

  // 1. Check write_calendar permission
  const accessService = new RelationshipAccessService(db);
  
  try {
    await accessService.requirePermission(requesterId, targetUserId, 'write_calendar');
  } catch (error) {
    throw new ProxyBookingError(
      'この相手のカレンダーに予定を書き込む権限がありません',
      'no_permission',
      403
    );
  }

  // 2. Get target user's access token
  const targetToken = await GoogleCalendarService.getOrganizerAccessToken(db, targetUserId, env);
  
  if (!targetToken) {
    throw new ProxyBookingError(
      '相手のGoogleカレンダーが連携されていません',
      'target_no_calendar',
      400
    );
  }

  // 3. Create event on target's calendar
  const calendarService = new GoogleCalendarService(targetToken, env);
  const createdEvent = await calendarService.createEventOnBehalf({
    ...event,
    onBehalfOf: requesterId,
  });

  if (!createdEvent) {
    throw new ProxyBookingError(
      'カレンダーイベントの作成に失敗しました',
      'create_failed',
      500
    );
  }

  console.log(`[ProxyBooking] Event created on behalf: requester=${requesterId}, target=${targetUserId}, event=${createdEvent.id}`);

  return {
    success: true,
    event: createdEvent,
    targetUserId,
    requesterId,
  };
}
