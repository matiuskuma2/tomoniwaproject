/**
 * executors/contactImport.ts
 * PR-D-FE-1: Contact Import Executor — 新API接続
 * 
 * 事故ゼロ設計:
 * - Gate-3: APIがowner_user_id一致を検証（不一致=404）
 * - Gate-4: confirm以外はcontacts書き込みゼロ（APIが保証）
 * - Gate-B: pending中は新規インテントを発火させない（classifier側で制御）
 * - 事故ゼロガード: all_ambiguous_resolved === true 必須 (confirm → 409)
 * 
 * フロー:
 * 1. contact.import.text → POST /api/contacts/import/preview → pending 設定
 * 2. 曖昧一致あり → pending.person.select 設定（ユーザー選択待ち）
 * 3. 番号入力 → POST /api/contacts/import/person-select → resolve/次へ
 * 4. confirm → POST /api/contacts/import/confirm → contacts 書き込み
 * 5. cancel → POST /api/contacts/import/cancel → pending クリア
 */

import {
  contactsImportApi,
  type ContactImportNewPreviewResponse,
  type BusinessCardScanResponse,
} from '../../api/contacts';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult, ExecutionContext, ContactImportContext, PostImportIntent } from './types';
import type { PendingState } from '../pendingTypes';
import { log } from '../../platform';

// ============================================================
// PR-D-FE-3.1: Upload Intent Classification
// ============================================================

/** アップロード時のテキストから意図を抽出するルールベース分類器 */
const INVITE_PATTERNS = [
  /招待/,
  /インバイト/,
  /送り?たい/,
  /送って/,
  /メール.*送/,
  /invite/i,
  /send/i,
  /連絡/,
  /誘う/,
];

const SCHEDULE_PATTERNS = [
  /日程/,
  /スケジュール/,
  /調整/,
  /予定/,
  /ミーティング/,
  /会議/,
  /打ち合わせ/,
  /schedule/i,
  /meeting/i,
  /アポ/,
];

const MESSAGE_ONLY_PATTERNS = [
  /登録だけ/,
  /取り込み?だけ/,
  /保存だけ/,
  /インポートだけ/,
  /等録だけ/,
  /just.*import/i,
  /just.*save/i,
];

/**
 * アップロード時のテキストからintentを抽出
 * 
 * 設計:
 * - ルールベース（LLM不要）
 * - 意図が明確なら send_invite | schedule | message_only
 * - 曖昧 or 空なら unknown（後でAIが1問聞く）
 */
export function classifyUploadIntent(text: string): ContactImportContext {
  const trimmed = (text || '').trim();
  
  // テキストが空ならunknown
  if (!trimmed) {
    return { intent: 'unknown' };
  }

  // パターンマッチ
  const isInvite = INVITE_PATTERNS.some(p => p.test(trimmed));
  const isSchedule = SCHEDULE_PATTERNS.some(p => p.test(trimmed));
  const isMessageOnly = MESSAGE_ONLY_PATTERNS.some(p => p.test(trimmed));

  // 明確な1つだけマッチ
  if (isInvite && !isSchedule && !isMessageOnly) {
    return { intent: 'send_invite', message: trimmed };
  }
  if (isSchedule && !isInvite && !isMessageOnly) {
    return { intent: 'schedule', message: trimmed };
  }
  if (isMessageOnly && !isInvite && !isSchedule) {
    return { intent: 'message_only', message: trimmed };
  }

  // 複数マッチ or 不明→ unknown + message 保持
  return { intent: 'unknown', message: trimmed };
}

/**
 * PR-D-FE-3.1: confirm完了後の次手提示メッセージを生成
 * 事故ゼロ: この時点では何も実行しない。次のアクションを提示するだけ。
 */
export function buildPostImportNextStepMessage(
  intent: PostImportIntent,
  importSummary: {
    created_count: number;
    updated_count: number;
    skipped_count: number;
    imported_contacts: Array<{ display_name: string; email: string }>;
  }
): string {
  const contactNames = importSummary.imported_contacts
    .slice(0, 3)
    .map(c => c.display_name || c.email)
    .join('、');
  const moreCount = importSummary.imported_contacts.length - 3;
  const namesList = moreCount > 0 ? `${contactNames} 他${moreCount}名` : contactNames;

  switch (intent) {
    case 'send_invite':
      return `✅ 連絡先取り込み完了\n\n次のステップ: ${namesList} に招待を送りますか？\n• 「はい」→ 招待送信へ\n• 「いいえ」→ 完了`;
    case 'schedule':
      return `✅ 連絡先取り込み完了\n\n次のステップ: ${namesList} と日程調整を始めますか？\n• 「はい」→ 日程調整へ\n• 「いいえ」→ 完了`;
    case 'message_only':
      return `✅ 連絡先取り込み完了\n\n${namesList} を連絡先に登録しました。`;
    case 'unknown':
    default:
      return `✅ 連絡先取り込み完了\n\n${namesList} を連絡先に登録しました。\n次は何をしますか？\n1️⃣ 招待を送る\n2️⃣ 日程調整を始める\n3️⃣ 完了（このまま終わる）`;
  }
}

/**
 * PR-D-FE-3.1: 次手選択のユーザー入力を解釈
 * 事故ゼロ: 選択だけで実行はしない
 */
export function parseNextStepSelection(
  input: string,
  currentIntent: PostImportIntent
): { action: 'send_invite' | 'schedule' | 'completed' | 'cancel' | 'unclear' } {
  const trimmed = (input || '').trim().toLowerCase();
  
  // キャンセルパターン
  if (/^(いいえ|いや|やめ|キャンセル|no|cancel|完了|おわり)/i.test(trimmed)) {
    // intentが明確な場合の「いいえ」は完了
    if (currentIntent !== 'unknown') {
      return { action: 'completed' };
    }
    // unknown時の「いいえ」は3番選択（完了）
    return { action: 'completed' };
  }
  
  // 確認パターン
  if (/^(はい|うん|そう|ok|yes|送る|送って|始める|始めて)/i.test(trimmed)) {
    if (currentIntent === 'send_invite') return { action: 'send_invite' };
    if (currentIntent === 'schedule') return { action: 'schedule' };
    // unknown時の「はい」は不明確
    return { action: 'unclear' };
  }
  
  // 番号選択（unknown時）
  if (/^1$/.test(trimmed)) return { action: 'send_invite' };
  if (/^2$/.test(trimmed)) return { action: 'schedule' };
  if (/^3$/.test(trimmed)) return { action: 'completed' };
  
  // キーワードマッチ
  if (INVITE_PATTERNS.some(p => p.test(trimmed))) return { action: 'send_invite' };
  if (SCHEDULE_PATTERNS.some(p => p.test(trimmed))) return { action: 'schedule' };
  
  return { action: 'unclear' };
}

// ============================================================
// Execute Functions
// ============================================================

/**
 * contact.import.text: テキスト/CSVから連絡先取り込み（プレビュー生成）
 * POST /api/contacts/import/preview
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
    log.info('[PR-D-FE-1] Executing contact import preview via new API', {
      module: 'contactImport',
      textLength: rawText.length,
    });

    // 新API呼び出し
    const source = (intentResult.params?.source as 'text' | 'csv') || 'text';
    const response = await contactsImportApi.preview({
      source,
      raw_text: rawText,
    });

    // プレビューメッセージ生成
    const message = buildPreviewMessage(response);

    return {
      success: true,
      message,
      data: {
        kind: 'contact_import.preview',
        payload: {
          pending_action_id: response.pending_action_id,
          expires_at: response.expires_at,
          summary: response.summary,
          parsed_entries: response.parsed_entries,
          next_pending_kind: response.next_pending_kind,
          source,
        },
      },
    } as ExecutionResult;

  } catch (error) {
    log.error('[PR-D-FE-1] Contact import preview failed', {
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
 * contact.import.person_select: 曖昧一致時の人物選択
 * POST /api/contacts/import/person-select
 */
export async function executeContactImportPersonSelect(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const pendingActionId = intentResult.params?.pending_action_id
    || (context?.pendingForThread as any)?.pending_action_id;
  const action = intentResult.params?.action;
  const candidateIndex = intentResult.params?.candidate_index;
  const selectedNumber = intentResult.params?.selected_number;

  if (!pendingActionId || !action || candidateIndex === undefined) {
    return {
      success: false,
      message: '❌ 選択情報が不完全です。',
    };
  }

  try {
    log.info('[PR-D-FE-1] Executing person select via new API', {
      module: 'contactImport',
      action,
      candidateIndex,
    });

    const response = await contactsImportApi.personSelect({
      pending_action_id: pendingActionId,
      entry_index: candidateIndex,
      action: action === 'create_new' ? 'new' : action === 'update_existing' ? 'select' : 'skip',
      selected_number: selectedNumber,
    });

    return {
      success: true,
      message: response.message,
      data: {
        kind: 'contact_import.person_selected',
        payload: {
          pending_action_id: pendingActionId,
          all_resolved: response.all_resolved,
          remaining_unresolved: response.remaining_unresolved,
          next_pending_kind: response.next_pending_kind,
          updated_entry: response.updated_entry,
        },
      },
    } as ExecutionResult;

  } catch (error: any) {
    // 404: 期限切れまたは他ユーザー
    if (error?.status === 404) {
      return {
        success: false,
        message: '❌ この操作は期限切れか、見つかりません。再度取り込みを実行してください。',
        data: {
          kind: 'contact_import.expired',
          payload: {},
        },
      } as ExecutionResult;
    }

    log.error('[PR-D-FE-1] Person select failed', {
      module: 'contactImport',
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `❌ 選択に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * contact.import.confirm: 取り込み確定
 * POST /api/contacts/import/confirm
 * Gate-4: ここだけがcontacts書き込み
 */
export async function executeContactImportConfirm(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const pendingActionId = intentResult.params?.pending_action_id
    || (context?.pendingForThread as any)?.pending_action_id;

  if (!pendingActionId) {
    return {
      success: false,
      message: '❌ 確認IDがありません。再度取り込みを実行してください。',
    };
  }

  try {
    log.info('[PR-D-FE-1] Executing contact import confirm via new API', {
      module: 'contactImport',
      pendingActionId,
    });

    const response = await contactsImportApi.confirm({
      pending_action_id: pendingActionId,
    });

    // PR-D-FE-3.1: pending stateからcontextを取得
    const importContext = (context?.pendingForThread as any)?.contact_import_context as ContactImportContext | undefined;
    const _source = (context?.pendingForThread as any)?.source as 'text' | 'csv' | 'business_card' | undefined;
    void _source; // PR-D-FE-4 で intent 抽出に使用予定
    
    // 取り込み済み連絡先一覧
    const importedContacts = (response.created_contacts || []).map((c: any) => ({
      display_name: c.display_name || '',
      email: c.email || '',
    }));

    // 結果メッセージ生成
    // PR-D-FE-3.1: contextがあれば次手提示メッセージを使用
    let message: string;
    if (importContext) {
      message = buildPostImportNextStepMessage(importContext.intent, {
        created_count: response.created_count,
        updated_count: response.updated_count,
        skipped_count: response.skipped_count,
        imported_contacts: importedContacts,
      });
    } else {
      message = '✅ 連絡先取り込み完了\n\n';

      if (response.created_count > 0) {
        message += `📝 新規登録: ${response.created_count}件\n`;
        response.created_contacts.slice(0, 5).forEach((c: any, i: number) => {
          message += `  ${i + 1}. ${c.display_name} <${c.email || ''}>\n`;
        });
        if (response.created_contacts.length > 5) {
          message += `  ... 他 ${response.created_contacts.length - 5}件\n`;
        }
        message += '\n';
      }

      if (response.updated_count > 0) {
        message += `🔄 更新: ${response.updated_count}件\n`;
      }

      if (response.skipped_count > 0) {
        message += `⏭️ スキップ: ${response.skipped_count}件\n`;
      }
    }

    return {
      success: true,
      message,
      data: {
        kind: 'contact_import.confirmed',
        payload: {
          created_count: response.created_count,
          updated_count: response.updated_count,
          skipped_count: response.skipped_count,
          // PR-D-FE-3.1: contextと取り込み済み連絡先を渡す
          contact_import_context: importContext,
          imported_contacts: importedContacts,
        },
      },
    } as ExecutionResult;

  } catch (error: any) {
    // 409: 曖昧一致未解決
    if (error?.status === 409) {
      return {
        success: false,
        message: '⚠️ まだ未解決の曖昧一致があります。番号を選択するか、「スキップして続行」と入力してください。',
        data: {
          kind: 'contact_import.ambiguous_remaining',
          payload: {},
        },
      } as ExecutionResult;
    }

    // 404: 期限切れまたは他ユーザー
    if (error?.status === 404) {
      return {
        success: false,
        message: '❌ この操作は期限切れか、見つかりません。再度取り込みを実行してください。',
        data: {
          kind: 'contact_import.expired',
          payload: {},
        },
      } as ExecutionResult;
    }

    log.error('[PR-D-FE-1] Contact import confirm failed', {
      module: 'contactImport',
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `❌ 登録に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}\nもう一度「はい」と入力してリトライできます。`,
    };
  }
}

/**
 * contact.import.cancel: 取り込みキャンセル
 * POST /api/contacts/import/cancel
 */
export async function executeContactImportCancel(
  _intentResult?: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const pendingActionId = _intentResult?.params?.pending_action_id
    || (context?.pendingForThread as any)?.pending_action_id;

  if (pendingActionId) {
    try {
      await contactsImportApi.cancel({ pending_action_id: pendingActionId });
    } catch (error) {
      // cancel の失敗は無視（UIは即クリア）
      log.warn('[PR-D-FE-1] Cancel API call failed (UI will clear pending)', {
        module: 'contactImport',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: true,
    message: '✅ 連絡先取り込みをキャンセルしました。データは書き込まれていません。',
    data: {
      kind: 'contact_import.cancelled',
      payload: {},
    },
  } as ExecutionResult;
}

/**
 * PR-D-FE-4: 取り込み完了後の次手選択
 * 
 * 事故ゼロ: この関数ではAPIコールなし。結果のkindに応じてuseChatReducerが
 * pendingクリア or 次のフロー（招待/日程調整）を開始する。
 */
export function executePostImportNextStepDecide(
  intentResult: IntentResult,
): ExecutionResult {
  const userInput = intentResult.params?.userInput as string || '';
  const currentIntent = intentResult.params?.currentIntent as PostImportIntent || 'unknown';
  const importSummary = intentResult.params?.importSummary as {
    created_count: number;
    updated_count: number;
    skipped_count: number;
    imported_contacts: Array<{ display_name: string; email: string }>;
  } | undefined;

  const selection = parseNextStepSelection(userInput, currentIntent);

  log.info('[PR-D-FE-4] Post-import next step decision', {
    module: 'contactImport',
    userInput,
    currentIntent,
    action: selection.action,
  });

  if (selection.action === 'unclear') {
    // 入力が不明確 → ガイダンス再表示
    let guidance: string;
    if (currentIntent === 'send_invite') {
      guidance = '招待を送りますか？\n• 「はい」→ 招待送信へ\n• 「いいえ」→ 完了';
    } else if (currentIntent === 'schedule') {
      guidance = '日程調整を始めますか？\n• 「はい」→ 日程調整へ\n• 「いいえ」→ 完了';
    } else {
      guidance = '次は何をしますか？\n1️⃣ 招待を送る\n2️⃣ 日程調整を始める\n3️⃣ 完了（このまま終わる）';
    }

    return {
      success: true,
      message: guidance,
      needsClarification: {
        field: 'next_step',
        message: guidance,
      },
    };
  }

  if (selection.action === 'completed' || selection.action === 'cancel') {
    return {
      success: true,
      message: '✅ 完了しました。',
      data: {
        kind: 'post_import.next_step.cancelled',
        payload: {},
      },
    } as ExecutionResult;
  }

  // send_invite or schedule → 次のアクションへ
  const emails = (importSummary?.imported_contacts || []).map(c => c.email).filter(Boolean);
  const names = (importSummary?.imported_contacts || []).map(c => c.display_name).filter(Boolean);

  let message: string;
  if (selection.action === 'send_invite') {
    message = `📨 ${names.slice(0, 3).join('、')}${names.length > 3 ? ` 他${names.length - 3}名` : ''} に招待を送る準備ができました。\n\n招待するスレッドを選択するか、新しいスレッドを作成してください。`;
  } else {
    message = `📅 ${names.slice(0, 3).join('、')}${names.length > 3 ? ` 他${names.length - 3}名` : ''} と日程調整を始めます。\n\n「○○さんと日程調整して」と入力してください。`;
  }

  return {
    success: true,
    message,
    data: {
      kind: 'post_import.next_step.selected',
      payload: {
        action: selection.action,
        emails,
      },
    },
  } as ExecutionResult;
}

/**
 * PR-D-3: 名刺スキャン → OCR抽出 → pending確認フロー
 * POST /api/business-cards/scan
 * 
 * 事故ゼロ: OCR結果はcontactImportの既存pendingフローに接続
 * Gate-1: emailなしはHard fail (missing_email_count++)
 * Gate-2: 曖昧一致はpending.person.selectで必ず止まる
 */
export async function executeBusinessCardScan(
  images: File[],
  context?: ContactImportContext
): Promise<ExecutionResult> {
  if (!images || images.length === 0) {
    return {
      success: false,
      message: '名刺画像を選択してください。',
      needsClarification: {
        field: 'images',
        message: '名刺画像を選択してください。',
      },
    };
  }

  try {
    log.info('[PR-D-3] Executing business card scan', {
      module: 'contactImport',
      imageCount: images.length,
    });

    const response = await contactsImportApi.businessCardScan(images);

    // プレビューメッセージ生成（scanのレスポンスはpreviewと同形）
    const message = buildScanPreviewMessage(response);

    return {
      success: true,
      message,
      data: {
        kind: 'contact_import.preview',
        payload: {
          pending_action_id: response.pending_action_id,
          expires_at: response.expires_at,
          summary: response.summary,
          parsed_entries: response.parsed_entries,
          next_pending_kind: response.next_pending_kind,
          source: 'business_card',
          business_card_ids: response.business_card_ids,
          // PR-D-FE-3.1: アップロード時の意図コンテキストを保持
          contact_import_context: context,
        },
      },
    } as ExecutionResult;

  } catch (error) {
    log.error('[PR-D-3] Business card scan failed', {
      module: 'contactImport',
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `❌ 名刺スキャンに失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * PR-D-3: 名刺スキャン結果のプレビューメッセージを生成
 */
function buildScanPreviewMessage(response: BusinessCardScanResponse): string {
  const { summary, parsed_entries } = response;
  let message = '📇 名刺スキャン結果\n\n';

  // 新規
  const newEntries = parsed_entries.filter(e => e.match_status === 'new');
  if (newEntries.length > 0) {
    message += `✅ 新規登録予定: ${newEntries.length}件\n`;
    newEntries.slice(0, 5).forEach((e, i) => {
      message += `  ${i + 1}. ${e.name} <${e.email || ''}>`;
      // 会社・役職があれば表示
      const extra = [
        (e as any).company,
        (e as any).title,
      ].filter(Boolean).join(' / ');
      if (extra) message += ` (${extra})`;
      message += '\n';
    });
    if (newEntries.length > 5) {
      message += `  ... 他 ${newEntries.length - 5}件\n`;
    }
    message += '\n';
  }

  // メール完全一致
  if (summary.exact_match_count > 0) {
    message += `🔄 既存一致（自動更新）: ${summary.exact_match_count}件\n`;
  }

  // 曖昧一致
  if (summary.ambiguous_count > 0) {
    message += `❓ 曖昧一致（要確認）: ${summary.ambiguous_count}件\n`;
    parsed_entries
      .filter(e => e.match_status === 'ambiguous')
      .forEach((e, i) => {
        message += `  ${i + 1}. ${e.name} <${e.email || ''}>\n`;
        if (e.ambiguous_candidates) {
          e.ambiguous_candidates.forEach(c => {
            message += `     → ${c.number}: ${c.display_name} <${c.email || ''}>\n`;
          });
        }
      });
    message += '\n';
  }

  // メール欠落（Hard fail）
  if (summary.missing_email_count > 0) {
    message += `⚠️ メールなし（スキップ）: ${summary.missing_email_count}件\n`;
    parsed_entries
      .filter(e => e.missing_email)
      .slice(0, 3)
      .forEach(e => {
        message += `  - ${e.name} (メールアドレス未取得)\n`;
      });
    message += '\n';
  }

  // 指示
  message += '━━━━━━━━━━━━━━━━━━━━\n';
  if (summary.ambiguous_count > 0) {
    message += '曖昧一致が見つかりました。\n';
    message += '番号で選択 / 0=新規 / s=スキップ\n';
    message += '全て解決後に「はい」で登録を確定します。\n';
  } else {
    message += '登録を実行しますか？\n';
    message += '• 「はい」→ 登録\n';
    message += '• 「いいえ」→ キャンセル\n';
  }

  return message;
}

/**
 * プレビューメッセージを生成
 */
function buildPreviewMessage(response: ContactImportNewPreviewResponse): string {
  const { summary, parsed_entries } = response;
  let message = '📋 連絡先取り込みプレビュー\n\n';

  // 新規
  if (summary.new_count > 0) {
    message += `✅ 新規登録予定: ${summary.new_count}件\n`;
    parsed_entries
      .filter(e => e.match_status === 'new')
      .slice(0, 5)
      .forEach((e, i) => {
        message += `  ${i + 1}. ${e.name} <${e.email || ''}>\n`;
      });
    if (summary.new_count > 5) {
      message += `  ... 他 ${summary.new_count - 5}件\n`;
    }
    message += '\n';
  }

  // メール完全一致（自動更新）
  if (summary.exact_match_count > 0) {
    message += `🔄 既存一致（自動更新）: ${summary.exact_match_count}件\n`;
  }

  // 曖昧一致
  if (summary.ambiguous_count > 0) {
    message += `❓ 曖昧一致（要確認）: ${summary.ambiguous_count}件\n`;
    parsed_entries
      .filter(e => e.match_status === 'ambiguous')
      .forEach((e, i) => {
        message += `  ${i + 1}. ${e.name} <${e.email || ''}>\n`;
        if (e.ambiguous_candidates) {
          e.ambiguous_candidates.forEach(c => {
            message += `     → ${c.number}: ${c.display_name} <${c.email || ''}>\n`;
          });
        }
      });
    message += '\n';
  }

  // メール欠落
  if (summary.missing_email_count > 0) {
    message += `⚠️ メールなし（スキップ）: ${summary.missing_email_count}件\n\n`;
  }

  // 指示
  message += '━━━━━━━━━━━━━━━━━━━━\n';
  if (summary.ambiguous_count > 0) {
    message += '曖昧一致が見つかりました。\n';
    message += '番号で選択 / 0=新規 / s=スキップ\n';
    message += '全て解決後に「はい」で登録を確定します。\n';
  } else {
    message += '登録を実行しますか？\n';
    message += '• 「はい」→ 登録\n';
    message += '• 「いいえ」→ キャンセル\n';
  }

  return message;
}

/**
 * pending.contact_import.confirm を生成（PR-D-FE-1: 新API対応）
 */
export function buildPendingContactImportConfirm(
  threadId: string,
  data: {
    pending_action_id: string;
    source: 'text' | 'csv' | 'business_card';
    summary: ContactImportNewPreviewResponse['summary'];
    parsed_entries: ContactImportNewPreviewResponse['parsed_entries'];
    next_pending_kind: string;
  }
): PendingState & { kind: 'pending.contact_import.confirm' } {
  // 旧型のpreview形式に変換して互換性維持
  const okEntries = data.parsed_entries
    .filter(e => e.match_status === 'new' || e.match_status === 'exact')
    .map(e => ({ index: e.index, display_name: e.name, email: e.email || '' }));
  const missingEntries = data.parsed_entries
    .filter(e => e.missing_email)
    .map(e => ({ index: e.index, raw_line: e.name, display_name: e.name }));
  const ambiguousEntries = data.parsed_entries
    .filter(e => e.match_status === 'ambiguous')
    .map(e => ({
      index: e.index,
      display_name: e.name,
      email: e.email || '',
      candidates: (e.ambiguous_candidates || []).map(c => ({
        id: c.contact_id,
        display_name: c.display_name,
        email: c.email || null,
      })),
      reason: 'similar_name' as const,
    }));

  return {
    kind: 'pending.contact_import.confirm',
    threadId,
    createdAt: Date.now(),
    confirmation_token: '', // 旧API互換 — 新APIではpending_action_idを使う
    source: data.source,
    preview: {
      ok: okEntries,
      missing_email: missingEntries,
      ambiguous: ambiguousEntries,
    },
    ambiguous_actions: {},
    all_ambiguous_resolved: data.summary.ambiguous_count === 0,
    // PR-D-FE-1: 新API用のフィールド
    pending_action_id: data.pending_action_id,
  } as any;
}

/**
 * pending.person.select を生成（PR-D-FE-1: 新API対応）
 */
export function buildPendingPersonSelect(
  threadId: string,
  data: {
    pending_action_id: string;
    candidate_index: number;
    input_name: string | null;
    input_email: string;
    reason: 'same_name' | 'similar_name' | 'email_exists';
    options: Array<{ id: string; display_name: string | null; email: string | null }>;
    allow_create_new?: boolean;
    allow_skip?: boolean;
  }
): PendingState & { kind: 'pending.person.select' } {
  return {
    kind: 'pending.person.select',
    threadId,
    createdAt: Date.now(),
    parent_kind: 'contact_import',
    confirmation_token: '', // 旧API互換
    candidate_index: data.candidate_index,
    input_name: data.input_name,
    input_email: data.input_email,
    reason: data.reason,
    options: data.options,
    allow_create_new: data.allow_create_new ?? true,
    allow_skip: data.allow_skip ?? true,
    // PR-D-FE-1: 新API用のフィールド
    pending_action_id: data.pending_action_id,
  } as any;
}
