/**
 * nlRouter/nlRouter.ts
 * CONV-1: AIフォールバック本体
 * 
 * 設計原則:
 * - AIは「解釈→意図→必要パラメータ→確認要否」のみを返す
 * - 実行は既存の apiExecutor.ts / executors/* で行う
 * - unknown/低信頼時のみ呼び出される
 */

import { z } from 'zod';
import {
  ActionPlanSchema,
  type ActionPlan,
  type NlRouterInput,
  type NlRouterOutput,
  type NlRouterContext,
  isAllowedIntent,
  FALLBACK_QUESTIONS,
} from './types';
import { generateSystemPrompt, formatUserPrompt } from './systemPrompt';

// ============================================================
// 設定定数
// ============================================================

const NL_ROUTER_CONFIG = {
  /** AI呼び出しのタイムアウト（ms） */
  timeout: 10000,
  /** 最大リトライ回数 */
  maxRetries: 1,
  /** 低信頼度の閾値（これ以下ならフォールバック） */
  lowConfidenceThreshold: 0.3,
  /** 使用するモデル */
  model: 'gpt-4o-mini',
  /** 温度パラメータ */
  temperature: 0.3,
  /** 最大トークン */
  maxTokens: 500,
} as const;

// ============================================================
// AI アダプター（OpenAI互換）
// ============================================================

interface AIAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIAdapterResponse {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * OpenAI互換のAI呼び出しアダプター
 */
async function callAI(
  messages: AIMessage[],
  options: AIAdapterOptions
): Promise<AIAdapterResponse> {
  const baseUrl = options.baseUrl || 'https://api.openai.com/v1';
  const model = options.model || NL_ROUTER_CONFIG.model;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NL_ROUTER_CONFIG.timeout);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: NL_ROUTER_CONFIG.temperature,
        max_tokens: NL_ROUTER_CONFIG.maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return {
        success: false,
        error: 'Empty response from AI',
      };
    }

    return {
      success: true,
      content,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: 'AI request timeout',
      };
    }
    return {
      success: false,
      error: `AI call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================
// JSON パーサー
// ============================================================

/**
 * AI の出力から JSON を抽出してパース
 */
function extractAndParseJSON(content: string): { success: boolean; data?: unknown; error?: string } {
  // まず直接パースを試みる
  try {
    const data = JSON.parse(content);
    return { success: true, data };
  } catch {
    // 失敗したらコードブロックから抽出
  }

  // ```json ... ``` ブロックを探す
  const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1].trim());
      return { success: true, data };
    } catch {
      return { success: false, error: 'Failed to parse JSON from code block' };
    }
  }

  // { ... } を探す
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]);
      return { success: true, data };
    } catch {
      return { success: false, error: 'Failed to parse extracted JSON' };
    }
  }

  return { success: false, error: 'No JSON found in response' };
}

// ============================================================
// バリデーション
// ============================================================

/**
 * AI出力を ActionPlan としてバリデーション
 */
function validateActionPlan(data: unknown): { success: boolean; actionPlan?: ActionPlan; errors?: string[] } {
  const result = ActionPlanSchema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }

  const actionPlan = result.data;

  // 許可リストチェック
  if (!isAllowedIntent(actionPlan.intent)) {
    return {
      success: false,
      errors: [`Intent "${actionPlan.intent}" is not allowed`],
    };
  }

  return {
    success: true,
    actionPlan,
  };
}

// ============================================================
// メインルーター
// ============================================================

export interface NlRouterOptions {
  /** OpenAI API キー */
  apiKey: string;
  /** ベースURL（オプション） */
  baseUrl?: string;
  /** モデル名（オプション） */
  model?: string;
  /** デバッグモード */
  debug?: boolean;
}

/**
 * nlRouter メイン関数
 * 
 * @param input - ユーザー入力と文脈
 * @param options - AI呼び出しオプション
 * @returns NlRouterOutput
 */
export async function route(
  input: NlRouterInput,
  options: NlRouterOptions
): Promise<NlRouterOutput> {
  const startTime = Date.now();

  // システムプロンプトを生成
  const systemPrompt = generateSystemPrompt(input.context, input.locale);
  const userPrompt = formatUserPrompt(input.rawInput);

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // AI呼び出し
  const aiResponse = await callAI(messages, {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
  });

  if (!aiResponse.success || !aiResponse.content) {
    return {
      success: false,
      error: {
        code: 'AI_ERROR',
        message: aiResponse.error || 'Unknown AI error',
      },
      latencyMs: Date.now() - startTime,
    };
  }

  // JSON抽出
  const parseResult = extractAndParseJSON(aiResponse.content);
  if (!parseResult.success) {
    return {
      success: false,
      error: {
        code: 'PARSE_ERROR',
        message: parseResult.error || 'Failed to parse JSON',
        raw: aiResponse.content,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  // バリデーション
  const validationResult = validateActionPlan(parseResult.data);
  if (!validationResult.success) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: validationResult.errors?.join(', ') || 'Validation failed',
        raw: aiResponse.content,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  const actionPlan = validationResult.actionPlan!;

  // 低信頼度チェック
  if (actionPlan.confidence < NL_ROUTER_CONFIG.lowConfidenceThreshold) {
    // 信頼度が低い場合は clarifications を追加
    if (!actionPlan.clarifications || actionPlan.clarifications.length === 0) {
      actionPlan.clarifications = [
        {
          field: 'intent',
          question: FALLBACK_QUESTIONS.ambiguous_action,
        },
      ];
    }
  }

  if (options.debug) {
    console.log('[nlRouter] ActionPlan:', JSON.stringify(actionPlan, null, 2));
  }

  return {
    success: true,
    actionPlan,
    latencyMs: Date.now() - startTime,
  };
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * NlRouterContext を作成
 */
export function createContext(
  params: Partial<NlRouterContext> & {
    selectedThreadId?: string;
    threadTitle?: string;
    threadStatus?: 'draft' | 'sent' | 'confirmed' | 'cancelled';
  }
): NlRouterContext {
  return {
    selectedThreadId: params.selectedThreadId,
    threadTitle: params.threadTitle,
    threadStatus: params.threadStatus,
    pendingForThread: params.pendingForThread || null,
    globalPendingAction: params.globalPendingAction || null,
    recentMessages: params.recentMessages || [],
  };
}

/**
 * NlRouterInput を作成
 */
export function createInput(
  rawInput: string,
  context: NlRouterContext,
  options?: { locale?: 'ja' | 'en'; timezone?: string }
): NlRouterInput {
  return {
    rawInput,
    normalizedInput: rawInput.toLowerCase().trim(),
    context,
    locale: options?.locale || 'ja',
    timezone: options?.timezone || 'Asia/Tokyo',
  };
}

/**
 * nlRouter を呼ぶべきか判定（policyGate の簡易版）
 * 
 * @param ruleResult - ルールベース分類の結果
 * @param context - 文脈
 * @returns true なら nlRouter を呼ぶべき
 */
export function shouldCallNlRouter(
  ruleResult: { intent: string; confidence: number } | null,
  context: NlRouterContext
): boolean {
  // ルール分類が成功した場合は呼ばない
  if (ruleResult && ruleResult.intent !== 'unknown' && ruleResult.confidence >= 0.5) {
    return false;
  }

  // pending 中は基本的に呼ばない（はい/いいえ はルールで処理）
  if (context.pendingForThread || context.globalPendingAction) {
    return false;
  }

  return true;
}
