/**
 * classifier/calendar.ts
 * TD-003: Phase Next-3 (P1) Calendar Read-only
 * 
 * - schedule.today: 今日の予定
 * - schedule.week: 今週の予定
 * - schedule.freebusy: 空き時間
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

/**
 * カレンダー関連の分類器
 */
export const classifyCalendar: ClassifierFn = (
  _input: string,
  normalizedInput: string,
  _context: IntentContext | undefined,
  _activePending: PendingState | null
): IntentResult | null => {
  // ============================================================
  // P1-1: schedule.today
  // Keywords: 今日、きょう、今日の予定
  // ============================================================
  if (/(今日|きょう).*予定/.test(normalizedInput)) {
    return {
      intent: 'schedule.today',
      confidence: 0.9,
      params: {},
    };
  }

  // ============================================================
  // P1-2: schedule.week
  // Keywords: 今週、こんしゅう、週の予定
  // ============================================================
  if (/(今週|こんしゅう|週).*予定/.test(normalizedInput)) {
    return {
      intent: 'schedule.week',
      confidence: 0.9,
      params: {},
    };
  }

  // ============================================================
  // P1-3: schedule.freebusy
  // Keywords: 空き、あき、空いて、あいて、フリー
  // ============================================================
  if (/(空き|あき|空いて|あいて|フリー)/.test(normalizedInput)) {
    // Determine range (today or week)
    let range: 'today' | 'week' = 'week'; // Default to week

    if (/(今日|きょう)/.test(normalizedInput)) {
      range = 'today';
    } else if (/(今週|こんしゅう)/.test(normalizedInput)) {
      range = 'week';
    }

    // Need clarification if range is ambiguous
    const hasTimeReference = /(今日|きょう|今週|こんしゅう)/.test(normalizedInput);

    return {
      intent: 'schedule.freebusy',
      confidence: hasTimeReference ? 0.9 : 0.7,
      params: { range },
      needsClarification: !hasTimeReference
        ? {
            field: 'range',
            message: '今日の空き時間ですか？それとも今週の空き時間ですか？',
          }
        : undefined,
    };
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};
