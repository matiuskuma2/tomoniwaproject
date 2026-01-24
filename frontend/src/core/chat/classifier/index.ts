/**
 * classifier/index.ts
 * TD-003: Intent分類の統合エントリポイント
 * 
 * 挙動は1ミリも変えない前提で、優先順位をコード構造で固定
 * 
 * 優先順位:
 * 1. pendingDecision - pending.action が存在する場合は最優先
 * 2. confirmCancel - はい/いいえ系（split/notify/remind の優先順で判定）
 * 3. lists - Beta A リスト5コマンド
 * 4. calendar - P1 カレンダー読み取り
 * 5. propose - 候補提案系
 * 6. remind - リマインド系
 * 7. thread - スレッド操作系（メール/確定/状況確認）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// 各分類器をインポート
import { classifyPendingDecision } from './pendingDecision';
import { classifyConfirmCancel } from './confirmCancel';
import { classifyLists } from './lists';
import { classifyCalendar } from './calendar';
import { classifyPropose } from './propose';
import { classifyRemind } from './remind';
import { classifyThread } from './thread';
import { classifyPreference } from './preference';

/**
 * 分類器チェーン（固定順序）
 * - 順番を変えると挙動が変わるため、絶対に順序を変更しないこと
 */
const classifierChain: ClassifierFn[] = [
  classifyPendingDecision,  // 1. pending.action 決定フロー（最優先）
  classifyConfirmCancel,    // 2. はい/いいえ系（split/notify/remind の優先順）
  classifyLists,            // 3. Beta A リスト5コマンド
  classifyCalendar,         // 4. P1 カレンダー読み取り
  classifyPreference,       // 5. P3-PREF 好み設定
  classifyPropose,          // 6. 候補提案系
  classifyRemind,           // 7. リマインド系
  classifyThread,           // 8. スレッド操作系
];

/**
 * Intent分類の統合エントリポイント
 * 
 * @param input - ユーザー入力（生テキスト）
 * @param context - 分類コンテキスト（selectedThreadId, pending等）
 * @returns IntentResult - 分類結果
 */
export function classifyIntentChain(input: string, context?: IntentContext): IntentResult {
  const normalizedInput = input.toLowerCase().trim();

  // P0-1: 正規化された pending を取得
  const activePending: PendingState | null =
    context?.pendingForThread ?? context?.globalPendingAction ?? null;

  // 分類器チェーンを順番に実行
  for (const classifier of classifierChain) {
    const result = classifier(input, normalizedInput, context, activePending);
    if (result !== null) {
      return result;
    }
  }

  // どの分類器にもマッチしなかった場合
  // CONV-1.0: rawInput を params に含めて nlRouter フォールバック用に保持
  return {
    intent: 'unknown',
    confidence: 0,
    params: {
      rawInput: input, // CONV-1.0: nlRouter フォールバック用
      threadId: context?.selectedThreadId,
    },
    // CONV-1.0: needsClarification は apiExecutor.ts で nlRouter 結果に応じて設定
  };
}

// 型とユーティリティを再エクスポート
export type { IntentType, IntentResult, IntentContext, ClassifierFn } from './types';
export { extractEmails, extractNames } from './utils';
