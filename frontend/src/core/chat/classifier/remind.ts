/**
 * classifier/remind.ts
 * TD-003: リマインド系の分類
 * 
 * - schedule.need_response.list: 再回答必要者リスト表示
 * - schedule.remind.need_response: 再回答必要者にリマインド
 * - schedule.remind.responded: 最新回答済みの人にリマインド (P2-D2)
 * - schedule.remind.pending: 未返信リマインド
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

/**
 * リマインド系の分類器
 */
export const classifyRemind: ClassifierFn = (
  _input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
  _activePending: PendingState | null
): IntentResult | null => {
  // ============================================================
  // P2-D0: schedule.need_response.list
  // Keywords: 再回答、要回答、回答待ち、誰が回答、誰に聞く
  // ============================================================
  if (/(再回答|要回答|回答待ち|誰が回答|誰に聞|回答必要|回答が必要)/.test(normalizedInput)) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.need_response.list',
        confidence: 0.9,
        params: {},
        needsClarification: {
          field: 'threadId',
          message:
            'どのスレッドの再回答必要者を確認しますか？\n左のスレッド一覧から選択してください。',
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
  // P2-D1: schedule.remind.need_response
  // Keywords: 再回答必要な人にリマインド、再回答の人だけ、要回答者にリマインド
  // NOTE: need_response.list より後に判定（リマインド系のキーワードが必要）
  // ============================================================
  if (
    /(再回答.*リマインド|要回答.*リマインド|回答必要.*リマインド|再回答.*送|要回答.*送|回答必要.*人.*送)/.test(
      normalizedInput
    )
  ) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.remind.need_response',
        confidence: 0.95,
        params: {},
        needsClarification: {
          field: 'threadId',
          message:
            'どのスレッドの再回答必要者にリマインドを送りますか？\n左のスレッド一覧から選択してください。',
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

  // ============================================================
  // P2-D2: schedule.remind.responded
  // Keywords: 回答済みの人にリマインド、回答者にリマインド、答えた人に
  // NOTE: need_response より後、pending より前に判定
  // ============================================================
  if (
    /(回答済み.*リマインド|回答者.*リマインド|答えた人.*リマインド|回答した人.*リマインド|回答済み.*送|回答者.*送)/.test(
      normalizedInput
    )
  ) {
    // Require threadId context
    if (!context?.selectedThreadId) {
      return {
        intent: 'schedule.remind.responded',
        confidence: 0.95,
        params: {},
        needsClarification: {
          field: 'threadId',
          message:
            'どのスレッドの回答済みの人にリマインドを送りますか？\n左のスレッド一覧から選択してください。',
        },
      };
    }

    return {
      intent: 'schedule.remind.responded',
      confidence: 0.95,
      params: {
        threadId: context.selectedThreadId,
      },
    };
  }

  // ============================================================
  // P3-1: schedule.remind.pending (Phase Next-6 Day1)
  // Keywords: リマインド、催促、未返信
  // ============================================================
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

  // マッチしない場合は null（次の分類器へ）
  return null;
};
