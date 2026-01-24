/**
 * slotScorer.ts
 * P3-GEN1: スロットのスコアリング（好み適用）
 * 
 * 設計方針:
 * - 各参加者の SchedulePrefs を使ってスロットをスコアリング
 * - time_windows にマッチ → +weight
 * - avoid_windows にマッチ → -weight
 * - 直近の枠は微小な負のスコア（タイブレーカー）
 * - 未設定の参加者はスコア0（フォールバック）
 */

import type { AvailableSlot } from './slotGenerator';
import {
  SchedulePrefs,
  ScoreReason,
  ScoredSlot,
  isSlotMatchingRule,
  PROXIMITY_SCORE_FACTOR,
  DEFAULT_PREFS_TIMEZONE,
} from './schedulePrefs';

// ============================================================
// Types
// ============================================================

export interface ParticipantPrefs {
  userId: string;
  name?: string;           // 表示用名前
  prefs: SchedulePrefs | null;  // null = 未設定
}

export interface SlotScorerParams {
  slots: AvailableSlot[];
  participantPrefs: ParticipantPrefs[];
  maxResults?: number;     // 出力する最大件数（デフォルト: 8）
  timezone?: string;       // スコアリング用タイムゾーン
  now?: Date;              // 現在時刻（テスト用）
}

export interface SlotScorerResult {
  scored_slots: ScoredSlot[];
  total_slots: number;
  has_preferences: boolean;  // 好み設定を持つ参加者がいるか
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_MAX_RESULTS = 8;

// ============================================================
// Scoring Logic
// ============================================================

/**
 * 単一スロットの単一参加者からのスコアを計算
 */
function scoreSlotForParticipant(
  slotStart: Date,
  participant: ParticipantPrefs,
  timezone: string
): { score: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = [];
  let score = 0;
  
  const prefs = participant.prefs;
  if (!prefs) {
    // 未設定の参加者 → スコア0
    return { score: 0, reasons: [] };
  }
  
  const prefsTimezone = prefs.timezone || timezone;
  
  // time_windows（好む時間帯）のチェック
  if (prefs.time_windows) {
    for (const rule of prefs.time_windows) {
      if (isSlotMatchingRule(slotStart, rule, prefsTimezone)) {
        score += rule.weight;
        reasons.push({
          source: participant.userId,
          label: rule.label || `${rule.start}-${rule.end}`,
          delta: rule.weight,
        });
      }
    }
  }
  
  // avoid_windows（避けたい時間帯）のチェック
  if (prefs.avoid_windows) {
    for (const rule of prefs.avoid_windows) {
      if (isSlotMatchingRule(slotStart, rule, prefsTimezone)) {
        // avoid_windowsの weight は負として扱う
        const delta = -Math.abs(rule.weight);
        score += delta;
        reasons.push({
          source: participant.userId,
          label: `回避: ${rule.label || `${rule.start}-${rule.end}`}`,
          delta,
        });
      }
    }
  }
  
  return { score, reasons };
}

/**
 * 直近の枠へのスコア（タイブレーカー）
 */
function calculateProximityScore(slotStart: Date, now: Date): { score: number; reason: ScoreReason | null } {
  const hoursFromNow = (slotStart.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  // 過去の枠は大きく減点
  if (hoursFromNow < 0) {
    return {
      score: -1000,
      reason: {
        source: 'proximity',
        label: '過去の枠',
        delta: -1000,
      },
    };
  }
  
  // 微小な負のスコア（直近が優先）
  const score = PROXIMITY_SCORE_FACTOR * hoursFromNow;
  
  // スコアが小さすぎる場合は理由を省略
  if (Math.abs(score) < 0.01) {
    return { score, reason: null };
  }
  
  return {
    score,
    reason: {
      source: 'proximity',
      label: '直近',
      delta: score,
    },
  };
}

/**
 * スロット配列をスコアリング
 * 
 * @param params - スコアリングパラメータ
 * @returns スコア付きスロット配列
 */
export function scoreSlots(params: SlotScorerParams): SlotScorerResult {
  const {
    slots,
    participantPrefs,
    maxResults = DEFAULT_MAX_RESULTS,
    timezone = DEFAULT_PREFS_TIMEZONE,
    now = new Date(),
  } = params;
  
  // 好み設定を持つ参加者がいるか
  const hasPreferences = participantPrefs.some(p => p.prefs !== null);
  
  // 各スロットをスコアリング
  const scoredSlots: ScoredSlot[] = slots.map(slot => {
    const slotStart = new Date(slot.start_at);
    let totalScore = 0;
    const allReasons: ScoreReason[] = [];
    
    // 各参加者の好みでスコアリング
    for (const participant of participantPrefs) {
      const { score, reasons } = scoreSlotForParticipant(slotStart, participant, timezone);
      totalScore += score;
      allReasons.push(...reasons);
    }
    
    // 直近スコア（タイブレーカー）
    const { score: proximityScore, reason: proximityReason } = calculateProximityScore(slotStart, now);
    totalScore += proximityScore;
    if (proximityReason) {
      allReasons.push(proximityReason);
    }
    
    return {
      start_at: slot.start_at,
      end_at: slot.end_at,
      label: slot.label,
      score: Math.round(totalScore * 1000) / 1000,  // 小数3桁に丸め
      reasons: allReasons,
    };
  });
  
  // スコアで降順ソート（同点なら元の順序維持＝start_at昇順）
  scoredSlots.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // 同点の場合は start_at で昇順
    return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
  });
  
  // 上位 maxResults 件を返す
  return {
    scored_slots: scoredSlots.slice(0, maxResults),
    total_slots: scoredSlots.length,
    has_preferences: hasPreferences,
  };
}

/**
 * スコア理由を要約（上位N件のみ）
 * 
 * @param reasons - 理由配列
 * @param maxReasons - 表示する最大件数
 * @returns 要約文字列
 */
export function summarizeReasons(reasons: ScoreReason[], maxReasons: number = 3): string {
  if (reasons.length === 0) return '';
  
  // delta の絶対値でソートして上位を取得
  const sorted = [...reasons].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = sorted.slice(0, maxReasons);
  
  return top.map(r => {
    const sign = r.delta >= 0 ? '+' : '';
    return `${sign}${r.delta} ${r.label}`;
  }).join(', ');
}

/**
 * ユーザー名付きの理由を生成（チャット表示用）
 * 
 * @param reasons - 理由配列
 * @param userMap - userId → 名前 のマップ
 * @param maxReasons - 表示する最大件数
 * @returns ユーザー名付きの理由文字列
 */
export function formatReasonsWithUsers(
  reasons: ScoreReason[],
  userMap: Map<string, string>,
  maxReasons: number = 3
): string {
  if (reasons.length === 0) return '';
  
  // delta の絶対値でソートして上位を取得
  const sorted = [...reasons].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = sorted.slice(0, maxReasons);
  
  return top.map(r => {
    const sign = r.delta >= 0 ? '+' : '';
    const userName = r.source === 'proximity' ? '' : (userMap.get(r.source) || r.source);
    if (userName) {
      return `${sign}${r.delta} ${userName}: ${r.label}`;
    }
    return `${sign}${r.delta} ${r.label}`;
  }).join(', ');
}
