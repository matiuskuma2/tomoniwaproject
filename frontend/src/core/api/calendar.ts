/**
 * Calendar API
 * Phase Next-3 (Day4): Read-only calendar access
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export interface CalendarEvent {
  id: string;
  start: string;  // ISO 8601
  end: string;    // ISO 8601
  summary: string;
  meet_url?: string | null;
  location?: string;
}

export type CalendarWarning = 
  | 'google_calendar_permission_missing' 
  | 'google_account_not_linked' 
  | null;

export interface CalendarTodayResponse {
  range: 'today';
  timezone: string;
  events: CalendarEvent[];
  warning?: CalendarWarning;
}

export interface CalendarWeekResponse {
  range: 'week';
  timezone: string;
  events: CalendarEvent[];
  warning?: CalendarWarning;
}

export interface CalendarFreeBusyResponse {
  range: 'today' | 'week';
  timezone: string;
  busy: Array<{ start: string; end: string }>;
  warning?: CalendarWarning;
}

// ============================================================
// API Client
// ============================================================

export const calendarApi = {
  /**
   * Get today's events
   */
  async getToday(): Promise<CalendarTodayResponse> {
    return api.get('/api/calendar/today');
  },

  /**
   * Get this week's events
   */
  async getWeek(): Promise<CalendarWeekResponse> {
    return api.get('/api/calendar/week');
  },

  /**
   * Get busy time slots
   */
  async getFreeBusy(range: 'today' | 'week'): Promise<CalendarFreeBusyResponse> {
    return api.get(`/api/calendar/freebusy?range=${range}`);
  },
};
