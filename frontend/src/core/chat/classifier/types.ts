/**
 * classifier/types.ts
 * TD-003: Intent classification types
 * 
 * 外部I/Fは intentClassifier.ts から re-export される
 */

import type { PendingState } from '../pendingTypes';

// ============================================================
// Intent Types
// ============================================================

export type IntentType =
  | 'schedule.external.create'
  | 'schedule.status.check'
  | 'schedule.finalize'
  | 'schedule.invite.list'  // P0-4: リスト全員に招待メール送信
  | 'thread.create'  // P0-5: チャットからスレッド作成
  | 'schedule.today'      // Phase Next-3 (P1)
  | 'schedule.week'       // Phase Next-3 (P1)
  | 'schedule.freebusy'   // Phase Next-3 (P1)
  | 'schedule.freebusy.batch' // P3-INTERSECT1: 共通空き（複数参加者）
  | 'schedule.auto_propose' // Phase Next-5 (P2) - 自動調整提案
  | 'schedule.auto_propose.confirm' // Phase Next-5 Day2 - 提案確定
  | 'schedule.auto_propose.cancel'  // Phase Next-5 Day2 - 提案キャンセル
  | 'schedule.additional_propose'   // Phase Next-5 Day3 - 追加候補提案
  | 'schedule.remind.pending'       // Phase Next-6 Day1 - 未返信リマインド提案
  | 'schedule.remind.pending.confirm' // Phase Next-6 Day1 - リマインド確定
  | 'schedule.remind.pending.cancel'  // Phase Next-6 Day1 - リマインドキャンセル
  | 'schedule.notify.confirmed'       // Phase Next-6 Day3 - 確定通知提案
  | 'schedule.notify.confirmed.confirm' // Phase Next-6 Day3 - 確定通知確定
  | 'schedule.notify.confirmed.cancel'  // Phase Next-6 Day3 - 確定通知キャンセル
  | 'schedule.propose_for_split'        // Phase Next-6 Day2 - 票割れ通知提案
  | 'schedule.propose_for_split.confirm' // Phase Next-6 Day2 - 票割れ提案確定
  | 'schedule.propose_for_split.cancel'  // Phase Next-6 Day2 - 票割れ提案キャンセル
  | 'schedule.need_response.list'        // Phase2 P2-D0 - 再回答必要者リスト表示
  | 'schedule.remind.need_response'       // Phase2 P2-D1 - 再回答必要者にリマインド
  | 'schedule.remind.need_response.confirm' // Phase2 P2-D1 - リマインド確定
  | 'schedule.remind.need_response.cancel'  // Phase2 P2-D1 - リマインドキャンセル
  | 'schedule.remind.responded'            // Phase2 P2-D2 - 最新回答済みの人にリマインド
  | 'schedule.remind.responded.confirm'    // Phase2 P2-D2 - リマインド確定
  | 'schedule.remind.responded.cancel'     // Phase2 P2-D2 - リマインドキャンセル
  | 'schedule.reschedule'                  // Phase2 P2-D3 - 確定後やり直し（再調整）
  | 'schedule.reschedule.confirm'          // Phase2 P2-D3 - 再調整確定
  | 'schedule.reschedule.cancel'           // Phase2 P2-D3 - 再調整キャンセル
  // P3-PREF: スケジュール好み設定
  | 'preference.set'                       // P3-PREF3 - 好み設定
  | 'preference.show'                      // P3-PREF3 - 好み表示
  | 'preference.clear'                     // P3-PREF3 - 好みクリア
  // Beta A: 送信フロー
  | 'pending.action.decide'    // Beta A: 3語固定決定（送る/キャンセル/別スレッドで）
  | 'invite.prepare.emails'    // Beta A: メール入力 → prepare API
  | 'invite.prepare.list'      // Beta A: リスト選択 → prepare API
  // Beta A: リスト5コマンド
  | 'list.create'              // Beta A: リスト作成
  | 'list.list'                // Beta A: リスト一覧
  | 'list.members'             // Beta A: リストメンバー表示
  | 'list.add_member'          // Beta A: リストにメンバー追加
  | 'unknown';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  params: Record<string, any>;
  needsClarification?: {
    field: string;
    message: string;
  };
}

/**
 * Intent context for classification
 * P0-1: PendingState 正規化対応
 */
export interface IntentContext {
  selectedThreadId?: string;
  selectedSlotId?: string;
  // P0-1: 正規化された pending
  pendingForThread?: PendingState | null;
  globalPendingAction?: PendingState | null;
}

// ============================================================
// Classifier Function Type
// ============================================================

/**
 * 各分類器の関数型
 * null を返した場合は「マッチしなかった」= 次の分類器へ
 */
export type ClassifierFn = (
  input: string,
  normalizedInput: string,
  context: IntentContext | undefined,
  activePending: PendingState | null
) => IntentResult | null;
