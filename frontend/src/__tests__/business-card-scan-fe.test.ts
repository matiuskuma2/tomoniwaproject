/**
 * PR-D-3-FE: Business Card Scan Frontend E2E Tests
 * 
 * 名刺スキャンのフロントエンド接続テスト:
 *   E2E-BC-1: 名刺スキャン → pending → person_select → confirm → contacts増加
 *   E2E-BC-2: 名刺スキャン → cancel → contacts書き込みゼロ
 *   E2E-BC-3: emailなし名刺 → missing_email → confirm後もスキップ
 *   E2E-BC-4: buildPendingContactImportConfirm が business_card sourceで動作
 * 
 * contactsImportApi.businessCardScan をモック化
 * pending UI以降は既存テスト (contact-import-fe1) と同一フロー
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================
const mockBusinessCardScan = vi.fn();
const mockConfirm = vi.fn();
const mockCancel = vi.fn();
const mockPersonSelect = vi.fn();

vi.mock('../core/api/contacts', () => ({
  contactsImportApi: {
    businessCardScan: (...args: any[]) => mockBusinessCardScan(...args),
    confirm: (...args: any[]) => mockConfirm(...args),
    cancel: (...args: any[]) => mockCancel(...args),
    personSelect: (...args: any[]) => mockPersonSelect(...args),
    preview: vi.fn(),
  },
}));

vi.mock('../core/platform', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import {
  executeBusinessCardScan,
  executeContactImportConfirm,
  executeContactImportCancel,
  executeContactImportPersonSelect,
  buildPendingContactImportConfirm,
} from '../core/chat/executors/contactImport';

import type { BusinessCardScanResponse } from '../core/api/contacts';

// ============================================================
// Test Data
// ============================================================

const SCAN_RESPONSE_OK: BusinessCardScanResponse = {
  pending_action_id: 'pa-scan-001',
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  summary: {
    total_count: 2,
    exact_match_count: 0,
    ambiguous_count: 0,
    new_count: 2,
    skipped_count: 0,
    missing_email_count: 0,
    source: 'business_card',
    preview_entries: [
      { name: '田中太郎', email: 'tanaka@example.com', match_status: 'new' },
      { name: '佐藤花子', email: 'sato@example.com', match_status: 'new' },
    ],
  },
  parsed_entries: [
    { index: 0, name: '田中太郎', email: 'tanaka@example.com', missing_email: false, match_status: 'new', resolved_action: { type: 'create_new' } },
    { index: 1, name: '佐藤花子', email: 'sato@example.com', missing_email: false, match_status: 'new', resolved_action: { type: 'create_new' } },
  ],
  business_card_ids: ['bc-001', 'bc-002'],
  next_pending_kind: 'contact_import_confirm',
  message: '名刺の内容を確認してください。「はい」で確定します。',
};

const SCAN_RESPONSE_AMBIGUOUS: BusinessCardScanResponse = {
  pending_action_id: 'pa-scan-002',
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  summary: {
    total_count: 1,
    exact_match_count: 0,
    ambiguous_count: 1,
    new_count: 0,
    skipped_count: 0,
    missing_email_count: 0,
    source: 'business_card',
    preview_entries: [
      { name: '田中太郎', email: 'tanaka-new@example.com', match_status: 'ambiguous', candidate_count: 1 },
    ],
  },
  parsed_entries: [
    {
      index: 0, name: '田中太郎', email: 'tanaka-new@example.com', missing_email: false, match_status: 'ambiguous',
      ambiguous_candidates: [{ number: 1, contact_id: 'c-existing-1', display_name: '田中一郎', email: 'tanaka-old@example.com', score: 0.8 }],
    },
  ],
  business_card_ids: ['bc-003'],
  next_pending_kind: 'contact_import_person_select',
  message: '1件の曖昧な一致があります。番号を選択してください。',
};

const SCAN_RESPONSE_MISSING_EMAIL: BusinessCardScanResponse = {
  pending_action_id: 'pa-scan-003',
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  summary: {
    total_count: 2,
    exact_match_count: 0,
    ambiguous_count: 0,
    new_count: 1,
    skipped_count: 1,
    missing_email_count: 1,
    source: 'business_card',
    preview_entries: [
      { name: '山田一郎', email: 'yamada@example.com', match_status: 'new' },
      { name: '鈴木次郎', match_status: 'skipped' },
    ],
  },
  parsed_entries: [
    { index: 0, name: '山田一郎', email: 'yamada@example.com', missing_email: false, match_status: 'new', resolved_action: { type: 'create_new' } },
    { index: 1, name: '鈴木次郎', missing_email: true, match_status: 'skipped', resolved_action: { type: 'skip' } },
  ],
  business_card_ids: ['bc-004', 'bc-005'],
  next_pending_kind: 'contact_import_confirm',
  message: '2件中1件はメール未取得のためスキップされます。残りの内容を確認して「はい」で確定してください。',
};

// ============================================================
// Tests
// ============================================================

describe('PR-D-3-FE: Business Card Scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // E2E-BC-1: 名刺スキャン → pending → confirm → contacts増加
  it('E2E-BC-1: scan → pending → confirm → contacts増加', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_OK);
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 2,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [
        { id: 'c-1', display_name: '田中太郎', email: 'tanaka@example.com' },
        { id: 'c-2', display_name: '佐藤花子', email: 'sato@example.com' },
      ],
    });

    // Step 1: scan
    const fakeFile = new File(['fake'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([fakeFile]);
    expect(scanResult.success).toBe(true);
    expect(scanResult.data?.kind).toBe('contact_import.preview');
    expect(scanResult.data?.payload?.source).toBe('business_card');
    expect(scanResult.data?.payload?.business_card_ids).toEqual(['bc-001', 'bc-002']);
    expect(scanResult.data?.payload?.pending_action_id).toBe('pa-scan-001');
    expect(scanResult.message).toContain('名刺スキャン結果');

    // Step 2: confirm
    const confirmResult = await executeContactImportConfirm({
      intent: 'contact.import.confirm',
      confidence: 1,
      params: { pending_action_id: 'pa-scan-001' },
    });
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.data?.kind).toBe('contact_import.confirmed');
    expect(confirmResult.data?.payload?.created_count).toBe(2);
    expect(confirmResult.message).toContain('新規登録: 2件');
  });

  // E2E-BC-2: 名刺スキャン → cancel → 書き込みゼロ
  it('E2E-BC-2: scan → cancel → contacts書き込みゼロ', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_OK);
    mockCancel.mockResolvedValue({ success: true, message: 'キャンセルしました' });

    // Step 1: scan
    const fakeFile = new File(['fake'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([fakeFile]);
    expect(scanResult.success).toBe(true);

    // Step 2: cancel
    const cancelResult = await executeContactImportCancel(
      { intent: 'contact.import.cancel', confidence: 1, params: { pending_action_id: 'pa-scan-001' } }
    );
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.data?.kind).toBe('contact_import.cancelled');
    expect(cancelResult.message).toContain('キャンセル');

    // confirm は呼ばれていない
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  // E2E-BC-3: emailなし名刺 → missing_email → confirmでスキップ
  it('E2E-BC-3: scan emailなし → missing_email → confirm後スキップ', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_MISSING_EMAIL);
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 1,
      updated_count: 0,
      skipped_count: 1,
      created_contacts: [
        { id: 'c-1', display_name: '山田一郎', email: 'yamada@example.com' },
      ],
    });

    // Step 1: scan
    const fakeFile = new File(['fake'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([fakeFile]);
    expect(scanResult.success).toBe(true);
    expect(scanResult.data?.payload?.summary?.missing_email_count).toBe(1);
    // メール欠損の旨がメッセージに含まれる
    expect(scanResult.message).toContain('メールなし');

    // Step 2: confirm
    const confirmResult = await executeContactImportConfirm({
      intent: 'contact.import.confirm',
      confidence: 1,
      params: { pending_action_id: 'pa-scan-003' },
    });
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.data?.payload?.created_count).toBe(1);
    expect(confirmResult.data?.payload?.skipped_count).toBe(1);
  });

  // E2E-BC-4: buildPendingContactImportConfirm が business_card sourceで動作
  it('E2E-BC-4: buildPendingContactImportConfirm with business_card source', () => {
    const pending = buildPendingContactImportConfirm('thread-1', {
      pending_action_id: 'pa-scan-001',
      source: 'business_card',
      summary: SCAN_RESPONSE_OK.summary,
      parsed_entries: SCAN_RESPONSE_OK.parsed_entries,
      next_pending_kind: 'contact_import_confirm',
    });

    expect(pending.kind).toBe('pending.contact_import.confirm');
    expect(pending.threadId).toBe('thread-1');
    expect(pending.source).toBe('business_card');
    expect((pending as any).pending_action_id).toBe('pa-scan-001');
  });

  // E2E-BC-5: 曖昧一致 → person_select 必須
  it('E2E-BC-5: scan ambiguous → person_select → confirm', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_AMBIGUOUS);
    mockPersonSelect.mockResolvedValue({
      updated_entry: { index: 0, name: '田中太郎', match_status: 'new', resolved_action: { type: 'create_new' } },
      all_resolved: true,
      remaining_unresolved: 0,
      next_pending_kind: 'contact_import_confirm',
      message: 'すべての曖昧一致が解決しました。',
    });
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 1,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [{ id: 'c-1', display_name: '田中太郎', email: 'tanaka-new@example.com' }],
    });

    // Step 1: scan (ambiguous)
    const fakeFile = new File(['fake'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([fakeFile]);
    expect(scanResult.success).toBe(true);
    expect(scanResult.data?.payload?.next_pending_kind).toBe('contact_import_person_select');
    expect(scanResult.message).toContain('曖昧一致');

    // Step 2: person_select
    const selectResult = await executeContactImportPersonSelect(
      {
        intent: 'contact.import.person_select',
        confidence: 1,
        params: {
          pending_action_id: 'pa-scan-002',
          candidate_index: 0,
          action: 'create_new',
        },
      }
    );
    expect(selectResult.success).toBe(true);
    expect(selectResult.data?.kind).toBe('contact_import.person_selected');
    expect(selectResult.data?.payload?.all_resolved).toBe(true);

    // Step 3: confirm
    const confirmResult = await executeContactImportConfirm({
      intent: 'contact.import.confirm',
      confidence: 1,
      params: { pending_action_id: 'pa-scan-002' },
    });
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.data?.payload?.created_count).toBe(1);
  });

  // E2E-BC-6: 空画像 → エラー
  it('E2E-BC-6: no images → error', async () => {
    const result = await executeBusinessCardScan([]);
    expect(result.success).toBe(false);
    expect(result.message).toContain('名刺画像を選択');
  });
});
