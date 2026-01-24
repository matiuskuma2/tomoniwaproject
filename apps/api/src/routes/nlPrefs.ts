/**
 * nlPrefs.ts
 * PREF-SET-1: 好み抽出API
 * 
 * POST /api/nl/prefs/extract
 * - 自然文からSchedulePreferences形式に変換
 * - 保存は行わない（確認フロー経由で保存）
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { 
  ExtractPrefsInputSchema, 
  ExtractPrefsOutputSchema,
  type ExtractPrefsResponse 
} from '../utils/nlPrefsSchema';
import { buildPrefsExtractSystemPrompt, buildPrefsExtractUserPrompt } from '../utils/nlPrefsPrompt';

type Variables = {
  userId: string;
  workspaceId: string;
  ownerUserId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Configuration
// ============================================================

const NL_PREFS_CONFIG = {
  timeout: 10000,
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 800,
};

// ============================================================
// Helper: Extract JSON from AI response
// ============================================================

function extractJson(text: string): string | null {
  // ```json ... ``` ブロックを抽出
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  // { ... } を直接抽出
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return null;
}

// ============================================================
// POST /api/nl/prefs/extract
// ============================================================

app.post('/extract', async (c) => {
  const { env } = c;
  const startTime = Date.now();

  try {
    // 1. 入力パース
    const body = await c.req.json();
    const parsed = ExtractPrefsInputSchema.safeParse(body);

    if (!parsed.success) {
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `入力が不正です: ${parsed.error.message}`,
        },
      }, 400);
    }

    const { text, viewer_timezone, existing_prefs } = parsed.data;

    // 2. OpenAI APIキー確認
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[nlPrefs] OPENAI_API_KEY not configured');
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'AI_ERROR',
          message: 'AIサービスが設定されていません',
        },
      }, 500);
    }

    // 3. プロンプト生成
    const systemPrompt = buildPrefsExtractSystemPrompt();
    const userPrompt = buildPrefsExtractUserPrompt(text, existing_prefs);

    // 4. OpenAI API呼び出し
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NL_PREFS_CONFIG.timeout);

    let aiResponse: Response;
    try {
      aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: NL_PREFS_CONFIG.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: NL_PREFS_CONFIG.temperature,
          max_tokens: NL_PREFS_CONFIG.maxTokens,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[nlPrefs] OpenAI API error:', aiResponse.status, errorText);
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'AI_ERROR',
          message: `AI APIエラー: ${aiResponse.status}`,
        },
      }, 500);
    }

    // 5. レスポンス解析
    const aiResult = await aiResponse.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = aiResult.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[nlPrefs] No content in AI response');
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'AI_ERROR',
          message: 'AIからの応答がありませんでした',
        },
      }, 500);
    }

    // 6. JSON抽出
    const jsonStr = extractJson(content);
    if (!jsonStr) {
      console.error('[nlPrefs] Failed to extract JSON from:', content);
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'AI応答からJSONを抽出できませんでした',
        },
      }, 500);
    }

    // 7. JSONパース
    let extractedData: unknown;
    try {
      extractedData = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[nlPrefs] JSON parse error:', e, jsonStr);
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'JSONのパースに失敗しました',
        },
      }, 500);
    }

    // 8. スキーマバリデーション
    const outputParsed = ExtractPrefsOutputSchema.safeParse(extractedData);
    if (!outputParsed.success) {
      console.warn('[nlPrefs] Schema validation failed:', outputParsed.error.message);
      
      // バリデーション失敗でも、最低限のデータがあれば返す
      const fallbackData = extractedData as any;
      if (fallbackData.proposed_prefs && fallbackData.summary) {
        return c.json<ExtractPrefsResponse>({
          success: true,
          data: {
            proposed_prefs: fallbackData.proposed_prefs,
            changes: fallbackData.changes || [],
            summary: fallbackData.summary,
            confidence: fallbackData.confidence ?? 0.5,
            needs_confirmation: true,
          },
        });
      }

      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `抽出結果のバリデーションに失敗しました`,
        },
      }, 400);
    }

    // 9. 信頼度チェック
    if (outputParsed.data.confidence < 0.3) {
      console.log('[nlPrefs] Low confidence:', outputParsed.data.confidence);
      return c.json<ExtractPrefsResponse>({
        success: false,
        error: {
          code: 'NO_PREFS_FOUND',
          message: '好み設定を抽出できませんでした。具体的な時間帯や曜日を含めて教えてください。',
        },
      }, 400);
    }

    // 10. 成功
    const latencyMs = Date.now() - startTime;
    console.log('[nlPrefs] Success:', {
      text: text.substring(0, 50),
      confidence: outputParsed.data.confidence,
      latencyMs,
    });

    return c.json<ExtractPrefsResponse>({
      success: true,
      data: outputParsed.data,
    });

  } catch (error) {
    console.error('[nlPrefs] Unexpected error:', error);
    return c.json<ExtractPrefsResponse>({
      success: false,
      error: {
        code: 'AI_ERROR',
        message: `予期せぬエラー: ${error instanceof Error ? error.message : 'Unknown'}`,
      },
    }, 500);
  }
});

export default app;
