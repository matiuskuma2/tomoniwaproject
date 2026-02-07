/**
 * contact-import-confirm.spec.ts
 * PR-D-1.1: 連絡先取り込み チャット確認フローの E2E テスト
 * 
 * 事故ゼロ設計の検証:
 * - IMPORT-CONFIRM-1: 曖昧一致がある場合 → pending.person.select 遷移
 * - IMPORT-CONFIRM-2: 番号選択 → 選択結果反映
 * - IMPORT-CONFIRM-3: 「はい」→ DB登録実行
 * - IMPORT-CONFIRM-4: 「いいえ」→ 書き込みゼロ
 * - IMPORT-CONFIRM-5: 「スキップして続行」→ 曖昧分スキップ・残り登録
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyContactImport } from '../src/core/chat/classifier/contactImport';
import {
  executeContactImportPreview,
  executeContactImportConfirm,
  executeContactImportCancel,
  executeContactImportPersonSelect,
  buildPendingContactImportConfirm,
  buildPendingPersonSelect,
} from '../src/core/chat/executors/contactImport';
import type { PendingState } from '../src/core/chat/pendingTypes';
import { contactsApi } from '../src/core/api/contacts';

// API モック
vi.mock('../src/core/api/contacts', () => ({
  contactsApi: {
    importPreview: vi.fn(),
    importConfirm: vi.fn(),
  },
}));

describe('PR-D-1.1: Contact Import Confirm Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Classifier Tests', () => {
    describe('IMPORT-CONFIRM-1: 曖昧一致 → pending.person.select', () => {
      it('番号入力で既存選択を返す', () => {
        const pending: PendingState = buildPendingPersonSelect('test-thread', {
          confirmation_token: 'test-token',
          candidate_index: 0,
          input_name: '山田太郎',
          input_email: 'yamada@example.com',
          reason: 'same_name',
          options: [
            { id: 'c1', display_name: '山田太郎', email: 'yamada@company.com' },
            { id: 'c2', display_name: '山田太朗', email: 'taro.yamada@example.com' },
          ],
          allow_create_new: true,
          allow_skip: true,
        });

        const result = classifyContactImport('1', '1', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.person_select');
        expect(result?.params.action).toBe('update_existing');
        expect(result?.params.existing_id).toBe('c1');
      });

      it('「0」で新規作成を返す', () => {
        const pending: PendingState = buildPendingPersonSelect('test-thread', {
          confirmation_token: 'test-token',
          candidate_index: 0,
          input_name: '山田太郎',
          input_email: 'yamada@example.com',
          reason: 'same_name',
          options: [{ id: 'c1', display_name: '山田太郎', email: 'yamada@company.com' }],
          allow_create_new: true,
          allow_skip: true,
        });

        const result = classifyContactImport('0', '0', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.person_select');
        expect(result?.params.action).toBe('create_new');
      });

      it('「新規」で新規作成を返す', () => {
        const pending: PendingState = buildPendingPersonSelect('test-thread', {
          confirmation_token: 'test-token',
          candidate_index: 0,
          input_name: '山田太郎',
          input_email: 'yamada@example.com',
          reason: 'same_name',
          options: [{ id: 'c1', display_name: '山田太郎', email: 'yamada@company.com' }],
          allow_create_new: true,
          allow_skip: true,
        });

        const result = classifyContactImport('新規', '新規', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.person_select');
        expect(result?.params.action).toBe('create_new');
      });

      it('「スキップ」でスキップを返す', () => {
        const pending: PendingState = buildPendingPersonSelect('test-thread', {
          confirmation_token: 'test-token',
          candidate_index: 0,
          input_name: '山田太郎',
          input_email: 'yamada@example.com',
          reason: 'same_name',
          options: [{ id: 'c1', display_name: '山田太郎', email: 'yamada@company.com' }],
          allow_create_new: true,
          allow_skip: true,
        });

        const result = classifyContactImport('スキップ', 'スキップ', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.person_select');
        expect(result?.params.action).toBe('skip');
      });
    });

    describe('IMPORT-CONFIRM-3: 「はい」→ confirm', () => {
      it('曖昧一致なしで「はい」→ confirm intent を返す', () => {
        const pending: PendingState = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: {
            ok: [{ index: 0, display_name: '山田太郎', email: 'yamada@example.com' }],
            missing_email: [],
            ambiguous: [],
          },
          all_ambiguous_resolved: true,
        });

        const result = classifyContactImport('はい', 'はい', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.confirm');
        expect(result?.params.confirmation_token).toBe('test-token');
        expect(result?.params.skip_ambiguous).toBe(false);
      });

      it('曖昧一致ありで「はい」→ 警告付き clarification', () => {
        const pending: PendingState = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: {
            ok: [{ index: 0, display_name: '山田太郎', email: 'yamada@example.com' }],
            missing_email: [],
            ambiguous: [{
              index: 1,
              display_name: '佐藤花子',
              email: 'sato@example.com',
              candidates: [{ id: 'c1', display_name: '佐藤花子', email: 'hanako@example.com' }],
              reason: 'same_name',
            }],
          },
          ambiguous_actions: {},
          all_ambiguous_resolved: false,
        });

        const result = classifyContactImport('はい', 'はい', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.confirm');
        expect(result?.needsClarification).toBeDefined();
        expect(result?.needsClarification?.field).toBe('ambiguous');
      });
    });

    describe('IMPORT-CONFIRM-4: 「いいえ」→ cancel', () => {
      it('「いいえ」で cancel intent を返す', () => {
        const pending: PendingState = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: {
            ok: [{ index: 0, display_name: '山田太郎', email: 'yamada@example.com' }],
            missing_email: [],
            ambiguous: [],
          },
        });

        const result = classifyContactImport('いいえ', 'いいえ', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.cancel');
        expect(result?.params.confirmation_token).toBe('test-token');
      });

      it('「キャンセル」で cancel intent を返す', () => {
        const pending: PendingState = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: { ok: [], missing_email: [], ambiguous: [] },
        });

        const result = classifyContactImport('キャンセル', 'キャンセル', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.cancel');
      });
    });

    describe('IMPORT-CONFIRM-5: 「スキップして続行」', () => {
      it('「スキップして続行」で skip_ambiguous=true の confirm を返す', () => {
        const pending: PendingState = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: {
            ok: [{ index: 0, display_name: '山田太郎', email: 'yamada@example.com' }],
            missing_email: [],
            ambiguous: [{
              index: 1,
              display_name: '佐藤花子',
              email: 'sato@example.com',
              candidates: [{ id: 'c1', display_name: '佐藤花子', email: 'hanako@example.com' }],
              reason: 'same_name',
            }],
          },
          all_ambiguous_resolved: false,
        });

        const result = classifyContactImport('スキップして続行', 'スキップして続行', undefined, pending);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.confirm');
        expect(result?.params.skip_ambiguous).toBe(true);
      });
    });

    describe('テキスト取り込みパターン', () => {
      it('「連絡先に追加」パターンでマッチ', () => {
        const result = classifyContactImport('連絡先に追加', '連絡先に追加', undefined, null);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.text');
        expect(result?.needsClarification).toBeDefined(); // テキストが短いため
      });

      it('テキスト付きでマッチ', () => {
        const input = '連絡先に取り込み\n山田太郎 yamada@example.com\n佐藤花子 sato@example.com';
        const result = classifyContactImport(input, input.toLowerCase(), undefined, null);

        expect(result).not.toBeNull();
        expect(result?.intent).toBe('contact.import.text');
        expect(result?.params.rawText).toBe(input);
      });
    });
  });

  describe('Executor Tests', () => {
    describe('executeContactImportPreview', () => {
      it('有効なテキストでプレビューを生成', async () => {
        vi.mocked(contactsApi.importPreview).mockResolvedValue({
          preview: {
            candidates: [
              { raw_line: '山田太郎 yamada@example.com', display_name: '山田太郎', email: 'yamada@example.com', status: 'ok' },
            ],
            ambiguous_matches: [],
            total_lines: 1,
            valid_count: 1,
            missing_email_count: 0,
            invalid_email_count: 0,
          },
          requires_confirmation: true,
          confirmation_token: 'test-token',
          message: '1件の連絡先を登録できます。',
        });

        const result = await executeContactImportPreview({
          intent: 'contact.import.text',
          confidence: 1.0,
          params: { rawText: '山田太郎 yamada@example.com' },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('登録予定');
        expect((result.data as any)?.payload?.confirmation_token).toBe('test-token');
      });

      it('テキストなしでエラー', async () => {
        const result = await executeContactImportPreview({
          intent: 'contact.import.text',
          confidence: 1.0,
          params: {},
        });

        expect(result.success).toBe(false);
        expect(result.needsClarification).toBeDefined();
      });
    });

    describe('executeContactImportConfirm', () => {
      it('正常に登録完了', async () => {
        vi.mocked(contactsApi.importConfirm).mockResolvedValue({
          created: [{ id: 'c1', display_name: '山田太郎', email: 'yamada@example.com' }],
          skipped: [],
          updated: [],
          errors: [],
          summary: {
            total_processed: 1,
            created_count: 1,
            skipped_count: 0,
            updated_count: 0,
            error_count: 0,
          },
        });

        const result = await executeContactImportConfirm({
          intent: 'contact.import.confirm',
          confidence: 1.0,
          params: { confirmation_token: 'test-token', skip_ambiguous: false },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('新規登録: 1件');
      });

      it('トークンなしでエラー', async () => {
        const result = await executeContactImportConfirm({
          intent: 'contact.import.confirm',
          confidence: 1.0,
          params: {},
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('確認トークンがありません');
      });
    });

    describe('executeContactImportCancel', () => {
      it('キャンセルメッセージを返す', () => {
        const result = executeContactImportCancel();

        expect(result.success).toBe(true);
        expect(result.message).toContain('キャンセルしました');
      });
    });

    describe('executeContactImportPersonSelect', () => {
      it('新規作成選択', async () => {
        const result = await executeContactImportPersonSelect({
          intent: 'contact.import.person_select',
          confidence: 1.0,
          params: {
            action: 'create_new',
            candidate_index: 0,
            confirmation_token: 'test-token',
          },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('新規作成として登録');
      });

      it('スキップ選択', async () => {
        const result = await executeContactImportPersonSelect({
          intent: 'contact.import.person_select',
          confidence: 1.0,
          params: {
            action: 'skip',
            candidate_index: 0,
            confirmation_token: 'test-token',
          },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('スキップ');
      });

      it('既存更新選択', async () => {
        const result = await executeContactImportPersonSelect({
          intent: 'contact.import.person_select',
          confidence: 1.0,
          params: {
            action: 'update_existing',
            candidate_index: 0,
            existing_id: 'c1',
            confirmation_token: 'test-token',
          },
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('更新');
      });
    });
  });

  describe('Pending Builder Tests', () => {
    describe('buildPendingContactImportConfirm', () => {
      it('正しい構造を生成', () => {
        const pending = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: {
            ok: [{ index: 0, display_name: '山田', email: 'yamada@example.com' }],
            missing_email: [],
            ambiguous: [],
          },
        });

        expect(pending.kind).toBe('pending.contact_import.confirm');
        expect(pending.threadId).toBe('test-thread');
        expect(pending.confirmation_token).toBe('test-token');
        expect(pending.all_ambiguous_resolved).toBe(true);
      });

      it('曖昧一致ありで all_ambiguous_resolved=false', () => {
        const pending = buildPendingContactImportConfirm('test-thread', {
          confirmation_token: 'test-token',
          source: 'text',
          preview: {
            ok: [],
            missing_email: [],
            ambiguous: [{
              index: 0,
              display_name: '山田',
              email: 'yamada@example.com',
              candidates: [],
              reason: 'same_name',
            }],
          },
        });

        expect(pending.all_ambiguous_resolved).toBe(false);
      });
    });

    describe('buildPendingPersonSelect', () => {
      it('正しい構造を生成', () => {
        const pending = buildPendingPersonSelect('test-thread', {
          confirmation_token: 'test-token',
          candidate_index: 0,
          input_name: '山田太郎',
          input_email: 'yamada@example.com',
          reason: 'same_name',
          options: [{ id: 'c1', display_name: '山田太郎', email: 'yamada@company.com' }],
        });

        expect(pending.kind).toBe('pending.person.select');
        expect(pending.threadId).toBe('test-thread');
        expect(pending.parent_kind).toBe('contact_import');
        expect(pending.allow_create_new).toBe(true);
        expect(pending.allow_skip).toBe(true);
      });
    });
  });
});
