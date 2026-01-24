/**
 * nlRouter/executorBridge.ts
 * CONV-1: ActionPlan → IntentResult 変換
 * 
 * 設計原則:
 * - AI の ActionPlan を既存の IntentResult に変換
 * - 既存の実行パイプライン（apiExecutor.ts / executors/*）に委譲
 * - 変換時に安全性チェック（policyGate）を適用
 */

import type { ActionPlan, NlRouterContext, NlRouterOutput } from './types';
import type { IntentResult, IntentType } from '../classifier/types';
import { applyPolicyGate, applyPolicyToActionPlan } from './policyGate';

// ============================================================
// 変換関数
// ============================================================

/**
 * ActionPlan を IntentResult に変換
 * 
 * @param actionPlan - AI が生成した ActionPlan
 * @param context - 現在の文脈
 * @returns IntentResult（既存の実行パイプラインに渡せる形式）
 */
export function actionPlanToIntentResult(
  actionPlan: ActionPlan,
  context: NlRouterContext
): IntentResult {
  // 1. Policy Gate を適用
  const gateResult = applyPolicyGate(actionPlan, context);
  const safeActionPlan = applyPolicyToActionPlan(actionPlan, gateResult);

  // 2. IntentResult に変換
  const intentResult: IntentResult = {
    intent: safeActionPlan.intent as IntentType,
    confidence: safeActionPlan.confidence,
    params: buildParams(safeActionPlan, context),
  };

  // 3. clarifications がある場合は needsClarification を設定
  if (safeActionPlan.clarifications && safeActionPlan.clarifications.length > 0) {
    const firstClarification = safeActionPlan.clarifications[0];
    intentResult.needsClarification = {
      field: firstClarification.field,
      message: firstClarification.question,
    };
  }

  // 4. message がある場合も needsClarification として扱う（unknown の場合）
  if (safeActionPlan.intent === 'unknown' && safeActionPlan.message && !intentResult.needsClarification) {
    intentResult.needsClarification = {
      field: 'intent',
      message: safeActionPlan.message,
    };
  }

  return intentResult;
}

/**
 * ActionPlan の params を IntentResult の params に変換
 */
function buildParams(
  actionPlan: ActionPlan,
  context: NlRouterContext
): Record<string, any> {
  const params: Record<string, any> = {};
  const ap = actionPlan.params || {};

  // 基本パラメータをコピー
  if (ap.range) params.range = ap.range;
  if (ap.prefer) params.prefer = ap.prefer;
  if (ap.duration_minutes) params.meetingLength = ap.duration_minutes;
  if (ap.threadId) params.threadId = ap.threadId;
  if (ap.slotId) params.slotId = ap.slotId;
  if (ap.emails) params.emails = ap.emails;
  if (ap.listName) params.listName = ap.listName;
  if (ap.decision) params.decision = ap.decision;
  if (ap.participants) params.participants = ap.participants;

  // 文脈から自動補完
  // threadId が未設定で selectedThreadId がある場合
  if (!params.threadId && context.selectedThreadId) {
    // スレッド依存の Intent の場合のみ補完
    const threadDependentIntents = [
      'schedule.status.check',
      'schedule.invite.list',
      'schedule.freebusy.batch',
      'schedule.remind.pending',
      'schedule.remind.need_response',
      'schedule.remind.responded',
      'schedule.notify.confirmed',
      'schedule.finalize',
      'schedule.reschedule',
      'schedule.additional_propose',
      'schedule.propose_for_split',
    ];
    if (threadDependentIntents.includes(actionPlan.intent)) {
      params.threadId = context.selectedThreadId;
    }
  }

  // range のデフォルト
  const rangeRequiredIntents = [
    'schedule.freebusy',
    'schedule.freebusy.batch',
    'schedule.auto_propose',
  ];
  if (rangeRequiredIntents.includes(actionPlan.intent) && !params.range) {
    params.range = 'week'; // デフォルト
  }

  // requires_confirm フラグ
  if (actionPlan.requires_confirm) {
    params._requires_confirm = true;
  }

  // AI メタ情報（デバッグ用）
  params._ai_confidence = actionPlan.confidence;
  if (actionPlan.meta) {
    params._ai_meta = actionPlan.meta;
  }

  return params;
}

// ============================================================
// NlRouterOutput → IntentResult 変換
// ============================================================

/**
 * NlRouterOutput を IntentResult に変換
 * 
 * @param output - nlRouter の出力
 * @param context - 現在の文脈
 * @returns IntentResult
 */
export function nlRouterOutputToIntentResult(
  output: NlRouterOutput,
  context: NlRouterContext
): IntentResult {
  // AI が失敗した場合
  if (!output.success || !output.actionPlan) {
    return {
      intent: 'unknown',
      confidence: 0,
      params: {
        _ai_error: output.error?.code || 'UNKNOWN',
        _ai_error_message: output.error?.message,
        _ai_latency_ms: output.latencyMs,
      },
      needsClarification: {
        field: 'intent',
        message: getErrorMessage(output.error?.code),
      },
    };
  }

  // ActionPlan を変換
  const intentResult = actionPlanToIntentResult(output.actionPlan, context);

  // レイテンシを記録
  intentResult.params._ai_latency_ms = output.latencyMs;

  return intentResult;
}

/**
 * エラーコードに応じたメッセージを取得
 */
function getErrorMessage(code?: string): string {
  switch (code) {
    case 'PARSE_ERROR':
      return '申し訳ございません。応答の解析に失敗しました。もう一度お試しください。';
    case 'VALIDATION_ERROR':
      return '申し訳ございません。操作を特定できませんでした。もう少し詳しく教えてください。';
    case 'AI_ERROR':
      return '申し訳ございません。一時的なエラーが発生しました。もう一度お試しください。';
    case 'TIMEOUT':
      return '申し訳ございません。応答に時間がかかっています。もう一度お試しください。';
    default:
      return '申し訳ございません。理解できませんでした。\n\n以下のような指示ができます：\n- 「〇〇さんに日程調整送って」（調整作成）\n- 「状況教えて」（進捗確認）\n- 「1番で確定して」（日程確定）';
  }
}

// ============================================================
// 統合フロー（classifyIntent の拡張版）
// ============================================================

export interface ClassifyWithAiFallbackParams {
  input: string;
  context: NlRouterContext;
  ruleResult: IntentResult | null;
  aiEnabled: boolean;
  aiOptions?: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
  };
}

export interface ClassifyWithAiFallbackResult {
  intentResult: IntentResult;
  source: 'rule' | 'ai' | 'fallback';
  aiLatencyMs?: number;
}

/**
 * ルールベース分類 + AI フォールバックの統合フロー
 * 
 * 注意: この関数は async なので、呼び出し側も async にする必要がある
 * CONV-1 では classifier/index.ts からは呼ばず、apiExecutor.ts で呼ぶ
 */
export async function classifyWithAiFallback(
  params: ClassifyWithAiFallbackParams
): Promise<ClassifyWithAiFallbackResult> {
  const { input, context, ruleResult, aiEnabled, aiOptions } = params;

  // ルール分類が成功している場合はそのまま返す
  if (ruleResult && ruleResult.intent !== 'unknown' && ruleResult.confidence >= 0.5) {
    return {
      intentResult: ruleResult,
      source: 'rule',
    };
  }

  // AI が無効、または API キーがない場合
  if (!aiEnabled || !aiOptions?.apiKey) {
    return {
      intentResult: ruleResult || getDefaultUnknownResult(),
      source: 'fallback',
    };
  }

  // AI フォールバックを呼ぶべきか判定
  const { shouldUseAiFallback } = await import('./policyGate');
  if (!shouldUseAiFallback(input, ruleResult, context)) {
    return {
      intentResult: ruleResult || getDefaultUnknownResult(),
      source: 'fallback',
    };
  }

  // AI フォールバックを実行
  try {
    const { route, createInput } = await import('./nlRouter');
    const nlInput = createInput(input, context);
    const nlOutput = await route(nlInput, aiOptions);
    const intentResult = nlRouterOutputToIntentResult(nlOutput, context);

    return {
      intentResult,
      source: 'ai',
      aiLatencyMs: nlOutput.latencyMs,
    };
  } catch (error) {
    console.error('[executorBridge] AI fallback error:', error);
    return {
      intentResult: ruleResult || getDefaultUnknownResult(),
      source: 'fallback',
    };
  }
}

/**
 * デフォルトの unknown IntentResult
 */
function getDefaultUnknownResult(): IntentResult {
  return {
    intent: 'unknown',
    confidence: 0,
    params: {},
    needsClarification: {
      field: 'intent',
      message:
        '申し訳ございません。理解できませんでした。\n\n以下のような指示ができます：\n- 「〇〇さんに日程調整送って」（調整作成）\n- 「状況教えて」（進捗確認）\n- 「1番で確定して」（日程確定）',
    },
  };
}
