/**
 * nlRouter/types.ts
 * CONV-1: AIフォールバック用の型定義
 * 
 * 設計原則:
 * - AIは「解釈→意図→必要パラメータ→確認要否」のみを返す
 * - 実行は既存の apiExecutor.ts / executors/* で行う
 * - 既存の IntentType / IntentResult との互換性を維持
 */

import { z } from 'zod';
import type { IntentType } from '../classifier/types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// 1. nlRouter 入力スキーマ
// ============================================================

/**
 * nlRouter への入力
 */
export interface NlRouterInput {
  /** ユーザーの発話（生テキスト） */
  rawInput: string;
  
  /** 正規化済み入力（小文字、トリム済み） */
  normalizedInput: string;
  
  /** 文脈情報 */
  context: NlRouterContext;
  
  /** ロケール */
  locale: 'ja' | 'en';
  
  /** タイムゾーン */
  timezone: string;
}

/**
 * nlRouter に渡す文脈
 */
export interface NlRouterContext {
  /** 選択中のスレッドID */
  selectedThreadId?: string;
  
  /** 選択中のスロットID */
  selectedSlotId?: string;
  
  /** 現在のスレッドに紐づく pending */
  pendingForThread?: PendingState | null;
  
  /** グローバルな pending（スレッド非依存） */
  globalPendingAction?: PendingState | null;
  
  /** 直近の会話履歴（最大5件） */
  recentMessages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  
  /** スレッドのタイトル（ある場合） */
  threadTitle?: string;
  
  /** スレッドの現在の状態（ある場合） */
  threadStatus?: 'draft' | 'sent' | 'confirmed' | 'cancelled';
}

// ============================================================
// 2. ActionPlan スキーマ（AI出力）
// ============================================================

/**
 * 人数構造（Topology）
 */
export const TopologySchema = z.enum(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
export type Topology = z.infer<typeof TopologySchema>;

/**
 * 参加条件ルール
 */
export const ParticipationRuleSchema = z.enum(['AND', 'OR', 'VOTE']);
export type ParticipationRule = z.infer<typeof ParticipationRuleSchema>;

/**
 * 可視性レベル
 */
export const VisibilityLevelSchema = z.enum(['V0', 'V1', 'V2', 'V3']);
export type VisibilityLevel = z.infer<typeof VisibilityLevelSchema>;

/**
 * 確定ルール
 */
export const CommitRuleSchema = z.enum(['manual', 'auto', 'tentative', 'proxy']);
export type CommitRule = z.infer<typeof CommitRuleSchema>;

/**
 * 時間帯プリファレンス
 */
export const TimePreferenceSchema = z.enum(['morning', 'afternoon', 'evening', 'business']);
export type TimePreference = z.infer<typeof TimePreferenceSchema>;

/**
 * 範囲指定
 */
export const RangeSchema = z.enum(['today', 'week', 'next_week']);
export type Range = z.infer<typeof RangeSchema>;

/**
 * 参加者情報
 */
export const ParticipantInfoSchema = z.object({
  type: z.enum(['organizer', 'app_user', 'external']),
  userId: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
});
export type ParticipantInfo = z.infer<typeof ParticipantInfoSchema>;

/**
 * 不足情報の質問
 */
export const ClarificationSchema = z.object({
  field: z.string(),
  question: z.string(),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

/**
 * 次のアクション提案（CONV-2用）
 */
export const SuggestedActionSchema = z.object({
  label: z.string(),
  intent: z.string(), // IntentType として扱う
  params: z.record(z.string(), z.any()).optional(),
});
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

/**
 * ActionPlan パラメータ
 */
export const ActionPlanParamsSchema = z.object({
  range: RangeSchema.optional(),
  prefer: TimePreferenceSchema.optional(),
  duration_minutes: z.number().int().positive().optional(),
  threadId: z.string().optional(),
  slotId: z.string().optional(),
  participants: z.array(ParticipantInfoSchema).optional(),
  emails: z.array(z.string().email()).optional(),
  listName: z.string().optional(),
  decision: z.enum(['send', 'cancel', 'new_thread']).optional(),
});
export type ActionPlanParams = z.infer<typeof ActionPlanParamsSchema>;

/**
 * ActionPlan メタ情報（メタモデル7要素の一部）
 */
export const ActionPlanMetaSchema = z.object({
  topology: TopologySchema.optional(),
  participation_rule: ParticipationRuleSchema.optional(),
  visibility_level: VisibilityLevelSchema.optional(),
  commit_rule: CommitRuleSchema.optional(),
}).optional();
export type ActionPlanMeta = z.infer<typeof ActionPlanMetaSchema>;

/**
 * ActionPlan（AI の出力）
 * 
 * AI は以下のいずれかを返す:
 * 1. 既知の intent + params → 実行可能
 * 2. clarifications → 不足情報を質問
 * 3. unknown + メッセージ → 対応不可
 */
export const ActionPlanSchema = z.object({
  /** 既存の IntentType に落とす */
  intent: z.string(), // IntentType として扱う
  
  /** パラメータ */
  params: ActionPlanParamsSchema.optional().default({}),
  
  /** メタモデル要素 */
  meta: ActionPlanMetaSchema,
  
  /** 確認が必要か */
  requires_confirm: z.boolean().default(false),
  
  /** 不足情報の質問（これがある場合は実行しない） */
  clarifications: z.array(ClarificationSchema).optional(),
  
  /** 応答スタイル */
  response_style: z.enum(['brief', 'detailed', 'conversational']).default('brief'),
  
  /** 次のアクション提案（CONV-2用） */
  suggested_next_actions: z.array(SuggestedActionSchema).optional(),
  
  /** AI の信頼度 (0.0 - 1.0) */
  confidence: z.number().min(0).max(1).default(0.5),
  
  /** AI からのメッセージ（ユーザーへの返答） */
  message: z.string().optional(),
});
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

// ============================================================
// 3. nlRouter 出力スキーマ
// ============================================================

/**
 * nlRouter の出力
 */
export interface NlRouterOutput {
  /** AI が正常に解釈できたか */
  success: boolean;
  
  /** ActionPlan（成功時） */
  actionPlan?: ActionPlan;
  
  /** エラー情報（失敗時） */
  error?: {
    code: 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'AI_ERROR' | 'TIMEOUT';
    message: string;
    raw?: string; // AI の生出力（デバッグ用）
  };
  
  /** 処理時間（ms） */
  latencyMs: number;
}

// ============================================================
// 4. policyGate 用の型
// ============================================================

/**
 * policyGate の判定結果
 */
export interface PolicyGateResult {
  /** 実行を許可するか */
  allowed: boolean;
  
  /** 確認が必要か（allowed=true でも true の場合あり） */
  requiresConfirm: boolean;
  
  /** ブロック理由（allowed=false の場合） */
  blockReason?: string;
  
  /** 代替として提案する質問（ブロック時） */
  fallbackQuestion?: string;
}

// ============================================================
// 5. 監査ログ用の型
// ============================================================

/**
 * nlRouter のログエントリ
 */
export interface NlRouterLog {
  id: string;
  timestamp: string;
  user_id: string;
  
  // 入力
  user_message: string;
  context: NlRouterContext;
  
  // AI出力
  ai_response_raw?: string;
  action_plan?: ActionPlan;
  validation_errors?: string[];
  
  // メタモデル判定結果
  detected_topology?: Topology;
  detected_participation_rule?: ParticipationRule;
  
  // 実行結果
  final_intent: IntentType;
  executed: boolean;
  execution_result?: string;
  
  // 状態遷移
  state_before?: string;
  state_after?: string;
  
  // パフォーマンス
  latency_ms: number;
}

// ============================================================
// 6. フォールバック質問テンプレート
// ============================================================

/**
 * unknown 時の質問テンプレート
 */
export const FALLBACK_QUESTIONS: Record<string, string> = {
  missing_thread: '対象のスレッドを選択してください',
  missing_range: '期間を教えてください（例: 今週、来週）',
  missing_participants: '参加者を教えてください（メールアドレスまたはリスト名）',
  missing_topology: '参加者は「全員」ですか？それとも「誰か1人」でいいですか？',
  ambiguous_action: '何をしたいですか？\n- 空き時間を確認\n- 招待を送る\n- リマインドを送る',
  missing_slot: '候補の番号を教えてください（例: 1番で）',
  missing_decision: '「送る」「キャンセル」「別スレッドで」のいずれかを選んでください',
};

// ============================================================
// 7. Intent許可リスト（nlRouter が出せる intent）
// ============================================================

/**
 * nlRouter が出力できる IntentType の一覧
 * intent_catalog.json から side_effect: read または write_local のみ
 * write_external は確認フローを経由するため、直接は出さない
 */
export const ALLOWED_INTENTS_FOR_AI: IntentType[] = [
  // calendar.read
  'schedule.today',
  'schedule.week',
  'schedule.freebusy',
  'schedule.freebusy.batch',
  
  // thread.read
  'schedule.status.check',
  'schedule.invite.list',
  
  // invite.prepare（確認フローに入る）
  'invite.prepare.emails',
  'invite.prepare.list',
  
  // pending.decide
  'pending.action.decide',
  
  // schedule.propose
  'schedule.auto_propose',
  'schedule.additional_propose',
  
  // schedule.remind（確認フローに入る）
  'schedule.remind.pending',
  'schedule.need_response.list',
  'schedule.remind.need_response',
  'schedule.remind.responded',
  
  // schedule.notify
  'schedule.notify.confirmed',
  
  // schedule.commit
  'schedule.finalize',
  
  // schedule.reschedule
  'schedule.reschedule',
  
  // preference
  'preference.set',
  'preference.show',
  'preference.clear',
  
  // list
  'list.create',
  'list.list',
  'list.members',
  'list.add_member',
  
  // fallback
  'unknown',
];

/**
 * AI が返した intent が許可リストに含まれるか確認
 */
export function isAllowedIntent(intent: string): intent is IntentType {
  return ALLOWED_INTENTS_FOR_AI.includes(intent as IntentType);
}
