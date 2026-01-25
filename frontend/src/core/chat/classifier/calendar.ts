/**
 * classifier/calendar.ts
 * TD-003: Phase Next-3 (P1) Calendar Read-only
 * P3-SLOTGEN1: 空き枠候補生成のための拡張
 * P3-INTERSECT1: 共通空き（複数参加者）
 * 
 * - schedule.today: 今日の予定
 * - schedule.week: 今週の予定
 * - schedule.freebusy: 空き時間（range + prefer 対応）
 * - schedule.freebusy.batch: 共通空き（複数参加者）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// P3-SLOTGEN1: Time preference type
type TimePreference = 'morning' | 'afternoon' | 'evening' | 'business';

/**
 * P3-SLOTGEN1: Extract time preference from input
 * - 午前、朝 → morning (9:00-12:00)
 * - 午後 → afternoon (14:00-18:00)
 * - 夜、夕方 → evening (18:00-21:00)
 * - 営業時間、ビジネスアワー → business (9:00-18:00)
 */
function extractTimePreference(input: string): TimePreference | undefined {
  if (/(午前|朝|あさ|ごぜん)/.test(input)) {
    return 'morning';
  }
  if (/(午後|ごご|ひる過ぎ|昼過ぎ)/.test(input)) {
    return 'afternoon';
  }
  if (/(夜|夕方|よる|ゆうがた|イブニング)/.test(input)) {
    return 'evening';
  }
  if (/(営業時間|ビジネスアワー|業務時間)/.test(input)) {
    return 'business';
  }
  return undefined;
}

/**
 * P3-SLOTGEN1: Extract range from input
 * - 今日、きょう → today
 * - 今週、こんしゅう → week
 * - 来週、らいしゅう → next_week
 */
function extractRange(input: string): 'today' | 'week' | 'next_week' | undefined {
  if (/(今日|きょう)/.test(input)) {
    return 'today';
  }
  if (/(来週|らいしゅう)/.test(input)) {
    return 'next_week';
  }
  if (/(今週|こんしゅう|週)/.test(input)) {
    return 'week';
  }
  return undefined;
}

/**
 * P3-INTERSECT1: 共通空き（複数参加者）の判定
 * Keywords: 全員、みんな、共通、〜と、〜で空き
 */
function isCommonAvailabilityQuery(input: string, context: IntentContext | undefined): boolean {
  // 明示的な共通空きキーワード
  if (/(全員|みんな|共通|一緒).*空き/.test(input)) {
    return true;
  }
  if (/空き.*(全員|みんな|共通|一緒)/.test(input)) {
    return true;
  }
  // 「〜と空いてる」「〜で空いてる」パターン
  if (/(と|で).*(空き|空いて|フリー)/.test(input)) {
    return true;
  }
  // スレッドが選択されている状態で「全員」「このスレッド」
  if (context?.selectedThreadId && /(全員|このスレッド|参加者)/.test(input)) {
    return true;
  }
  return false;
}

/**
 * カレンダー関連の分類器
 */
export const classifyCalendar: ClassifierFn = (
  _input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
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
  // P3-INTERSECT1: schedule.freebusy.batch (共通空き)
  // 複数参加者の空きを計算
  // Keywords: 全員、みんな、共通、〜と空き
  // NOTE: 「追加候補」「もっと候補」「候補出して」はproposeに委譲
  // ============================================================
  // 「追加」「もっと」と「候補」の組み合わせ、および「候補出して」は propose に委譲
  if (/(追加.?候補|もっと.?候補|追加で.?候補|追加して|候補.*出して)/.test(normalizedInput)) {
    return null; // proposeに委譲
  }
  if (/(空き|あき|空いて|あいて|フリー|候補|枠)/.test(normalizedInput)) {
    // 共通空きかどうか判定
    const isCommon = isCommonAvailabilityQuery(normalizedInput, context);
    
    // Extract range
    const extractedRange = extractRange(normalizedInput);
    const range = extractedRange || 'week'; // Default to week
    
    // P3-SLOTGEN1: Extract time preference
    const prefer = extractTimePreference(normalizedInput);
    
    // Confidence calculation
    const hasTimeReference = extractedRange !== undefined;
    const hasPreference = prefer !== undefined;
    
    // Higher confidence if both are specified
    let confidence = 0.7;
    if (hasTimeReference && hasPreference) {
      confidence = 0.95;
    } else if (hasTimeReference || hasPreference) {
      confidence = 0.9;
    }
    
    // Build params
    const params: Record<string, unknown> = { range };
    if (prefer) {
      params.prefer = prefer;
    }
    
    // P3-INTERSECT1: 共通空きの場合
    if (isCommon) {
      // スレッドが選択されていれば threadId を追加
      if (context?.selectedThreadId) {
        params.threadId = context.selectedThreadId;
      }
      
      return {
        intent: 'schedule.freebusy.batch',
        confidence: confidence + 0.05, // 共通空きはより具体的なのでconfidence UP
        params,
      };
    }
    
    // Need clarification only if nothing is specified
    const needsClarification = !hasTimeReference && !hasPreference
      ? {
          field: 'range',
          message: '今日、今週、来週のどの期間の空き時間ですか？（例: 「来週の午後の空き」）',
        }
      : undefined;

    return {
      intent: 'schedule.freebusy',
      confidence,
      params,
      needsClarification,
    };
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};
