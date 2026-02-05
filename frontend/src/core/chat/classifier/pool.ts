/**
 * Pool Classifier
 * 
 * G2-A: Pool Booking の intent 分類
 * 
 * 対象 intent:
 * - pool_booking.create: プール作成（管理者）
 * - pool_booking.add_slots: 枠追加
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

/** プール作成パターン */
const CREATE_PATTERNS = [
  // プール作成
  /予約(受付|プール)(を)?作(って|成|る)/,
  /(受付|プール)(を)?作(って|成|る)/,
  /新しい(受付|プール)(を)?作/,
  /(相談|面談|営業|サポート).*(受付|窓口|プール).*(作|設置|開設)/,
  /(作成|設置|開設)(して|する|お願い)/,
  /create\s+(pool|booking)/i,
];

/** 枠追加パターン */
const ADD_SLOTS_PATTERNS = [
  /枠(を)?(追加|作成|設定)/,
  /スロット(を)?(追加|作成)/,
  /(予約)?枠(を)?増やす/,
  /add\s+slots?/i,
];

/** プール名抽出パターン */
const POOL_NAME_PATTERNS = [
  /「([^」]+)」(の|で|を)?(予約|申し込|空き|受付)/,
  /([^\s「」]+)(プール|受付|窓口)(の|で|を)?(予約|申し込|空き|作)/,
  /([^\s「」で]+)(で|の)(予約受付|受付)/,
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
  
  // -------------------- pending.pool.create 対応（確認待ち）--------------------
  if (activePending?.kind === 'pending.pool.create') {
    // はい/いいえ で確認
    if (/^(はい|yes|ok|うん|作成|作って|お願い)$/i.test(normalizedInput)) {
      return {
        intent: 'pool_booking.create_confirm',
        confidence: 0.95,
        params: { decision: 'confirm', draft: (activePending as any).draft },
      };
    }
    if (/^(いいえ|no|やめる|キャンセル|中止)$/i.test(normalizedInput)) {
      return {
        intent: 'pool_booking.create_cancel',
        confidence: 0.95,
        params: { decision: 'cancel' },
      };
    }
  }
  
  // -------------------- pending.pool.member_select 対応（メンバー選択待ち）--------------------
  if (activePending?.kind === 'pending.pool.member_select') {
    const numberMatch = normalizedInput.match(/^([1-9]|10)$/);
    if (numberMatch) {
      const selectedIndex = parseInt(numberMatch[1], 10) - 1;
      const pendingData = activePending as any;
      const candidates = pendingData.candidates as Array<{ id: string }>;
      if (candidates && candidates[selectedIndex]) {
        return {
          intent: 'pool_booking.member_selected',
          confidence: 0.95,
          params: { 
            selected_member_id: candidates[selectedIndex].id,
            pending: activePending,
          },
        };
      }
    }
    // キャンセル
    if (/^(キャンセル|やめる|中止)$/i.test(normalizedInput)) {
      return {
        intent: 'pool_booking.create_cancel',
        confidence: 0.95,
        params: { decision: 'cancel' },
      };
    }
  }
  
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
  
  // -------------------- プール作成 --------------------
  for (const pattern of CREATE_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        intent: 'pool_booking.create',
        confidence: 0.85,
        params: extractCreateParams(input, normalizedInput),
      };
    }
  }
  
  // -------------------- 枠追加 --------------------
  for (const pattern of ADD_SLOTS_PATTERNS) {
    if (pattern.test(normalizedInput)) {
      return {
        intent: 'pool_booking.add_slots',
        confidence: 0.85,
        params: extractSlotConfigParams(input, normalizedInput),
      };
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

/**
 * プール作成パラメータを抽出
 */
function extractCreateParams(input: string, normalizedInput: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  
  // プール名抽出
  // パターン1: 「〇〇」で予約受付/プールを作って
  const quotedMatch = input.match(/「([^」]+)」/);
  if (quotedMatch) {
    params.pool_name = quotedMatch[1];
  }
  
  // パターン2: 〇〇チームで予約受付
  const teamMatch = input.match(/([^\s「」]+)(チーム|部|課|グループ)(で|の)(予約|受付)/);
  if (teamMatch && !params.pool_name) {
    params.pool_name = `${teamMatch[1]}${teamMatch[2]}`;
  }
  
  // パターン3: 〇〇の予約受付/相談窓口
  const serviceMatch = input.match(/(相談|面談|営業|サポート|予約)(窓口|受付|プール)/);
  if (serviceMatch && !params.pool_name) {
    params.pool_name = `${serviceMatch[1]}${serviceMatch[2]}`;
  }
  
  // 説明文抽出
  const descMatch = input.match(/説明[：:]\s*(.+?)(?:[。、]|$)/);
  if (descMatch) {
    params.description = descMatch[1];
  }
  
  // メンバー抽出（「メンバーは田中/佐藤/山田」形式）
  const membersMatch = input.match(/メンバー[はは：:]\s*([^。]+)/);
  if (membersMatch) {
    const memberNames = membersMatch[1]
      .split(/[\/、,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (memberNames.length > 0) {
      params.member_names = memberNames;
    }
  }
  
  // 時間枠設定抽出
  const durationMatch = normalizedInput.match(/(\d+)(分|時間)(枠|の枠)/);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    params.duration_minutes = unit === '時間' ? value * 60 : value;
  }
  
  // 範囲抽出
  if (/来週/.test(normalizedInput)) {
    params.range = 'next_week';
  } else if (/来月/.test(normalizedInput)) {
    params.range = 'next_month';
  } else if (/今週/.test(normalizedInput)) {
    params.range = 'this_week';
  }
  
  // 時間帯抽出（10-18、10時〜18時など）
  const timeRangeMatch = normalizedInput.match(/(\d{1,2})[時:\-]?[-〜~](\d{1,2})時?/);
  if (timeRangeMatch) {
    params.start_hour = parseInt(timeRangeMatch[1], 10);
    params.end_hour = parseInt(timeRangeMatch[2], 10);
  }
  
  return params;
}

/**
 * スロット設定パラメータを抽出
 */
function extractSlotConfigParams(input: string, normalizedInput: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  
  // プール名
  const poolParams = extractPoolParams(input, normalizedInput);
  Object.assign(params, poolParams);
  
  // 時間枠設定
  const durationMatch = normalizedInput.match(/(\d+)(分|時間)(枠|の枠)?/);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    params.duration_minutes = unit === '時間' ? value * 60 : value;
  }
  
  // 範囲
  if (/来週/.test(normalizedInput)) {
    params.range = 'next_week';
  } else if (/来月/.test(normalizedInput)) {
    params.range = 'next_month';
  }
  
  // 時間帯
  const timeRangeMatch = normalizedInput.match(/(\d{1,2})[時:\-]?[-〜~](\d{1,2})時?/);
  if (timeRangeMatch) {
    params.start_hour = parseInt(timeRangeMatch[1], 10);
    params.end_hour = parseInt(timeRangeMatch[2], 10);
  }
  
  return params;
}
