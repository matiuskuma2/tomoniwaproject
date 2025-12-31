/**
 * Intent Classifier for Phase Next-2 (P0) + Phase Next-3 (P1)
 * Rule-based intent classification for chat input
 */

export type IntentType =
  | 'schedule.external.create'
  | 'schedule.status.check'
  | 'schedule.finalize'
  | 'schedule.today'      // Phase Next-3 (P1)
  | 'schedule.week'       // Phase Next-3 (P1)
  | 'schedule.freebusy'   // Phase Next-3 (P1)
  | 'schedule.auto_propose' // Phase Next-5 (P2) - 自動調整提案
  | 'schedule.auto_propose.confirm' // Phase Next-5 Day2 - 提案確定
  | 'schedule.auto_propose.cancel'  // Phase Next-5 Day2 - 提案キャンセル
  | 'schedule.additional_propose'   // Phase Next-5 Day3 - 追加候補提案
  | 'schedule.remind.pending'       // Phase Next-6 Day1 - 未返信リマインド提案
  | 'schedule.remind.pending.confirm' // Phase Next-6 Day1 - リマインド確定
  | 'schedule.remind.pending.cancel'  // Phase Next-6 Day1 - リマインドキャンセル
  | 'schedule.notify.confirmed'       // Phase Next-6 Day3 - 確定通知提案
  | 'schedule.notify.confirmed.confirm' // Phase Next-6 Day3 - 確定通知確定
  | 'schedule.notify.confirmed.cancel'  // Phase Next-6 Day3 - 確定通知キャンセル
  | 'schedule.propose_for_split'        // Phase Next-6 Day2 - 票割れ通知提案
  | 'schedule.propose_for_split.confirm' // Phase Next-6 Day2 - 票割れ提案確定
  | 'schedule.propose_for_split.cancel'  // Phase Next-6 Day2 - 票割れ提案キャンセル
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
 * Intent context for classification
 * Phase Next-6 Day1: Added pendingRemind
 * Phase Next-6 Day3: Added pendingNotify
 * Phase Next-6 Day2: Added pendingSplit
 */
export interface IntentContext {
  selectedThreadId?: string;
  selectedSlotId?: string;
  pendingRemind?: {
    threadId: string;
    pendingInvites: Array<{ email: string; name?: string }>;
    count: number;
  } | null;
  pendingNotify?: {
    threadId: string;
    invites: Array<{ email: string; name?: string }>;
    finalSlot: { start_at: string; end_at: string; label?: string };
    meetingUrl?: string;
  } | null;
  pendingSplit?: {
    threadId: string;
  } | null;
}

/**
 * Classify user input into one of the P0 intents
 * Phase Next-2: Rule-based only (no LLM)
 * Phase Next-6 Day1: Added pendingRemind support
 */
export function classifyIntent(input: string, context?: IntentContext): IntentResult {
  const normalizedInput = input.toLowerCase().trim();

  // ============================================================
  // Phase Next-3 (P1): Calendar Read-only
  // ============================================================

  // P1-1: schedule.today
  // Keywords: 今日、きょう、今日の予定
  if (/(今日|きょう).*予定/.test(normalizedInput)) {
    return {
      intent: 'schedule.today',
      confidence: 0.9,
      params: {},
    };
  }

  // P1-2: schedule.week
  // Keywords: 今週、こんしゅう、週の予定
  if (/(今週|こんしゅう|週).*予定/.test(normalizedInput)) {
    return {
      intent: 'schedule.week',
      confidence: 0.9,
      params: {},
    };
  }

  // P1-3: schedule.freebusy
  // Keywords: 空き、あき、空いて、あいて、フリー
  if (/(空き|あき|空いて|あいて|フリー)/.test(normalizedInput)) {
    // Determine range (today or week)
    let range: 'today' | 'week' = 'week'; // Default to week
    
    if (/(今日|きょう)/.test(normalizedInput)) {
      range = 'today';
    } else if (/(今週|こんしゅう)/.test(normalizedInput)) {
      range = 'week';
    }
    
    // Need clarification if range is ambiguous
    const hasTimeReference = /(今日|きょう|今週|こんしゅう)/.test(normalizedInput);
    
    return {
      intent: 'schedule.freebusy',
      confidence: hasTimeReference ? 0.9 : 0.7,
      params: { range },
      needsClarification: !hasTimeReference ? {
        field: 'range',
        message: '今日の空き時間ですか？それとも今週の空き時間ですか？',
      } : undefined,
    };
  }

  // ============================================================
  // Phase Next-5 (P2): Auto-propose (自動調整)
  // ============================================================

  // P2-2 & P3-2 & P3-5 & P3-7: Confirm (提案確定)
  // Phase Next-6 Day2: Support split, notify, remind, and auto_propose flows
  // Keywords: はい、yes、作成して、OK
  if (/(はい|yes|作成|ok|おk)/i.test(normalizedInput) && normalizedInput.length < 10) {
    // Check context to determine which flow (優先順位: split > notify > remind > auto_propose)
    if (context?.pendingSplit) {
      return {
        intent: 'schedule.propose_for_split.confirm',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (context?.pendingNotify) {
      return {
        intent: 'schedule.notify.confirmed.confirm',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (context?.pendingRemind) {
      return {
        intent: 'schedule.remind.pending.confirm',
        confidence: 0.9,
        params: {},
      };
    }
    
    // Default to auto_propose flow
    return {
      intent: 'schedule.auto_propose.confirm',
      confidence: 0.9,
      params: {},
    };
  }

  // P2-3 & P3-3 & P3-6 & P3-8: Cancel (提案キャンセル)
  // Phase Next-6 Day2: Support split, notify, remind, and auto_propose flows
  // Keywords: いいえ、no、キャンセル、やめる
  if (/(いいえ|no|キャンセル|やめ)/i.test(normalizedInput) && normalizedInput.length < 10) {
    // Check context to determine which flow (優先順位: split > notify > remind > auto_propose)
    if (context?.pendingSplit) {
      return {
        intent: 'schedule.propose_for_split.cancel',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (context?.pendingNotify) {
      return {
        intent: 'schedule.notify.confirmed.cancel',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (context?.pendingRemind) {
      return {
        intent: 'schedule.remind.pending.cancel',
        confidence: 0.9,
        params: {},
      };
    }
    
    // Default to auto_propose flow
    return {
      intent: 'schedule.auto_propose.cancel',
      confidence: 0.9,
      params: {},
    };
  }
  
  // P2-4: schedule.additional_propose (Phase Next-5 Day3)
  // Keywords: 追加候補、もっと候補、追加で候補
  if (/(追加.*候補|もっと.*候補|追加で.*候補|追加して)/.test(normalizedInput)) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.additional_propose',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドに追加候補を提案しますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }
    
    return {
      intent: 'schedule.additional_propose',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
      },
    };
  }
  
  // ============================================================
  // Phase Next-6: Notification (通知)
  // ============================================================
  
  // P3-4: schedule.notify.confirmed (Phase Next-6 Day3)
  // Keywords: 確定通知、みんなに知らせ、全員に連絡、確定送る
  if (/(確定.*通知|みんな.*知らせ|全員.*連絡|確定.*送|確定.*伝え)/.test(normalizedInput)) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.notify.confirmed',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドの確定通知を送りますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }
    
    return {
      intent: 'schedule.notify.confirmed',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
      },
    };
  }
  
  // P3-1: schedule.remind.pending (Phase Next-6 Day1)
  // Keywords: リマインド、催促、未返信
  if (/(リマインド|催促|未返信.*連絡|未返信.*送)/.test(normalizedInput)) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.remind.pending',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドにリマインドを送りますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }
    
    return {
      intent: 'schedule.remind.pending',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
      },
    };
  }

  // P2-1: schedule.auto_propose
  // Keywords: 候補出して、調整して、自動、提案
  // NOTE: This should be checked BEFORE schedule.external.create
  if (
    /(候補.*出して|調整.*して|自動.*調整|提案)/.test(normalizedInput) &&
    !/(状況|進捗|確認)/.test(normalizedInput)
  ) {
    // Extract emails from input (Phase Next-5 Day1: メールのみで相手を特定)
    const emails = extractEmails(input);
    
    // Extract duration if specified (default 30 minutes)
    const durationMatch = normalizedInput.match(/(\d+)分/);
    const duration = durationMatch ? parseInt(durationMatch[1], 10) : 30;
    
    // Phase Next-5 Day1: 来週固定（busyは使わない）
    const range = 'next_week';
    
    return {
      intent: 'schedule.auto_propose',
      confidence: 0.9,
      params: {
        rawInput: input,
        emails,
        duration,
        range,
      },
      needsClarification: emails.length === 0 ? {
        field: 'emails',
        message: '送る相手のメールアドレスを貼ってください。\n\n例: tanaka@example.com',
      } : undefined,
    };
  }

  // ============================================================
  // Phase Next-2 (P0): Scheduling
  // ============================================================

  // P0-1: schedule.external.create
  // PRIORITY: Email extraction first!
  const emails = extractEmails(input);
  
  if (
    /送(って|る)|調整|案内|招待/.test(normalizedInput) &&
    !/(状況|進捗|確認|教えて|候補.*出して)/.test(normalizedInput)
  ) {
    // Check if emails are provided
    if (emails.length === 0) {
      return {
        intent: 'schedule.external.create',
        confidence: 0.8,
        params: {
          rawInput: input,
        },
        needsClarification: {
          field: 'emails',
          message: '送信先のメールアドレスを貼ってください。\n\n例: tanaka@example.com',
        },
      };
    }
    
    return {
      intent: 'schedule.external.create',
      confidence: 0.9,
      params: {
        rawInput: input,
        emails,
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
