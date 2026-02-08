/**
 * classifier/contactImport.ts
 * PR-D-1.1: 連絡先取り込み分類器
 * 
 * 対象インテント:
 * - contact.import.text: テキストからの連絡先取り込み
 * - contact.import.confirm: 取り込み確認（はい）
 * - contact.import.cancel: 取り込みキャンセル（いいえ）
 * - contact.import.person_select: 曖昧一致時の人物選択（番号/新規/スキップ）
 * 
 * 事故ゼロ設計:
 * - pending.contact_import.confirm がある場合のみ confirm/cancel を許可
 * - pending.person.select がある場合のみ番号選択を許可
 * - 曖昧一致は自動選択しない（ユーザー判断必須）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Intent Types (types.ts への追加用)
// ============================================================

// contact.import.text: テキストからの連絡先取り込み開始
// contact.import.confirm: 取り込み確認
// contact.import.cancel: 取り込みキャンセル
// contact.import.person_select: 曖昧一致時の人物選択

// ============================================================
// Pattern Matching
// ============================================================

/**
 * テキスト取り込みパターン
 * - 「以下を連絡先に追加」「連絡先に取り込み」「連絡先を登録」
 */
const TEXT_IMPORT_PATTERNS = [
  /連絡先.*(追加|登録|取り込|インポート)/i,
  /(追加|登録|取り込|インポート).*連絡先/i,
  /contact.*import/i,
  /import.*contact/i,
];

/**
 * 確認パターン（pending.contact_import.confirm 時のみ有効）
 */
const CONFIRM_PATTERNS = [
  /^(はい|yes|ok|おk|確定|登録|追加)$/i,
  /^(登録して|追加して|取り込んで)$/i,
];

/**
 * キャンセルパターン（pending.contact_import.confirm 時のみ有効）
 */
const CANCEL_PATTERNS = [
  /^(いいえ|no|cancel|キャンセル|やめる|中止)$/i,
];

/**
 * スキップ継続パターン（曖昧一致をスキップして続行）
 */
const SKIP_CONTINUE_PATTERNS = [
  /^(スキップ|skip|スキップして続行|曖昧分スキップ)$/i,
];

/**
 * 番号選択パターン（pending.person.select 時のみ有効）
 */
const NUMBER_SELECT_PATTERN = /^(\d+)$/;

/**
 * 新規作成パターン（pending.person.select 時のみ有効）
 */
const CREATE_NEW_PATTERNS = [
  /^(新規|新しく作成|新規作成|new)$/i,
  /^0$/,  // 0 は新規を意味する
];

/**
 * 個別スキップパターン（pending.person.select 時のみ有効）
 */
const SKIP_ONE_PATTERNS = [
  /^(スキップ|skip|飛ばす)$/i,
  /^-1$/,  // -1 はスキップを意味する
];

// ============================================================
// Classifier Implementation
// ============================================================

/**
 * 連絡先取り込み分類器
 * 
 * 優先順位:
 * 1. pending.person.select がある場合 → 番号選択/新規/スキップ
 * 2. pending.contact_import.confirm がある場合 → はい/いいえ/スキップ続行
 * 3. テキスト取り込みパターンにマッチ → contact.import.text
 */
export const classifyContactImport: ClassifierFn = (
  input: string,
  normalizedInput: string,
  _context: IntentContext | undefined,
  activePending: PendingState | null
): IntentResult | null => {
  
  // ============================================================
  // Case 0: pending.post_import.next_step がある場合
  // PR-D-FE-4: 取り込み完了後の次手選択
  // ============================================================
  if (activePending?.kind === 'pending.post_import.next_step') {
    const pending = activePending as PendingState & { kind: 'pending.post_import.next_step' };
    
    return {
      intent: 'post_import.next_step.decide' as IntentResult['intent'],
      confidence: 1.0,
      params: {
        userInput: input,
        currentIntent: pending.intent,
        importSummary: pending.importSummary,
        source: pending.source,
      },
    };
  }

  // ============================================================
  // Case 1: pending.person.select がある場合
  // 曖昧一致の解決フロー
  // ============================================================
  if (activePending?.kind === 'pending.person.select') {
    const pending = activePending as PendingState & { kind: 'pending.person.select' };
    
    // 番号選択（1, 2, 3, ...）
    const numberMatch = normalizedInput.match(NUMBER_SELECT_PATTERN);
    if (numberMatch) {
      const selectedNumber = parseInt(numberMatch[1], 10);
      const optionsCount = pending.options.length;
      
      // 0 は新規作成
      if (selectedNumber === 0 && pending.allow_create_new) {
        return {
          intent: 'contact.import.person_select' as IntentResult['intent'],
          confidence: 1.0,
          params: {
            action: 'create_new',
            candidate_index: pending.candidate_index,
            confirmation_token: pending.confirmation_token,
          },
        };
      }
      
      // -1 はスキップ（別の入力として処理）
      // 1〜n は既存選択
      if (selectedNumber >= 1 && selectedNumber <= optionsCount) {
        const selectedOption = pending.options[selectedNumber - 1];
        return {
          intent: 'contact.import.person_select' as IntentResult['intent'],
          confidence: 1.0,
          params: {
            action: 'update_existing',
            candidate_index: pending.candidate_index,
            existing_id: selectedOption.id,
            confirmation_token: pending.confirmation_token,
          },
        };
      }
      
      // 範囲外の番号
      return {
        intent: 'contact.import.person_select' as IntentResult['intent'],
        confidence: 0.5,
        params: {},
        needsClarification: {
          field: 'selection',
          message: `1〜${optionsCount} の番号で選択してください。${pending.allow_create_new ? '新規作成は「0」または「新規」' : ''}${pending.allow_skip ? '、スキップは「-1」または「スキップ」' : ''}`,
        },
      };
    }
    
    // 「新規」「新規作成」
    if (pending.allow_create_new && CREATE_NEW_PATTERNS.some(p => p.test(normalizedInput))) {
      return {
        intent: 'contact.import.person_select' as IntentResult['intent'],
        confidence: 1.0,
        params: {
          action: 'create_new',
          candidate_index: pending.candidate_index,
          confirmation_token: pending.confirmation_token,
        },
      };
    }
    
    // 「スキップ」
    if (pending.allow_skip && SKIP_ONE_PATTERNS.some(p => p.test(normalizedInput))) {
      return {
        intent: 'contact.import.person_select' as IntentResult['intent'],
        confidence: 1.0,
        params: {
          action: 'skip',
          candidate_index: pending.candidate_index,
          confirmation_token: pending.confirmation_token,
        },
      };
    }
    
    // どれにもマッチしない場合: ガイダンス
    let guidance = `以下から選択してください：\n`;
    pending.options.forEach((opt, i) => {
      guidance += `${i + 1}. ${opt.display_name || '(名前なし)'} <${opt.email || '(メールなし)'}>\n`;
    });
    if (pending.allow_create_new) {
      guidance += `0. 新規作成\n`;
    }
    if (pending.allow_skip) {
      guidance += `-1. スキップ\n`;
    }
    
    return {
      intent: 'contact.import.person_select' as IntentResult['intent'],
      confidence: 0.3,
      params: {},
      needsClarification: {
        field: 'selection',
        message: guidance,
      },
    };
  }
  
  // ============================================================
  // Case 2: pending.contact_import.confirm がある場合
  // 取り込み確認フロー
  // ============================================================
  if (activePending?.kind === 'pending.contact_import.confirm') {
    const pending = activePending as PendingState & { kind: 'pending.contact_import.confirm' };
    
    // 「はい」「登録して」
    if (CONFIRM_PATTERNS.some(p => p.test(normalizedInput))) {
      // 未解決の曖昧一致がある場合
      if (!pending.all_ambiguous_resolved && pending.preview.ambiguous.length > 0) {
        return {
          intent: 'contact.import.confirm' as IntentResult['intent'],
          confidence: 0.8,
          params: {
            confirmation_token: pending.confirmation_token,
          },
          needsClarification: {
            field: 'ambiguous',
            message: '⚠️ 曖昧一致が未解決です。\n「スキップして続行」で曖昧分をスキップして登録するか、各候補を選択してください。',
          },
        };
      }
      
      return {
        intent: 'contact.import.confirm' as IntentResult['intent'],
        confidence: 1.0,
        params: {
          confirmation_token: pending.confirmation_token,
          skip_ambiguous: false,
        },
      };
    }
    
    // 「いいえ」「キャンセル」
    if (CANCEL_PATTERNS.some(p => p.test(normalizedInput))) {
      return {
        intent: 'contact.import.cancel' as IntentResult['intent'],
        confidence: 1.0,
        params: {
          confirmation_token: pending.confirmation_token,
        },
      };
    }
    
    // 「スキップして続行」（曖昧一致をスキップして残りを登録）
    if (SKIP_CONTINUE_PATTERNS.some(p => p.test(normalizedInput))) {
      return {
        intent: 'contact.import.confirm' as IntentResult['intent'],
        confidence: 1.0,
        params: {
          confirmation_token: pending.confirmation_token,
          skip_ambiguous: true,
        },
      };
    }
    
    // どれにもマッチしない場合: ガイダンス
    let guidance = '以下から選択してください：\n';
    guidance += '• 「はい」→ 登録を実行\n';
    guidance += '• 「いいえ」→ キャンセル\n';
    if (pending.preview.ambiguous.length > 0 && !pending.all_ambiguous_resolved) {
      guidance += '• 「スキップして続行」→ 曖昧分をスキップして登録\n';
      guidance += '\n⚠️ 曖昧一致が ' + pending.preview.ambiguous.length + ' 件あります。';
    }
    
    return {
      intent: 'contact.import.confirm' as IntentResult['intent'],
      confidence: 0.3,
      params: {},
      needsClarification: {
        field: 'decision',
        message: guidance,
      },
    };
  }
  
  // ============================================================
  // Case 3: テキスト取り込みパターン
  // 新規取り込み開始
  // ============================================================
  
  // パターンマッチ
  if (TEXT_IMPORT_PATTERNS.some(p => p.test(input))) {
    // テキストが短すぎる場合（コマンドのみ）
    if (input.length < 30) {
      return {
        intent: 'contact.import.text' as IntentResult['intent'],
        confidence: 0.8,
        params: {},
        needsClarification: {
          field: 'text',
          message: '取り込むテキストを入力してください。\n\n例:\n山田太郎 yamada@example.com\n鈴木花子 <suzuki@example.com>\n佐藤次郎, sato@example.com',
        },
      };
    }
    
    // テキスト付きで取り込み開始
    return {
      intent: 'contact.import.text' as IntentResult['intent'],
      confidence: 0.9,
      params: {
        rawText: input,
      },
    };
  }
  
  // マッチしない場合は null を返して次の分類器へ
  return null;
};

// ============================================================
// Export
// ============================================================

export default classifyContactImport;
