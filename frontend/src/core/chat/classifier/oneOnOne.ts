/**
 * classifier/oneOnOne.ts
 * v1.0: 1対1予定調整（固定日時スタート）の Intent 分類
 * 
 * ユーザー発話例:
 * - 「Aさんと来週木曜17時から1時間、予定調整お願い」
 * - 「田中さんと打ち合わせしたい、明日14時から」
 * - 「tanaka@example.com と 1/30 10:00 で打ち合わせ」
 * 
 * 抽出するパラメータ:
 * - person: { name, email? } - 相手の情報
 * - start_at: ISO8601 - 開始日時
 * - duration_minutes: number - 所要時間（デフォルト60分）
 * - title: string - 予定タイトル（省略時: 打ち合わせ）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Patterns for 1-on-1 scheduling
// ============================================================

// 相手の名前パターン（「○○さん」「○○と」）
const PERSON_PATTERNS = [
  /(.+?)さんと/,
  /(.+?)と(?:の|打ち合わせ|予定|ミーティング|会議)/,
];

// メールアドレスパターン
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

// 日付パターン（相対日付）
const RELATIVE_DATE_PATTERNS: Array<{ pattern: RegExp; resolver: () => Date }> = [
  { pattern: /今日/, resolver: () => new Date() },
  { pattern: /明日/, resolver: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; } },
  { pattern: /明後日/, resolver: () => { const d = new Date(); d.setDate(d.getDate() + 2); return d; } },
  { pattern: /来週の?(月曜|月)/, resolver: () => getNextWeekday(1) },
  { pattern: /来週の?(火曜|火)/, resolver: () => getNextWeekday(2) },
  { pattern: /来週の?(水曜|水)/, resolver: () => getNextWeekday(3) },
  { pattern: /来週の?(木曜|木)/, resolver: () => getNextWeekday(4) },
  { pattern: /来週の?(金曜|金)/, resolver: () => getNextWeekday(5) },
  { pattern: /来週の?(土曜|土)/, resolver: () => getNextWeekday(6) },
  { pattern: /来週の?(日曜|日)/, resolver: () => getNextWeekday(0) },
  { pattern: /今週の?(月曜|月)/, resolver: () => getThisWeekday(1) },
  { pattern: /今週の?(火曜|火)/, resolver: () => getThisWeekday(2) },
  { pattern: /今週の?(水曜|水)/, resolver: () => getThisWeekday(3) },
  { pattern: /今週の?(木曜|木)/, resolver: () => getThisWeekday(4) },
  { pattern: /今週の?(金曜|金)/, resolver: () => getThisWeekday(5) },
];

// 絶対日付パターン（M/D, M月D日）
const ABSOLUTE_DATE_PATTERN = /(\d{1,2})[\/月](\d{1,2})日?/;

// 時刻パターン
const TIME_PATTERN = /(\d{1,2})[時:：](\d{0,2})分?/;

// 所要時間パターン
const DURATION_PATTERNS = [
  { pattern: /(\d+)時間/, multiplier: 60 },
  { pattern: /(\d+)分/, multiplier: 1 },
];

// トリガーワード（これがないと1対1として認識しない）
const TRIGGER_WORDS = [
  '予定調整',
  '日程調整',
  'スケジュール調整',
  '打ち合わせ',
  'ミーティング',
  '会議',
  '面談',
  '相談',
];

// ============================================================
// Helper Functions
// ============================================================

/**
 * 来週の指定曜日を取得
 */
function getNextWeekday(targetDay: number): Date {
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntilTarget = targetDay - currentDay;
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }
  daysUntilTarget += 7; // 来週なので +7
  const result = new Date(today);
  result.setDate(today.getDate() + daysUntilTarget);
  return result;
}

/**
 * 今週の指定曜日を取得
 */
function getThisWeekday(targetDay: number): Date {
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntilTarget = targetDay - currentDay;
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }
  const result = new Date(today);
  result.setDate(today.getDate() + daysUntilTarget);
  return result;
}

/**
 * 相手の名前またはメールを抽出
 */
function extractPerson(input: string): { name?: string; email?: string } | null {
  // メールアドレスを探す
  const emailMatch = input.match(EMAIL_PATTERN);
  if (emailMatch) {
    return { email: emailMatch[1] };
  }

  // 名前パターンを探す
  for (const pattern of PERSON_PATTERNS) {
    const match = input.match(pattern);
    if (match && match[1]) {
      return { name: match[1].trim() };
    }
  }

  return null;
}

/**
 * 日付を抽出
 */
function extractDate(input: string): Date | null {
  // 相対日付パターンをチェック
  for (const { pattern, resolver } of RELATIVE_DATE_PATTERNS) {
    if (pattern.test(input)) {
      return resolver();
    }
  }

  // 絶対日付パターンをチェック
  const absoluteMatch = input.match(ABSOLUTE_DATE_PATTERN);
  if (absoluteMatch) {
    const month = parseInt(absoluteMatch[1], 10) - 1;
    const day = parseInt(absoluteMatch[2], 10);
    const year = new Date().getFullYear();
    const date = new Date(year, month, day);
    // 過去の日付なら来年にする
    if (date < new Date()) {
      date.setFullYear(year + 1);
    }
    return date;
  }

  return null;
}

/**
 * 時刻を抽出
 */
function extractTime(input: string): { hours: number; minutes: number } | null {
  const match = input.match(TIME_PATTERN);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }
  return null;
}

/**
 * 所要時間を抽出（分単位）
 */
function extractDuration(input: string): number {
  for (const { pattern, multiplier } of DURATION_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      return parseInt(match[1], 10) * multiplier;
    }
  }
  return 60; // デフォルト60分
}

/**
 * トリガーワードが含まれているか
 */
function hasTriggerWord(input: string): boolean {
  return TRIGGER_WORDS.some(word => input.includes(word));
}

// ============================================================
// Main Classifier
// ============================================================

/**
 * 1対1固定日時の Intent 分類
 */
export const classifyOneOnOne: ClassifierFn = (
  input: string,
  _normalizedInput: string,
  _context?: IntentContext,
  activePending?: PendingState | null
): IntentResult | null => {
  // pending がある場合はスキップ（既存フローを優先）
  if (activePending) {
    return null;
  }

  // トリガーワードがなければスキップ
  if (!hasTriggerWord(input)) {
    return null;
  }

  // 相手を抽出
  const person = extractPerson(input);
  if (!person) {
    return null;
  }

  // 日付を抽出
  const date = extractDate(input);
  if (!date) {
    // 日付がない場合は clarification を要求
    return {
      intent: 'schedule.1on1.fixed',
      confidence: 0.7,
      params: {
        person,
        rawInput: input,
      },
      needsClarification: {
        field: 'date',
        message: `${person.name || person.email}さんとの予定、いつがいいですか？（例: 来週木曜17時から）`,
      },
    };
  }

  // 時刻を抽出
  const time = extractTime(input);
  if (!time) {
    // 時刻がない場合は clarification を要求
    return {
      intent: 'schedule.1on1.fixed',
      confidence: 0.7,
      params: {
        person,
        date: date.toISOString(),
        rawInput: input,
      },
      needsClarification: {
        field: 'time',
        message: `${person.name || person.email}さんとの予定、何時からがいいですか？（例: 17時から）`,
      },
    };
  }

  // 所要時間を抽出
  const durationMinutes = extractDuration(input);

  // 開始日時を組み立て
  const startAt = new Date(date);
  startAt.setHours(time.hours, time.minutes, 0, 0);

  // 終了日時を計算
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  // タイトルを推測
  let title = '打ち合わせ';
  if (input.includes('ミーティング')) title = 'ミーティング';
  if (input.includes('会議')) title = '会議';
  if (input.includes('面談')) title = '面談';
  if (input.includes('相談')) title = '相談';

  return {
    intent: 'schedule.1on1.fixed',
    confidence: 0.9,
    params: {
      person,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      duration_minutes: durationMinutes,
      title,
      rawInput: input,
    },
  };
};
