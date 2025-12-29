/**
 * Intent Classifier for Phase Next-2 (P0 only)
 * Rule-based intent classification for chat input
 */

export type IntentType =
  | 'schedule.external.create'
  | 'schedule.status.check'
  | 'schedule.finalize'
  | 'unknown';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  params: Record<string, any>;
  needsClarification?: {
    field: string;
    message: string;
  };
}

/**
 * Classify user input into one of the P0 intents
 * Phase Next-2: Rule-based only (no LLM)
 */
export function classifyIntent(input: string, context?: {
  selectedThreadId?: string;
  selectedSlotId?: string;
}): IntentResult {
  const normalizedInput = input.toLowerCase().trim();

  // P0-1: schedule.external.create
  // Keywords: 送る、調整、案内、招待
  if (
    /送(って|る)|調整|案内|招待/.test(normalizedInput) &&
    !/(状況|進捗|確認|教えて)/.test(normalizedInput)
  ) {
    return {
      intent: 'schedule.external.create',
      confidence: 0.8,
      params: {
        rawInput: input,
      },
    };
  }

  // P0-3: schedule.finalize
  // Keywords: 確定、決める、この日
  if (
    /(確定|決め(る|て)|この日)/.test(normalizedInput) ||
    /^\d+番?(で|に)/.test(normalizedInput) // "1番で", "2で"
  ) {
    // Check if we have required context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.finalize',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドの日程を確定しますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }

    // Extract slot number from input (e.g., "1番で" -> 1)
    const slotMatch = normalizedInput.match(/(\d+)番?(で|に)/);
    
    return {
      intent: 'schedule.finalize',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
        slotNumber: slotMatch ? parseInt(slotMatch[1], 10) : undefined,
      },
      needsClarification: !slotMatch ? {
        field: 'slotId',
        message: 'どの候補日時で確定しますか？\n右側のカードから候補を選択してください。',
      } : undefined,
    };
  }

  // P0-2: schedule.status.check
  // Keywords: 状況、進捗、確認、教えて、何がある
  if (
    /(状況|進捗|確認|教えて|何.*ある|見(る|て)|どう|参加|未返信)/.test(normalizedInput)
  ) {
    return {
      intent: 'schedule.status.check',
      confidence: 0.8,
      params: {
        threadId: context?.selectedThreadId,
        scope: normalizedInput.includes('募集') || normalizedInput.includes('全') ? 'all' : 'single',
      },
      needsClarification: !context?.selectedThreadId && !normalizedInput.includes('募集') ? {
        field: 'threadId',
        message: 'どのスレッドの状況を確認しますか？\n左のスレッド一覧から選択してください。\n\nまたは「募集中の予定」と入力すると全体を確認できます。',
      } : undefined,
    };
  }

  // Unknown intent
  return {
    intent: 'unknown',
    confidence: 0,
    params: {},
    needsClarification: {
      field: 'intent',
      message: '申し訳ございません。理解できませんでした。\n\n以下のような指示ができます：\n- 「〇〇さんに日程調整送って」（調整作成）\n- 「状況教えて」（進捗確認）\n- 「1番で確定して」（日程確定）',
    },
  };
}

/**
 * Extract email addresses from text
 */
export function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  return matches || [];
}

/**
 * Extract names from Japanese text (simple heuristic)
 * Phase Next-2: Very basic implementation
 */
export function extractNames(text: string): string[] {
  // Simple pattern: "〇〇さん" or "〇〇氏"
  const namePattern = /([一-龯ぁ-んァ-ヶa-zA-Z]+)(さん|氏|様)/g;
  const matches = [];
  let match;
  
  while ((match = namePattern.exec(text)) !== null) {
    matches.push(match[1]);
  }
  
  return matches;
}
