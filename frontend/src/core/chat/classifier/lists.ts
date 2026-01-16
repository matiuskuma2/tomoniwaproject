/**
 * classifier/lists.ts
 * TD-003: Beta A リスト5コマンド
 * 
 * - list.create: リスト作成
 * - list.list: リスト一覧
 * - list.members: リストメンバー表示
 * - list.add_member: リストにメンバー追加
 * - invite.prepare.list: リストに招待
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';
import { extractEmails } from './utils';

/**
 * リストコマンドの分類器
 */
export const classifyLists: ClassifierFn = (
  input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
  _activePending: PendingState | null
): IntentResult | null => {
  // ============================================================
  // list.create: 「営業部リストを作って」「リスト作成」
  // ============================================================
  if (
    /(リスト|list).*(作|つく|作成|create)/i.test(normalizedInput) ||
    /(作|つく).*(リスト|list)/i.test(normalizedInput)
  ) {
    const listNameMatch = input.match(/[「『](.+?)[」』]|(.+?)(リスト|list).*(作|つく)/i);
    const listName = listNameMatch ? (listNameMatch[1] || listNameMatch[2])?.trim() : undefined;

    return {
      intent: 'list.create',
      confidence: 0.9,
      params: {
        listName,
        rawInput: input,
      },
      needsClarification: !listName
        ? {
            field: 'listName',
            message: '作成するリストの名前を入力してください。\n\n例: 「営業部リストを作って」',
          }
        : undefined,
    };
  }

  // ============================================================
  // list.list: 「リスト見せて」「リスト一覧」「リスト」
  // ============================================================
  const listListInput = normalizedInput.trim();
  if (
    /^(リスト|list)(見せ|見て|一覧|表示|show)?$/i.test(listListInput) ||
    /^(リスト|list).*(見せて|見て|一覧|表示)/i.test(listListInput)
  ) {
    return {
      intent: 'list.list',
      confidence: 0.9,
      params: {},
    };
  }

  // ============================================================
  // list.members: 「営業部リストのメンバー」「〇〇リストの中身」
  // ============================================================
  if (/(リスト|list).*(メンバー|中身|内容|members)/i.test(normalizedInput)) {
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
      needsClarification: !listName
        ? {
            field: 'listName',
            message: 'どのリストのメンバーを表示しますか？\n\n例: 「営業部リストのメンバー」',
          }
        : undefined,
    };
  }

  // ============================================================
  // list.add_member: 「tanaka@example.comを営業部リストに追加」
  // ============================================================
  if (
    /(リスト|list).*(追加|add)/i.test(normalizedInput) ||
    /(追加|add).*(リスト|list)/i.test(normalizedInput)
  ) {
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
      needsClarification:
        emails.length === 0
          ? {
              field: 'emails',
              message:
                '追加するメールアドレスを入力してください。\n\n例: 「tanaka@example.comを営業部リストに追加」',
            }
          : !listName
          ? {
              field: 'listName',
              message: 'どのリストに追加しますか？\n\n例: 「営業部リストに追加」',
            }
          : undefined,
    };
  }

  // ============================================================
  // invite.prepare.list: 「営業部リストに招待」「〇〇リストに送って」
  // NOTE: schedule.invite.list より優先（Beta A フローを使用）
  // ============================================================
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
      needsClarification: !listName
        ? {
            field: 'listName',
            message: 'どのリストに招待を送りますか？\n\n例: 「営業部リストに招待」',
          }
        : undefined,
    };
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};
