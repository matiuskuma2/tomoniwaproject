/**
 * nlPrefsSchema.ts
 * PREF-SET-1: 好み抽出用のZodスキーマ
 * 
 * AIが自然文からSchedulePreferences形式に変換するためのスキーマ
 */

import { z } from 'zod';

// ============================================================
// Input Schema
// ============================================================

export const ExtractPrefsInputSchema = z.object({
  text: z.string().min(1).describe('ユーザーの発話（好み設定に関する自然文）'),
  viewer_timezone: z.string().default('Asia/Tokyo'),
  existing_prefs: z.any().optional().describe('既存のSchedulePreferences（マージ用）'),
});

export type ExtractPrefsInput = z.infer<typeof ExtractPrefsInputSchema>;

// ============================================================
// Output Schema
// ============================================================

/**
 * 曜日（0=日, 1=月, ..., 6=土）
 */
const DowSchema = z.array(z.number().min(0).max(6));

/**
 * 時間帯ルール
 */
const TimeWindowSchema = z.object({
  dow: DowSchema.describe('対象曜日（0=日, 1=月, ..., 6=土）'),
  start: z.string().regex(/^\d{2}:\d{2}$/).describe('開始時刻 (HH:mm)'),
  end: z.string().regex(/^\d{2}:\d{2}$/).describe('終了時刻 (HH:mm)'),
  weight: z.number().describe('スコア重み（正=優先、負=回避）'),
  label: z.string().optional().describe('ラベル（表示用）'),
});

/**
 * 抽出されたprefsの変更内容
 */
const ProposedChangeSchema = z.object({
  op: z.enum(['add', 'remove', 'replace']).describe('操作種別'),
  path: z.string().describe('変更対象パス（例: windows[0], avoid[1]）'),
  value: z.any().optional().describe('新しい値'),
  reason: z.string().describe('変更理由（日本語）'),
});

/**
 * AI抽出結果
 */
export const ExtractPrefsOutputSchema = z.object({
  // 抽出された好み設定
  proposed_prefs: z.object({
    windows: z.array(TimeWindowSchema).optional().describe('追加する優先時間帯'),
    avoid: z.array(TimeWindowSchema).optional().describe('追加する回避時間帯'),
    min_notice_hours: z.number().optional().describe('最小通知時間（時間）'),
    meeting_length_min: z.number().optional().describe('会議の長さ（分）'),
    max_end_time: z.string().optional().describe('最終終了時刻'),
  }).describe('抽出された好み設定'),
  
  // 変更内容の詳細
  changes: z.array(ProposedChangeSchema).describe('変更内容の詳細'),
  
  // 日本語サマリ
  summary: z.string().describe('抽出内容のサマリ（日本語）'),
  
  // マージ後のprefs（既存 + 新規）
  merged_prefs: z.object({
    windows: z.array(TimeWindowSchema).optional(),
    avoid: z.array(TimeWindowSchema).optional(),
    min_notice_hours: z.number().optional(),
    meeting_length_min: z.number().optional(),
    max_end_time: z.string().optional(),
  }).optional().describe('マージ後の完全なprefs'),
  
  // 信頼度
  confidence: z.number().min(0).max(1).describe('抽出の信頼度'),
  
  // 確認が必要か
  needs_confirmation: z.literal(true).default(true).describe('常にtrue（保存前に確認が必要）'),
});

export type ExtractPrefsOutput = z.infer<typeof ExtractPrefsOutputSchema>;

// ============================================================
// Route Response Schema
// ============================================================

export const ExtractPrefsResponseSchema = z.object({
  success: z.boolean(),
  data: ExtractPrefsOutputSchema.optional(),
  error: z.object({
    code: z.enum(['PARSE_ERROR', 'VALIDATION_ERROR', 'AI_ERROR', 'NO_PREFS_FOUND']),
    message: z.string(),
  }).optional(),
});

export type ExtractPrefsResponse = z.infer<typeof ExtractPrefsResponseSchema>;
