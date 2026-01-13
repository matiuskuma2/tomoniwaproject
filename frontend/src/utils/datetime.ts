/**
 * 日時フォーマットユーティリティ（フロントエンド用）
 * 
 * ⚠️ 重要: toLocaleString() の直書きは禁止
 * 必ずこのファイルの関数を使用すること
 * 
 * 設計方針:
 * - DB保存: UTC ISO文字列（例: 2026-01-15T01:00:00.000Z）
 * - 表示: ユーザー/閲覧者のタイムゾーンで変換
 * - デフォルト: Asia/Tokyo（日本展開優先）
 * 
 * 将来拡張（P3-TZ1/TZ2/TZ3）:
 * - ユーザーごとのタイムゾーン設定を取得して表示
 * - スレッド基準タイムゾーンとの併記
 */

export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const DEFAULT_LOCALE = 'ja-JP';

/**
 * 主要タイムゾーン（設定画面のUI選択肢用）
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
 * ISO文字列を閲覧者のタイムゾーンでフォーマット
 * 
 * @param isoString - UTC ISO文字列（例: 2026-01-15T01:00:00.000Z）
 * @param viewerTimezone - 閲覧者のタイムゾーン（デフォルト: Asia/Tokyo）
 * @returns フォーマットされた日時文字列
 * 
 * @example
 * formatDateTimeForViewer('2026-01-15T01:00:00.000Z')
 * // => "1/15(水) 10:00" (JSTで表示)
 * 
 * formatDateTimeForViewer('2026-01-15T01:00:00.000Z', 'Asia/Dubai')
 * // => "1/15(水) 5:00" (GSTで表示)
 */
export function formatDateTimeForViewer(
  isoString: string | Date | number,
  viewerTimezone: string = DEFAULT_TIMEZONE
): string {
  // 様々な入力形式に対応
  const date = isoString instanceof Date 
    ? isoString 
    : typeof isoString === 'number'
      ? new Date(isoString)
      : new Date(isoString);
  
  if (isNaN(date.getTime())) {
    console.warn(`[formatDateTimeForViewer] Invalid date: ${isoString}`);
    return String(isoString); // フォールバック
  }
  
  return date.toLocaleString(DEFAULT_LOCALE, {
    timeZone: viewerTimezone,
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
export function formatDateForViewer(
  isoString: string | Date | number,
  viewerTimezone: string = DEFAULT_TIMEZONE
): string {
  const date = isoString instanceof Date 
    ? isoString 
    : typeof isoString === 'number'
      ? new Date(isoString)
      : new Date(isoString);
  
  if (isNaN(date.getTime())) {
    console.warn(`[formatDateForViewer] Invalid date: ${isoString}`);
    return String(isoString);
  }
  
  return date.toLocaleString(DEFAULT_LOCALE, {
    timeZone: viewerTimezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

/**
 * ISO文字列を時間のみでフォーマット（日付なし）
 */
export function formatTimeForViewer(
  isoString: string | Date | number,
  viewerTimezone: string = DEFAULT_TIMEZONE
): string {
  const date = isoString instanceof Date 
    ? isoString 
    : typeof isoString === 'number'
      ? new Date(isoString)
      : new Date(isoString);
  
  if (isNaN(date.getTime())) {
    console.warn(`[formatTimeForViewer] Invalid date: ${isoString}`);
    return String(isoString);
  }
  
  return date.toLocaleString(DEFAULT_LOCALE, {
    timeZone: viewerTimezone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * 日時範囲をフォーマット（候補日表示用）
 * 
 * @example
 * formatDateTimeRangeForViewer('2026-01-15T01:00:00.000Z', '2026-01-15T02:00:00.000Z')
 * // => "1/15(水) 10:00-11:00"
 */
export function formatDateTimeRangeForViewer(
  startIso: string,
  endIso: string,
  viewerTimezone: string = DEFAULT_TIMEZONE
): string {
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.warn(`[formatDateTimeRangeForViewer] Invalid date range: ${startIso} - ${endIso}`);
    return `${startIso} - ${endIso}`;
  }
  
  const dateStr = startDate.toLocaleString(DEFAULT_LOCALE, {
    timeZone: viewerTimezone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  
  const startTime = startDate.toLocaleString(DEFAULT_LOCALE, {
    timeZone: viewerTimezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  
  const endTime = endDate.toLocaleString(DEFAULT_LOCALE, {
    timeZone: viewerTimezone,
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
 * 相対時間を取得（〇分前、〇時間前など）
 */
export function getRelativeTime(isoString: string | Date | number): string {
  const date = isoString instanceof Date 
    ? isoString 
    : typeof isoString === 'number'
      ? new Date(isoString)
      : new Date(isoString);
  
  if (isNaN(date.getTime())) {
    return '';
  }
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHour = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  if (diffDay < 7) return `${diffDay}日前`;
  
  return formatDateForViewer(date);
}

/**
 * 安全な時間フォーマット（ChatPane用の互換関数）
 * 様々な入力形式に対応
 */
export function safeFormatTime(
  timestamp: Date | string | number | undefined | null
): string {
  if (!timestamp) return '';
  
  try {
    const date = timestamp instanceof Date 
      ? timestamp 
      : typeof timestamp === 'number'
        ? new Date(timestamp)
        : new Date(timestamp);
    
    if (isNaN(date.getTime())) return '';
    
    return date.toLocaleTimeString(DEFAULT_LOCALE, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
