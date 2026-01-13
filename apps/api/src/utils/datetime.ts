/**
 * 日時フォーマットユーティリティ
 * 
 * ⚠️ 重要: toLocaleString() の直書きは禁止
 * 必ずこのファイルの関数を使用すること
 * 
 * 設計方針:
 * - DB保存: UTC ISO文字列（例: 2026-01-15T01:00:00.000Z）
 * - 表示: ユーザー/受信者のタイムゾーンで変換
 * - デフォルト: Asia/Tokyo（日本展開優先）
 * 
 * 将来拡張（P3-TZ1/TZ2/TZ3）:
 * - ユーザーごとのタイムゾーン設定
 * - メール受信者のタイムゾーンで表示
 * - スレッド基準タイムゾーン
 */

export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_LOCALE = 'ja-JP';

/**
 * 主要タイムゾーン（将来のUI選択肢用）
 */
export const SUPPORTED_TIMEZONES = [
  { value: 'Asia/Tokyo', label: '日本標準時 (JST)', offset: 'UTC+9' },
  { value: 'Asia/Dubai', label: 'アラブ首長国連邦 (GST)', offset: 'UTC+4' },
  { value: 'Asia/Singapore', label: 'シンガポール (SGT)', offset: 'UTC+8' },
  { value: 'Asia/Shanghai', label: '中国標準時 (CST)', offset: 'UTC+8' },
  { value: 'America/New_York', label: '米国東部 (EST/EDT)', offset: 'UTC-5/-4' },
  { value: 'America/Los_Angeles', label: '米国西部 (PST/PDT)', offset: 'UTC-8/-7' },
  { value: 'Europe/London', label: 'イギリス (GMT/BST)', offset: 'UTC+0/+1' },
  { value: 'Europe/Paris', label: '中央ヨーロッパ (CET/CEST)', offset: 'UTC+1/+2' },
] as const;

export type SupportedTimezone = typeof SUPPORTED_TIMEZONES[number]['value'];

/**
 * ISO文字列を指定タイムゾーンでフォーマット
 * 
 * @param isoString - UTC ISO文字列（例: 2026-01-15T01:00:00.000Z）
 * @param timezone - タイムゾーン（デフォルト: Asia/Tokyo）
 * @param locale - ロケール（デフォルト: ja-JP）
 * @returns フォーマットされた日時文字列
 * 
 * @example
 * formatDateTime('2026-01-15T01:00:00.000Z')
 * // => "1/15(水) 10:00" (JSTで表示)
 * 
 * formatDateTime('2026-01-15T01:00:00.000Z', 'Asia/Dubai')
 * // => "1/15(水) 5:00" (GSTで表示)
 */
export function formatDateTime(
  isoString: string,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE
): string {
  const date = new Date(isoString);
  
  if (isNaN(date.getTime())) {
    console.warn(`[formatDateTime] Invalid date: ${isoString}`);
    return isoString; // フォールバック
  }
  
  return date.toLocaleString(locale, {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * ISO文字列を日付のみでフォーマット（時間なし）
 */
export function formatDate(
  isoString: string,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE
): string {
  const date = new Date(isoString);
  
  if (isNaN(date.getTime())) {
    console.warn(`[formatDate] Invalid date: ${isoString}`);
    return isoString;
  }
  
  return date.toLocaleString(locale, {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

/**
 * ISO文字列を時間のみでフォーマット（日付なし）
 */
export function formatTime(
  isoString: string,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE
): string {
  const date = new Date(isoString);
  
  if (isNaN(date.getTime())) {
    console.warn(`[formatTime] Invalid date: ${isoString}`);
    return isoString;
  }
  
  return date.toLocaleString(locale, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * 日時範囲をフォーマット（候補日表示用）
 * 
 * @example
 * formatDateTimeRange('2026-01-15T01:00:00.000Z', '2026-01-15T02:00:00.000Z')
 * // => "1/15(水) 10:00-11:00"
 */
export function formatDateTimeRange(
  startIso: string,
  endIso: string,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE
): string {
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.warn(`[formatDateTimeRange] Invalid date range: ${startIso} - ${endIso}`);
    return `${startIso} - ${endIso}`;
  }
  
  const dateStr = startDate.toLocaleString(locale, {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  
  const startTime = startDate.toLocaleString(locale, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  
  const endTime = endDate.toLocaleString(locale, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  
  return `${dateStr} ${startTime}-${endTime}`;
}

/**
 * タイムゾーン略称を取得
 */
export function getTimezoneAbbr(timezone: string): string {
  const abbrs: Record<string, string> = {
    'Asia/Tokyo': 'JST',
    'Asia/Dubai': 'GST',
    'Asia/Singapore': 'SGT',
    'Asia/Shanghai': 'CST',
    'America/New_York': 'EST',
    'America/Los_Angeles': 'PST',
    'Europe/London': 'GMT',
    'Europe/Paris': 'CET',
  };
  return abbrs[timezone] || timezone;
}

/**
 * スロット配列からラベル一覧を生成（メール本文用）
 * 
 * @param slots - スロット配列
 * @param maxDisplay - 最大表示件数（デフォルト: 3）
 * @param timezone - タイムゾーン
 * @returns カンマ区切りのラベル文字列
 * 
 * @example
 * generateSlotLabels([{start_at: '...', label: '1/15 10:00'}, ...])
 * // => "1/15 10:00、1/16 14:00、1/17 09:00 他2件"
 */
export function generateSlotLabels(
  slots: Array<{ start_at: string; label?: string | null }>,
  maxDisplay: number = 3,
  timezone: string = DEFAULT_TIMEZONE
): string {
  const labels = slots.slice(0, maxDisplay).map((s) => {
    // 既存のラベルがあれば優先（フロントで生成済みのラベルが最も安全）
    if (s.label) return s.label;
    
    // なければ start_at から生成
    return formatDateTime(s.start_at, timezone);
  });
  
  const suffix = slots.length > maxDisplay 
    ? ` 他${slots.length - maxDisplay}件` 
    : '';
  
  return labels.join('、') + suffix;
}
