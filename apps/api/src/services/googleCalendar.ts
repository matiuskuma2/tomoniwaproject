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
}

export class GoogleCalendarService {
  constructor(
    private accessToken: string,
    private env: Env
  ) {}

  /**
   * Create a Calendar Event with Google Meet
   * 
   * Phase 0A: No attendees (主催者のカレンダーにイベント作成のみ)
   */
  async createEventWithMeet(params: CreateEventParams): Promise<CalendarEvent | null> {
    try {
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
        // Phase 0A: attendees は空（主催者のみ）
        attendees: [],
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
   * Get user's Google account access token
   * 
   * Phase 0A: 主催者のアクセストークンを取得
   */
  static async getOrganizerAccessToken(
    db: D1Database,
    organizerUserId: string
  ): Promise<string | null> {
    try {
      const account = await db
        .prepare(
          `SELECT access_token_enc, refresh_token_enc, token_expires_at
           FROM google_accounts
           WHERE user_id = ? AND is_primary = 1
           LIMIT 1`
        )
        .bind(organizerUserId)
        .first<{
          access_token_enc: string;
          refresh_token_enc: string;
          token_expires_at: string;
        }>();

      if (!account) {
        console.error('[GoogleCalendar] No Google account found for user:', organizerUserId);
        return null;
      }

      // TODO: トークンのデコード処理（現状は暗号化されていると仮定）
      // 実際の実装では access_token_enc をデコードする必要がある
      // 今はシンプルにそのまま返す（開発環境用）
      return account.access_token_enc;
    } catch (error) {
      console.error('[GoogleCalendar] Get access token error:', error);
      return null;
    }
  }
}
