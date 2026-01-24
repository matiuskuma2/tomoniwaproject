/**
 * nlRouter.ts
 * CONV-1.0: calendar限定のAIルーティングAPI
 * CONV-1.1: params補完（Assist Mode）追加
 * 
 * POST /api/nl/route   - intent判定
 * POST /api/nl/assist  - params補完（CONV-1.1）
 * 
 * 設計原則:
 * - READ-ONLYのcalendar系のみ
 * - write系を絶対に選ばない
 * - 不明な場合は unknown を返す
 * - 既存のintent/execを壊さない
 * - CONV-1.1: intentは変更せず、params補完のみ
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import { buildNlRouterSystemPrompt, buildNlRouterUserPrompt } from '../utils/nlRouterPrompt';
import { buildAssistSystemPrompt, buildAssistUserPrompt } from '../utils/nlAssistPrompt';
import { 
  RouteResultSchema, 
  dayTimeToPrefer,
  AssistRequestSchema,
  AssistResponseSchema,
  type AssistRequest,
} from '../utils/nlRouterSchema';

// ============================================================
// LLM呼び出し（OpenAI互換）
// ============================================================

async function callLLM(
  system: string,
  user: string,
  apiKey: string | undefined
): Promise<string> {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} - ${errorText}`);
  }

  const json = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json?.choices?.[0]?.message?.content;
  
  if (!text) {
    throw new Error('LLM returned empty content');
  }
  
  return text;
}

// ============================================================
// JSON抽出ヘルパー
// ============================================================

function extractJSON(raw: string): string {
  // まず直接パースを試みる
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    // 失敗したら { ... } を抽出
  }

  // ```json ... ``` ブロックを探す
  const jsonBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  // { ... } を探す
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end >= 0 && end > start) {
    return raw.slice(start, end + 1);
  }

  return raw;
}

// ============================================================
// Routes
// ============================================================

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /route
 * 
 * Request:
 * {
 *   "text": "来週の午後の空き教えて",
 *   "context": {
 *     "selected_thread_id": "thread_xxx",
 *     "viewer_timezone": "Asia/Tokyo"
 *   }
 * }
 * 
 * Response:
 * {
 *   "intent": "schedule.freebusy",
 *   "confidence": 0.82,
 *   "params": { "range": "next_week", "prefer": "afternoon" },
 *   "rationale": "来週+午後+空き→freebusy"
 * }
 */
app.post('/route', async (c) => {
  const { env } = c;
  const { workspaceId } = getTenant(c);

  // リクエストボディをパース
  const body = await c.req.json<{
    text?: string;
    context?: {
      selected_thread_id?: string | null;
      viewer_timezone?: string | null;
    };
  }>();

  const text = (body.text || '').trim();
  
  // 空の入力は即座に unknown を返す
  if (!text) {
    return c.json({
      intent: 'unknown',
      confidence: 0.0,
      params: {},
    });
  }

  const selectedThreadId = body.context?.selected_thread_id ?? null;
  const viewerTimezone = body.context?.viewer_timezone ?? 'Asia/Tokyo';

  // プロンプト構築
  const system = buildNlRouterSystemPrompt();
  const user = buildNlRouterUserPrompt({ text, selectedThreadId, viewerTimezone });

  try {
    // LLM呼び出し
    const raw = await callLLM(system, user, env.OPENAI_API_KEY);

    // JSON抽出
    const jsonText = extractJSON(raw);

    // バリデーション
    const parsed = RouteResultSchema.parse(JSON.parse(jsonText));

    // threadIdが必要で不足なら needs_clarification 付ける（二重ガード）
    if (parsed.intent === 'schedule.freebusy.batch') {
      const threadId = parsed.params?.threadId ?? selectedThreadId;
      if (!threadId) {
        return c.json({
          intent: 'schedule.freebusy.batch',
          confidence: Math.min(parsed.confidence, 0.8),
          params: {},
          needs_clarification: {
            field: 'threadId',
            message: 'どのスレッド（参加者グループ）の共通空きを見ますか？左のスレッドを選択してください。',
          },
        });
      }
      parsed.params.threadId = threadId;
    }

    // dayTimeWindow を prefer に変換（既存API互換）
    if (parsed.params?.dayTimeWindow) {
      const prefer = dayTimeToPrefer(parsed.params.dayTimeWindow);
      if (prefer) {
        parsed.params.prefer = prefer;
      }
      delete parsed.params.dayTimeWindow;
    }

    // durationMinutes を meetingLength に変換（既存API互換）
    if (parsed.params?.durationMinutes) {
      parsed.params.meetingLength = parsed.params.durationMinutes;
      delete parsed.params.durationMinutes;
    }

    return c.json(parsed);
  } catch (e) {
    console.error('[nlRouter] error', e, { workspaceId, text });
    
    // エラー時は unknown を返す
    return c.json({
      intent: 'unknown',
      confidence: 0.0,
      params: {},
    });
  }
});

// ============================================================
// CONV-1.1: POST /assist（params補完）
// ============================================================

/**
 * POST /assist
 * 
 * Request:
 * {
 *   "text": "来週の午後で空いてる？",
 *   "detected_intent": "schedule.freebusy",
 *   "existing_params": {},
 *   "viewer_timezone": "Asia/Tokyo"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "target_intent": "schedule.freebusy",
 *     "params_patch": { "range": "next_week", "dayTimeWindow": "afternoon" },
 *     "confidence": 0.9,
 *     "rationale": "来週=next_week, 午後=afternoon"
 *   }
 * }
 */
app.post('/assist', async (c) => {
  const { env } = c;
  const { workspaceId } = getTenant(c);

  let body: AssistRequest;
  try {
    const rawBody = await c.req.json();
    body = AssistRequestSchema.parse(rawBody);
  } catch (e) {
    return c.json({
      success: false,
      error: 'invalid_request',
      message: 'リクエスト形式が不正です',
    }, 400);
  }

  try {
    // プロンプト構築
    const system = buildAssistSystemPrompt();
    const user = buildAssistUserPrompt(body);

    // LLM呼び出し（低コスト設定）
    const raw = await callLLM(system, user, env.OPENAI_API_KEY);

    // JSON抽出
    const jsonText = extractJSON(raw);

    // バリデーション
    const parsed = AssistResponseSchema.parse(JSON.parse(jsonText));

    // 絶対ルール: intent変更禁止
    if (parsed.target_intent !== body.detected_intent) {
      console.warn('[nlRouter/assist] intent mismatch rejected', {
        workspaceId,
        detected: body.detected_intent,
        returned: parsed.target_intent,
      });
      return c.json({
        success: false,
        error: 'intent_mismatch',
        message: 'AIがintentを変更しようとしたため拒否しました',
      });
    }

    // confidence が低すぎる場合は空patchを返す
    if (parsed.confidence < 0.5) {
      return c.json({
        success: true,
        data: {
          target_intent: body.detected_intent,
          params_patch: {},
          confidence: parsed.confidence,
          rationale: 'confidence too low, returning empty patch',
        },
      });
    }

    // existing_params にある項目を params_patch から除去（上書き防止）
    const cleanedPatch = { ...parsed.params_patch };
    for (const key of Object.keys(body.existing_params)) {
      if (key in cleanedPatch) {
        delete cleanedPatch[key as keyof typeof cleanedPatch];
      }
    }

    // dayTimeWindow を prefer に変換（既存API互換）
    if (cleanedPatch.dayTimeWindow) {
      const prefer = dayTimeToPrefer(cleanedPatch.dayTimeWindow as 'morning' | 'afternoon' | 'night');
      if (prefer) {
        (cleanedPatch as Record<string, unknown>).prefer = prefer;
      }
      delete cleanedPatch.dayTimeWindow;
    }

    // durationMinutes を meetingLength に変換（既存API互換）
    if (cleanedPatch.durationMinutes) {
      (cleanedPatch as Record<string, unknown>).meetingLength = cleanedPatch.durationMinutes;
      delete cleanedPatch.durationMinutes;
    }

    console.log('[nlRouter/assist] success', {
      workspaceId,
      intent: body.detected_intent,
      confidence: parsed.confidence,
      patchKeys: Object.keys(cleanedPatch),
    });

    return c.json({
      success: true,
      data: {
        target_intent: parsed.target_intent,
        params_patch: cleanedPatch,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
      },
    });

  } catch (e) {
    console.error('[nlRouter/assist] error', e, { workspaceId, text: body.text });
    
    // エラー時は空patchを返す（従来動作にフォールバック）
    return c.json({
      success: true,
      data: {
        target_intent: body.detected_intent,
        params_patch: {},
        confidence: 0,
        rationale: 'error occurred, returning empty patch',
      },
    });
  }
});

export default app;
