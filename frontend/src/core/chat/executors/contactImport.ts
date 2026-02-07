/**
 * executors/contactImport.ts
 * PR-D-1.1: 連絡先取り込み Executor
 * 
 * 事故ゼロ設計:
 * - メール必須 (Hard fail)
 * - 曖昧一致は自動選択しない
 * - confirm なしでの書き込みは禁止
 * - 書き込み後は必ず結果サマリを返す
 * 
 * フロー:
 * 1. contact.import.text → プレビュー生成 → pending.contact_import.confirm 設定
 * 2. 曖昧一致あり → pending.person.select 設定（ユーザー選択待ち）
 * 3. 選択完了 → pending.contact_import.confirm に戻る
 * 4. confirm → /api/contacts/import/confirm 実行
 * 5. cancel → pending クリア
 */

import { contactsApi, type ImportCandidate, type AmbiguousMatch } from '../../api/contacts';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult, ExecutionContext } from './types';
import type { PendingState } from '../pendingTypes';
import { log } from '../../platform';

// ============================================================
// Type Definitions for Executor
// ============================================================

/**
 * pending.contact_import.confirm の詳細型
 */
type PendingContactImportConfirm = PendingState & {
  kind: 'pending.contact_import.confirm';
  confirmation_token: string;
  source: 'text' | 'email' | 'csv';
  preview: {
    ok: Array<{ index: number; display_name: string | null; email: string }>;
    missing_email: Array<{ index: number; raw_line: string; display_name: string | null }>;
    ambiguous: Array<{
      index: number;
      display_name: string | null;
      email: string;
      candidates: Array<{ id: string; display_name: string | null; email: string | null }>;
      reason: 'same_name' | 'similar_name' | 'email_exists';
    }>;
  };
  ambiguous_actions: Record<number, {
    action: 'create_new' | 'skip' | 'update_existing';
    existing_id?: string;
  }>;
  all_ambiguous_resolved: boolean;
};

/**
 * pending.person.select の詳細型
 */
type PendingPersonSelect = PendingState & {
  kind: 'pending.person.select';
  parent_kind: 'contact_import';
  confirmation_token: string;
  candidate_index: number;
  input_name: string | null;
  input_email: string;
  reason: 'same_name' | 'similar_name' | 'email_exists';
  options: Array<{
    id: string;
    display_name: string | null;
    email: string | null;
  }>;
  allow_create_new: boolean;
  allow_skip: boolean;
};

// ============================================================
// Execute Functions
// ============================================================

/**
 * contact.import.text: テキストから連絡先取り込み（プレビュー生成）
 * 
 * @param intentResult - rawText を含む IntentResult
 * @returns プレビュー結果と pending 設定
 */
export async function executeContactImportPreview(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const rawText = intentResult.params?.rawText;

  if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
    return {
      success: false,
      message: '取り込むテキストを入力してください。\n\n例:\n山田太郎 yamada@example.com\n鈴木花子 <suzuki@example.com>\n佐藤次郎, sato@example.com',
      needsClarification: {
        field: 'text',
        message: '取り込むテキストを入力してください。',
      },
    };
  }

  try {
    log.info('[PR-D-1.1] Executing contact import preview', {
      module: 'contactImport',
      textLength: rawText.length,
    });

    // API呼び出し
    const response = await contactsApi.importPreview({
      text: rawText,
      source: 'text',
    });

    // プレビュー結果を整形
    const { preview, confirmation_token, requires_confirmation, message: apiMessage } = response;

    // ok / missing_email / ambiguous を分類
    const okCandidates = preview.candidates
      .filter(c => c.status === 'ok')
      .map((c, i) => ({
        index: i,
        display_name: c.display_name,
        email: c.email!,
      }));

    const missingEmailCandidates = preview.candidates
      .filter(c => c.status === 'missing_email')
      .map((c, i) => ({
        index: i,
        raw_line: c.raw_line,
        display_name: c.display_name,
      }));

    // ambiguous をマッピング
    const ambiguousList = preview.ambiguous_matches.map(m => ({
      index: m.candidate_index,
      display_name: m.candidate_name,
      email: m.candidate_email!,
      candidates: m.existing_contacts,
      reason: m.reason,
    }));

    // メッセージ生成
    let message = '📋 連絡先取り込みプレビュー\n\n';

    // 有効件数
    if (okCandidates.length > 0) {
      message += `✅ 登録予定: ${okCandidates.length}件\n`;
      okCandidates.slice(0, 5).forEach((c, i) => {
        message += `  ${i + 1}. ${c.display_name || '(名前なし)'} <${c.email}>\n`;
      });
      if (okCandidates.length > 5) {
        message += `  ... 他 ${okCandidates.length - 5}件\n`;
      }
      message += '\n';
    }

    // メール欠落
    if (missingEmailCandidates.length > 0) {
      message += `⚠️ メールなし（スキップ）: ${missingEmailCandidates.length}件\n`;
      missingEmailCandidates.slice(0, 3).forEach((c, i) => {
        message += `  • ${c.display_name || c.raw_line}\n`;
      });
      if (missingEmailCandidates.length > 3) {
        message += `  ... 他 ${missingEmailCandidates.length - 3}件\n`;
      }
      message += '\n';
    }

    // 曖昧一致
    if (ambiguousList.length > 0) {
      message += `❓ 曖昧一致（要確認）: ${ambiguousList.length}件\n`;
      ambiguousList.forEach((a, i) => {
        const reasonLabel = a.reason === 'email_exists' ? 'メール重複' 
          : a.reason === 'same_name' ? '同姓同名' 
          : '類似名';
        message += `  ${i + 1}. ${a.display_name || '(名前なし)'} <${a.email}> [${reasonLabel}]\n`;
        a.candidates.forEach((c, j) => {
          message += `     → ${j + 1}: ${c.display_name || '(名前なし)'} <${c.email || '(メールなし)'}>\n`;
        });
      });
      message += '\n';
    }

    // 指示
    if (requires_confirmation) {
      if (ambiguousList.length > 0) {
        message += '━━━━━━━━━━━━━━━━━━━━\n';
        message += '曖昧一致が見つかりました。\n';
        message += '各候補の番号で選択するか、以下から選んでください：\n';
        message += '• 「はい」→ 曖昧分を新規作成として登録\n';
        message += '• 「スキップして続行」→ 曖昧分をスキップして登録\n';
        message += '• 「いいえ」→ キャンセル\n';
      } else {
        message += '━━━━━━━━━━━━━━━━━━━━\n';
        message += '登録を実行しますか？\n';
        message += '• 「はい」→ 登録\n';
        message += '• 「いいえ」→ キャンセル\n';
      }
    } else {
      message += apiMessage;
    }

    // 結果を返す（pending設定用のデータを含む）
    return {
      success: true,
      message,
      data: {
        kind: 'contact_import.preview',
        payload: {
          confirmation_token,
          source: 'text' as const,
          preview: {
            ok: okCandidates,
            missing_email: missingEmailCandidates,
            ambiguous: ambiguousList,
          },
          ambiguous_actions: {},
          all_ambiguous_resolved: ambiguousList.length === 0,
          requires_confirmation,
        },
      },
    } as ExecutionResult;

  } catch (error) {
    log.error('[PR-D-1.1] Contact import preview failed', {
      module: 'contactImport',
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `❌ 取り込みに失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * contact.import.confirm: 取り込み確定
 * 
 * @param intentResult - confirmation_token, skip_ambiguous を含む IntentResult
 * @param context - pending を含む ExecutionContext
 * @returns 登録結果
 */
export async function executeContactImportConfirm(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const confirmationToken = intentResult.params?.confirmation_token;
  const skipAmbiguous = intentResult.params?.skip_ambiguous === true;

  // pending から ambiguous_actions を取得
  const pending = context?.pendingForThread as PendingContactImportConfirm | null;
  const ambiguousActions = pending?.ambiguous_actions || {};

  if (!confirmationToken) {
    return {
      success: false,
      message: '❌ 確認トークンがありません。再度取り込みを実行してください。',
    };
  }

  try {
    log.info('[PR-D-1.1] Executing contact import confirm', {
      module: 'contactImport',
      confirmationToken,
      skipAmbiguous,
      ambiguousActionsCount: Object.keys(ambiguousActions).length,
    });

    // ambiguous_actions を API 形式に変換
    const ambiguousActionsArray = Object.entries(ambiguousActions).map(([indexStr, action]) => ({
      candidate_index: parseInt(indexStr, 10),
      ...action,
    }));

    // skip_ambiguous の場合、未解決の曖昧一致をスキップとしてマーク
    if (skipAmbiguous && pending?.preview.ambiguous) {
      pending.preview.ambiguous.forEach(a => {
        if (!ambiguousActions[a.index]) {
          ambiguousActionsArray.push({
            candidate_index: a.index,
            action: 'skip',
          });
        }
      });
    }

    // API呼び出し
    const response = await contactsApi.importConfirm({
      confirmation_token: confirmationToken,
      skip_ambiguous: skipAmbiguous,
      ambiguous_actions: ambiguousActionsArray,
    });

    const { created, skipped, updated, errors, summary } = response;

    // 結果メッセージ生成
    let message = '✅ 連絡先取り込み完了\n\n';

    if (created.length > 0) {
      message += `📝 新規登録: ${created.length}件\n`;
      created.slice(0, 5).forEach((c, i) => {
        message += `  ${i + 1}. ${c.display_name || '(名前なし)'} <${c.email}>\n`;
      });
      if (created.length > 5) {
        message += `  ... 他 ${created.length - 5}件\n`;
      }
      message += '\n';
    }

    if (updated.length > 0) {
      message += `🔄 更新: ${updated.length}件\n`;
      updated.slice(0, 3).forEach((c, i) => {
        message += `  • ${c.display_name || '(名前なし)'} <${c.email}>\n`;
      });
      message += '\n';
    }

    if (skipped.length > 0) {
      message += `⏭️ スキップ: ${skipped.length}件\n`;
    }

    if (errors.length > 0) {
      message += `❌ エラー: ${errors.length}件\n`;
      errors.slice(0, 3).forEach((e, i) => {
        message += `  • ${e.raw_line}: ${e.error}\n`;
      });
    }

    return {
      success: true,
      message,
      data: {
        kind: 'contact_import.confirmed',
        payload: {
          created_count: created.length,
          updated_count: updated.length,
          skipped_count: skipped.length,
          error_count: errors.length,
          total_processed: summary.total_processed,
        },
      },
    } as ExecutionResult;

  } catch (error) {
    log.error('[PR-D-1.1] Contact import confirm failed', {
      module: 'contactImport',
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `❌ 登録に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * contact.import.cancel: 取り込みキャンセル
 * 
 * @returns キャンセル完了メッセージ
 */
export function executeContactImportCancel(): ExecutionResult {
  return {
    success: true,
    message: '✅ 連絡先取り込みをキャンセルしました。',
    data: {
      kind: 'contact_import.cancelled',
      payload: {},
    },
  } as ExecutionResult;
}

/**
 * contact.import.person_select: 曖昧一致時の人物選択
 * 
 * @param intentResult - action, candidate_index, existing_id, confirmation_token を含む IntentResult
 * @param context - pending を含む ExecutionContext
 * @returns 選択結果（pending.contact_import.confirm への更新情報）
 */
export async function executeContactImportPersonSelect(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const { action, candidate_index, existing_id, confirmation_token } = intentResult.params || {};

  if (!action || candidate_index === undefined || !confirmation_token) {
    return {
      success: false,
      message: '❌ 選択情報が不完全です。',
    };
  }

  log.info('[PR-D-1.1] Executing person select', {
    module: 'contactImport',
    action,
    candidateIndex: candidate_index,
  });

  // 選択結果のメッセージ
  let actionMessage = '';
  switch (action) {
    case 'create_new':
      actionMessage = '新規作成として登録します。';
      break;
    case 'skip':
      actionMessage = 'この候補をスキップします。';
      break;
    case 'update_existing':
      actionMessage = '既存の連絡先を更新します。';
      break;
  }

  return {
    success: true,
    message: `✅ ${actionMessage}\n\n次の曖昧一致を確認するか、「はい」で登録を実行してください。`,
    data: {
      kind: 'contact_import.person_selected',
      payload: {
        candidate_index,
        action,
        existing_id,
        confirmation_token,
      },
    },
  } as ExecutionResult;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * pending.contact_import.confirm を生成
 */
export function buildPendingContactImportConfirm(
  threadId: string,
  data: {
    confirmation_token: string;
    source: 'text' | 'email' | 'csv';
    preview: PendingContactImportConfirm['preview'];
    ambiguous_actions?: PendingContactImportConfirm['ambiguous_actions'];
    all_ambiguous_resolved?: boolean;
  }
): PendingContactImportConfirm {
  return {
    kind: 'pending.contact_import.confirm',
    threadId,
    createdAt: Date.now(),
    confirmation_token: data.confirmation_token,
    source: data.source,
    preview: data.preview,
    ambiguous_actions: data.ambiguous_actions || {},
    all_ambiguous_resolved: data.all_ambiguous_resolved ?? data.preview.ambiguous.length === 0,
  };
}

/**
 * pending.person.select を生成
 */
export function buildPendingPersonSelect(
  threadId: string,
  data: {
    confirmation_token: string;
    candidate_index: number;
    input_name: string | null;
    input_email: string;
    reason: 'same_name' | 'similar_name' | 'email_exists';
    options: PendingPersonSelect['options'];
    allow_create_new?: boolean;
    allow_skip?: boolean;
  }
): PendingPersonSelect {
  return {
    kind: 'pending.person.select',
    threadId,
    createdAt: Date.now(),
    parent_kind: 'contact_import',
    confirmation_token: data.confirmation_token,
    candidate_index: data.candidate_index,
    input_name: data.input_name,
    input_email: data.input_email,
    reason: data.reason,
    options: data.options,
    allow_create_new: data.allow_create_new ?? true,
    allow_skip: data.allow_skip ?? true,
  };
}
