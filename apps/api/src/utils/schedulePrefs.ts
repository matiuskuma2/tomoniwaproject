/**
 * schedulePrefs.ts
 * P3-GEN1: 参加者のスケジュール好み（preferences）の型定義とユーティリティ
 * 
 * 設計方針:
 * - ユーザーの好みは users.schedule_prefs_json に保存
 * - 時間帯の好みを time_windows / avoid_windows で表現
 * - 将来的にはAI抽出で自然言語 → JSON変換
 */

// ============================================================
// Types
// ============================================================

/**
 * 曜日の型
 */
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * 時間帯ルール
 * 例: { label: 'afternoon', days: ['mon','tue','wed','thu','fri'], start: '14:00', end: '18:00', weight: 3 }
 */
export interface TimeWindowRule {
  label?: string;           // ラベル（表示・理由用）
  days?: DayOfWeek[];       // 対象曜日（未指定=全曜日）
  start: string;            // 開始時刻 (HH:mm)
  end: string;              // 終了時刻 (HH:mm)
  weight: number;           // 重み（正=好み、負=回避）
}

/**
 * ユーザーのスケジュール好み
 */
export interface SchedulePrefs {
  time_windows?: TimeWindowRule[];     // 好む時間帯（正の重み）
  avoid_windows?: TimeWindowRule[];    // 避けたい時間帯（負の重み）
  timezone?: string;                   // ユーザーのタイムゾーン
}

/**
 * P3-SCORE1: スロットスコアの詳細理由
 * - participant_label を必須化（ユーザー名付き表示用）
 * - kind を追加（理由の種別）
 */
export type ScoreReasonKind = 'prefer' | 'avoid' | 'tiebreak';

export interface ScoreReason {
  source: string;              // どのユーザーの好みか（user_id または 'proximity'）
  participant_label: string;   // P3-SCORE1: 表示用名前（田中さん / xxx@email.com）
  rule_label: string;          // ルールのラベル（例: '午後(14:00-18:00)', '木曜夜(18:00-22:00)'）
  delta: number;               // スコアへの影響（正/負）
  kind: ScoreReasonKind;       // 理由の種別
  // 後方互換: 旧 label を保持
  label?: string;
}

/**
 * スコア付きスロット
 */
export interface ScoredSlot {
  start_at: string;        // ISO 8601
  end_at: string;          // ISO 8601
  label: string;           // 表示用ラベル
  score: number;           // 合計スコア
  reasons: ScoreReason[];  // スコアの理由一覧
}

// ============================================================
// Constants
// ============================================================

/**
 * 曜日のマッピング（JS Date.getDay() → DayOfWeek）
 * getDay(): 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
 */
export const DAY_INDEX_TO_DAY_OF_WEEK: Record<number, DayOfWeek> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

/**
 * デフォルトのタイムゾーン
 */
export const DEFAULT_PREFS_TIMEZONE = 'Asia/Tokyo';

/**
 * プロキシミティ（直近の枠）のスコア係数
 * スコア = -0.001 * hours_from_now (微小なタイブレーカー)
 */
export const PROXIMITY_SCORE_FACTOR = -0.001;

// ============================================================
// P3-SCORE1: Label Generation Helpers
// ============================================================

/**
 * 曜日を日本語に変換
 */
export const DAY_OF_WEEK_TO_JA: Record<DayOfWeek, string> = {
  sun: '日', mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土',
};

/**
 * 時間帯を日本語ラベルに変換
 * @param start - 開始時刻 (HH:mm)
 * @param end - 終了時刻 (HH:mm)
 * @returns 時間帯ラベル（例: '午前', '午後', '夜'）
 */
export function getDaypartLabel(start: string, end: string): string {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  
  // 午前: 6:00-12:00
  if (startMinutes >= 360 && endMinutes <= 720) return '午前';
  // 午後: 12:00-18:00
  if (startMinutes >= 720 && endMinutes <= 1080) return '午後';
  // 夜: 18:00-24:00
  if (startMinutes >= 1080) return '夜';
  // 営業時間: 9:00-18:00
  if (startMinutes === 540 && endMinutes === 1080) return '営業時間';
  
  return '';
}

/**
 * TimeWindowRule から表示用ラベルを生成
 * @param rule - 時間帯ルール
 * @param isAvoid - 回避ルールかどうか
 * @returns 表示用ラベル（例: '午後(14:00-18:00)', '木曜夜(18:00-22:00)', '午前回避(09:00-12:00)'）
 */
export function generateRuleLabel(rule: TimeWindowRule, isAvoid: boolean = false): string {
  // 明示的なラベルがある場合はそれを使用
  if (rule.label && rule.label.trim() !== '') {
    return isAvoid ? `${rule.label}回避` : rule.label;
  }
  
  const parts: string[] = [];
  
  // 曜日
  if (rule.days && rule.days.length > 0 && rule.days.length < 7) {
    const dayLabels = rule.days.map(d => DAY_OF_WEEK_TO_JA[d]);
    if (dayLabels.length <= 2) {
      parts.push(dayLabels.join('・'));
    } else {
      parts.push(`${dayLabels[0]}他`);
    }
  }
  
  // 時間帯名（午前/午後/夜）
  const daypartLabel = getDaypartLabel(rule.start, rule.end);
  if (daypartLabel) {
    parts.push(daypartLabel);
  }
  
  // 回避フラグ
  if (isAvoid) {
    parts.push('回避');
  }
  
  // 時間範囲
  const timeRange = `(${rule.start}-${rule.end})`;
  
  return parts.length > 0 ? `${parts.join('')}${timeRange}` : timeRange;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 時刻文字列（HH:mm）を分に変換
 * @param timeStr - "14:00" 形式
 * @returns 分（例: 14:00 → 840）
 */
export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Date から指定タイムゾーンでの時刻（分）を取得
 * @param date - Date オブジェクト
 * @param timezone - タイムゾーン
 * @returns その日の 0:00 からの分数
 */
export function getMinutesInTimezone(date: Date, timezone: string): number {
  const hour = parseInt(
    date.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }),
    10
  );
  const minute = parseInt(
    date.toLocaleString('en-US', { timeZone: timezone, minute: 'numeric' }),
    10
  );
  return hour * 60 + minute;
}

/**
 * Date から指定タイムゾーンでの曜日を取得
 * @param date - Date オブジェクト
 * @param timezone - タイムゾーン
 * @returns DayOfWeek
 */
export function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
  const dayIndex = parseInt(
    date.toLocaleString('en-US', { timeZone: timezone, weekday: 'narrow' }),
    10
  );
  // Intl では weekday:'narrow' が数字にならないので別の方法を使う
  const dateStr = date.toLocaleString('en-US', { timeZone: timezone, weekday: 'short' });
  const dayMap: Record<string, DayOfWeek> = {
    'Sun': 'sun', 'Mon': 'mon', 'Tue': 'tue', 'Wed': 'wed',
    'Thu': 'thu', 'Fri': 'fri', 'Sat': 'sat',
  };
  return dayMap[dateStr] || 'mon';
}

/**
 * スロットが TimeWindowRule にマッチするかチェック
 * @param slotStart - スロット開始日時
 * @param rule - 時間帯ルール
 * @param timezone - タイムゾーン
 * @returns マッチすれば true
 */
export function isSlotMatchingRule(
  slotStart: Date,
  rule: TimeWindowRule,
  timezone: string
): boolean {
  // 1. 曜日チェック（days が未指定なら全曜日）
  if (rule.days && rule.days.length > 0) {
    const dayOfWeek = getDayOfWeekInTimezone(slotStart, timezone);
    if (!rule.days.includes(dayOfWeek)) {
      return false;
    }
  }
  
  // 2. 時刻チェック
  const slotMinutes = getMinutesInTimezone(slotStart, timezone);
  const ruleStartMinutes = timeToMinutes(rule.start);
  const ruleEndMinutes = timeToMinutes(rule.end);
  
  return slotMinutes >= ruleStartMinutes && slotMinutes < ruleEndMinutes;
}

/**
 * SchedulePrefs のバリデーション
 * @param prefs - 検証するprefs
 * @returns バリデーション結果
 */
export function validateSchedulePrefs(prefs: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!prefs || typeof prefs !== 'object') {
    return { valid: false, errors: ['prefs must be an object'] };
  }
  
  const p = prefs as Record<string, unknown>;
  
  // time_windows のバリデーション
  if (p.time_windows !== undefined) {
    if (!Array.isArray(p.time_windows)) {
      errors.push('time_windows must be an array');
    } else {
      for (let i = 0; i < p.time_windows.length; i++) {
        const tw = p.time_windows[i];
        if (!tw || typeof tw !== 'object') {
          errors.push(`time_windows[${i}] must be an object`);
          continue;
        }
        if (typeof tw.start !== 'string' || !/^\d{2}:\d{2}$/.test(tw.start)) {
          errors.push(`time_windows[${i}].start must be in HH:mm format`);
        }
        if (typeof tw.end !== 'string' || !/^\d{2}:\d{2}$/.test(tw.end)) {
          errors.push(`time_windows[${i}].end must be in HH:mm format`);
        }
        if (typeof tw.weight !== 'number') {
          errors.push(`time_windows[${i}].weight must be a number`);
        }
      }
    }
  }
  
  // avoid_windows のバリデーション
  if (p.avoid_windows !== undefined) {
    if (!Array.isArray(p.avoid_windows)) {
      errors.push('avoid_windows must be an array');
    } else {
      for (let i = 0; i < p.avoid_windows.length; i++) {
        const aw = p.avoid_windows[i];
        if (!aw || typeof aw !== 'object') {
          errors.push(`avoid_windows[${i}] must be an object`);
          continue;
        }
        if (typeof aw.start !== 'string' || !/^\d{2}:\d{2}$/.test(aw.start)) {
          errors.push(`avoid_windows[${i}].start must be in HH:mm format`);
        }
        if (typeof aw.end !== 'string' || !/^\d{2}:\d{2}$/.test(aw.end)) {
          errors.push(`avoid_windows[${i}].end must be in HH:mm format`);
        }
        if (typeof aw.weight !== 'number') {
          errors.push(`avoid_windows[${i}].weight must be a number`);
        }
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * JSON文字列からSchedulePrefsをパース
 * @param json - JSON文字列またはnull
 * @returns パースしたprefs（失敗時はnull）
 */
export function parseSchedulePrefs(json: string | null | undefined): SchedulePrefs | null {
  if (!json) return null;
  
  try {
    const parsed = JSON.parse(json);
    const { valid, errors } = validateSchedulePrefs(parsed);
    if (!valid) {
      console.warn('[parseSchedulePrefs] Validation failed:', errors);
      return null;
    }
    return parsed as SchedulePrefs;
  } catch (e) {
    console.warn('[parseSchedulePrefs] Parse failed:', e);
    return null;
  }
}

/**
 * デフォルトの（空の）SchedulePrefs
 */
export function getDefaultSchedulePrefs(): SchedulePrefs {
  return {
    time_windows: [],
    avoid_windows: [],
    timezone: DEFAULT_PREFS_TIMEZONE,
  };
}
