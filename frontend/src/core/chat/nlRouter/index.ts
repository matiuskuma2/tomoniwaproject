/**
 * nlRouter/index.ts
 * CONV-1: AIフォールバックモジュールのエントリポイント
 * 
 * 使い方:
 * ```typescript
 * import { route, classifyWithAiFallback, shouldUseAiFallback } from './nlRouter';
 * 
 * // 1. 直接 AI を呼ぶ場合
 * const output = await route(input, { apiKey: 'xxx' });
 * 
 * // 2. ルールベース + AI フォールバックの統合フロー
 * const result = await classifyWithAiFallback({
 *   input: userInput,
 *   context: nlRouterContext,
 *   ruleResult: classifyIntent(userInput, intentContext),
 *   aiEnabled: true,
 *   aiOptions: { apiKey: 'xxx' }
 * });
 * ```
 */

// ============================================================
// 型定義
// ============================================================

export type {
  // nlRouter 入力
  NlRouterInput,
  NlRouterContext,
  
  // AI 出力（ActionPlan）
  ActionPlan,
  ActionPlanParams,
  ActionPlanMeta,
  Clarification,
  SuggestedAction,
  
  // nlRouter 出力
  NlRouterOutput,
  
  // Policy Gate
  PolicyGateResult,
  
  // メタモデル要素
  Topology,
  ParticipationRule,
  VisibilityLevel,
  CommitRule,
  TimePreference,
  Range,
  ParticipantInfo,
  
  // ログ
  NlRouterLog,
} from './types';

// ============================================================
// スキーマ（Zod）
// ============================================================

export {
  // ActionPlan スキーマ
  ActionPlanSchema,
  ActionPlanParamsSchema,
  ActionPlanMetaSchema,
  ClarificationSchema,
  SuggestedActionSchema,
  
  // メタモデルスキーマ
  TopologySchema,
  ParticipationRuleSchema,
  VisibilityLevelSchema,
  CommitRuleSchema,
  TimePreferenceSchema,
  RangeSchema,
  ParticipantInfoSchema,
  
  // 定数
  FALLBACK_QUESTIONS,
  ALLOWED_INTENTS_FOR_AI,
  
  // ユーティリティ
  isAllowedIntent,
} from './types';

// ============================================================
// nlRouter 本体
// ============================================================

export {
  // メイン関数
  route,
  
  // ヘルパー
  createContext,
  createInput,
  shouldCallNlRouter,
  
  // オプション型
  type NlRouterOptions,
} from './nlRouter';

// ============================================================
// Policy Gate
// ============================================================

export {
  // メイン関数
  applyPolicyGate,
  applyPolicyToActionPlan,
  
  // 判定関数
  shouldUseAiFallback,
} from './policyGate';

// ============================================================
// Executor Bridge
// ============================================================

export {
  // 変換関数
  actionPlanToIntentResult,
  nlRouterOutputToIntentResult,
  
  // 統合フロー
  classifyWithAiFallback,
  type ClassifyWithAiFallbackParams,
  type ClassifyWithAiFallbackResult,
} from './executorBridge';

// ============================================================
// プロンプト生成
// ============================================================

export {
  generateSystemPrompt,
  formatUserPrompt,
} from './systemPrompt';
