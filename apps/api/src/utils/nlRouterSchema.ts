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
