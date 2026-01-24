/**
 * nlRouterSchema.ts
 * CONV-1.0: calendar限定のAIルーティング用Zodスキーマ
 * 
 * 設計原則:
 * - calendar系（READ-ONLY）のみ対応
 * - write系（invite/remind/finalize等）は対象外
 * - unknown時のフォールバック用
 */

import { z } from 'zod';

// ============================================================
// calendar-only intents
// ============================================================

export const IntentEnum = z.enum([
  'schedule.today',
  'schedule.week',
  'schedule.freebusy',
  'schedule.freebusy.batch',
  'unknown',
]);

export type NlRouterIntent = z.infer<typeof IntentEnum>;

// ============================================================
// Parameter enums
// ============================================================

export const RangeEnum = z.enum(['today', 'week', 'next_week']);
export type NlRouterRange = z.infer<typeof RangeEnum>;

export const DayTimeEnum = z.enum(['morning', 'afternoon', 'night']);
export type NlRouterDayTime = z.infer<typeof DayTimeEnum>;

// ============================================================
// Route Result Schema
// ============================================================

export const RouteResultSchema = z.object({
  intent: IntentEnum,
  confidence: z.number().min(0).max(1),
  params: z.record(z.any()).default({}),
  rationale: z.string().optional(),
  needs_clarification: z
    .object({
      field: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type RouteResult = z.infer<typeof RouteResultSchema>;

// ============================================================
// Request Schema
// ============================================================

export const RouteRequestSchema = z.object({
  text: z.string().min(1),
  context: z
    .object({
      selected_thread_id: z.string().nullable().optional(),
      viewer_timezone: z.string().optional().default('Asia/Tokyo'),
    })
    .optional(),
});

export type RouteRequest = z.infer<typeof RouteRequestSchema>;

// ============================================================
// dayTimeWindow → 時間帯マッピング
// ============================================================

export const DAY_TIME_TO_HOURS: Record<NlRouterDayTime, { start: number; end: number }> = {
  morning: { start: 9, end: 12 },
  afternoon: { start: 14, end: 18 },
  night: { start: 18, end: 22 },
};

/**
 * dayTimeWindow を prefer に変換（既存API互換）
 */
export function dayTimeToPrefer(dayTime: NlRouterDayTime | undefined): string | undefined {
  if (!dayTime) return undefined;
  
  // 既存の prefer enum に合わせる
  switch (dayTime) {
    case 'morning':
      return 'morning';
    case 'afternoon':
      return 'afternoon';
    case 'night':
      return 'evening'; // 既存APIは 'evening' を使用
    default:
      return undefined;
  }
}

// ============================================================
// CONV-1.1: Assist Extract Schema（params補完用）
// ============================================================

/**
 * calendar系intentのみ対象
 */
export const AssistTargetIntentEnum = z.enum([
  'schedule.today',
  'schedule.week',
  'schedule.freebusy',
  'schedule.freebusy.batch',
]);

export type AssistTargetIntent = z.infer<typeof AssistTargetIntentEnum>;

/**
 * 拡張された時間帯enum（CONV-1.1）
 */
export const ExtendedDayTimeEnum = z.enum([
  'morning',    // 9-12
  'afternoon',  // 14-18
  'evening',    // 16-20
  'night',      // 18-22
  'daytime',    // 9-18
]);

export type ExtendedDayTime = z.infer<typeof ExtendedDayTimeEnum>;

/**
 * 拡張されたrangeEnum（CONV-1.1）
 */
export const ExtendedRangeEnum = z.enum([
  'today',
  'tomorrow',
  'week',
  'this_week',
  'next_week',
  'this_month',
  'next_month',
]);

export type ExtendedRange = z.infer<typeof ExtendedRangeEnum>;

/**
 * 曜日enum
 */
export const DayOfWeekEnum = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type DayOfWeek = z.infer<typeof DayOfWeekEnum>;

/**
 * Assist Request Schema
 */
export const AssistRequestSchema = z.object({
  text: z.string().min(1),                          // ユーザー原文
  detected_intent: AssistTargetIntentEnum,          // classifier が決めた intent
  existing_params: z.record(z.any()).default({}),   // 現在のparams（上書きしない）
  viewer_timezone: z.string().default('Asia/Tokyo'),
  now_iso: z.string().optional(),                   // 相対表現の解釈用
  context_hint: z.object({
    selected_thread_id: z.string().nullable().optional(),
    participants_count: z.number().optional(),
  }).optional(),
});

export type AssistRequest = z.infer<typeof AssistRequestSchema>;

/**
 * params_patch の型（部分更新のみ）
 */
export const ParamsPatchSchema = z.object({
  range: ExtendedRangeEnum.optional(),
  dayTimeWindow: ExtendedDayTimeEnum.optional(),
  durationMinutes: z.number().min(15).max(480).optional(),
  daysOfWeek: z.array(DayOfWeekEnum).optional(),
  count: z.number().min(1).max(20).optional(),
}).partial();

export type ParamsPatch = z.infer<typeof ParamsPatchSchema>;

/**
 * Assist Response Schema
 */
export const AssistResponseSchema = z.object({
  target_intent: AssistTargetIntentEnum,            // = detected_intent（変更禁止）
  params_patch: ParamsPatchSchema,                  // 部分更新のみ
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),                 // ログ用
});

export type AssistResponse = z.infer<typeof AssistResponseSchema>;

/**
 * 日本語→パラメータ変換テーブル（プロンプト用）
 */
export const JAPANESE_TO_PARAMS = {
  // 時間帯
  '朝': 'morning',
  '午前': 'morning',
  '午後': 'afternoon',
  '夕方': 'evening',
  '夜': 'night',
  '昼': 'daytime',
  '日中': 'daytime',
  
  // 期間
  '今日': 'today',
  '明日': 'tomorrow',
  '今週': 'this_week',
  '来週': 'next_week',
  '今月': 'this_month',
  '来月': 'next_month',
  
  // 曜日
  '月曜': 'mon',
  '火曜': 'tue',
  '水曜': 'wed',
  '木曜': 'thu',
  '金曜': 'fri',
  '土曜': 'sat',
  '日曜': 'sun',
} as const;
