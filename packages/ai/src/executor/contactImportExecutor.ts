/**
 * Contact Import Executor
 * 
 * Classifier の分類結果に基づいて contact import の各操作を実行する。
 * 
 * ■ ルーティング:
 *   contact.import.text         → importPreview（テキスト→パース→曖昧検出→pending作成）
 *   contact.import.confirm      → importConfirm（全曖昧解決済み→DB書き込み）
 *   contact.import.cancel       → importCancel（pending破棄→書き込みゼロ）
 *   contact.import.person_select → personSelect（番号選択→曖昧解決→次へ遷移）
 * 
 * ■ 事故ゼロガード:
 *   1. confirm実行前に all_ambiguous_resolved === true を強制
 *   2. person_select の番号が候補範囲外ならリジェクト
 *   3. cancel → DB書き込みゼロを保証
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ClassifiedIntent, PersonSelectionInput } from '../classifier/types';
import type {
  ContactImportPayload,
  ContactImportEntry,
  ContactImportSummary,
  ContactImportSource,
  ContactMatchStatus,
  AmbiguousCandidate,
  AmbiguousResolvedAction,
  PendingConfirmationKind,
  ContactImportPreviewResponse,
  ContactImportConfirmResponse,
  ContactImportPersonSelectResponse,
} from '../../../../packages/shared/src/types/pendingAction';
import { PENDING_CONFIRMATION_KIND } from '../../../../packages/shared/src/types/pendingAction';
import { parseCSV } from '../parser/csvParser';

// ============================================================
// Executor Response（UIに返す統一型）
// ============================================================

export interface ExecutorResponse {
  success: boolean;
  /** UIに表示するメッセージ */
  message: string;
  /** 次のpending状態 */
  next_pending_kind: PendingConfirmationKind | null;
  /** pending action ID（継続中なら） */
  pending_action_id: string | null;
  /** 具体的なデータ（型はカテゴリ毎に異なる） */
  data?:
    | ContactImportPreviewResponse
    | ContactImportConfirmResponse
    | ContactImportPersonSelectResponse;
}

// ============================================================
// Executor Dependencies Interface
// ============================================================

/**
 * Executor が依存する外部サービスのインターフェース
 * テスト時にモック可能にするためにインターフェース化
 */
export interface ContactImportDeps {
  /** pending action を作成 */
  createPendingAction(params: {
    actor_user_id: string;
    action_type: string;
    target_type: string;
    target_id: string;
    payload: ContactImportPayload;
    summary: ContactImportSummary;
    expires_in_minutes?: number;
  }): Promise<{ id: string; expires_at: string }>;

  /** pending action を取得 */
  getPendingAction(id: string): Promise<{
    id: string;
    payload: ContactImportPayload;
    summary: ContactImportSummary;
    status: string;
    expires_at: string;
  } | null>;

  /** pending action の payload/summary を更新 */
  updatePendingAction(id: string, payload: ContactImportPayload, summary: ContactImportSummary): Promise<void>;

  /** pending action をキャンセル */
  cancelPendingAction(id: string): Promise<void>;

  /** pending action を実行済みにする */
  executePendingAction(id: string): Promise<void>;

  /** テキストから人物エントリをパースする（LLM or パターン） */
  parseContactText(text: string): Promise<ContactImportEntry[]>;

  /** 名前/メールで既存contactsを曖昧検索 */
  findAmbiguousCandidates(entry: ContactImportEntry, userId: string): Promise<AmbiguousCandidate[]>;

  /** contactを新規作成 */
  createContact(params: {
    owner_user_id: string;
    display_name: string;
    email?: string;
    phone?: string;
    notes?: string;
  }): Promise<{ id: string; display_name: string; email?: string }>;

  /** 既存contactを更新（マージ） */
  updateContact(contactId: string, params: {
    display_name?: string;
    email?: string;
    phone?: string;
    notes?: string;
  }): Promise<void>;
}

// ============================================================
// Contact Import Executor
// ============================================================

export class ContactImportExecutor {
  constructor(private deps: ContactImportDeps) {}

  /**
   * 分類結果に基づいてルーティング
   */
  async execute(
    classified: ClassifiedIntent,
    userId: string,
    pendingActionId?: string | null
  ): Promise<ExecutorResponse> {
    switch (classified.category) {
      case 'contact.import.text':
        return this.handleImportText(classified.raw_text || '', userId);

      case 'contact.import.csv':
        return this.handleImportCSV(classified.raw_text || '', userId);

      case 'contact.import.confirm':
        return this.handleImportConfirm(userId, pendingActionId || null);

      case 'contact.import.cancel':
        return this.handleImportCancel(pendingActionId || null);

      case 'contact.import.person_select':
        return this.handlePersonSelect(
          classified.person_selection!,
          userId,
          pendingActionId || null
        );

      default:
        return {
          success: false,
          message: `未対応のカテゴリ: ${classified.category}`,
          next_pending_kind: null,
          pending_action_id: null,
        };
    }
  }

  // ============================================================
  // contact.import.text → Preview
  // ============================================================

  private async handleImportText(
    rawText: string,
    userId: string
  ): Promise<ExecutorResponse> {
    // 1. テキストから人物エントリをパース
    const entries = await this.deps.parseContactText(rawText);

    if (entries.length === 0) {
      return {
        success: false,
        message: '取り込める連絡先が見つかりませんでした。名前やメールアドレスを含むテキストを入力してください。',
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    return this.buildPreviewFromEntries(entries, rawText, 'text', userId);
  }

  // ============================================================
  // contact.import.csv → CSVパース → Preview
  // ============================================================

  private async handleImportCSV(
    rawText: string,
    userId: string
  ): Promise<ExecutorResponse> {
    // 1. CSVパース
    // 取り込みキーワード行を除去（「CSV取り込んで」等のテキストを除去して純粋CSVデータだけ渡す）
    const csvText = this.extractCSVContent(rawText);
    const parseResult = parseCSV(csvText);

    if (parseResult.warnings.length > 0 && parseResult.entries.length === 0) {
      return {
        success: false,
        message: `CSVの解析に失敗しました。\n${parseResult.warnings.join('\n')}`,
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    if (parseResult.entries.length === 0) {
      return {
        success: false,
        message: 'CSVから取り込める連絡先が見つかりませんでした。name,email 形式のCSVを入力してください。',
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    return this.buildPreviewFromEntries(
      parseResult.entries,
      rawText,
      'csv',
      userId,
      parseResult.warnings,
      parseResult.missing_email_count,
      parseResult.truncated_rows
    );
  }

  /**
   * CSVテキストから純粋CSVデータを抽出（キーワード行を除去）
   * 例: 「CSV取り込んで\nname,email\n田中,tanaka@...\n」 → 「name,email\n田中,tanaka@...\n」
   * 
   * 判定基準: 先頭から最大3行、以下の条件を全て満たす行を除去:
   *   1. カンマ/タブが含まれない（データ行ではない）
   *   2. メールアドレスが含まれない
   *   3. 純粋なCSVヘッダ（name,email等）ではない
   */
  private extractCSVContent(rawText: string): string {
    const lines = rawText.split('\n');
    
    // データ行判定: カンマまたはタブを含む、またはメールっぽい文字列を含む
    const isDataLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // カンマ/タブがある → データ or ヘッダ行
      if (trimmed.includes(',') || trimmed.includes('\t')) return true;
      // メールアドレスがある
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) return true;
      return false;
    };
    
    let startIndex = 0;
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      if (isDataLine(lines[i])) {
        break; // データ行に到達したらストップ
      }
      startIndex = i + 1; // この行はキーワード行として除去
    }

    return lines.slice(startIndex).join('\n');
  }

  // ============================================================
  // 共通: entries からpreviewを構築
  // ============================================================

  private async buildPreviewFromEntries(
    entries: ContactImportEntry[],
    rawText: string,
    source: ContactImportSource,
    userId: string,
    csvWarnings: string[] = [],
    missingEmailCount: number = 0,
    truncatedRows: number = 0
  ): Promise<ExecutorResponse> {
    // 2. 各エントリに対して曖昧一致検索（メール欠落=skippedのエントリはスキップ）
    for (const entry of entries) {
      // メール欠落は既にskippedなので曖昧検索不要
      if (entry.match_status === 'skipped') continue;

      const candidates = await this.deps.findAmbiguousCandidates(entry, userId);
      
      if (candidates.length === 1 && candidates[0].score >= 0.95) {
        entry.match_status = 'exact';
        entry.resolved_action = { type: 'select_existing', contact_id: candidates[0].contact_id };
      } else if (candidates.length > 0) {
        entry.match_status = 'ambiguous';
        entry.ambiguous_candidates = candidates;
      } else {
        entry.match_status = 'new';
        entry.resolved_action = { type: 'create_new' };
      }
    }

    // 3. サマリ計算
    const summary = this.buildSummary(entries, source, missingEmailCount);
    const unresolvedCount = entries.filter(e => e.match_status === 'ambiguous' && !e.resolved_action).length;
    const allResolved = unresolvedCount === 0;

    // 4. payload作成
    const payload: ContactImportPayload = {
      source,
      raw_text: rawText,
      parsed_entries: entries,
      unresolved_count: unresolvedCount,
      all_ambiguous_resolved: allResolved,
      missing_email_count: missingEmailCount,
    };

    // 5. pending action 作成
    const pendingAction = await this.deps.createPendingAction({
      actor_user_id: userId,
      action_type: 'contact_import',
      target_type: 'contacts',
      target_id: `import-${source}-${Date.now()}`,
      payload,
      summary,
    });

    // 6. 次のpending kindを決定
    const nextKind: PendingConfirmationKind = allResolved
      ? PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM
      : PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT;

    // 7. メッセージ生成
    let message: string;
    if (allResolved) {
      message = this.buildConfirmMessage(summary, csvWarnings, truncatedRows);
    } else {
      message = this.buildAmbiguousMessage(entries, summary, csvWarnings, truncatedRows);
    }

    return {
      success: true,
      message,
      next_pending_kind: nextKind,
      pending_action_id: pendingAction.id,
      data: {
        pending_action_id: pendingAction.id,
        expires_at: pendingAction.expires_at,
        summary,
        parsed_entries: entries,
        message,
        next_pending_kind: nextKind,
      } as ContactImportPreviewResponse,
    };
  }

  // ============================================================
  // contact.import.confirm → 確定（事故ゼロガード付き）
  // ============================================================

  private async handleImportConfirm(
    userId: string,
    pendingActionId: string | null
  ): Promise<ExecutorResponse> {
    if (!pendingActionId) {
      return {
        success: false,
        message: '確認待ちの取り込みがありません。',
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    const action = await this.deps.getPendingAction(pendingActionId);
    if (!action || action.status !== 'pending') {
      return {
        success: false,
        message: '確認待ちの取り込みが見つからないか、既に期限切れです。',
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    const payload = action.payload;

    // ■■■ 事故ゼロガード: all_ambiguous_resolved 必須 ■■■
    if (!payload.all_ambiguous_resolved) {
      const unresolvedEntries = payload.parsed_entries.filter(
        e => e.match_status === 'ambiguous' && !e.resolved_action
      );
      return {
        success: false,
        message: `まだ ${unresolvedEntries.length}件の曖昧な一致が未解決です。先に番号選択またはスキップをしてください。`,
        next_pending_kind: PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT,
        pending_action_id: pendingActionId,
      };
    }
    // ■■■ ガード終了 ■■■

    // 実際のDB書き込み
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const createdContacts: Array<{ id: string; display_name: string; email?: string }> = [];

    for (const entry of payload.parsed_entries) {
      if (!entry.resolved_action) {
        skippedCount++;
        continue;
      }

      switch (entry.resolved_action.type) {
        case 'create_new': {
          const contact = await this.deps.createContact({
            owner_user_id: userId,
            display_name: entry.name,
            email: entry.email,
            phone: entry.phone,
            notes: entry.notes,
          });
          createdContacts.push(contact);
          createdCount++;
          break;
        }
        case 'select_existing': {
          // 既存に紐付け（必要に応じてマージ更新）
          await this.deps.updateContact(entry.resolved_action.contact_id, {
            notes: entry.notes,
          });
          updatedCount++;
          break;
        }
        case 'skip': {
          skippedCount++;
          break;
        }
      }
    }

    // pending action を実行済みに
    await this.deps.executePendingAction(pendingActionId);

    const message = `✅ 連絡先の取り込みが完了しました！\n` +
      `• 新規作成: ${createdCount}件\n` +
      `• 既存更新: ${updatedCount}件\n` +
      `• スキップ: ${skippedCount}件`;

    return {
      success: true,
      message,
      next_pending_kind: null,
      pending_action_id: null,
      data: {
        success: true,
        created_count: createdCount,
        updated_count: updatedCount,
        skipped_count: skippedCount,
        created_contacts: createdContacts,
      } as ContactImportConfirmResponse,
    };
  }

  // ============================================================
  // contact.import.cancel → キャンセル（書き込みゼロ保証）
  // ============================================================

  private async handleImportCancel(
    pendingActionId: string | null
  ): Promise<ExecutorResponse> {
    if (pendingActionId) {
      await this.deps.cancelPendingAction(pendingActionId);
    }

    return {
      success: true,
      message: '連絡先の取り込みをキャンセルしました。データは書き込まれていません。',
      next_pending_kind: null,
      pending_action_id: null,
    };
  }

  // ============================================================
  // contact.import.person_select → 曖昧一致解決
  // ============================================================

  private async handlePersonSelect(
    selection: PersonSelectionInput,
    userId: string,
    pendingActionId: string | null
  ): Promise<ExecutorResponse> {
    if (!pendingActionId) {
      return {
        success: false,
        message: '選択対象の取り込みがありません。',
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    const action = await this.deps.getPendingAction(pendingActionId);
    if (!action || action.status !== 'pending') {
      return {
        success: false,
        message: '確認待ちの取り込みが見つからないか、既に期限切れです。',
        next_pending_kind: null,
        pending_action_id: null,
      };
    }

    const payload = action.payload;
    const entryIndex = selection.target_entry_index;
    const entry = payload.parsed_entries[entryIndex];

    if (!entry) {
      return {
        success: false,
        message: `対象のエントリ（${entryIndex}）が見つかりません。`,
        next_pending_kind: PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT,
        pending_action_id: pendingActionId,
      };
    }

    // 選択結果を反映
    let resolvedAction: AmbiguousResolvedAction;

    if (selection.is_skip) {
      // スキップ
      resolvedAction = { type: 'skip' };
      entry.match_status = 'skipped';
    } else if (selection.selected_number === 0) {
      // 新規作成
      resolvedAction = { type: 'create_new' };
      entry.match_status = 'new';
    } else {
      // 既存候補から選択
      const candidates = entry.ambiguous_candidates || [];
      const selectedCandidate = candidates.find(c => c.number === selection.selected_number);

      if (!selectedCandidate) {
        const maxNum = candidates.length;
        return {
          success: false,
          message: `番号 ${selection.selected_number} は無効です。0〜${maxNum}の番号、または s（スキップ）で選んでください。`,
          next_pending_kind: PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT,
          pending_action_id: pendingActionId,
        };
      }

      resolvedAction = { type: 'select_existing', contact_id: selectedCandidate.contact_id };
      entry.match_status = 'exact'; // 解決済みなのでexactに変更
    }

    entry.resolved_action = resolvedAction;

    // unresolved_countとall_ambiguous_resolvedを再計算
    const unresolvedEntries = payload.parsed_entries.filter(
      e => e.match_status === 'ambiguous' && !e.resolved_action
    );
    payload.unresolved_count = unresolvedEntries.length;
    payload.all_ambiguous_resolved = unresolvedEntries.length === 0;

    // summary再計算（sourceとmissing_email_countはpayloadから引き継ぐ）
    const summary = this.buildSummary(payload.parsed_entries, payload.source, payload.missing_email_count);

    // pending actionを更新
    await this.deps.updatePendingAction(pendingActionId, payload, summary);

    // 次のpending kindを決定
    const nextKind: PendingConfirmationKind = payload.all_ambiguous_resolved
      ? PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM
      : PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT;

    // メッセージ生成
    let message: string;
    if (payload.all_ambiguous_resolved) {
      message = this.buildConfirmMessage(summary);
    } else {
      // 次の未解決エントリを表示
      message = this.buildAmbiguousMessage(payload.parsed_entries, summary);
    }

    const updatedEntry = payload.parsed_entries[entryIndex];

    return {
      success: true,
      message,
      next_pending_kind: nextKind,
      pending_action_id: pendingActionId,
      data: {
        updated_entry: updatedEntry,
        all_resolved: payload.all_ambiguous_resolved,
        remaining_unresolved: payload.unresolved_count,
        next_pending_kind: nextKind,
        message,
      } as ContactImportPersonSelectResponse,
    };
  }

  // ============================================================
  // Helper: サマリ構築
  // ============================================================

  private buildSummary(
    entries: ContactImportEntry[],
    source: ContactImportSource = 'text',
    missingEmailCount: number = 0
  ): ContactImportSummary {
    return {
      total_count: entries.length,
      exact_match_count: entries.filter(e => e.match_status === 'exact').length,
      ambiguous_count: entries.filter(e => e.match_status === 'ambiguous' && !e.resolved_action).length,
      new_count: entries.filter(e => e.match_status === 'new').length,
      skipped_count: entries.filter(e => e.match_status === 'skipped').length,
      missing_email_count: missingEmailCount,
      source,
      preview_entries: entries.map(e => ({
        name: e.name,
        email: e.email,
        match_status: e.match_status,
        candidate_count: e.ambiguous_candidates?.length,
      })),
    };
  }

  // ============================================================
  // Helper: メッセージ生成
  // ============================================================

  private buildConfirmMessage(
    summary: ContactImportSummary,
    csvWarnings: string[] = [],
    truncatedRows: number = 0
  ): string {
    const sourceLabel = summary.source === 'csv' ? 'CSV' : 'テキスト';
    const lines: string[] = [
      `📋 連絡先の取り込みプレビュー（${sourceLabel}）`,
      ``,
      `全${summary.total_count}件:`,
    ];

    if (summary.exact_match_count > 0) {
      lines.push(`  ✅ 既存一致: ${summary.exact_match_count}件`);
    }
    if (summary.new_count > 0) {
      lines.push(`  🆕 新規作成: ${summary.new_count}件`);
    }
    if (summary.skipped_count > 0) {
      lines.push(`  ⏭️ スキップ: ${summary.skipped_count}件`);
    }

    // ■■■ CSV専用: メール欠落の明示表示（事故ゼロ） ■■■
    if (summary.missing_email_count > 0) {
      lines.push(``);
      lines.push(`  ⚠️ メール欠落: ${summary.missing_email_count}件（登録不可 → スキップ）`);
    }

    // 上限切り捨て
    if (truncatedRows > 0) {
      lines.push(`  ⚠️ ${truncatedRows}行が上限超過で切り捨てられました`);
    }

    // CSVパース警告
    if (csvWarnings.length > 0) {
      lines.push(``);
      for (const w of csvWarnings) {
        lines.push(`  ℹ️ ${w}`);
      }
    }

    lines.push(``);
    lines.push(`この内容で登録しますか？（はい / いいえ）`);

    return lines.join('\n');
  }

  /**
   * 曖昧一致メッセージ（事故ゼロ: 0=新規, s=スキップ を必ず表示）
   */
  private buildAmbiguousMessage(
    entries: ContactImportEntry[],
    summary: ContactImportSummary,
    csvWarnings: string[] = [],
    truncatedRows: number = 0
  ): string {
    // 最初の未解決エントリを取得
    const unresolved = entries.find(
      e => e.match_status === 'ambiguous' && !e.resolved_action
    );

    if (!unresolved) {
      return this.buildConfirmMessage(summary);
    }

    const lines: string[] = [
      `🔍 「${unresolved.name}」に似ている連絡先が見つかりました。`,
      ``,
    ];

    if (unresolved.ambiguous_candidates) {
      for (const candidate of unresolved.ambiguous_candidates) {
        const emailStr = candidate.email ? ` (${candidate.email})` : '';
        lines.push(`  ${candidate.number}. ${candidate.display_name}${emailStr}`);
      }
    }

    // ■■■ 事故ゼロ: 0=新規, s=スキップ を必ず表示 ■■■
    lines.push(``);
    lines.push(`  0 = 新規作成`);
    lines.push(`  s = スキップ`);
    lines.push(``);

    const remaining = entries.filter(
      e => e.match_status === 'ambiguous' && !e.resolved_action
    ).length;

    // CSV専用: メール欠落の明示表示
    if (summary.missing_email_count > 0) {
      lines.push(`⚠️ メール欠落: ${summary.missing_email_count}件（登録不可 → スキップ）`);
      lines.push(``);
    }

    // 上限切り捨て
    if (truncatedRows > 0) {
      lines.push(`⚠️ ${truncatedRows}行が上限超過で切り捨てられました`);
      lines.push(``);
    }

    lines.push(`番号で選んでください（残り${remaining}件）`);

    return lines.join('\n');
  }
}
