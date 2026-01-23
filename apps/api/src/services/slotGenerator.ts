/**
 * Slot Generator Service
 * P3-SLOT1: freebusy から空き枠を生成
 * P3-SCORE1: 好みに基づいてスコアリング
 * 
 * MVP-1: 主催者の好みだけで候補最適化
 */

import { GoogleCalendarService } from './googleCalendar';

// ============================================================
// Types
// ============================================================

/**
 * 時間帯ルール
 */
export interface TimeWindow {
  dow: number[];      // 曜日（0=日, 1=月, ..., 6=土）
  start: string;      // 開始時刻 "HH:mm"
  end: string;        // 終了時刻 "HH:mm"
  weight: number;     // スコア重み
  label?: string;     // ラベル（例: "平日午後"）
}

/**
 * スケジュール好み設定
 */
export interface SchedulePreferences {
  windows?: TimeWindow[];
  avoid?: TimeWindow[];
  min_notice_hours?: number;
  meeting_length_min?: number;
  max_end_time?: string;
}

/**
 * 生成された候補枠
 */
export interface GeneratedSlot {
  start: string;      // ISO 8601
  end: string;        // ISO 8601
  score: number;      // スコア（高いほど優先）
  reasons: string[];  // スコアの理由
}

/**
 * Busy period from calendar
 */
interface BusyPeriod {
  start: string;
  end: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 時刻文字列（HH:mm）を分に変換
 */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

/**
 * Dateから時刻（分）を取得（タイムゾーン考慮）
 */
function getMinutesInTimezone(date: Date, timezone: string): number {
  const options: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  };
  const timeStr = date.toLocaleString('ja-JP', options);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Dateから曜日を取得（タイムゾーン考慮）
 */
function getDayOfWeekInTimezone(date: Date, timezone: string): number {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    timeZone: timezone,
  };
  const dayStr = date.toLocaleString('en-US', options);
  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
  };
  return dayMap[dayStr] ?? 0;
}

/**
 * 2つの時間範囲が重なるかチェック
 */
function isOverlapping(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && end1 > start2;
}

/**
 * 曜日番号を日本語に変換
 */
function dowToJapanese(dow: number): string {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  return dayNames[dow] ?? '?';
}

// ============================================================
// Slot Generator
// ============================================================

/**
 * 空き枠を生成する
 * 
 * @param busyPeriods - Google Calendar から取得した busy 時間帯
 * @param startDate - 検索開始日時
 * @param endDate - 検索終了日時
 * @param durationMinutes - 会議の長さ（分）
 * @param timezone - タイムゾーン
 * @param workingHours - 営業時間 { start: "09:00", end: "18:00" }
 * @returns 空き枠の配列
 */
export function generateFreeSlots(
  busyPeriods: BusyPeriod[],
  startDate: Date,
  endDate: Date,
  durationMinutes: number = 60,
  timezone: string = 'Asia/Tokyo',
  workingHours: { start: string; end: string } = { start: '09:00', end: '18:00' }
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const slotInterval = 30; // 30分間隔でスロット生成

  // Convert busy periods to Date objects
  const busyDates = busyPeriods.map(bp => ({
    start: new Date(bp.start),
    end: new Date(bp.end),
  }));

  // Working hours in minutes
  const workStart = timeToMinutes(workingHours.start);
  const workEnd = timeToMinutes(workingHours.end);

  // Iterate through each day
  let currentDay = new Date(startDate);
  currentDay.setHours(0, 0, 0, 0);

  while (currentDay < endDate) {
    // Get day of week in timezone
    const dow = getDayOfWeekInTimezone(currentDay, timezone);
    
    // Skip weekends (optional - can be controlled by preferences later)
    // For MVP, we generate all days and let scoring handle it

    // Generate slots for this day
    for (let minutes = workStart; minutes + durationMinutes <= workEnd; minutes += slotInterval) {
      // Create slot start/end in the target timezone
      const slotStartMinutes = minutes;
      const slotEndMinutes = minutes + durationMinutes;

      // Calculate UTC time for this slot
      // Note: This is a simplified approach - for production, use a proper timezone library
      const slotStart = new Date(currentDay);
      const slotEnd = new Date(currentDay);
      
      // Set hours/minutes (simplified - assumes JST for now)
      const jstOffset = 9 * 60; // JST = UTC+9
      slotStart.setUTCHours(Math.floor((slotStartMinutes - jstOffset + 1440) / 60) % 24);
      slotStart.setUTCMinutes((slotStartMinutes - jstOffset + 1440) % 60);
      slotEnd.setUTCHours(Math.floor((slotEndMinutes - jstOffset + 1440) / 60) % 24);
      slotEnd.setUTCMinutes((slotEndMinutes - jstOffset + 1440) % 60);

      // Adjust date if rolled over
      if (slotStartMinutes - jstOffset < 0) {
        slotStart.setUTCDate(slotStart.getUTCDate() - 1);
      }
      if (slotEndMinutes - jstOffset < 0) {
        slotEnd.setUTCDate(slotEnd.getUTCDate() - 1);
      }

      // Check if slot is in the future
      if (slotStart < new Date()) {
        continue;
      }

      // Check if slot overlaps with any busy period
      const isBusy = busyDates.some(bp => isOverlapping(slotStart, slotEnd, bp.start, bp.end));
      
      if (!isBusy) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
    }

    // Move to next day
    currentDay.setDate(currentDay.getDate() + 1);
  }

  return slots;
}

// ============================================================
// Scoring Engine
// ============================================================

/**
 * 候補枠にスコアをつける
 * 
 * @param slot - 候補枠
 * @param preferences - ユーザーの好み設定
 * @param timezone - タイムゾーン
 * @returns スコアと理由
 */
export function scoreSlot(
  slot: { start: string; end: string },
  preferences: SchedulePreferences | null,
  timezone: string = 'Asia/Tokyo'
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50; // 基本スコア

  if (!preferences) {
    return { score, reasons: ['デフォルトスコア'] };
  }

  const slotStart = new Date(slot.start);
  const dow = getDayOfWeekInTimezone(slotStart, timezone);
  const timeMinutes = getMinutesInTimezone(slotStart, timezone);
  const timeStr = `${Math.floor(timeMinutes / 60).toString().padStart(2, '0')}:${(timeMinutes % 60).toString().padStart(2, '0')}`;

  // Check windows (preferred times)
  if (preferences.windows) {
    for (const w of preferences.windows) {
      if (w.dow.includes(dow)) {
        const windowStart = timeToMinutes(w.start);
        const windowEnd = timeToMinutes(w.end);
        
        if (timeMinutes >= windowStart && timeMinutes < windowEnd) {
          score += w.weight;
          reasons.push(`✅ ${w.label || `${dowToJapanese(dow)}曜 ${w.start}〜${w.end}`} に一致 (+${w.weight})`);
        }
      }
    }
  }

  // Check avoid times
  if (preferences.avoid) {
    for (const a of preferences.avoid) {
      if (a.dow.includes(dow)) {
        const avoidStart = timeToMinutes(a.start);
        const avoidEnd = timeToMinutes(a.end);
        
        if (timeMinutes >= avoidStart && timeMinutes < avoidEnd) {
          score += a.weight; // weight is negative
          reasons.push(`⛔ ${a.label || `${dowToJapanese(dow)}曜 ${a.start}〜${a.end}`} に該当 (${a.weight})`);
        }
      }
    }
  }

  // Check min_notice_hours
  if (preferences.min_notice_hours) {
    const hoursUntilSlot = (slotStart.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilSlot < preferences.min_notice_hours) {
      score -= 20;
      reasons.push(`⚠️ 通知時間不足: ${Math.round(hoursUntilSlot)}時間後（希望: ${preferences.min_notice_hours}時間以上）(-20)`);
    } else {
      score += 5;
      reasons.push(`✅ 十分な通知時間: ${Math.round(hoursUntilSlot)}時間後 (+5)`);
    }
  }

  // Check max_end_time
  if (preferences.max_end_time) {
    const slotEnd = new Date(slot.end);
    const endTimeMinutes = getMinutesInTimezone(slotEnd, timezone);
    const maxEndMinutes = timeToMinutes(preferences.max_end_time);
    
    if (endTimeMinutes > maxEndMinutes) {
      score -= 15;
      reasons.push(`⚠️ 終了時刻が遅い: ${preferences.max_end_time}以降 (-15)`);
    }
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

/**
 * 候補枠リストをスコアリングしてソート
 */
export function scoreAndSortSlots(
  slots: { start: string; end: string }[],
  preferences: SchedulePreferences | null,
  timezone: string = 'Asia/Tokyo',
  maxSlots: number = 8
): GeneratedSlot[] {
  const scoredSlots: GeneratedSlot[] = slots.map(slot => {
    const { score, reasons } = scoreSlot(slot, preferences, timezone);
    return {
      start: slot.start,
      end: slot.end,
      score,
      reasons,
    };
  });

  // Sort by score (descending)
  scoredSlots.sort((a, b) => b.score - a.score);

  // Return top N slots
  return scoredSlots.slice(0, maxSlots);
}

// ============================================================
// Integrated Generator
// ============================================================

/**
 * 統合された候補生成
 * freebusyから空き枠を生成し、好みでスコアリング
 */
export async function generateOptimizedSlots(
  accessToken: string,
  env: any,
  preferences: SchedulePreferences | null,
  options: {
    startDate?: Date;
    endDate?: Date;
    durationMinutes?: number;
    maxSlots?: number;
    timezone?: string;
  } = {}
): Promise<{
  slots: GeneratedSlot[];
  total_free_slots: number;
  preferences_applied: boolean;
}> {
  const {
    startDate = new Date(),
    endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
    durationMinutes = preferences?.meeting_length_min || 60,
    maxSlots = 8,
    timezone = 'Asia/Tokyo',
  } = options;

  // Fetch busy periods from Google Calendar
  const calendarService = new GoogleCalendarService(accessToken, env);
  const busyPeriods = await calendarService.getFreeBusy(
    startDate.toISOString(),
    endDate.toISOString()
  );

  // Generate free slots
  const freeSlots = generateFreeSlots(
    busyPeriods,
    startDate,
    endDate,
    durationMinutes,
    timezone
  );

  // Score and sort
  const scoredSlots = scoreAndSortSlots(
    freeSlots,
    preferences,
    timezone,
    maxSlots
  );

  return {
    slots: scoredSlots,
    total_free_slots: freeSlots.length,
    preferences_applied: preferences !== null && (
      (preferences.windows?.length || 0) > 0 ||
      (preferences.avoid?.length || 0) > 0 ||
      preferences.min_notice_hours !== undefined
    ),
  };
}
