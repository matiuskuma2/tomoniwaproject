/**
 * Google Calendar Service
 * 
 * Handles Google Calendar Event creation with Meet integration
 */

import type { Env } from '../../../../packages/shared/src/types/env';

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
}
