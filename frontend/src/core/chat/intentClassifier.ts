/**
 * Intent Classifier for Phase Next-2 (P0) + Phase Next-3 (P1)
 * Rule-based intent classification for chat input
 * 
 * TD-003: 分類ロジックは classifier/ に分割
 * このファイルは外部I/F互換のための薄いラッパー
 */

// classifier/ から re-export
export type { IntentType, IntentResult, IntentContext } from './classifier';
export { extractEmails, extractNames } from './classifier';

// 内部で使用する分類関数をインポート
import { classifyIntentChain } from './classifier';
import type { IntentContext } from './classifier';

/**
 * Classify user input into one of the P0 intents
 * Phase Next-2: Rule-based only (no LLM)
 * P0-1: PendingState 正規化対応
 * 
 * TD-003: 実装は classifier/index.ts の classifyIntentChain に委譲
 * 外部I/Fは変更なし
 */
export function classifyIntent(input: string, context?: IntentContext) {
  return classifyIntentChain(input, context);
}
