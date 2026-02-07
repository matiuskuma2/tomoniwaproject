/**
 * Classifier Chain - 共通型定義
 * 
 * チャット入力を分類するchain of responsibility
 * 優先順位: pendingDecision > contactImport > (将来の他classifier)
 */

import type {
  PendingConfirmationKind,
  PendingConfirmationState,
} from '../../../../packages/shared/src/types/pendingAction';

// ============================================================
// Classified Intent - classifierが返す統一型
// ============================================================

/** 分類されたintentのカテゴリ */
export type ClassifiedCategory =
  | 'pending.decision'             // pending中のYES/NO応答
  | 'contact.import.text'          // テキストから連絡先取り込み
  | 'contact.import.csv'           // CSVから連絡先取り込み
  | 'contact.import.confirm'       // 取り込みプレビューへのYES/NO
  | 'contact.import.cancel'        // 取り込みキャンセル
  | 'contact.import.person_select' // 曖昧一致の番号選択
  | 'list.create'                  // リスト作成
  | 'list.add_member'              // リストにメンバー追加
  | 'list.remove_member'           // リストからメンバー削除
  | 'list.show'                    // リスト一覧/詳細表示
  | 'general.intent'               // 既存のintent parse（create/modify/query等）
  | 'unknown';

/** 分類結果 */
export interface ClassifiedIntent {
  category: ClassifiedCategory;
  confidence: number;
  /** pending応答の場合のYES/NO/番号 */
  pending_response?: PendingDecisionResponse;
  /** contact import のraw text */
  raw_text?: string;
  /** person select の選択情報 */
  person_selection?: PersonSelectionInput;
  /** list操作のパラメータ */
  list_params?: ListOperationParams;
}

/** list操作のパラメータ（classifier→executor間で渡す） */
export interface ListOperationParams {
  /** リスト名（create / show / add / remove で使用） */
  list_name?: string;
  /** リスト説明（create用） */
  description?: string;
  /** メンバー名 or メール（add/remove用） */
  member_query?: string;
  /** 複数メンバー（一括add用） */
  member_queries?: string[];
}

/** pending.decision の応答内容 */
export interface PendingDecisionResponse {
  answer: 'yes' | 'no';
  /** どのpending kindに対する応答か */
  target_kind: PendingConfirmationKind;
}

/** person.select の選択入力 */
export interface PersonSelectionInput {
  /** 選択番号（0=新規, 1~N=既存候補, -1=スキップ） */
  selected_number: number;
  /** スキップかどうか */
  is_skip: boolean;
  /** 対象のentry index */
  target_entry_index: number;
}

// ============================================================
// Classifier Context - classifierに渡すコンテキスト
// ============================================================

export interface ClassifierContext {
  /** ユーザー入力テキスト */
  user_input: string;
  /** 現在のpending状態 */
  pending_state: PendingConfirmationState;
  /** ユーザーID */
  user_id: string;
  /** 現在pending中のperson.selectで表示中のentry index（あれば） */
  current_ambiguous_entry_index?: number;
}

// ============================================================
// Classifier Interface
// ============================================================

export interface IClassifier {
  /** このclassifierの名前 */
  name: string;
  /** 分類を試みる。マッチしなければnullを返す */
  classify(ctx: ClassifierContext): ClassifiedIntent | null;
}
