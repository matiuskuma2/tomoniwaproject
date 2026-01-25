/**
 * classifier/confirmCancel.ts
 * TD-003: はい/いいえ系の確認・キャンセル判定
 * 
 * 優先順位: 2（pending.action の次）
 * 対象: split → notify → remind → remind_need_response → remind_responded → auto_propose
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';
import {
  isPendingSplit,
  isPendingNotify,
  isPendingRemind,
  isPendingRemindNeedResponse,
  isPendingRemindResponded,
  isPendingReschedule,
  isPendingAiConfirm,
} from '../pendingTypes';

/**
 * はい/いいえ系の確認・キャンセル分類器
 * - 短い肯定/否定の入力のみ対象
 * - pending の kind に応じて適切な intent を返す
 */
export const classifyConfirmCancel: ClassifierFn = (
  _input: string,
  normalizedInput: string,
  _context: IntentContext | undefined,
  activePending: PendingState | null
): IntentResult | null => {
  // 短い入力のみ対象（10文字以下）
  if (normalizedInput.length >= 10) {
    return null;
  }

  // ============================================================
  // Confirm（はい系）
  // ============================================================
  if (/(はい|yes|作成|ok|おk)/i.test(normalizedInput)) {
    // 優先順位順に判定
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

    // TD-REMIND-UNIFY: pending の情報を params に設定して executors に渡す
    if (isPendingRemind(activePending)) {
      return {
        intent: 'schedule.remind.pending.confirm',
        confidence: 0.9,
        params: {
          threadId: activePending.threadId,
          pendingInvitees: activePending.pendingInvites,
          count: activePending.count,
        },
      };
    }

    if (isPendingRemindNeedResponse(activePending)) {
      return {
        intent: 'schedule.remind.need_response.confirm',
        confidence: 0.9,
        params: {
          threadId: activePending.threadId,
          threadTitle: activePending.threadTitle,
          targetInvitees: activePending.targetInvitees,
          count: activePending.count,
        },
      };
    }

    if (isPendingRemindResponded(activePending)) {
      return {
        intent: 'schedule.remind.responded.confirm',
        confidence: 0.9,
        params: {
          threadId: activePending.threadId,
          threadTitle: activePending.threadTitle,
          targetInvitees: activePending.targetInvitees,
          count: activePending.count,
        },
      };
    }

    // P2-D3: 確定後やり直し（再調整）
    if (isPendingReschedule(activePending)) {
      return {
        intent: 'schedule.reschedule.confirm',
        confidence: 0.9,
        params: {
          originalThreadId: activePending.originalThreadId,
          originalTitle: activePending.originalTitle,
          participants: activePending.participants,
          suggestedTitle: activePending.suggestedTitle,
        },
      };
    }

    // CONV-1.2: AI確認待ち
    if (isPendingAiConfirm(activePending)) {
      // ai.confirmは元のintentに戻して実行
      return {
        intent: activePending.targetIntent as any,
        confidence: 0.95,
        params: {
          ...activePending.params,
          _aiConfirmed: true,  // 確認済みフラグ
        },
      };
    }

    // Default to auto_propose flow
    return {
      intent: 'schedule.auto_propose.confirm',
      confidence: 0.9,
      params: {},
    };
  }

  // ============================================================
  // Cancel（いいえ系）
  // ============================================================
  if (/(いいえ|no|キャンセル|やめ)/i.test(normalizedInput)) {
    // 優先順位順に判定
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

    if (isPendingRemindResponded(activePending)) {
      return {
        intent: 'schedule.remind.responded.cancel',
        confidence: 0.9,
        params: {},
      };
    }

    // P2-D3: 確定後やり直し（再調整）キャンセル
    if (isPendingReschedule(activePending)) {
      return {
        intent: 'schedule.reschedule.cancel',
        confidence: 0.9,
        params: {},
      };
    }

    // CONV-1.2: AI確認待ちのキャンセル
    if (isPendingAiConfirm(activePending)) {
      return {
        intent: 'unknown',  // キャンセルされたのでunknownに戻す
        confidence: 0.9,
        params: {
          _aiCancelled: true,
          message: 'キャンセルしました。',
        },
      };
    }

    // Default to auto_propose flow
    return {
      intent: 'schedule.auto_propose.cancel',
      confidence: 0.9,
      params: {},
    };
  }

  // マッチしない場合は null（次の分類器へ）
  return null;
};
