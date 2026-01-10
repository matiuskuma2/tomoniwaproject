/**
 * Calendar Slice - カレンダー状態管理
 * 
 * 責務:
 * - 今日の予定
 * - 週間予定
 * - 空き時間情報
 */

import type { StateCreator } from 'zustand';
import type { 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse 
} from '../../core/models';

// ============================================================
// Types
// ============================================================

export interface CalendarState {
  today: CalendarTodayResponse | null;
  week: CalendarWeekResponse | null;
  freebusy: CalendarFreeBusyResponse | null;
  lastFetched: {
    today: number | null;
    week: number | null;
    freebusy: number | null;
  };
}

export interface CalendarActions {
  setToday: (data: CalendarTodayResponse) => void;
  setWeek: (data: CalendarWeekResponse) => void;
  setFreebusy: (data: CalendarFreeBusyResponse) => void;
  clearCalendar: () => void;
  isStale: (type: 'today' | 'week' | 'freebusy', ttlMs?: number) => boolean;
}

export type CalendarSlice = CalendarState & CalendarActions;

// ============================================================
// Constants
// ============================================================

const DEFAULT_TTL_MS = 60 * 1000; // 1分

// ============================================================
// Initial State
// ============================================================

const initialState: CalendarState = {
  today: null,
  week: null,
  freebusy: null,
  lastFetched: {
    today: null,
    week: null,
    freebusy: null,
  },
};

// ============================================================
// Slice Creator
// ============================================================

export const createCalendarSlice: StateCreator<CalendarSlice> = (set, get) => ({
  ...initialState,

  setToday: (today) => {
    set({ 
      today, 
      lastFetched: { ...get().lastFetched, today: Date.now() } 
    });
  },

  setWeek: (week) => {
    set({ 
      week, 
      lastFetched: { ...get().lastFetched, week: Date.now() } 
    });
  },

  setFreebusy: (freebusy) => {
    set({ 
      freebusy, 
      lastFetched: { ...get().lastFetched, freebusy: Date.now() } 
    });
  },

  clearCalendar: () => set(initialState),

  isStale: (type, ttlMs = DEFAULT_TTL_MS) => {
    const lastFetched = get().lastFetched[type];
    if (!lastFetched) return true;
    return Date.now() - lastFetched > ttlMs;
  },
});
