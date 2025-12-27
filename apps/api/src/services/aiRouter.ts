/**
 * AI Provider Router Service (Ticket 08 Fix)
 * 
 * Gemini優先 → OpenAI fallback ロジック
 * Intent Parse + Share Intent 判定
 * ai_usage_logs への記録
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface IntentParseResult {
  intent: 'create' | 'modify' | 'undo' | 'query' | 'unknown';
  confidence: number;
  share_intent?: 'explicit' | 'uncertain' | 'none';
  entities: {
    type?: 'task' | 'scheduled';
    title?: string;
    start_at?: string;
    end_at?: string;
    location?: string;
    status?: 'pending' | 'completed' | 'cancelled';
    target_id?: string;
  };
}

interface AIUsageLog {
  user_id?: string;
  room_id?: string;
  workspace_id?: string;
  provider: 'gemini' | 'openai';
  model: string;
  feature: string;
  status: 'success' | 'error';
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  error_message?: string;
}

export class AIRouterService {
  private geminiApiKey: string;
  private openaiApiKey: string;
  private db: D1Database;
  private allowFallback: boolean;

  constructor(
    geminiApiKey: string, 
    openaiApiKey: string, 
    db: D1Database,
    allowFallback: boolean = true // Default: allow fallback (for backward compatibility)
  ) {
    this.geminiApiKey = geminiApiKey;
    this.openaiApiKey = openaiApiKey;
    this.db = db;
    this.allowFallback = allowFallback;
  }

  /**
   * Intent Parse with LLM (Gemini優先 → OpenAI fallback)
   */
  async parseIntent(text: string, userId?: string, roomId?: string): Promise<IntentParseResult> {
    // Try Gemini first
    try {
      const result = await this.parseWithGemini(text, userId, roomId);
      return result;
    } catch (geminiError) {
      console.warn('[AIRouter] Gemini failed:', geminiError);

      // Check if fallback is allowed
      if (!this.allowFallback) {
        console.error('[AIRouter] OpenAI fallback disabled, using pattern fallback');
        return this.parseWithPattern(text);
      }

      // Try OpenAI fallback
      console.warn('[AIRouter] Trying OpenAI fallback');
      try {
        const result = await this.parseWithOpenAI(text, userId, roomId);
        return result;
      } catch (openaiError) {
        console.error('[AIRouter] Both Gemini and OpenAI failed, using pattern fallback:', openaiError);
        
        // Pattern fallback (existing logic)
        return this.parseWithPattern(text);
      }
    }
  }

  /**
   * Parse with Gemini
   */
  private async parseWithGemini(text: string, userId?: string, roomId?: string): Promise<IntentParseResult> {
    const model = 'gemini-2.0-flash-exp';
    const startTime = Date.now();

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: this.buildIntentPrompt(text)
              }]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 500,
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!content) {
        throw new Error('No content in Gemini response');
      }

      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      let parsed: IntentParseResult;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        // Try to fix common JSON issues
        const fixed = this.fixBrokenJSON(jsonStr);
        parsed = JSON.parse(fixed);
      }

      // Log usage
      await this.logUsage({
        user_id: userId,
        room_id: roomId,
        provider: 'gemini',
        model,
        feature: 'intent_parse',
        status: 'success',
        input_tokens: this.estimateTokens(text),
        output_tokens: this.estimateTokens(content),
        estimated_cost_usd: 0, // Gemini is free for now
      });

      return parsed;
    } catch (error) {
      // Log error
      await this.logUsage({
        user_id: userId,
        room_id: roomId,
        provider: 'gemini',
        model,
        feature: 'intent_parse',
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  /**
   * Parse with OpenAI (fallback)
   */
  private async parseWithOpenAI(text: string, userId?: string, roomId?: string): Promise<IntentParseResult> {
    const model = 'gpt-4o-mini';
    const startTime = Date.now();

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an intent parser. Return only valid JSON, no markdown.'
            },
            {
              role: 'user',
              content: this.buildIntentPrompt(text)
            }
          ],
          temperature: 0.1,
          max_tokens: 500,
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      // Parse JSON
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      let parsed: IntentParseResult;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        const fixed = this.fixBrokenJSON(jsonStr);
        parsed = JSON.parse(fixed);
      }

      // Log usage
      await this.logUsage({
        user_id: userId,
        room_id: roomId,
        provider: 'openai',
        model,
        feature: 'intent_parse',
        status: 'success',
        input_tokens: data.usage?.prompt_tokens,
        output_tokens: data.usage?.completion_tokens,
        estimated_cost_usd: this.estimateOpenAICost(data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0),
      });

      return parsed;
    } catch (error) {
      // Log error
      await this.logUsage({
        user_id: userId,
        room_id: roomId,
        provider: 'openai',
        model,
        feature: 'intent_parse',
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  /**
   * Pattern-based fallback (existing logic)
   */
  private parseWithPattern(text: string): IntentParseResult {
    const lower = text.toLowerCase();

    // Undo patterns
    if (/戻|元に|取り消|キャンセル|undo|revert/.test(lower)) {
      return {
        intent: 'undo',
        confidence: 0.9,
        share_intent: 'none',
        entities: {}
      };
    }

    // Modify patterns
    if (/完了|終わ|済|完成|done|complete|finish/.test(lower)) {
      return {
        intent: 'modify',
        confidence: 0.85,
        share_intent: 'none',
        entities: {
          status: 'completed'
        }
      };
    }

    // Query patterns
    if (/[?？]|予定|スケジュール|タスク|何|いつ|when|what|list|show/.test(lower)) {
      return {
        intent: 'query',
        confidence: 0.7,
        share_intent: 'none',
        entities: {}
      };
    }

    // Create patterns
    if (/追加|作成|登録|新規|create|add|new/.test(lower)) {
      const isScheduled = /ミーティング|会議|meeting|予定|schedule/.test(lower);
      
      return {
        intent: 'create',
        confidence: 0.8,
        share_intent: 'none',
        entities: {
          type: isScheduled ? 'scheduled' : 'task',
          title: this.extractTitle(text)
        }
      };
    }

    // Unknown
    return {
      intent: 'unknown',
      confidence: 0.3,
      share_intent: 'none',
      entities: {}
    };
  }

  /**
   * Build Intent Parse Prompt (凍結仕様ベース)
   */
  private buildIntentPrompt(text: string): string {
    return `You are an intent parser for a task/schedule management system.

Parse the following user input and return JSON with this exact structure:

{
  "intent": "create" | "modify" | "undo" | "query" | "unknown",
  "confidence": 0.0-1.0,
  "share_intent": "explicit" | "uncertain" | "none",
  "entities": {
    "type": "task" | "scheduled",
    "title": "extracted title",
    "start_at": "ISO 8601 datetime",
    "end_at": "ISO 8601 datetime",
    "location": "extracted location",
    "status": "pending" | "completed" | "cancelled",
    "target_id": "id for modify/undo"
  }
}

Intent definitions:
- create: Adding new task/schedule
- modify: Updating existing item
- undo: Reverting last action
- query: Asking about tasks/schedules
- unknown: Cannot determine intent

Share intent definitions:
- explicit: User explicitly wants to share to room/team (keywords: 共有, シェア, みんな, share, team)
- uncertain: Might want to share (keywords: 相談, 提案, どう思う, suggest, discuss)
- none: No indication of sharing

Rules:
1. Always include "share_intent" field
2. Extract datetime in ISO 8601 format (e.g., "2025-01-15T14:00:00Z")
3. For relative dates, calculate from current date: ${new Date().toISOString()}
4. Return only valid JSON, no markdown code blocks

User input: "${text}"`;
  }

  /**
   * Fix broken JSON (common issues)
   */
  private fixBrokenJSON(json: string): string {
    let fixed = json.trim();
    
    // Remove trailing commas
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix unquoted keys
    fixed = fixed.replace(/(\w+):/g, '"$1":');
    
    // Fix single quotes to double quotes
    fixed = fixed.replace(/'/g, '"');
    
    return fixed;
  }

  /**
   * Extract title from text (simple heuristic)
   */
  private extractTitle(text: string): string {
    // Remove action words
    let title = text
      .replace(/追加|作成|登録|新規|create|add|new/gi, '')
      .replace(/^[に|を|へ|する]+/g, '')
      .trim();
    
    // Take first 50 chars
    return title.substring(0, 50);
  }

  /**
   * Estimate tokens (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 chars for English, 1 token ≈ 2 chars for Japanese
    const japaneseChars = (text.match(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/g) || []).length;
    const otherChars = text.length - japaneseChars;
    
    return Math.ceil(japaneseChars / 2 + otherChars / 4);
  }

  /**
   * Estimate Gemini cost (gemini-2.0-flash-exp pricing)
   */
  private estimateGeminiCost(inputTokens: number, outputTokens: number): number {
    // gemini-2.0-flash-exp: Free tier (usage-based pricing coming soon)
    // For now, assume minimal cost: $0.05 / 1M input tokens, $0.15 / 1M output tokens
    const inputCost = (inputTokens / 1_000_000) * 0.05;
    const outputCost = (outputTokens / 1_000_000) * 0.15;
    return inputCost + outputCost;
  }

  /**
   * Estimate OpenAI cost (gpt-4o-mini pricing)
   */
  private estimateOpenAICost(inputTokens: number, outputTokens: number): number {
    // gpt-4o-mini: $0.150 / 1M input tokens, $0.600 / 1M output tokens
    const inputCost = (inputTokens / 1_000_000) * 0.15;
    const outputCost = (outputTokens / 1_000_000) * 0.60;
    return inputCost + outputCost;
  }

  /**
   * Generic content generation with LLM (Gemini → OpenAI fallback)
   * Used for candidate generation, summaries, etc.
   */
  async generateContent(options: {
    feature: string;
    prompt: string;
    temperature?: number;
    userId?: string;
    roomId?: string;
  }): Promise<string> {
    const { feature, prompt, temperature = 0.7, userId, roomId } = options;

    // Try Gemini first
    try {
      const result = await this.generateWithGemini(prompt, temperature, feature, userId, roomId);
      return result;
    } catch (geminiError) {
      console.warn('[AIRouter] Gemini content generation failed:', geminiError);

      // Check if fallback is allowed
      if (!this.allowFallback) {
        console.error('[AIRouter] OpenAI fallback disabled for free tier');
        throw new Error('AI generation unavailable. Please try again later.');
      }

      // Try OpenAI fallback
      console.warn('[AIRouter] Trying OpenAI fallback');
      try {
        const result = await this.generateWithOpenAI(prompt, temperature, feature, userId, roomId);
        return result;
      } catch (openaiError) {
        console.error('[AIRouter] Both Gemini and OpenAI content generation failed:', openaiError);
        throw new Error('AI content generation failed');
      }
    }
  }

  /**
   * Generate content with Gemini
   */
  private async generateWithGemini(
    prompt: string,
    temperature: number,
    feature: string,
    userId?: string,
    roomId?: string
  ): Promise<string> {
    const model = 'gemini-2.0-flash-exp';
    const startTime = Date.now();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error('Empty response from Gemini');
    }

    // Estimate tokens and cost
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(content.length / 4);
    const estimatedCost = this.estimateGeminiCost(inputTokens, outputTokens);

    // Log usage
    await this.logUsage({
      user_id: userId,
      room_id: roomId,
      provider: 'gemini',
      model,
      feature,
      status: 'success',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCost,
    });

    return content;
  }

  /**
   * Generate content with OpenAI
   */
  private async generateWithOpenAI(
    prompt: string,
    temperature: number,
    feature: string,
    userId?: string,
    roomId?: string
  ): Promise<string> {
    const model = 'gpt-4o-mini';
    const startTime = Date.now();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Get actual token usage
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const estimatedCost = this.estimateOpenAICost(inputTokens, outputTokens);

    // Log usage
    await this.logUsage({
      user_id: userId,
      room_id: roomId,
      provider: 'openai',
      model,
      feature,
      status: 'success',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCost,
    });

    return content;
  }

  /**
   * Log AI usage to D1
   * 
   * 優先A: null撲滅 - 集計クエリ（SUM）でnullが混入しないよう必須フィールドを補正
   */
  private async logUsage(log: AIUsageLog): Promise<void> {
    try {
      const id = crypto.randomUUID();
      const timestamp = Math.floor(Date.now() / 1000);

      // null撲滅: 数値フィールドは0、文字列フィールドは'unknown'で補正
      const provider = log.provider || 'unknown';
      const model = log.model || 'unknown';
      const feature = log.feature || 'unknown_feature';
      const status = log.status || 'error';
      const inputTokens = log.input_tokens ?? 0;  // null/undefined → 0
      const outputTokens = log.output_tokens ?? 0;
      const estimatedCost = log.estimated_cost_usd ?? 0;

      await this.db
        .prepare(
          `INSERT INTO ai_usage_logs 
          (id, user_id, room_id, workspace_id, provider, model, feature, status, 
           input_tokens, output_tokens, estimated_cost_usd, error_message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          log.user_id || null,
          log.room_id || null,
          log.workspace_id || null,
          provider,
          model,
          feature,
          status,
          inputTokens,
          outputTokens,
          estimatedCost,
          log.error_message || null,
          timestamp
        )
        .run();
    } catch (error) {
      // Don't throw - logging failures shouldn't break the main flow
      console.error('[AIRouter] Failed to log usage:', error);
    }
  }
}
