/**
 * classifier/propose.ts
 * TD-003: 候補提案系の分類
 * 
 * - schedule.additional_propose: 追加候補提案
 * - schedule.notify.confirmed: 確定通知
 * - schedule.auto_propose: 自動調整提案
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';
import { extractEmails } from './utils';

/**
 * 候補提案系の分類器
 */
export const classifyPropose: ClassifierFn = (
  input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
  _activePending: PendingState | null
): IntentResult | null => {
  // ============================================================
  // P2-4: schedule.additional_propose (Phase Next-5 Day3)
  // Keywords: 追加候補、もっと候補、追加で候補
  // ============================================================
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
  // P3-4: schedule.notify.confirmed (Phase Next-6 Day3)
  // Keywords: 確定通知、みんなに知らせ、全員に連絡、確定送る
  // ============================================================
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
  // P2-1: schedule.auto_propose
  // Keywords: 候補出して、調整して、自動、提案
  // NOTE: This should be checked BEFORE schedule.external.create
  // ============================================================
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
      needsClarification:
        emails.length === 0
          ? {
              field: 'emails',
              message: '送る相手のメールアドレスを貼ってください。\n\n例: tanaka@example.com',
            }
          : undefined,
    };
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};
