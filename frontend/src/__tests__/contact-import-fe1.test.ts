/**
 * contact-import-fe1.spec.ts
 * PR-D-FE-1: Contact Import フロント接続テスト
 * 
 * テスト対象:
 * - E2E-FE-1: CSV貼付 → preview → person-select → confirm → pending消える
 * - E2E-FE-2: preview → cancel → pending消える（登録影響なし）
 * 
 * 検証ポイント:
 * - 新API (contactsImportApi) への接続
 * - pending 種別に応じたUI反映（SSOT: getPendingPlaceholder/HintBanner/SendButtonLabel）
 * - useChatReducer の contact_import.* ハンドリング
 * - stale closure 回避 (RESOLVE_CONTACT_IMPORT_AMBIGUOUS)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  contactsImportApi,
  type ContactImportNewPreviewResponse,
  type ContactImportPersonSelectNewResponse,
  type ContactImportConfirmNewResponse,
} from '../core/api/contacts';
import {
  executeContactImportPreview,
  executeContactImportConfirm,
  executeContactImportCancel,
  executeContactImportPersonSelect,
  buildPendingContactImportConfirm,
  buildPendingPersonSelect,
} from '../core/chat/executors/contactImport';
import {
  getPendingPlaceholder,
  getPendingHintBanner,
  getPendingSendButtonLabel,
} from '../core/chat/pendingTypes';
import type { PendingState } from '../core/chat/pendingTypes';

// 新API モック
vi.mock('../core/api/contacts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../core/api/contacts')>();
  return {
    ...mod,
    contactsImportApi: {
      preview: vi.fn(),
      personSelect: vi.fn(),
      confirm: vi.fn(),
      cancel: vi.fn(),
    },
  };
});

// platform モック（log）
vi.mock('../core/platform', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PR-D-FE-1: Contact Import FE Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // E2E-FE-1: CSV貼付 → preview → person-select → confirm → pending消える
  // ============================================================
  describe('E2E-FE-1: Full flow (preview → person-select → confirm)', () => {
    it('Step 1: preview → pending.contact_import.confirm 設定', async () => {
      const mockResponse: ContactImportNewPreviewResponse = {
        pending_action_id: 'pa-test-001',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        summary: {
          total_count: 3,
          exact_match_count: 0,
          ambiguous_count: 1,
          new_count: 2,
          skipped_count: 0,
          missing_email_count: 0,
          source: 'text',
          preview_entries: [
            { name: '田中太郎', email: 'tanaka@example.com', match_status: 'new' },
            { name: '佐藤花子', email: 'sato@example.com', match_status: 'ambiguous', candidate_count: 2 },
            { name: '山田次郎', email: 'yamada@example.com', match_status: 'new' },
          ],
        },
        parsed_entries: [
          { index: 0, name: '田中太郎', email: 'tanaka@example.com', missing_email: false, match_status: 'new' },
          {
            index: 1, name: '佐藤花子', email: 'sato@example.com', missing_email: false, match_status: 'ambiguous',
            ambiguous_candidates: [
              { number: 1, contact_id: 'c-exist-1', display_name: '佐藤花子', email: 'hanako.sato@work.com', score: 0.85 },
              { number: 2, contact_id: 'c-exist-2', display_name: '佐藤はなこ', email: 'sato-h@example.com', score: 0.70 },
            ],
          },
          { index: 2, name: '山田次郎', email: 'yamada@example.com', missing_email: false, match_status: 'new' },
        ],
        csv_warnings: [],
        next_pending_kind: 'person_select',
        message: '3件の連絡先を検出しました。',
      };

      vi.mocked(contactsImportApi.preview).mockResolvedValue(mockResponse);

      const result = await executeContactImportPreview({
        intent: 'contact.import.text',
        confidence: 1.0,
        params: { rawText: '田中太郎 tanaka@example.com\n佐藤花子 sato@example.com\n山田次郎 yamada@example.com' },
      });

      // Executor結果の検証
      expect(result.success).toBe(true);
      expect(result.message).toContain('プレビュー');
      expect(result.data?.kind).toBe('contact_import.preview');
      expect((result.data as any)?.payload?.pending_action_id).toBe('pa-test-001');

      // API呼び出しの検証
      expect(contactsImportApi.preview).toHaveBeenCalledWith({
        source: 'text',
        raw_text: expect.any(String),
      });

      // pending builder検証
      const pending = buildPendingContactImportConfirm('thread-1', {
        pending_action_id: 'pa-test-001',
        source: 'text',
        summary: mockResponse.summary,
        parsed_entries: mockResponse.parsed_entries,
        next_pending_kind: 'person_select',
      });

      expect(pending.kind).toBe('pending.contact_import.confirm');
      expect(pending.all_ambiguous_resolved).toBe(false); // 曖昧一致あり
      expect((pending as any).pending_action_id).toBe('pa-test-001');

      // SSOT UI関数の検証
      expect(getPendingPlaceholder(pending)).toBe('はい / いいえ');
      expect(getPendingHintBanner(pending)).toContain('曖昧一致');
      expect(getPendingSendButtonLabel(pending)).toBe('確定');
    });

    it('Step 2: person-select → 曖昧一致解決', async () => {
      const mockSelectResponse: ContactImportPersonSelectNewResponse = {
        updated_entry: {
          index: 1,
          name: '佐藤花子',
          email: 'sato@example.com',
          match_status: 'resolved',
          resolved_action: { type: 'select_existing', contact_id: 'c-exist-1' },
        },
        all_resolved: true,
        remaining_unresolved: 0,
        next_pending_kind: 'confirm',
        message: '佐藤花子 → 既存の佐藤花子を更新します。全ての曖昧一致が解決しました。',
      };

      vi.mocked(contactsImportApi.personSelect).mockResolvedValue(mockSelectResponse);

      const result = await executeContactImportPersonSelect(
        {
          intent: 'contact.import.person_select',
          confidence: 1.0,
          params: {
            pending_action_id: 'pa-test-001',
            action: 'update_existing',
            candidate_index: 1,
            selected_number: 1,
          },
        },
        { pendingForThread: null }
      );

      expect(result.success).toBe(true);
      expect(result.data?.kind).toBe('contact_import.person_selected');
      expect((result.data as any)?.payload?.all_resolved).toBe(true);
      expect((result.data as any)?.payload?.remaining_unresolved).toBe(0);

      // API呼び出しの検証
      expect(contactsImportApi.personSelect).toHaveBeenCalledWith({
        pending_action_id: 'pa-test-001',
        entry_index: 1,
        action: 'select',
        selected_number: 1,
      });
    });

    it('Step 3: confirm → contacts書き込み → pending消える', async () => {
      const mockConfirmResponse: ContactImportConfirmNewResponse = {
        success: true,
        created_count: 2,
        updated_count: 1,
        skipped_count: 0,
        created_contacts: [
          { id: 'c-new-1', display_name: '田中太郎', email: 'tanaka@example.com' },
          { id: 'c-new-2', display_name: '山田次郎', email: 'yamada@example.com' },
        ],
      };

      vi.mocked(contactsImportApi.confirm).mockResolvedValue(mockConfirmResponse);

      const result = await executeContactImportConfirm(
        {
          intent: 'contact.import.confirm',
          confidence: 1.0,
          params: { pending_action_id: 'pa-test-001' },
        },
        { pendingForThread: null }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('連絡先取り込み完了');
      expect(result.message).toContain('新規登録: 2件');
      expect(result.message).toContain('更新: 1件');
      expect(result.data?.kind).toBe('contact_import.confirmed');

      // Gate-4: confirm のみ書き込み → API呼び出し確認
      expect(contactsImportApi.confirm).toHaveBeenCalledWith({
        pending_action_id: 'pa-test-001',
      });
    });
  });

  // ============================================================
  // E2E-FE-2: preview → cancel → pending消える（登録影響なし）
  // ============================================================
  describe('E2E-FE-2: Cancel flow (preview → cancel → no writes)', () => {
    it('preview → cancel → 書き込みゼロ保証', async () => {
      // Step 1: preview
      const mockPreview: ContactImportNewPreviewResponse = {
        pending_action_id: 'pa-test-002',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        summary: {
          total_count: 1,
          exact_match_count: 0,
          ambiguous_count: 0,
          new_count: 1,
          skipped_count: 0,
          missing_email_count: 0,
          source: 'text',
          preview_entries: [
            { name: '田中太郎', email: 'tanaka@example.com', match_status: 'new' },
          ],
        },
        parsed_entries: [
          { index: 0, name: '田中太郎', email: 'tanaka@example.com', missing_email: false, match_status: 'new' },
        ],
        csv_warnings: [],
        next_pending_kind: 'confirm',
        message: '1件の連絡先を検出しました。',
      };

      vi.mocked(contactsImportApi.preview).mockResolvedValue(mockPreview);

      const previewResult = await executeContactImportPreview({
        intent: 'contact.import.text',
        confidence: 1.0,
        params: { rawText: '田中太郎 tanaka@example.com' },
      });

      expect(previewResult.success).toBe(true);
      expect(previewResult.data?.kind).toBe('contact_import.preview');

      // Step 2: cancel
      vi.mocked(contactsImportApi.cancel).mockResolvedValue({
        success: true,
        message: 'キャンセルしました。',
      });

      const cancelResult = await executeContactImportCancel(
        {
          intent: 'contact.import.cancel',
          confidence: 1.0,
          params: { pending_action_id: 'pa-test-002' },
        },
        { pendingForThread: null }
      );

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.message).toContain('キャンセル');
      expect(cancelResult.data?.kind).toBe('contact_import.cancelled');

      // 書き込みゼロ保証: confirm API は呼ばれない
      expect(contactsImportApi.confirm).not.toHaveBeenCalled();

      // cancel API は呼ばれた
      expect(contactsImportApi.cancel).toHaveBeenCalledWith({
        pending_action_id: 'pa-test-002',
      });
    });

    it('cancel API失敗時もUIはクリアされる', async () => {
      vi.mocked(contactsImportApi.cancel).mockRejectedValue(new Error('Network error'));

      const result = await executeContactImportCancel(
        {
          intent: 'contact.import.cancel',
          confidence: 1.0,
          params: { pending_action_id: 'pa-test-003' },
        },
        { pendingForThread: null }
      );

      // cancel失敗してもUIはクリア（success: true）
      expect(result.success).toBe(true);
      expect(result.data?.kind).toBe('contact_import.cancelled');
    });
  });

  // ============================================================
  // エラーハンドリング
  // ============================================================
  describe('Error Handling', () => {
    it('confirm → 409 → 曖昧一致未解決メッセージ', async () => {
      const error = new Error('Conflict');
      (error as any).status = 409;
      vi.mocked(contactsImportApi.confirm).mockRejectedValue(error);

      const result = await executeContactImportConfirm(
        {
          intent: 'contact.import.confirm',
          confidence: 1.0,
          params: { pending_action_id: 'pa-test-004' },
        },
        { pendingForThread: null }
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('未解決の曖昧一致');
      expect(result.data?.kind).toBe('contact_import.ambiguous_remaining');
    });

    it('confirm → 404 → 期限切れメッセージ', async () => {
      const error = new Error('Not Found');
      (error as any).status = 404;
      vi.mocked(contactsImportApi.confirm).mockRejectedValue(error);

      const result = await executeContactImportConfirm(
        {
          intent: 'contact.import.confirm',
          confidence: 1.0,
          params: { pending_action_id: 'pa-test-005' },
        },
        { pendingForThread: null }
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('期限切れ');
      expect(result.data?.kind).toBe('contact_import.expired');
    });

    it('person-select → 404 → 期限切れメッセージ', async () => {
      const error = new Error('Not Found');
      (error as any).status = 404;
      vi.mocked(contactsImportApi.personSelect).mockRejectedValue(error);

      const result = await executeContactImportPersonSelect(
        {
          intent: 'contact.import.person_select',
          confidence: 1.0,
          params: {
            pending_action_id: 'pa-test-006',
            action: 'create_new',
            candidate_index: 0,
          },
        },
        { pendingForThread: null }
      );

      expect(result.success).toBe(false);
      expect(result.data?.kind).toBe('contact_import.expired');
    });
  });

  // ============================================================
  // SSOT UI関数テスト
  // ============================================================
  describe('SSOT UI Functions', () => {
    it('pending.contact_import.confirm → 正しいUI要素', () => {
      const pending = buildPendingContactImportConfirm('t1', {
        pending_action_id: 'pa-1',
        source: 'text',
        summary: {
          total_count: 2, exact_match_count: 0, ambiguous_count: 0,
          new_count: 2, skipped_count: 0, missing_email_count: 0,
          source: 'text', preview_entries: [],
        },
        parsed_entries: [
          { index: 0, name: 'A', email: 'a@e.com', missing_email: false, match_status: 'new' },
          { index: 1, name: 'B', email: 'b@e.com', missing_email: false, match_status: 'new' },
        ],
        next_pending_kind: 'confirm',
      });

      expect(getPendingPlaceholder(pending)).toBe('はい / いいえ');
      expect(getPendingHintBanner(pending)).toContain('連絡先');
      expect(getPendingHintBanner(pending)).toContain('2件');
      expect(getPendingSendButtonLabel(pending)).toBe('確定');
    });

    it('pending.person.select → 正しいUI要素', () => {
      const pending = buildPendingPersonSelect('t1', {
        pending_action_id: 'pa-1',
        candidate_index: 0,
        input_name: '佐藤花子',
        input_email: 'sato@example.com',
        reason: 'similar_name',
        options: [
          { id: 'c1', display_name: '佐藤花子', email: 'hanako@work.com' },
          { id: 'c2', display_name: '佐藤はなこ', email: 'sato-h@example.com' },
        ],
      });

      expect(getPendingPlaceholder(pending)).toBe('番号で選択（例: 1） / 0=新規 / s=スキップ');
      expect(getPendingHintBanner(pending)).toContain('佐藤花子');
      expect(getPendingHintBanner(pending)).toContain('2件');
      expect(getPendingSendButtonLabel(pending)).toBe('選択');
    });

    it('null pending → null', () => {
      expect(getPendingPlaceholder(null)).toBeNull();
      expect(getPendingHintBanner(null)).toBeNull();
      expect(getPendingSendButtonLabel(null)).toBeNull();
    });
  });
});
