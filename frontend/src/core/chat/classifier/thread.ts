/**
 * classifier/thread.ts
 * TD-003: スレッド操作系の分類
 * 
 * - thread.create: スレッド作成
 * - invite.prepare.emails: メール入力 → prepare API
 * - schedule.external.create: 旧フロー（メール不足時）
 * - schedule.invite.list: リスト全員に招待
 * - schedule.finalize: 日程確定
 * - schedule.status.check: 状況確認
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';
import { extractEmails } from './utils';

/**
 * スレッド操作系の分類器
 */
export const classifyThread: ClassifierFn = (
  input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
  _activePending: PendingState | null
): IntentResult | null => {
  // ============================================================
  // P0-5: thread.create
  // Keywords: スレッド作って、新規日程、日程調整開始
  // ============================================================
  if (
    /(スレッド(作|つく)|新規(スレッド|日程)|日程調整(開始|作成)|予定調整(開始|作成))/i.test(
      normalizedInput
    )
  ) {
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
  // P2-E2: rawText を渡してSMS用の phone を抽出可能に
  if (emails.length > 0) {
    return {
      intent: 'invite.prepare.emails',
      confidence: 0.95,
      params: {
        rawInput: input,
        rawText: input,  // P2-E2: phone抽出用に生テキストを渡す
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
        // P2-E2: phone入力例も追加
        message: '送信先のメールアドレスを貼ってください。\n\n例:\n• tanaka@example.com\n• tanaka@example.com +819012345678 (SMS送信する場合)',
      },
    };
  }

  // ============================================================
  // P0-4: schedule.invite.list
  // Keywords: リスト○○に送って、○○リストに招待、リスト全員に
  // NOTE: Beta A の invite.prepare.list で先に処理されるが、後方互換のため残す
  // ============================================================
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
          message:
            'どのリストに招待メールを送りますか？\n\n例: 「リスト「営業部」に招待メールを送って」',
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

  // ============================================================
  // P0-3: schedule.finalize
  // Keywords: 確定、決める、この日、1番、2番、etc.
  // ============================================================
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
    console.log(
      '[Intent] schedule.finalize: slotMatch =',
      slotMatch,
      'normalizedInput =',
      normalizedInput
    );

    return {
      intent: 'schedule.finalize',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
        slotNumber: slotMatch ? parseInt(slotMatch[1], 10) : undefined,
      },
      needsClarification: !slotMatch
        ? {
            field: 'slotId',
            message: 'どの候補日時で確定しますか？\n\n例: 「1番で確定」と入力してください。',
          }
        : undefined,
    };
  }

  // ============================================================
  // PROG-1: 会話的な進捗質問（優先判定）
  // Keywords: 今どうなってる、返事きた、誰が未回答、進捗教えて
  // → mode: 'summary' で会話向け要約を返す
  // ============================================================
  const conversationalProgressPatterns = [
    /今どうなってる/,
    /今の状況/,
    /進捗(教えて|は|どう)/,
    /返事.*(きた|来た|あった)/,
    /誰.*(未回答|返事)/,
    /まだ.*(返事|回答)/,
    /何人.*(回答|返事)/,
    /次.*(どうする|すべき|すれば)/,  // 「次どうすればいい？」対応
  ];

  if (conversationalProgressPatterns.some(p => p.test(normalizedInput))) {
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.status.check',
        confidence: 0.85,
        params: {
          mode: 'summary',
          scope: 'all',
        },
        needsClarification: {
          field: 'threadId',
          message:
            'どのスレッドの進捗を確認しますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }

    return {
      intent: 'schedule.status.check',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
        mode: 'summary',  // PROG-1: 会話向け要約
      },
    };
  }

  // ============================================================
  // P0-2: schedule.status.check
  // Keywords: 状況、進捗、確認、教えて、何がある
  // PROG-1: デフォルトで mode: 'summary' を使用（会話向け）
  // ============================================================
  if (/(状況|進捗|確認|教えて|何.*ある|見(る|て)|どう|参加|未返信)/.test(normalizedInput)) {
    return {
      intent: 'schedule.status.check',
      confidence: 0.8,
      params: {
        threadId: context?.selectedThreadId,
        scope: normalizedInput.includes('募集') || normalizedInput.includes('全') ? 'all' : 'single',
        mode: 'summary',  // PROG-1: デフォルトで会話向け要約
      },
      needsClarification:
        !context?.selectedThreadId && !normalizedInput.includes('募集')
          ? {
              field: 'threadId',
              message:
                'どのスレッドの状況を確認しますか？\n左のスレッド一覧から選択してください。\n\nまたは「募集中の予定」と入力すると全体を確認できます。',
            }
          : undefined,
    };
  }

  // ============================================================
  // P2-D3: schedule.reschedule
  // Keywords: 再調整、やり直し、日程変更、リスケ
  // 確定済みスレッドを選択中に「日程を変更したい」で発動
  // ============================================================
  if (/(再調整|やり直し|日程変更|リスケ|改めて|もう一度|別の日|変更したい)/.test(normalizedInput)) {
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.reschedule',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message: 'どのスレッドを再調整しますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }

    return {
      intent: 'schedule.reschedule',
      confidence: 0.9,
      params: {
        threadId: context.selectedThreadId,
      },
    };
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};
