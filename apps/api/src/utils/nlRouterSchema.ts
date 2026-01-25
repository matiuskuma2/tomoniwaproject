/**
 * nlRouterSchema.ts
 * CONV-1.0: calendar限定のAIルーティング用Zodスキーマ
 * CONV-1.2: multi-intent対応（招待/リマインド/リスト/連絡先/グループ）
 * 
 * 設計原則:
 * - calendar系（READ-ONLY）は即実行
 * - write_local系は即実行
 * - write_external系はpending.actionへ合流（必ず確認）
 * - unknownは雑談フォールバックへ
 */

import { z } from 'zod';

// ============================================================
// calendar-only intents
// ============================================================

// ============================================================
// CONV-1.0: calendar-only intents (READ-ONLY)
// ============================================================

export const CalendarIntentEnum = z.enum([
  'schedule.today',
  'schedule.week',
  'schedule.freebusy',
  'schedule.freebusy.batch',
]);

export type CalendarIntent = z.infer<typeof CalendarIntentEnum>;

// ============================================================
// CONV-1.2: multi-intent対応
// ============================================================

export const MultiIntentEnum = z.enum([
  // Calendar (READ-ONLY) - 即実行
  'schedule.today',
  'schedule.week',
  'schedule.freebusy',
  'schedule.freebusy.batch',
  // Thread/Progress (READ-ONLY) - 即実行
  'schedule.status.check',
  'thread.summary',
  // Invite (WRITE_LOCAL then WRITE_EXTERNAL) - pendingへ合流
  'invite.prepare.emails',
  'invite.prepare.list',
  // Remind (WRITE_LOCAL then WRITE_EXTERNAL) - pendingへ合流
  'schedule.remind.pending',
  'schedule.remind.need_response',
  'schedule.remind.responded',
  // Notify (WRITE_EXTERNAL) - pendingへ合流
  'schedule.notify.confirmed',
  // List (WRITE_LOCAL) - 即実行
  'list.create',
  'list.list',
  'list.members',
  'list.add_member',
  'list.delete',
  // Contacts (WRITE_LOCAL) - 即実行
  'contacts.add',
  'contacts.list',
  // Group (WRITE_LOCAL) - 即実行 or pendingへ合流
  'group.create',
  'group.list',
  'group.invite',
  // Preference (WRITE_LOCAL) - 即実行
  'preference.set',
  'preference.show',
  'preference.clear',
  // Failure (WRITE_LOCAL) - 即実行
  'schedule.fail.report',
  // Chat (NONE) - 雑談フォールバック
  'chat.general',
  // Unknown
  'unknown',
]);

export type MultiIntent = z.infer<typeof MultiIntentEnum>;

// Legacy alias for backward compatibility
export const IntentEnum = CalendarIntentEnum.or(z.literal('unknown'));
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

// ============================================================
// CONV-1.2: Multi-intent Route Schema
// ============================================================

/**
 * Side effect types for policy gate
 */
export type SideEffectType = 'none' | 'read' | 'write_local' | 'write_external';

/**
 * Intent metadata for policy gate
 */
export interface IntentMetadata {
  intent: MultiIntent;
  side_effect: SideEffectType;
  requires_confirmation: boolean;
  confirmation_prompt?: string;
}

/**
 * CONV-1.2 Route Result Schema
 */
export const MultiRouteResultSchema = z.object({
  intent: MultiIntentEnum,
  confidence: z.number().min(0).max(1),
  params: z.record(z.any()).default({}),
  side_effect: z.enum(['none', 'read', 'write_local', 'write_external']).default('read'),
  requires_confirmation: z.boolean().default(false),
  confirmation_prompt: z.string().optional(),
  rationale: z.string().optional(),
  needs_clarification: z
    .object({
      field: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type MultiRouteResult = z.infer<typeof MultiRouteResultSchema>;

/**
 * CONV-1.2 Multi-intent Request Schema
 */
export const MultiRouteRequestSchema = z.object({
  text: z.string().min(1),
  context: z
    .object({
      selected_thread_id: z.string().nullable().optional(),
      viewer_timezone: z.string().optional().default('Asia/Tokyo'),
      has_pending_action: z.boolean().optional(),
    })
    .optional(),
});

export type MultiRouteRequest = z.infer<typeof MultiRouteRequestSchema>;

/**
 * Intent side effect mapping (SSOT from intent_catalog.json)
 * write_external系は必ずpendingへ合流
 */
export const INTENT_SIDE_EFFECTS: Record<MultiIntent, SideEffectType> = {
  // Calendar (READ)
  'schedule.today': 'read',
  'schedule.week': 'read',
  'schedule.freebusy': 'read',
  'schedule.freebusy.batch': 'read',
  // Thread/Progress (READ)
  'schedule.status.check': 'read',
  'thread.summary': 'read',
  // Invite (WRITE_LOCAL → pending → WRITE_EXTERNAL)
  'invite.prepare.emails': 'write_local',
  'invite.prepare.list': 'write_local',
  // Remind (WRITE_LOCAL → pending → WRITE_EXTERNAL)
  'schedule.remind.pending': 'write_local',
  'schedule.remind.need_response': 'write_local',
  'schedule.remind.responded': 'write_local',
  // Notify (WRITE_LOCAL → pending → WRITE_EXTERNAL)
  'schedule.notify.confirmed': 'write_local',
  // List (WRITE_LOCAL)
  'list.create': 'write_local',
  'list.list': 'read',
  'list.members': 'read',
  'list.add_member': 'write_local',
  'list.delete': 'write_local',
  // Contacts (WRITE_LOCAL)
  'contacts.add': 'write_local',
  'contacts.list': 'read',
  // Group
  'group.create': 'write_local',
  'group.list': 'read',
  'group.invite': 'write_local',
  // Preference (WRITE_LOCAL)
  'preference.set': 'write_local',
  'preference.show': 'read',
  'preference.clear': 'write_local',
  // Failure (WRITE_LOCAL)
  'schedule.fail.report': 'write_local',
  // Chat (NONE)
  'chat.general': 'none',
  // Unknown
  'unknown': 'none',
};

/**
 * Intents that require confirmation before execution
 */
export const INTENTS_REQUIRING_CONFIRMATION: MultiIntent[] = [
  'invite.prepare.emails',
  'invite.prepare.list',
  'schedule.remind.pending',
  'schedule.remind.need_response',
  'schedule.remind.responded',
  'schedule.notify.confirmed',
  'list.delete',
  'group.invite',
];
