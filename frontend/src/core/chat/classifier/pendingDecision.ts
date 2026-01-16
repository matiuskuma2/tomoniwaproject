/**
 * classifier/pendingDecision.ts
 * TD-003: pending.action 決定フロー（最優先）
 * 
 * pending.action が存在する場合、決定語のみ受け付け
 * 優先順位: 1（最優先）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';
import { isPendingAction } from '../pendingTypes';

/**
 * pending.action 決定フローの分類器
 * - 「送る」「キャンセル」「別スレッドで」のみ受け付け
 * - それ以外の入力は案内メッセージを返す
 */
export const classifyPendingDecision: ClassifierFn = (
  _input: string,
  normalizedInput: string,
  _context: IntentContext | undefined,
  activePending: PendingState | null
): IntentResult | null => {
  // pending.action が存在しない場合はスキップ
  if (!isPendingAction(activePending)) {
    return null;
  }

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

  // 決定語以外の入力は案内メッセージを返す（他の分類器には進まない）
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
};
