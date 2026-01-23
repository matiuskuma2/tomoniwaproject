/**
 * slotGenerator.ts
 * P3-SLOTGEN1: freebusy → 空き枠列挙
 * 
 * busy intervals から空いている候補枠を生成する
 * 
 * 設計方針:
 * - 入力: busy intervals + 期間 + 条件
 * - 出力: available_slots（最大8件、start_at昇順）
 * - 将来拡張: 1対Nでintersectionを取る
 */

import { formatDateTimeRange, DEFAULT_TIMEZONE } from './datetime';

// ============================================================
// Types
// ============================================================

export interface BusyInterval {
  start: string;  // ISO 8601
  end: string;    // ISO 8601
}

export interface AvailableSlot {
  start_at: string;   // ISO 8601
  end_at: string;     // ISO 8601
  label: string;      // 表示用ラベル（例: "1/24(金) 14:00-15:00"）
}

export interface DayTimeWindow {
  startHour: number;  // 0-23
  endHour: number;    // 0-23（例: 18 = 18:00まで）
}

export interface SlotGeneratorParams {
  timeMin: string;                  // 検索範囲の開始（ISO 8601）
  timeMax: string;                  // 検索範囲の終了（ISO 8601）
  busy: BusyInterval[];             // 埋まっている時間帯
  meetingLengthMin?: number;        // ミーティング長（分、デフォルト: 60）
  stepMin?: number;                 // グリッド刻み（分、デフォルト: 30）
  maxResults?: number;              // 最大候補数（デフォルト: 8）
  dayTimeWindow?: DayTimeWindow;    // 時間帯フィルタ（例: 午後 = {startHour: 14, endHour: 18}）
  timezone?: string;                // 表示用タイムゾーン（デフォルト: Asia/Tokyo）
}

export interface SlotGeneratorResult {
  available_slots: AvailableSlot[];
  coverage: {
    time_min: string;
    time_max: string;
    total_free_minutes: number;
    slot_count: number;
  };
}

// ============================================================
// 定数（デフォルト値）
// ============================================================

const DEFAULT_MEETING_LENGTH_MIN = 60;
const DEFAULT_STEP_MIN = 30;
const DEFAULT_MAX_RESULTS = 8;

// よく使う時間帯フィルタ（プリセット）
export const TIME_WINDOW_PRESETS = {
  morning: { startHour: 9, endHour: 12 },      // 午前: 9:00-12:00
  afternoon: { startHour: 14, endHour: 18 },   // 午後: 14:00-18:00
  evening: { startHour: 18, endHour: 21 },     // 夜: 18:00-21:00
  business: { startHour: 9, endHour: 18 },     // 営業時間: 9:00-18:00
} as const;

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * busy intervals を [timeMin, timeMax] にクリップ
 */
function clipBusyIntervals(
  busy: BusyInterval[],
  timeMin: Date,
  timeMax: Date
): Array<{ start: Date; end: Date }> {
  return busy
    .map((b) => {
      const start = new Date(b.start);
      const end = new Date(b.end);
      
      // 範囲外は除外
      if (end <= timeMin || start >= timeMax) return null;
      
      // クリップ
      return {
        start: start < timeMin ? timeMin : start,
        end: end > timeMax ? timeMax : end,
      };
    })
    .filter((b): b is { start: Date; end: Date } => b !== null);
}

/**
 * 重なっている intervals をマージ
 */
function mergeIntervals(
  intervals: Array<{ start: Date; end: Date }>
): Array<{ start: Date; end: Date }> {
  if (intervals.length === 0) return [];
  
  // start でソート
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  
  const merged: Array<{ start: Date; end: Date }> = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    
    // 重なっている or 連続している場合はマージ
    if (current.start <= last.end) {
      last.end = current.end > last.end ? current.end : last.end;
    } else {
      merged.push(current);
    }
  }
  
  return merged;
}

/**
 * busy intervals の逆集合（free intervals）を計算
 */
function computeFreeIntervals(
  busy: Array<{ start: Date; end: Date }>,
  timeMin: Date,
  timeMax: Date
): Array<{ start: Date; end: Date }> {
  if (busy.length === 0) {
    return [{ start: timeMin, end: timeMax }];
  }
  
  const free: Array<{ start: Date; end: Date }> = [];
  let cursor = timeMin;
  
  for (const b of busy) {
    if (cursor < b.start) {
      free.push({ start: cursor, end: b.start });
    }
    cursor = b.end > cursor ? b.end : cursor;
  }
  
  // 最後の busy の後にまだ空きがあれば追加
  if (cursor < timeMax) {
    free.push({ start: cursor, end: timeMax });
  }
  
  return free;
}

/**
 * 指定した Date が dayTimeWindow 内にあるかチェック
 * 
 * @param date - チェックする日時
 * @param window - 時間帯フィルタ
 * @param timezone - タイムゾーン（時間帯判定用）
 */
function isWithinDayTimeWindow(
  date: Date,
  window: DayTimeWindow,
  timezone: string
): boolean {
  // タイムゾーンでの時刻を取得
  const hour = parseInt(
    date.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }),
    10
  );
  
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * free interval をグリッド化して候補枠を生成
 */
function generateSlotsFromFreeIntervals(
  freeIntervals: Array<{ start: Date; end: Date }>,
  meetingLengthMs: number,
  stepMs: number,
  maxResults: number,
  dayTimeWindow: DayTimeWindow | undefined,
  timezone: string
): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  
  for (const free of freeIntervals) {
    let cursor = free.start.getTime();
    const endTime = free.end.getTime();
    
    while (cursor + meetingLengthMs <= endTime && slots.length < maxResults) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor + meetingLengthMs);
      
      // dayTimeWindow フィルタ
      if (dayTimeWindow) {
        if (!isWithinDayTimeWindow(slotStart, dayTimeWindow, timezone)) {
          cursor += stepMs;
          continue;
        }
      }
      
      // ラベル生成
      const label = formatDateTimeRange(
        slotStart.toISOString(),
        slotEnd.toISOString(),
        timezone
      );
      
      slots.push({
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        label,
      });
      
      cursor += stepMs;
    }
    
    if (slots.length >= maxResults) break;
  }
  
  return slots;
}

/**
 * 合計空き時間（分）を計算
 */
function calculateTotalFreeMinutes(
  freeIntervals: Array<{ start: Date; end: Date }>
): number {
  return freeIntervals.reduce((total, free) => {
    return total + (free.end.getTime() - free.start.getTime()) / (60 * 1000);
  }, 0);
}

// ============================================================
// メイン関数
// ============================================================

/**
 * freebusy から空き枠候補を生成
 * 
 * @param params - 生成パラメータ
 * @returns 空き枠候補と統計情報
 * 
 * @example
 * const result = generateAvailableSlots({
 *   timeMin: '2026-01-24T00:00:00.000Z',
 *   timeMax: '2026-01-24T23:59:59.999Z',
 *   busy: [{ start: '2026-01-24T01:00:00.000Z', end: '2026-01-24T03:00:00.000Z' }],
 *   meetingLengthMin: 60,
 *   stepMin: 30,
 *   dayTimeWindow: { startHour: 14, endHour: 18 },
 * });
 */
export function generateAvailableSlots(
  params: SlotGeneratorParams
): SlotGeneratorResult {
  const {
    timeMin,
    timeMax,
    busy,
    meetingLengthMin = DEFAULT_MEETING_LENGTH_MIN,
    stepMin = DEFAULT_STEP_MIN,
    maxResults = DEFAULT_MAX_RESULTS,
    dayTimeWindow,
    timezone = DEFAULT_TIMEZONE,
  } = params;
  
  // パラメータを ms に変換
  const meetingLengthMs = meetingLengthMin * 60 * 1000;
  const stepMs = stepMin * 60 * 1000;
  
  // 期間の Date オブジェクト
  const timeMinDate = new Date(timeMin);
  const timeMaxDate = new Date(timeMax);
  
  // 1. busy をクリップ
  const clippedBusy = clipBusyIntervals(busy, timeMinDate, timeMaxDate);
  
  // 2. busy をマージ
  const mergedBusy = mergeIntervals(clippedBusy);
  
  // 3. free intervals を計算
  const freeIntervals = computeFreeIntervals(mergedBusy, timeMinDate, timeMaxDate);
  
  // 4. 候補枠を生成
  const availableSlots = generateSlotsFromFreeIntervals(
    freeIntervals,
    meetingLengthMs,
    stepMs,
    maxResults,
    dayTimeWindow,
    timezone
  );
  
  // 5. 統計情報
  const totalFreeMinutes = calculateTotalFreeMinutes(freeIntervals);
  
  return {
    available_slots: availableSlots,
    coverage: {
      time_min: timeMin,
      time_max: timeMax,
      total_free_minutes: Math.round(totalFreeMinutes),
      slot_count: availableSlots.length,
    },
  };
}

/**
 * 複数ユーザーの busy を合算して共通の空き枠を計算（1対N用）
 * 
 * @param usersBusy - ユーザーごとの busy intervals
 * @param params - 他のパラメータ
 * @returns 全員が空いている枠
 */
export function generateCommonAvailableSlots(
  usersBusy: BusyInterval[][],
  params: Omit<SlotGeneratorParams, 'busy'>
): SlotGeneratorResult {
  // 全ユーザーの busy を統合
  const allBusy: BusyInterval[] = usersBusy.flat();
  
  // 統合した busy で候補生成
  return generateAvailableSlots({
    ...params,
    busy: allBusy,
  });
}

/**
 * 時間帯フィルタを文字列から取得
 * 
 * @param prefer - 'morning' | 'afternoon' | 'evening' | 'business' | undefined
 * @returns DayTimeWindow または undefined
 */
export function getTimeWindowFromPrefer(
  prefer: string | undefined
): DayTimeWindow | undefined {
  if (!prefer) return undefined;
  
  return TIME_WINDOW_PRESETS[prefer as keyof typeof TIME_WINDOW_PRESETS];
}
