/**
 * Calendar API
 * Phase Next-3 (Day4) + P3-SLOTGEN1: Read-only calendar access with slot generation
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
  | 'fetch_error'
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

// P3-SLOTGEN1: Available slot type
export interface AvailableSlot {
  start_at: string;   // ISO 8601
  end_at: string;     // ISO 8601
  label: string;      // 表示用ラベル（例: "1/24(金) 14:00-15:00"）
}

// P3-SCORE1: スコア理由の種別
export type ScoreReasonKind = 'prefer' | 'avoid' | 'tiebreak';

// P3-SCORE1: スコア理由
export interface ScoreReason {
  source: string;              // ユーザーIDまたは'proximity'
  participant_label: string;   // 表示用名前（例: '田中さん', 'xxx@email.com'）
  rule_label: string;          // ルールのラベル（例: '午後(14:00-18:00)'）
  delta: number;               // スコアへの影響
  kind: ScoreReasonKind;       // 理由の種別
  label?: string;              // 後方互換用
}

// P3-GEN1: スコア付きスロット
export interface ScoredSlot {
  start_at: string;   // ISO 8601
  end_at: string;     // ISO 8601
  label: string;      // 表示用ラベル
  score: number;      // 合計スコア
  reasons: ScoreReason[];  // スコアの理由一覧
}

// P3-SLOTGEN1: Coverage info
export interface SlotCoverage {
  time_min: string;
  time_max: string;
  total_free_minutes: number;
  slot_count: number;
}

// P3-SLOTGEN1: FreeBusy response with available_slots
export interface CalendarFreeBusyResponse {
  range: 'today' | 'week' | 'next_week';
  timezone: string;
  busy: Array<{ start: string; end: string }>;
  available_slots: AvailableSlot[];
  coverage?: SlotCoverage;
  prefer?: string | null;
  warning?: CalendarWarning;
}

// P3-SLOTGEN1: Time preference presets
export type TimePreference = 'morning' | 'afternoon' | 'evening' | 'business';

// P3-SLOTGEN1: FreeBusy query params
export interface FreeBusyParams {
  range: 'today' | 'week' | 'next_week';
  prefer?: TimePreference;
  meetingLength?: number;
}

// ============================================================
// P3-INTERSECT1: Batch FreeBusy Types
// ============================================================

// 参加者の種類
export interface ParticipantInfo {
  type: 'self' | 'app_user' | 'external';
  userId?: string;
  email?: string;
  name?: string;
}

// 参加者ごとのbusy結果
export interface ParticipantBusy {
  participant: ParticipantInfo;
  busy: Array<{ start: string; end: string }>;
  status: 'success' | 'not_linked' | 'error' | 'external_excluded';
  error?: string;
}

// バッチfreebusyリクエスト
export interface BatchFreeBusyParams {
  threadId?: string;
  participants?: ParticipantInfo[];
  range?: 'today' | 'week' | 'next_week';
  prefer?: TimePreference;
  meetingLength?: number;
}

// バッチfreebusyレスポンス
export interface BatchFreeBusyResponse {
  range: 'today' | 'week' | 'next_week';
  timezone: string;
  available_slots: AvailableSlot[];
  scored_slots?: ScoredSlot[];  // P3-GEN1: スコア付きスロット
  busy_union: Array<{ start: string; end: string }>;
  per_participant: ParticipantBusy[];
  coverage: SlotCoverage;
  excluded_count: number;
  linked_count: number;
  prefer: string | null;
  warning: string | null;
  has_preferences?: boolean;  // P3-GEN1: 好み設定を持つ参加者がいるか
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
   * Get busy time slots + available slots
   * P3-SLOTGEN1: Enhanced with slot generation
   * 
   * @param params - Query parameters
   * @param params.range - 'today' | 'week' | 'next_week'
   * @param params.prefer - 'morning' | 'afternoon' | 'evening' | 'business' (optional)
   * @param params.meetingLength - Meeting duration in minutes (default: 60)
   */
  async getFreeBusy(params: FreeBusyParams | 'today' | 'week'): Promise<CalendarFreeBusyResponse> {
    // 後方互換: 文字列の場合は旧API形式
    if (typeof params === 'string') {
      return api.get(`/api/calendar/freebusy?range=${params}`);
    }
    
    // P3-SLOTGEN1: Full params
    const queryParts: string[] = [`range=${params.range}`];
    if (params.prefer) {
      queryParts.push(`prefer=${params.prefer}`);
    }
    if (params.meetingLength) {
      queryParts.push(`meeting_length=${params.meetingLength}`);
    }
    
    return api.get(`/api/calendar/freebusy?${queryParts.join('&')}`);
  },

  /**
   * P3-INTERSECT1: Get common available slots for multiple participants
   * 
   * @param params - Batch freebusy parameters
   * @param params.threadId - Thread ID to get participants from (priority)
   * @param params.participants - Direct participant list (if no threadId)
   * @param params.range - 'today' | 'week' | 'next_week'
   * @param params.prefer - Time preference filter
   * @param params.meetingLength - Meeting duration in minutes
   */
  async getBatchFreeBusy(params: BatchFreeBusyParams): Promise<BatchFreeBusyResponse> {
    return api.post('/api/calendar/freebusy/batch', {
      threadId: params.threadId,
      participants: params.participants,
      range: params.range || 'week',
      prefer: params.prefer,
      meeting_length: params.meetingLength || 60,
    });
  },
};
