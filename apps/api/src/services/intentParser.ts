/**
 * Intent Parser Service (Ticket 08)
 * 
 * Parses voice commands into structured intents.
 * Uses LLM (OpenAI/Gemini) for natural language understanding.
 */

export interface ParsedIntent {
  intent: 'create' | 'modify' | 'undo' | 'query' | 'unknown';
  confidence: number;
  entities: {
    type?: 'task' | 'scheduled';
    title?: string;
    description?: string;
    start_at?: string; // ISO 8601
    end_at?: string;   // ISO 8601
    location?: string;
    target_id?: string; // For modify/undo
    status?: 'pending' | 'completed' | 'cancelled';
  };
  raw_text: string;
}

export class IntentParserService {
  constructor(
    private readonly openaiApiKey: string,
    private readonly geminiApiKey?: string
  ) {}

  /**
   * Parse voice command into structured intent
   */
  async parse(text: string, userId: string): Promise<ParsedIntent> {
    // For MVP: Use simple pattern matching
    // TODO: Replace with LLM-based parsing in production
    return this.parseWithPatterns(text);
  }

  /**
   * Simple pattern-based parser (MVP)
   * 
   * Examples:
   * - "明日の10時にミーティング" → create scheduled
   * - "買い物リストにパンを追加" → create task
   * - "最後のタスクを完了にする" → modify status
   * - "さっきの予定を取り消して" → undo
   */
  private parseWithPatterns(text: string): ParsedIntent {
    const lowerText = text.toLowerCase();

    // Intent: Undo
    if (this.matchUndo(lowerText)) {
      return {
        intent: 'undo',
        confidence: 0.9,
        entities: {},
        raw_text: text,
      };
    }

    // Intent: Modify (complete/cancel)
    const modifyResult = this.matchModify(lowerText);
    if (modifyResult) {
      return {
        intent: 'modify',
        confidence: 0.85,
        entities: modifyResult,
        raw_text: text,
      };
    }

    // Intent: Create (task or scheduled)
    const createResult = this.matchCreate(text);
    if (createResult) {
      return {
        intent: 'create',
        confidence: 0.8,
        entities: createResult,
        raw_text: text,
      };
    }

    // Intent: Query
    if (this.matchQuery(lowerText)) {
      return {
        intent: 'query',
        confidence: 0.7,
        entities: {},
        raw_text: text,
      };
    }

    // Unknown intent
    return {
      intent: 'unknown',
      confidence: 0.0,
      entities: {},
      raw_text: text,
    };
  }

  /**
   * Match undo patterns
   */
  private matchUndo(text: string): boolean {
    const undoPatterns = [
      /取り消/,
      /キャンセル/,
      /やめ/,
      /削除/,
      /消し/,
      /undo/i,
      /cancel/i,
    ];

    return undoPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Match modify patterns
   */
  private matchModify(text: string): { status?: string; target_id?: string } | null {
    // Complete patterns
    if (/完了|終わっ|済み|done|complete/i.test(text)) {
      return { status: 'completed' };
    }

    // Cancel patterns
    if (/中止|中断|やめ/i.test(text)) {
      return { status: 'cancelled' };
    }

    return null;
  }

  /**
   * Match query patterns
   */
  private matchQuery(text: string): boolean {
    const queryPatterns = [
      /何|なに|どんな|どう/,
      /予定|スケジュール|タスク/,
      /today|tomorrow|next/i,
    ];

    return queryPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Match create patterns and extract entities
   */
  private matchCreate(text: string): {
    type: 'task' | 'scheduled';
    title?: string;
    start_at?: string;
    end_at?: string;
    location?: string;
  } | null {
    // Scheduled event patterns
    const scheduledPatterns = [
      /(?:明日|明後日|来週)(?:の)?(?:午前|午後)?(\d{1,2})時/,
      /(\d{1,2})月(\d{1,2})日/,
      /ミーティング|会議|打ち合わせ|meeting/i,
    ];

    const isScheduled = scheduledPatterns.some(pattern => pattern.test(text));

    if (isScheduled) {
      const title = this.extractTitle(text);
      const startAt = this.extractDateTime(text);
      const location = this.extractLocation(text);

      return {
        type: 'scheduled',
        title,
        start_at: startAt,
        location,
      };
    }

    // Task patterns
    const taskPatterns = [
      /追加|作成|登録|add|create/i,
      /タスク|TODO|やること|task/i,
      /買|準備|確認|連絡/,
    ];

    const isTask = taskPatterns.some(pattern => pattern.test(text));

    if (isTask) {
      const title = this.extractTitle(text);

      return {
        type: 'task',
        title,
      };
    }

    return null;
  }

  /**
   * Extract title from text
   */
  private extractTitle(text: string): string {
    // Remove common prefixes
    let title = text
      .replace(/^(明日|明後日|来週)(の|に)?/, '')
      .replace(/^(午前|午後)?(\d{1,2})時(に|から)?/, '')
      .replace(/(追加|作成|登録|予定)/, '')
      .trim();

    // Limit length
    if (title.length > 50) {
      title = title.substring(0, 50) + '...';
    }

    return title || text;
  }

  /**
   * Extract datetime from text (simplified)
   */
  private extractDateTime(text: string): string {
    const now = new Date();

    // Tomorrow
    if (/明日/.test(text)) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Extract hour
      const hourMatch = text.match(/(\d{1,2})時/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1], 10);
        tomorrow.setHours(hour, 0, 0, 0);
        return tomorrow.toISOString();
      }
      
      tomorrow.setHours(9, 0, 0, 0); // Default 9am
      return tomorrow.toISOString();
    }

    // Day after tomorrow
    if (/明後日/.test(text)) {
      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 2);
      dayAfter.setHours(9, 0, 0, 0);
      return dayAfter.toISOString();
    }

    // Next week
    if (/来週/.test(text)) {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(9, 0, 0, 0);
      return nextWeek.toISOString();
    }

    // Default: 1 hour from now
    const future = new Date(now);
    future.setHours(future.getHours() + 1);
    return future.toISOString();
  }

  /**
   * Extract location from text
   */
  private extractLocation(text: string): string | undefined {
    const locationMatch = text.match(/(会議室|オフィス|自宅|[A-Z]\d+室)/);
    return locationMatch?.[1];
  }

  /**
   * Parse with LLM (OpenAI GPT-4) - for future implementation
   */
  async parseWithLLM(text: string, userId: string): Promise<ParsedIntent> {
    // TODO: Implement LLM-based parsing
    // Call OpenAI API with system prompt from docs/26_INTENT_PARSE_PROMPT.md
    
    // For now, fallback to pattern matching
    return this.parseWithPatterns(text);
  }
}
