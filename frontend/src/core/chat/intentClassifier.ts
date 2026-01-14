/**
 * Intent Classifier for Phase Next-2 (P0) + Phase Next-3 (P1)
 * Rule-based intent classification for chat input
 */

export type IntentType =
  | 'schedule.external.create'
  | 'schedule.status.check'
  | 'schedule.finalize'
  | 'schedule.invite.list'  // P0-4: リスト全員に招待メール送信
  | 'thread.create'  // P0-5: チャットからスレッド作成
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
  | 'schedule.need_response.list'        // Phase2 P2-D0 - 再回答必要者リスト表示
  | 'schedule.remind.need_response'       // Phase2 P2-D1 - 再回答必要者にリマインド
  | 'schedule.remind.need_response.confirm' // Phase2 P2-D1 - リマインド確定
  | 'schedule.remind.need_response.cancel'  // Phase2 P2-D1 - リマインドキャンセル
  // Beta A: 送信フロー
  | 'pending.action.decide'    // Beta A: 3語固定決定（送る/キャンセル/別スレッドで）
  | 'invite.prepare.emails'    // Beta A: メール入力 → prepare API
  | 'invite.prepare.list'      // Beta A: リスト選択 → prepare API
  // Beta A: リスト5コマンド
  | 'list.create'              // Beta A: リスト作成
  | 'list.list'                // Beta A: リスト一覧
  | 'list.members'             // Beta A: リストメンバー表示
  | 'list.add_member'          // Beta A: リストにメンバー追加
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
 * P0-1: PendingState 正規化対応
 */
import type { PendingState } from './pendingTypes';
import { 
  isPendingAction, 
  isPendingRemind, 
  isPendingRemindNeedResponse,
  isPendingNotify,
  isPendingSplit,
} from './pendingTypes';

export interface IntentContext {
  selectedThreadId?: string;
  selectedSlotId?: string;
  // P0-1: 正規化された pending
  pendingForThread?: PendingState | null;
  globalPendingAction?: PendingState | null;
}

/**
 * Classify user input into one of the P0 intents
 * Phase Next-2: Rule-based only (no LLM)
 * P0-1: PendingState 正規化対応
 */
export function classifyIntent(input: string, context?: IntentContext): IntentResult {
  const normalizedInput = input.toLowerCase().trim();
  
  // P0-1: 正規化された pending を取得
  const activePending = context?.pendingForThread ?? context?.globalPendingAction ?? null;

  // ============================================================
  // P0-1: pending.action 決定フロー（最優先）
  // pending.action が存在する場合、決定語のみ受け付け
  // ============================================================
  if (isPendingAction(activePending)) {
    const isAddSlots = activePending.mode === 'add_slots';
    
    // 「送る」「send」「追加」「add」
    if (/^(送る|送って|send|送信|追加|追加する|add)$/i.test(normalizedInput)) {
      return {
        intent: 'pending.action.decide',
        confidence: 1.0,
        params: {
          decision: isAddSlots ? '追加' : '送る',
          confirmToken: activePending.confirmToken,
        },
      };
    }
    // 「キャンセル」「cancel」「やめる」
    if (/^(キャンセル|やめる|cancel|取り消し|取消)$/i.test(normalizedInput)) {
      return {
        intent: 'pending.action.decide',
        confidence: 1.0,
        params: {
          decision: 'キャンセル',
          confirmToken: activePending.confirmToken,
        },
      };
    }
    // 「別スレッドで」「new_thread」（add_slots では使用不可）
    if (!isAddSlots && /^(別スレッドで|別スレッド|新規スレッド|new.?thread)$/i.test(normalizedInput)) {
      return {
        intent: 'pending.action.decide',
        confidence: 1.0,
        params: {
          decision: '別スレッドで',
          confirmToken: activePending.confirmToken,
        },
      };
    }
    // 決定語以外の入力は案内メッセージを返す
    const helpMessage = isAddSlots
      ? '現在、追加候補の確認待ちです。\n\n「追加」または「キャンセル」を入力してください。'
      : '現在、送信確認待ちです。\n\n「送る」「キャンセル」「別スレッドで」のいずれかを入力してください。';
    return {
      intent: 'unknown',
      confidence: 0,
      params: {},
      needsClarification: {
        field: 'decision',
        message: helpMessage,
      },
    };
  }

  // ============================================================
  // Beta A: リスト5コマンド
  // ============================================================
  
  // list.create: 「営業部リストを作って」「リスト作成」
  if (/(リスト|list).*(作|つく|作成|create)/i.test(normalizedInput) || 
      /(作|つく).*(リスト|list)/i.test(normalizedInput)) {
    const listNameMatch = input.match(/[「『](.+?)[」』]|(.+?)(リスト|list).*(作|つく)/i);
    const listName = listNameMatch ? (listNameMatch[1] || listNameMatch[2])?.trim() : undefined;
    
    return {
      intent: 'list.create',
      confidence: 0.9,
      params: {
        listName,
        rawInput: input,
      },
      needsClarification: !listName ? {
        field: 'listName',
        message: '作成するリストの名前を入力してください。\n\n例: 「営業部リストを作って」',
      } : undefined,
    };
  }
  
  // list.list: 「リスト見せて」「リスト一覧」「リスト」
  const listListInput = normalizedInput.trim();
  if (/^(リスト|list)(見せ|見て|一覧|表示|show)?$/i.test(listListInput) ||
      /^(リスト|list).*(見せて|見て|一覧|表示)/i.test(listListInput)) {
    return {
      intent: 'list.list',
      confidence: 0.9,
      params: {},
    };
  }
  
  // list.members: 「営業部リストのメンバー」「〇〇リストの中身」「テストリストのメンバー」
  if (/(リスト|list).*(メンバー|中身|内容|members)/i.test(normalizedInput)) {
    // 「テストリストのメンバー」→「テストリスト」を抽出
    const listNameMatch = input.match(/[「『](.+?)[」』]|(.+?)(リスト|list)/i);
    let listName = listNameMatch ? (listNameMatch[1] || listNameMatch[2])?.trim() : undefined;
    // 「テスト」だけでなく「テストリスト」全体を保持
    if (listName && !listName.endsWith('リスト') && input.includes(listName + 'リスト')) {
      listName = listName + 'リスト';
    }
    
    return {
      intent: 'list.members',
      confidence: 0.9,
      params: {
        listName,
        rawInput: input,
      },
      needsClarification: !listName ? {
        field: 'listName',
        message: 'どのリストのメンバーを表示しますか？\n\n例: 「営業部リストのメンバー」',
      } : undefined,
    };
  }
  
  // list.add_member: 「tanaka@example.comを営業部リストに追加」
  if (/(リスト|list).*(追加|add)/i.test(normalizedInput) ||
      /(追加|add).*(リスト|list)/i.test(normalizedInput)) {
    const emails = extractEmails(input);
    const listNameMatch = input.match(/[「『](.+?)[」』](リスト|list)?に|(.*?)(リスト|list)に/i);
    const listName = listNameMatch ? (listNameMatch[1] || listNameMatch[3])?.trim() : undefined;
    
    return {
      intent: 'list.add_member',
      confidence: 0.9,
      params: {
        emails,
        listName,
        rawInput: input,
      },
      needsClarification: emails.length === 0 ? {
        field: 'emails',
        message: '追加するメールアドレスを入力してください。\n\n例: 「tanaka@example.comを営業部リストに追加」',
      } : !listName ? {
        field: 'listName',
        message: 'どのリストに追加しますか？\n\n例: 「営業部リストに追加」',
      } : undefined,
    };
  }
  
  // invite.prepare.list: 「営業部リストに招待」「〇〇リストに送って」
  // NOTE: schedule.invite.list より優先（Beta A フローを使用）
  if (/(リスト|list).*(招待|送|invite)/i.test(normalizedInput)) {
    const listNameMatch = input.match(/[「『](.+?)[」』](リスト)?に|(.+?)(リスト|list)に/i);
    const listName = listNameMatch ? (listNameMatch[1] || listNameMatch[3])?.trim() : undefined;
    
    return {
      intent: 'invite.prepare.list',
      confidence: 0.95,
      params: {
        listName,
        threadId: context?.selectedThreadId,
        rawInput: input,
      },
      needsClarification: !listName ? {
        field: 'listName',
        message: 'どのリストに招待を送りますか？\n\n例: 「営業部リストに招待」',
      } : undefined,
    };
  }

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

  // P0-1: Confirm (提案確定) - 正規化された pending を使用
  // Keywords: はい、yes、作成して、OK
  if (/(はい|yes|作成|ok|おk)/i.test(normalizedInput) && normalizedInput.length < 10) {
    // P0-1: pendingForThread の kind で判定（優先順位順）
    if (isPendingSplit(activePending)) {
      return {
        intent: 'schedule.propose_for_split.confirm',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (isPendingNotify(activePending)) {
      return {
        intent: 'schedule.notify.confirmed.confirm',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (isPendingRemind(activePending)) {
      return {
        intent: 'schedule.remind.pending.confirm',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (isPendingRemindNeedResponse(activePending)) {
      return {
        intent: 'schedule.remind.need_response.confirm',
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

  // P0-1: Cancel (提案キャンセル) - 正規化された pending を使用
  // Keywords: いいえ、no、キャンセル、やめる
  if (/(いいえ|no|キャンセル|やめ)/i.test(normalizedInput) && normalizedInput.length < 10) {
    // P0-1: pendingForThread の kind で判定（優先順位順）
    if (isPendingSplit(activePending)) {
      return {
        intent: 'schedule.propose_for_split.cancel',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (isPendingNotify(activePending)) {
      return {
        intent: 'schedule.notify.confirmed.cancel',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (isPendingRemind(activePending)) {
      return {
        intent: 'schedule.remind.pending.cancel',
        confidence: 0.9,
        params: {},
      };
    }
    
    if (isPendingRemindNeedResponse(activePending)) {
      return {
        intent: 'schedule.remind.need_response.cancel',
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
  
  // ============================================================
  // Phase2 P2-D0: 再回答必要者リスト表示
  // ============================================================
  
  // P2-D0: schedule.need_response.list
  // Keywords: 再回答、要回答、回答待ち、誰が回答、誰に聞く
  if (/(再回答|要回答|回答待ち|誰が回答|誰に聞|回答必要|回答が必要)/.test(normalizedInput)) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.need_response.list',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドの再回答必要者を確認しますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }
    
    return {
      intent: 'schedule.need_response.list',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
      },
    };
  }

  // ============================================================
  // Phase2 P2-D1: 再回答必要者だけにリマインド
  // P0-1: この判定は上の confirm/cancel 判定に統合済み
  // ============================================================
  
  // P2-D1: schedule.remind.need_response
  // Keywords: 再回答必要な人にリマインド、再回答の人だけ、要回答者にリマインド
  if (/(再回答.*リマインド|要回答.*リマインド|回答必要.*リマインド|再回答.*送|要回答.*送|回答必要.*人.*送)/.test(normalizedInput)) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.remind.need_response',
        confidence: 0.95,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドの再回答必要者にリマインドを送りますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }
    
    return {
      intent: 'schedule.remind.need_response',
      confidence: 0.95,
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

  // P0-5: thread.create
  // Keywords: スレッド作って、新規日程、日程調整開始
  if (/(スレッド(作|つく)|新規(スレッド|日程)|日程調整(開始|作成)|予定調整(開始|作成))/i.test(normalizedInput)) {
    return {
      intent: 'thread.create',
      confidence: 0.9,
      params: {
        rawInput: input,
      },
    };
  }

  // ============================================================
  // Beta A: メール入力 → invite.prepare.emails
  // NOTE: schedule.external.create を置き換え
  // ============================================================
  
  // P0-1: Email extraction
  const emails = extractEmails(input);
  
  // Beta A: If emails are found, route to invite.prepare.emails
  // - スレッド選択中: 追加招待（invites/prepare）
  // - スレッド未選択: 新規作成（prepare-send）
  if (emails.length > 0) {
    return {
      intent: 'invite.prepare.emails',
      confidence: 0.95,
      params: {
        rawInput: input,
        emails,
        threadId: context?.selectedThreadId,
        mode: context?.selectedThreadId ? 'add_to_thread' : 'new_thread',
      },
    };
  }
  
  // If keywords are present but no emails, ask for clarification
  if (
    /送(って|る)|調整|案内|招待/.test(normalizedInput) &&
    !/(状況|進捗|確認|教えて|候補.*出して)/.test(normalizedInput)
  ) {
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

  // P0-4: schedule.invite.list
  // Keywords: リスト○○に送って、○○リストに招待、リスト全員に
  if (/(リスト.*送|リスト.*招待|リスト.*全員)/.test(normalizedInput)) {
    // Extract list name from input
    const listNameMatch = input.match(/リスト[「『]?(.+?)[」』]?に|[「『](.+?)[」』]リスト/);
    const listName = listNameMatch ? (listNameMatch[1] || listNameMatch[2]).trim() : undefined;
    
    if (!listName) {
      return {
        intent: 'schedule.invite.list',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'listName',
          message: 'どのリストに招待メールを送りますか？\n\n例: 「リスト「営業部」に招待メールを送って」',
        },
      };
    }
    
    return {
      intent: 'schedule.invite.list',
      confidence: 0.9,
      params: {
        listName,
        threadId: context?.selectedThreadId,
      },
    };
  }

  // P0-3: schedule.finalize
  // Keywords: 確定、決める、この日、1番、2番、etc.
  if (
    /(確定|決め(る|て)|この日)/.test(normalizedInput) ||
    /\d+番?(で|に|を)/.test(normalizedInput) // "1番で", "2で", "1番"
  ) {
    // Check if we have required context
    if (!context?.selectedThreadId) {
      console.log('[Intent] schedule.finalize: No threadId in context');
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

    // Extract slot number from input (e.g., "1番で" -> 1, "1番" -> 1)
    const slotMatch = normalizedInput.match(/(\d+)番?/);
    console.log('[Intent] schedule.finalize: slotMatch =', slotMatch, 'normalizedInput =', normalizedInput);
    
    return {
      intent: 'schedule.finalize',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
        slotNumber: slotMatch ? parseInt(slotMatch[1], 10) : undefined,
      },
      needsClarification: !slotMatch ? {
        field: 'slotId',
        message: 'どの候補日時で確定しますか？\n\n例: 「1番で確定」と入力してください。',
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
