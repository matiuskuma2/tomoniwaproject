/**
 * Classifier: Contact Import
 * 
 * pending.contact_import.confirm / pending.contact_import.person_select を拾う。
 * classifyPendingDecision の直後に実行される。
 * 
 * 判定ロジック:
 * 1. pending.contact_import.confirm の場合
 *    → YES/NO を拾う → contact.import.confirm / contact.import.cancel
 * 2. pending.contact_import.person_select の場合
 *    → 番号 / 0(新規) / s(スキップ) を拾う → contact.import.person_select
 * 3. pending無し & テキストがメール/名前リストっぽい場合
 *    → contact.import.text
 */

import type { IClassifier, ClassifierContext, ClassifiedIntent } from './types';
import { PENDING_CONFIRMATION_KIND } from '../../../../packages/shared/src/types/pendingAction';

// YES判定パターン（confirm用）
const YES_PATTERNS = [
  /^(はい|うん|yes|ok|おk|いいよ|いいです|お願い|登録して|確定|する|了解|りょ|おけ)$/i,
  /^(y|yes|ok|sure|go|confirm|register)$/i,
];

// NO判定パターン（cancel用）
const NO_PATTERNS = [
  /^(いいえ|いや|no|だめ|やめ|やめて|キャンセル|取り消|中止|しない|やめる|やめとく)$/i,
  /^(n|no|nope|cancel|abort|stop)$/i,
];

// 番号選択パターン（person_select用）
// 0=新規, 1~99=候補番号
const NUMBER_PATTERN = /^(\d{1,2})$/;

// スキップパターン
const SKIP_PATTERNS = [
  /^(s|skip|スキップ|飛ばす|飛ばして|次|パス)$/i,
];

// 新規作成パターン（0の代替表現）
const NEW_PATTERNS = [
  /^(新規|新しく|new|create|作成|0)$/i,
];

// テキスト取り込み判定パターン
// メールアドレスが含まれている、またはカンマ区切りの名前リスト
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const MULTI_LINE_NAMES = /\n.*\n/; // 3行以上
const COMMA_SEPARATED = /[,、]\s*\S+\s*[,、]\s*\S+/; // カンマ区切り3つ以上
const IMPORT_KEYWORDS = /(?:登録|取り込|インポート|import|追加して|台帳に)/i;

// CSV判定パターン
const CSV_KEYWORDS = /(?:csv|CSV|シーエスブイ)/i;
const CSV_HEADER_PATTERNS = /(?:^|\n)\s*(?:name|名前|氏名|email|メール|mail)/im;
// CSV構造: 2行以上で各行にカンマまたはタブが1つ以上
const CSV_STRUCTURE = /^[^\n]+[,\t][^\n]+\n[^\n]+[,\t][^\n]+/m;

export class ContactImportClassifier implements IClassifier {
  name = 'contactImport';

  classify(ctx: ClassifierContext): ClassifiedIntent | null {
    const input = ctx.user_input.trim();

    // ============================================================
    // Phase 1: pending.contact_import.confirm の場合
    // ============================================================
    if (
      ctx.pending_state.hasPending &&
      ctx.pending_state.kind === PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM
    ) {
      // YES → confirm
      if (YES_PATTERNS.some(p => p.test(input))) {
        return {
          category: 'contact.import.confirm',
          confidence: 0.95,
          pending_response: {
            answer: 'yes',
            target_kind: PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM,
          },
        };
      }
      // NO → cancel
      if (NO_PATTERNS.some(p => p.test(input))) {
        return {
          category: 'contact.import.cancel',
          confidence: 0.95,
          pending_response: {
            answer: 'no',
            target_kind: PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM,
          },
        };
      }
      // confirm中だが YES/NO 以外の入力 → nullでfallthrough
      // （他のclassifierが拾わなければ「はい/いいえで答えてください」案内になる）
      return null;
    }

    // ============================================================
    // Phase 2: pending.contact_import.person_select の場合
    // ============================================================
    if (
      ctx.pending_state.hasPending &&
      ctx.pending_state.kind === PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT
    ) {
      const entryIndex = ctx.current_ambiguous_entry_index ?? 0;

      // スキップ
      if (SKIP_PATTERNS.some(p => p.test(input))) {
        return {
          category: 'contact.import.person_select',
          confidence: 0.95,
          person_selection: {
            selected_number: -1,
            is_skip: true,
            target_entry_index: entryIndex,
          },
        };
      }

      // 新規（"0" or "新規" 等）
      if (NEW_PATTERNS.some(p => p.test(input))) {
        return {
          category: 'contact.import.person_select',
          confidence: 0.95,
          person_selection: {
            selected_number: 0,
            is_skip: false,
            target_entry_index: entryIndex,
          },
        };
      }

      // 番号選択
      const numMatch = input.match(NUMBER_PATTERN);
      if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        return {
          category: 'contact.import.person_select',
          confidence: 0.95,
          person_selection: {
            selected_number: num,
            is_skip: false,
            target_entry_index: entryIndex,
          },
        };
      }

      // person_select中だが有効な入力でない → nullでfallthrough
      return null;
    }

    // ============================================================
    // Phase 3: pending無し → テキスト or CSV 取り込み判定
    // ============================================================
    // pending中は新規取り込みを受け付けない（事故防止）
    if (ctx.pending_state.hasPending) {
      return null;
    }

    // ---- CSV判定（textより先に判定する） ----

    // パターンA: 明示的にCSVキーワード + データ
    if (CSV_KEYWORDS.test(input) && (input.includes('\n') || COMMA_SEPARATED.test(input))) {
      return {
        category: 'contact.import.csv',
        confidence: 0.90,
        raw_text: input,
      };
    }

    // パターンB: CSVヘッダっぽい行 + CSV構造（2行以上のカンマ/タブ区切り）
    if (CSV_HEADER_PATTERNS.test(input) && CSV_STRUCTURE.test(input)) {
      return {
        category: 'contact.import.csv',
        confidence: 0.88,
        raw_text: input,
      };
    }

    // パターンC: 取り込みキーワード + CSV構造（ヘッダ無くてもOK）
    if (IMPORT_KEYWORDS.test(input) && CSV_STRUCTURE.test(input)) {
      return {
        category: 'contact.import.csv',
        confidence: 0.85,
        raw_text: input,
      };
    }

    // ---- テキスト判定 ----

    // メールアドレスが含まれている
    if (EMAIL_PATTERN.test(input) && (IMPORT_KEYWORDS.test(input) || input.includes('\n'))) {
      return {
        category: 'contact.import.text',
        confidence: 0.85,
        raw_text: input,
      };
    }

    // 明示的な取り込みキーワード + 複数行 or カンマ区切り
    if (IMPORT_KEYWORDS.test(input) && (MULTI_LINE_NAMES.test(input) || COMMA_SEPARATED.test(input))) {
      return {
        category: 'contact.import.text',
        confidence: 0.80,
        raw_text: input,
      };
    }

    return null;
  }
}
