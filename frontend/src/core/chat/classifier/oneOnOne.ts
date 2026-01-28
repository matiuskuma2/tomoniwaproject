/**
 * classifier/oneOnOne.ts
 * v1.0: 1対1予定調整（固定日時スタート）の Intent 分類
 * v1.1: Phase B-1 候補3つ提示対応
 * v1.2: Phase B-2 freebusy から候補生成
 * 
 * ユーザー発話例:
 * - 「Aさんと来週木曜17時から1時間、予定調整お願い」→ fixed
 * - 「田中さんと打ち合わせしたい、明日14時から」→ fixed
 * - 「田中さんと来週月曜10時か火曜14時で打ち合わせ」→ candidates3
 * - 「佐藤さんに3つ候補出して日程調整」→ candidates3
 * - 「Aさんと1/28、1/29、1/30で予定調整」→ candidates3
 * - 「田中さんと来週の空いてるところから候補出して」→ freebusy
 * - 「佐藤さんに2週間以内の午後で候補送って」→ freebusy
 * 
 * 抽出するパラメータ:
 * - person: { name, email? } - 相手の情報
 * - start_at: ISO8601 - 開始日時（fixed用）
 * - slots: Array<{start_at, end_at}> - 候補日時（candidates3用）
 * - duration_minutes: number - 所要時間（デフォルト60分）
 * - title: string - 予定タイトル（省略時: 打ち合わせ）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Patterns for 1-on-1 scheduling
// ============================================================

// 相手の名前パターン（「○○さん」「○○と」「○○に」）
const PERSON_PATTERNS = [
  /(.+?)さんと/,
  /(.+?)さんに/,  // 「佐藤さんに候補出して」
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
const ABSOLUTE_DATE_PATTERN = /(\d{1,2})[/月](\d{1,2})日?/;

// 時刻パターン
// 注意: 「1時間」のような所要時間表現を除外するため、後続が「時間」でないことを確認
const TIME_PATTERN = /(\d{1,2})[時:：](\d{0,2})分?(?!間)/;

// 所要時間パターン
const DURATION_PATTERNS = [
  { pattern: /(\d+)時間/, multiplier: 60 },
  { pattern: /(\d+)分/, multiplier: 1 },
];

// ============================================================
// Phase B-1: 複数候補検出パターン
// ============================================================

// 複数候補を示すキーワード（candidates3 にルーティング）
const MULTIPLE_SLOT_KEYWORDS = [
  '候補',
  'いくつか',
  '3つ',
  '三つ',
  '複数',
  'どれか',
  'どちらか',
];

// 「〜か〜」パターン（日時の選択肢を示す）
// 「10時か14時」「月曜か火曜」「1/28か1/29」 などのパターン
// 誤検出防止: 「打ち合わせしたいか」のようなパターンを除外
const ALTERNATIVE_PATTERN = /(?:\d{1,2}[時:：]|\d{1,2}月|[月火水木金土日]曜?)か(?:\d{1,2}[時:：]|\d{1,2}月|[月火水木金土日]曜?)/;

// 複数の絶対日付を検出するためのグローバルマッチパターン
const MULTIPLE_ABSOLUTE_DATE_PATTERN = /(\d{1,2})[/月](\d{1,2})日?/g;

// 複数の相対日付（曜日）を検出
const WEEKDAY_PATTERNS = [
  { pattern: /月曜|月(?=[、か]|$)/, day: 1 },
  { pattern: /火曜|火(?=[、か]|$)/, day: 2 },
  { pattern: /水曜|水(?=[、か]|$)/, day: 3 },
  { pattern: /木曜|木(?=[、か]|$)/, day: 4 },
  { pattern: /金曜|金(?=[、か]|$)/, day: 5 },
  { pattern: /土曜|土(?=[、か]|$)/, day: 6 },
  { pattern: /日曜|日(?=[、か]|$)/, day: 0 },
];

// 複数時刻を検出するパターン
// 注意: 「1時間」のような所要時間表現を除外するため、後続が「時間」でないことを確認
const MULTIPLE_TIME_PATTERN = /(\d{1,2})[時:：](\d{0,2})分?(?!間)/g;

// ============================================================
// Phase B-2: freebusy 検出パターン
// ============================================================

// freebusy から候補を生成するキーワード
const FREEBUSY_KEYWORDS = [
  '空いてるところから',
  '空き時間から',
  '空いてる時間から',
  '空いてる時間帯から',
  '空きから',
  '私の空き',
  '自分の空き',
  'カレンダーから',
  'freebusyから',
  'freebusy',
];

// 時間帯の prefer 検出
const PREFER_PATTERNS: Array<{ pattern: RegExp; prefer: 'morning' | 'afternoon' | 'evening' | 'business' }> = [
  { pattern: /午前|朝|AM/, prefer: 'morning' },
  { pattern: /午後|昼|PM/, prefer: 'afternoon' },
  { pattern: /夕方|夜/, prefer: 'evening' },
  { pattern: /営業時間|ビジネス/, prefer: 'business' },
];

// 期間の検出パターン（time_min / time_max 用）
const RANGE_PATTERNS: Array<{ pattern: RegExp; resolver: () => { time_min: Date; time_max: Date } }> = [
  // 「来週」→ 来週の月曜〜日曜
  { 
    pattern: /来週/, 
    resolver: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      const timeMin = new Date(now);
      timeMin.setDate(now.getDate() + daysUntilMonday);
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(timeMin);
      timeMax.setDate(timeMin.getDate() + 6);
      timeMax.setHours(23, 59, 59, 999);
      return { time_min: timeMin, time_max: timeMax };
    }
  },
  // 「今週」→ 今日〜今週日曜
  { 
    pattern: /今週/, 
    resolver: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const timeMin = new Date(now);
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(now);
      timeMax.setDate(now.getDate() + (7 - dayOfWeek));
      timeMax.setHours(23, 59, 59, 999);
      return { time_min: timeMin, time_max: timeMax };
    }
  },
  // 「2週間」「2週間以内」→ 今日から2週間
  { 
    pattern: /2週間|二週間/, 
    resolver: () => {
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(now);
      timeMax.setDate(now.getDate() + 14);
      timeMax.setHours(23, 59, 59, 999);
      return { time_min: timeMin, time_max: timeMax };
    }
  },
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

/**
 * 複数候補キーワードが含まれているか
 */
function hasMultipleSlotKeyword(input: string): boolean {
  return MULTIPLE_SLOT_KEYWORDS.some(word => input.includes(word));
}

/**
 * Phase B-2: freebusy キーワードが含まれているか
 */
function hasFreebusyKeyword(input: string): boolean {
  return FREEBUSY_KEYWORDS.some(word => input.includes(word));
}

/**
 * Phase B-2: prefer（時間帯）を抽出
 */
function extractPrefer(input: string): 'morning' | 'afternoon' | 'evening' | 'business' | null {
  for (const { pattern, prefer } of PREFER_PATTERNS) {
    if (pattern.test(input)) {
      return prefer;
    }
  }
  return null;
}

/**
 * Phase B-2: time_min / time_max を抽出
 */
function extractTimeRange(input: string): { time_min: Date; time_max: Date } | null {
  for (const { pattern, resolver } of RANGE_PATTERNS) {
    if (pattern.test(input)) {
      return resolver();
    }
  }
  return null;
}

/**
 * 「〜か〜」パターンで日時の選択肢があるか
 */
function hasAlternativePattern(input: string): boolean {
  return ALTERNATIVE_PATTERN.test(input);
}

/**
 * 複数の日時トークンを検出（Phase B-1）
 * 日時トークンが2つ以上あれば candidates3 候補
 */
function extractMultipleSlots(input: string, durationMinutes: number): Array<{start_at: string; end_at: string}> | null {
  const slots: Array<{start_at: string; end_at: string}> = [];
  const now = new Date();
  const year = now.getFullYear();
  
  // 1. 複数の絶対日付を検出（1/28, 1/29, 1/30 など）
  const absoluteDates: Date[] = [];
  let absoluteMatch;
  const absoluteRegex = new RegExp(MULTIPLE_ABSOLUTE_DATE_PATTERN.source, 'g');
  while ((absoluteMatch = absoluteRegex.exec(input)) !== null) {
    const month = parseInt(absoluteMatch[1], 10) - 1;
    const day = parseInt(absoluteMatch[2], 10);
    const date = new Date(year, month, day);
    if (date < now) {
      date.setFullYear(year + 1);
    }
    absoluteDates.push(date);
  }
  
  // 2. 複数の曜日を検出（月曜か火曜、木と金 など）
  const weekdayDates: Date[] = [];
  const isNextWeek = input.includes('来週');
  for (const { pattern, day } of WEEKDAY_PATTERNS) {
    if (pattern.test(input)) {
      const date = isNextWeek ? getNextWeekday(day) : getThisWeekday(day);
      weekdayDates.push(date);
    }
  }
  
  // 3. 時刻を複数抽出
  const times: Array<{hours: number; minutes: number}> = [];
  let timeMatch;
  const timeRegex = new RegExp(MULTIPLE_TIME_PATTERN.source, 'g');
  while ((timeMatch = timeRegex.exec(input)) !== null) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      times.push({ hours, minutes });
    }
  }
  
  // 時刻が0個なら単一日時として処理するためnullを返す
  if (times.length === 0) {
    return null;
  }
  
  // 4. 日付と時刻を組み合わせてスロットを生成
  const allDates = [...absoluteDates, ...weekdayDates];
  
  // パターン A: 複数日付 × 1時刻（例: 1/28, 1/29, 1/30 の 14時）
  if (allDates.length >= 2 && times.length === 1) {
    const time = times[0];
    for (const date of allDates) {
      const startAt = new Date(date);
      startAt.setHours(time.hours, time.minutes, 0, 0);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
      slots.push({
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      });
    }
    return slots.length >= 2 ? slots : null;
  }
  
  // パターン B: 1日付 × 複数時刻（例: 来週木曜 10時か14時か16時）
  if (allDates.length === 1 && times.length >= 2) {
    const date = allDates[0];
    for (const time of times) {
      const startAt = new Date(date);
      startAt.setHours(time.hours, time.minutes, 0, 0);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
      slots.push({
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      });
    }
    return slots.length >= 2 ? slots : null;
  }
  
  // パターン C: 複数日付 × 複数時刻（1:1対応: 月曜10時か火曜14時）
  if (allDates.length >= 2 && times.length >= 2 && allDates.length === times.length) {
    for (let i = 0; i < allDates.length; i++) {
      const startAt = new Date(allDates[i]);
      startAt.setHours(times[i].hours, times[i].minutes, 0, 0);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
      slots.push({
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      });
    }
    return slots.length >= 2 ? slots : null;
  }
  
  // パターン D: 複数日付のみ（時刻なし→デフォルト時刻が必要）
  // この場合は clarification が必要なので null を返す
  
  return null;
}

// ============================================================
// Main Classifier
// ============================================================

/**
 * 1対1の Intent 分類（fixed / candidates3 / freebusy 分岐）
 * 
 * Phase B-1: 候補3つ判定ロジック
 * - 「候補」「3つ」「いくつか」などのキーワード
 * - 「〜か〜」パターンで複数日時
 * - 複数の日時トークン（2つ以上）
 * 
 * Phase B-2: freebusy 判定ロジック
 * - 「空いてるところから」「空き時間から」などのキーワード
 * - 主催者のカレンダーから空き枠を自動生成
 * 
 * 重要: 日時トークンが2つ以上ある場合のみ candidates3 化
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

  // 所要時間を抽出（早めに抽出して複数スロット生成に使う）
  const durationMinutes = extractDuration(input);

  // タイトルを推測
  let title = '打ち合わせ';
  if (input.includes('ミーティング')) title = 'ミーティング';
  if (input.includes('会議')) title = '会議';
  if (input.includes('面談')) title = '面談';
  if (input.includes('相談')) title = '相談';

  // ============================================================
  // Phase B-2: freebusy 判定（candidates3 より先に判定）
  // ============================================================
  
  if (hasFreebusyKeyword(input)) {
    // prefer と time_range を抽出
    const prefer = extractPrefer(input);
    const timeRange = extractTimeRange(input);
    
    // constraints を組み立て
    const constraints: {
      time_min?: string;
      time_max?: string;
      prefer?: 'morning' | 'afternoon' | 'evening' | 'business';
      duration?: number;
    } = {};
    
    if (timeRange) {
      constraints.time_min = timeRange.time_min.toISOString();
      constraints.time_max = timeRange.time_max.toISOString();
    }
    if (prefer) {
      constraints.prefer = prefer;
    }
    if (durationMinutes !== 60) {
      constraints.duration = durationMinutes;
    }
    
    return {
      intent: 'schedule.1on1.freebusy',
      confidence: 0.9,
      params: {
        person,
        constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
        duration_minutes: durationMinutes,
        title,
        rawInput: input,
      },
    };
  }

  // ============================================================
  // Phase B-1: 候補3つ（candidates3）判定
  // ============================================================
  
  // 複数候補キーワードがあるか、選択肢パターンがあるか
  const hasMultiKeyword = hasMultipleSlotKeyword(input);
  const hasAltPattern = hasAlternativePattern(input);
  
  // 複数日時スロットを抽出
  const multipleSlots = extractMultipleSlots(input, durationMinutes);
  
  // candidates3 の条件:
  // 1. 複数スロットが抽出できた（2つ以上の具体的な日時）
  // 2. または、複数候補キーワードがあり、かつ選択肢パターンがある
  const isCandidates3 = multipleSlots !== null && multipleSlots.length >= 2;
  
  if (isCandidates3 && multipleSlots) {
    // candidates3 として返す
    return {
      intent: 'schedule.1on1.candidates3',
      confidence: 0.9,
      params: {
        person,
        slots: multipleSlots.slice(0, 5), // 最大5候補
        duration_minutes: durationMinutes,
        title,
        rawInput: input,
      },
    };
  }
  
  // 複数候補キーワードはあるが、具体的な日時が足りない場合
  if (hasMultiKeyword || hasAltPattern) {
    // 日時の clarification を要求
    return {
      intent: 'schedule.1on1.candidates3',
      confidence: 0.7,
      params: {
        person,
        title,
        rawInput: input,
      },
      needsClarification: {
        field: 'slots',
        message: `${person.name || person.email}さんとの予定、候補日時を教えてください。（例: 来週月曜10時か火曜14時か水曜16時）`,
      },
    };
  }

  // ============================================================
  // 固定日時（fixed）判定
  // ============================================================

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

  // 開始日時を組み立て
  const startAt = new Date(date);
  startAt.setHours(time.hours, time.minutes, 0, 0);

  // 終了日時を計算
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

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
