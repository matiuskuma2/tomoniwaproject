/**
 * Pool Classifier
 * 
 * G2-A: Pool Booking の intent 分類
 * 
 * 対象 intent:
 * - pool_booking.book: 予約実行（「予約したい」「申し込む」）
 * - pool_booking.cancel: 予約キャンセル
 * - pool_booking.list: 予約一覧
 * - pool_booking.slots: 空き枠確認
 */

import type { IntentResult, ClassifierFn, IntentContext } from './types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Patterns
// ============================================================

/** 予約実行パターン */
const BOOK_PATTERNS = [
  // 直接予約
  /予約(したい|する|して|お願い)/,
  /(申し込み|申込み?)(したい|する|して|お願い)/,
  /ブッキング(したい|する|して|お願い)?/i,
  /book(\s+|ing)?/i,
  
  // 枠選択後の予約
  /^([1-9]|10)(\s*番)?$/,  // 番号選択
  /この枠(で|を)(予約|申し込)/,
  /(この|その)(枠|時間)(で|を)?(お願い|予約)/,
];

/** キャンセルパターン */
const CANCEL_PATTERNS = [
  /予約(を)?キャンセル/,
  /(申し込み|申込み?)?(を)?キャンセル/,
  /予約(を)?取り消/,
  /キャンセル(したい|する|して|お願い)/,
];

/** 一覧表示パターン */
const LIST_PATTERNS = [
  /予約(の)?(一覧|リスト|状況|確認)/,
  /(私の|自分の)?予約(を)?確認/,
  /予約(状況|履歴)(を)?見/,
  /(booking|bookings)(\s+list)?/i,
];

/** 空き枠確認パターン */
const SLOTS_PATTERNS = [
  /空き(枠|時間|スロット)(を)?確認/,
  /(空いてる|空いている)(枠|時間)/,
  /空き(枠|時間)(を)?見/,
  /いつ(が|なら)?空い(てる|ている)/,
  /slots?(\s+available)?/i,
];

/** プール名抽出パターン */
const POOL_NAME_PATTERNS = [
  /「([^」]+)」(の|で|を)?(予約|申し込|空き)/,
  /([^\s「」]+)プール(の|で|を)?(予約|申し込|空き)/,
];

/** 枠ラベル抽出パターン */
const SLOT_LABEL_PATTERNS = [
  /「([^」]+)」(の|を)?(枠|時間)?/,
  /(\d{1,2}月\d{1,2}日)/,
  /(\d{1,2}[\/\-]\d{1,2})/,
  /(\d{1,2}:\d{2})/,
];

// ============================================================
// Classifier
// ============================================================

export const classifyPool: ClassifierFn = (
  input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
  activePending: PendingState | null
): IntentResult | null => {
  const params: Record<string, unknown> = {};
  
  // -------------------- pending.pool_booking.slot_selection 対応 --------------------
  // スロット選択待ちの場合、番号入力を予約として処理
  if (activePending?.kind === 'pending.action') {
    const summary = (activePending as any).summary;
    if (summary?.mode === 'pool_slot_selection') {
      const numberMatch = normalizedInput.match(/^([1-9]|10)$/);
      if (numberMatch) {
        const selectedIndex = parseInt(numberMatch[1], 10) - 1;
        const candidates = summary.candidates as Array<{ id: string }>;
        if (candidates && candidates[selectedIndex]) {
          params.slot_id = candidates[selectedIndex].id;
          params.pool_id = summary.pool_id;
          return {
            intent: 'pool_booking.book',
            confidence: 0.95,
            params,
          };
        }
      }
    }
    
    // プール選択待ちの場合
    if (summary?.mode === 'pool_selection') {
      const numberMatch = normalizedInput.match(/^([1-9]|10)$/);
      if (numberMatch) {
        const selectedIndex = parseInt(numberMatch[1], 10) - 1;
        const candidates = summary.candidates as Array<{ id: string }>;
        if (candidates && candidates[selectedIndex]) {
          params.pool_id = candidates[selectedIndex].id;
          return {
            intent: 'pool_booking.book',
            confidence: 0.95,
            params,
          };
        }
      }
    }
  }
  
  // -------------------- キャンセル --------------------
  for (const pattern of CANCEL_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        intent: 'pool_booking.cancel',
        confidence: 0.85,
        params: extractBookingParams(input, normalizedInput),
      };
    }
  }
  
  // -------------------- 一覧表示 --------------------
  for (const pattern of LIST_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        intent: 'pool_booking.list',
        confidence: 0.85,
        params: extractPoolParams(input, normalizedInput),
      };
    }
  }
  
  // -------------------- 空き枠確認 --------------------
  for (const pattern of SLOTS_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        intent: 'pool_booking.slots',
        confidence: 0.85,
        params: extractPoolParams(input, normalizedInput),
      };
    }
  }
  
  // -------------------- 予約実行 --------------------
  for (const pattern of BOOK_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        intent: 'pool_booking.book',
        confidence: 0.85,
        params: {
          ...extractPoolParams(input, normalizedInput),
          ...extractSlotParams(input, normalizedInput),
        },
      };
    }
  }
  
  // マッチしない場合は null（次の classifier に委譲）
  return null;
};

// ============================================================
// Helpers
// ============================================================

/**
 * プール名を抽出
 */
function extractPoolParams(input: string, _normalizedInput: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  
  for (const pattern of POOL_NAME_PATTERNS) {
    const match = input.match(pattern);
    if (match && match[1]) {
      params.pool_name = match[1];
      break;
    }
  }
  
  return params;
}

/**
 * スロットラベルを抽出
 */
function extractSlotParams(input: string, _normalizedInput: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  
  for (const pattern of SLOT_LABEL_PATTERNS) {
    const match = input.match(pattern);
    if (match && match[1]) {
      params.slot_label = match[1];
      break;
    }
  }
  
  return params;
}

/**
 * 予約IDを抽出（キャンセル用）
 */
function extractBookingParams(input: string, _normalizedInput: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  
  // UUID形式の予約ID
  const uuidMatch = input.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) {
    params.booking_id = uuidMatch[1];
  }
  
  // 短縮ID（8文字）
  const shortIdMatch = input.match(/予約ID[:\s]*([0-9a-f]{8})/i);
  if (shortIdMatch) {
    params.booking_id_prefix = shortIdMatch[1];
  }
  
  return { ...params, ...extractPoolParams(input, _normalizedInput) };
}
