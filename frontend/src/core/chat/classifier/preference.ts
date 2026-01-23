/**
 * classifier/preference.ts
 * P3-PREF3: スケジュール好み設定の分類
 * 
 * - preference.set: 好み設定（自然文から）
 * - preference.show: 好み表示
 * - preference.clear: 好みクリア
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

/**
 * 自然文から好みルールを抽出する
 * 例: "平日14時以降がいい" → { dow: [1,2,3,4,5], start: "14:00", end: "18:00" }
 */
function parsePreferenceFromText(input: string): {
  windows?: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
  avoid?: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
  min_notice_hours?: number;
} | null {
  const result: {
    windows: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
    avoid: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
    min_notice_hours?: number;
  } = { windows: [], avoid: [] };

  const normalized = input.toLowerCase();

  // 曜日パターン
  const weekdaysDow = [1, 2, 3, 4, 5]; // 月〜金
  const weekendDow = [0, 6]; // 土日
  const allDays = [0, 1, 2, 3, 4, 5, 6];

  // 特定曜日マッピング
  const dayMap: Record<string, number> = {
    '日': 0, '日曜': 0, '日曜日': 0,
    '月': 1, '月曜': 1, '月曜日': 1,
    '火': 2, '火曜': 2, '火曜日': 2,
    '水': 3, '水曜': 3, '水曜日': 3,
    '木': 4, '木曜': 4, '木曜日': 4,
    '金': 5, '金曜': 5, '金曜日': 5,
    '土': 6, '土曜': 6, '土曜日': 6,
  };

  // 時間抽出
  const extractTimeRange = (text: string): { start: string; end: string } | null => {
    // "14時〜18時" or "14:00-18:00" パターン
    const rangeMatch = text.match(/(\d{1,2})[:時]?\s*[〜~-]\s*(\d{1,2})[:時]?/);
    if (rangeMatch) {
      const startHour = parseInt(rangeMatch[1], 10);
      const endHour = parseInt(rangeMatch[2], 10);
      if (startHour >= 0 && startHour <= 23 && endHour >= 0 && endHour <= 23) {
        return {
          start: `${startHour.toString().padStart(2, '0')}:00`,
          end: `${endHour.toString().padStart(2, '0')}:00`,
        };
      }
    }

    // "午後" パターン
    if (/午後/.test(text)) {
      return { start: '12:00', end: '18:00' };
    }

    // "午前" パターン
    if (/午前/.test(text)) {
      return { start: '09:00', end: '12:00' };
    }

    // "夜" パターン
    if (/夜/.test(text)) {
      return { start: '18:00', end: '21:00' };
    }

    // "朝" パターン
    if (/朝/.test(text)) {
      return { start: '09:00', end: '12:00' };
    }

    // "14時以降" パターン
    const afterMatch = text.match(/(\d{1,2})[:時]?以降/);
    if (afterMatch) {
      const startHour = parseInt(afterMatch[1], 10);
      if (startHour >= 0 && startHour <= 23) {
        return {
          start: `${startHour.toString().padStart(2, '0')}:00`,
          end: '21:00', // デフォルト終了
        };
      }
    }

    // "18時まで" パターン
    const beforeMatch = text.match(/(\d{1,2})[:時]?まで/);
    if (beforeMatch) {
      const endHour = parseInt(beforeMatch[1], 10);
      if (endHour >= 0 && endHour <= 23) {
        return {
          start: '09:00', // デフォルト開始
          end: `${endHour.toString().padStart(2, '0')}:00`,
        };
      }
    }

    return null;
  };

  // 曜日抽出
  const extractDays = (text: string): number[] => {
    // 平日
    if (/平日/.test(text)) {
      return weekdaysDow;
    }

    // 週末/土日
    if (/週末|土日/.test(text)) {
      return weekendDow;
    }

    // 特定曜日（複数対応）
    const days: number[] = [];
    for (const [key, value] of Object.entries(dayMap)) {
      if (text.includes(key)) {
        if (!days.includes(value)) {
          days.push(value);
        }
      }
    }
    if (days.length > 0) {
      return days.sort();
    }

    // デフォルト: 平日
    return weekdaysDow;
  };

  // 避けたいパターン（"〜は避けたい", "〜はNG", "〜は嫌"）
  const isAvoid = /避け|NG|だめ|ダメ|嫌|いや|なし/.test(normalized);

  // 好むパターン（"〜がいい", "〜希望", "〜優先"）
  const isPrefer = /いい|良い|希望|優先|好き|したい/.test(normalized);

  const timeRange = extractTimeRange(input);
  const days = extractDays(input);

  if (timeRange) {
    const rule = {
      dow: days,
      start: timeRange.start,
      end: timeRange.end,
      weight: isAvoid ? -8 : 10,
      label: input.slice(0, 20), // 元の入力を短く保存
    };

    if (isAvoid) {
      result.avoid.push(rule);
    } else {
      result.windows.push(rule);
    }
  }

  // 直前を避ける（"直前は避けたい", "前日までに"）
  const noticeMatch = input.match(/(\d+)\s*(時間|日).*前/);
  if (noticeMatch) {
    const value = parseInt(noticeMatch[1], 10);
    const unit = noticeMatch[2];
    result.min_notice_hours = unit === '日' ? value * 24 : value;
  } else if (/直前.*避け|前日まで/.test(normalized)) {
    result.min_notice_hours = 24;
  }

  // 結果があれば返す
  if (result.windows.length > 0 || result.avoid.length > 0 || result.min_notice_hours) {
    return {
      windows: result.windows.length > 0 ? result.windows : undefined,
      avoid: result.avoid.length > 0 ? result.avoid : undefined,
      min_notice_hours: result.min_notice_hours,
    };
  }

  return null;
}

/**
 * 好み設定の分類器
 */
export const classifyPreference: ClassifierFn = (
  input: string,
  normalizedInput: string,
  _context: IntentContext | undefined,
  _activePending: PendingState | null
): IntentResult | null => {
  // ============================================================
  // preference.show - 好み表示
  // Keywords: 好み見せて、設定見せて、好み確認
  // ============================================================
  if (/(好み|設定).*(見せ|確認|教えて|表示)|(見せ|確認|教えて|表示).*(好み|設定)/.test(normalizedInput)) {
    return {
      intent: 'preference.show',
      confidence: 0.9,
      params: {},
    };
  }

  // ============================================================
  // preference.clear - 好みクリア
  // Keywords: 好みクリア、設定クリア、リセット
  // ============================================================
  if (/(好み|設定).*(クリア|リセット|削除|消して)/.test(normalizedInput)) {
    return {
      intent: 'preference.clear',
      confidence: 0.9,
      params: {},
    };
  }

  // ============================================================
  // preference.set - 好み設定
  // 自然文から好みを解析
  // Keywords: 〜がいい、〜希望、〜優先、〜避けたい、〜はNG
  // ============================================================
  const preferencePatterns = [
    /がいい|が良い/,           // "14時以降がいい"
    /希望/,                    // "午後希望"
    /優先/,                    // "夜優先"
    /避け/,                    // "昼は避けたい"
    /NG|だめ|ダメ/,            // "土日はNG"
    /したい/,                  // "18時までにしたい"
  ];

  const hasPreferenceKeyword = preferencePatterns.some(p => p.test(normalizedInput));

  if (hasPreferenceKeyword) {
    const parsedPrefs = parsePreferenceFromText(input);
    
    if (parsedPrefs) {
      return {
        intent: 'preference.set',
        confidence: 0.85,
        params: {
          parsed_prefs: parsedPrefs,
          original_text: input,
        },
      };
    }
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};

/**
 * 好み設定をマージする（既存 + 新規）
 */
export function mergePreferences(
  existing: {
    windows?: Array<{ dow: number[]; start: string; end: string; weight: number; label?: string }>;
    avoid?: Array<{ dow: number[]; start: string; end: string; weight: number; label?: string }>;
    min_notice_hours?: number;
  } | null,
  newPrefs: {
    windows?: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
    avoid?: Array<{ dow: number[]; start: string; end: string; weight: number; label: string }>;
    min_notice_hours?: number;
  }
): {
  windows: Array<{ dow: number[]; start: string; end: string; weight: number; label?: string }>;
  avoid: Array<{ dow: number[]; start: string; end: string; weight: number; label?: string }>;
  min_notice_hours?: number;
} {
  const result = {
    windows: [...(existing?.windows || [])],
    avoid: [...(existing?.avoid || [])],
    min_notice_hours: newPrefs.min_notice_hours ?? existing?.min_notice_hours,
  };

  // 新しいwindowsを追加（重複チェック）
  if (newPrefs.windows) {
    for (const w of newPrefs.windows) {
      const isDuplicate = result.windows.some(
        e => e.start === w.start && e.end === w.end && JSON.stringify(e.dow) === JSON.stringify(w.dow)
      );
      if (!isDuplicate) {
        result.windows.push(w);
      }
    }
  }

  // 新しいavoidを追加（重複チェック）
  if (newPrefs.avoid) {
    for (const a of newPrefs.avoid) {
      const isDuplicate = result.avoid.some(
        e => e.start === a.start && e.end === a.end && JSON.stringify(e.dow) === JSON.stringify(a.dow)
      );
      if (!isDuplicate) {
        result.avoid.push(a);
      }
    }
  }

  return result;
}
