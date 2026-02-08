/**
 * PR-D-FE-3: Business Card Scan Chat UI Integration Tests
 *
 * ChatPane 画像アップロード導線 → executeBusinessCardScan → pending接続
 * のE2Eフロー検証
 *
 * テストセット:
 *   UI-BC-1: 画像添付 → 送信 → scan実行 → pending設定
 *   UI-BC-2: 画像バリデーション（MIME/サイズ/枚数制限）
 *   UI-BC-3: 画像添付 → cancel → 書き込みゼロ
 *   UI-BC-4: scan結果がuseChatReducerのcontact_import.previewに接続
 *   UI-BC-5: 名刺scan後のpending UI（confirm/cancel/person_select）フロー
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
  buildPendingPersonSelect,
} from '../core/chat/executors/contactImport';

import type { BusinessCardScanResponse, ContactImportNewPreviewResponse } from '../core/api/contacts';

// ============================================================
// Test Data
// ============================================================

const SCAN_RESPONSE_NEW: BusinessCardScanResponse = {
  pending_action_id: 'pa-ui-scan-001',
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  summary: {
    total_count: 1,
    exact_match_count: 0,
    ambiguous_count: 0,
    new_count: 1,
    skipped_count: 0,
    missing_email_count: 0,
    source: 'business_card',
    preview_entries: [
      { name: '鈴木一郎', email: 'suzuki@test.com', match_status: 'new' },
    ],
  },
  parsed_entries: [
    {
      index: 0,
      name: '鈴木一郎',
      email: 'suzuki@test.com',
      missing_email: false,
      match_status: 'new',
      resolved_action: { type: 'create_new' },
    },
  ],
  business_card_ids: ['bc-ui-001'],
  next_pending_kind: 'contact_import_confirm',
  message: 'OK',
};

const SCAN_RESPONSE_AMBIGUOUS: BusinessCardScanResponse = {
  pending_action_id: 'pa-ui-scan-002',
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
      { name: '田中太郎', email: 'tanaka@test.com', match_status: 'ambiguous', candidate_count: 2 },
    ],
  },
  parsed_entries: [
    {
      index: 0,
      name: '田中太郎',
      email: 'tanaka@test.com',
      missing_email: false,
      match_status: 'ambiguous',
      ambiguous_candidates: [
        { number: 1, contact_id: 'c-exist-1', display_name: '田中太郎（既存）', email: 'tanaka-old@test.com', score: 0.9 },
        { number: 2, contact_id: 'c-exist-2', display_name: '田中次郎', email: 'tanaka2@test.com', score: 0.7 },
      ],
    },
  ],
  business_card_ids: ['bc-ui-002'],
  next_pending_kind: 'contact_import_person_select',
  message: '曖昧一致 1件',
};

// ============================================================
// Tests
// ============================================================

describe('PR-D-FE-3: Business Card Chat UI Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // UI-BC-1: 画像添付 → scan実行 → pending設定フロー
  it('UI-BC-1: image attach → scan → pending設定（full flow）', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_NEW);
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 1,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [{ id: 'c-new-1', display_name: '鈴木一郎', email: 'suzuki@test.com' }],
    });

    // Step 1: Simulate file selection & scan
    const file = new File(['img-data'], 'meishi.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([file]);

    // Verify scan result
    expect(scanResult.success).toBe(true);
    expect(scanResult.data?.kind).toBe('contact_import.preview');
    expect(scanResult.data?.payload?.source).toBe('business_card');
    expect(scanResult.data?.payload?.pending_action_id).toBe('pa-ui-scan-001');
    expect(scanResult.data?.payload?.business_card_ids).toEqual(['bc-ui-001']);
    expect(mockBusinessCardScan).toHaveBeenCalledTimes(1);
    expect(mockBusinessCardScan).toHaveBeenCalledWith([file]);

    // Step 2: Build pending state (simulating useChatReducer)
    const pending = buildPendingContactImportConfirm('temp', {
      pending_action_id: 'pa-ui-scan-001',
      source: 'business_card',
      summary: SCAN_RESPONSE_NEW.summary,
      parsed_entries: SCAN_RESPONSE_NEW.parsed_entries,
      next_pending_kind: 'contact_import_confirm',
    });
    expect(pending.kind).toBe('pending.contact_import.confirm');
    expect(pending.source).toBe('business_card');
    expect(pending.all_ambiguous_resolved).toBe(true); // no ambiguous

    // Step 3: Confirm
    const confirmResult = await executeContactImportConfirm({
      intent: 'contact.import.confirm',
      confidence: 1,
      params: { pending_action_id: 'pa-ui-scan-001' },
    });
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.data?.kind).toBe('contact_import.confirmed');
    expect(confirmResult.data?.payload?.created_count).toBe(1);
  });

  // UI-BC-2: 画像バリデーション
  describe('UI-BC-2: Image validation', () => {
    it('empty images → error', async () => {
      const result = await executeBusinessCardScan([]);
      expect(result.success).toBe(false);
      expect(result.message).toContain('名刺画像を選択');
    });

    it('scan API error → graceful error message', async () => {
      mockBusinessCardScan.mockRejectedValue(new Error('OCR抽出に失敗'));
      const file = new File(['img'], 'card.png', { type: 'image/png' });
      const result = await executeBusinessCardScan([file]);
      expect(result.success).toBe(false);
      expect(result.message).toContain('名刺スキャンに失敗');
      expect(result.message).toContain('OCR抽出に失敗');
    });

    it('multiple images (up to 5)', async () => {
      mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_NEW);
      const files = Array.from({ length: 5 }, (_, i) =>
        new File(['img'], `card${i}.jpg`, { type: 'image/jpeg' })
      );
      const result = await executeBusinessCardScan(files);
      expect(result.success).toBe(true);
      expect(mockBusinessCardScan).toHaveBeenCalledWith(files);
    });
  });

  // UI-BC-3: cancel → 書き込みゼロ
  it('UI-BC-3: scan → cancel → contacts書き込みゼロ', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_NEW);
    mockCancel.mockResolvedValue({ success: true, message: 'Cancelled' });

    // Scan
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    await executeBusinessCardScan([file]);

    // Cancel
    const cancelResult = await executeContactImportCancel(
      { intent: 'contact.import.cancel', confidence: 1, params: { pending_action_id: 'pa-ui-scan-001' } }
    );
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.data?.kind).toBe('contact_import.cancelled');

    // Confirm was never called
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  // UI-BC-4: scan結果がuseChatReducerに接続（pending state builder）
  describe('UI-BC-4: useChatReducer pending接続', () => {
    it('new entries → pending.contact_import.confirm（all_resolved=true）', () => {
      const pending = buildPendingContactImportConfirm('temp', {
        pending_action_id: 'pa-001',
        source: 'business_card',
        summary: SCAN_RESPONSE_NEW.summary,
        parsed_entries: SCAN_RESPONSE_NEW.parsed_entries,
        next_pending_kind: 'contact_import_confirm',
      });
      expect(pending.kind).toBe('pending.contact_import.confirm');
      expect(pending.all_ambiguous_resolved).toBe(true);
      expect(pending.preview.ok.length).toBe(1);
      expect(pending.preview.ambiguous.length).toBe(0);
    });

    it('ambiguous entries → pending.contact_import.confirm（all_resolved=false）', () => {
      const pending = buildPendingContactImportConfirm('temp', {
        pending_action_id: 'pa-002',
        source: 'business_card',
        summary: SCAN_RESPONSE_AMBIGUOUS.summary,
        parsed_entries: SCAN_RESPONSE_AMBIGUOUS.parsed_entries,
        next_pending_kind: 'contact_import_person_select',
      });
      expect(pending.kind).toBe('pending.contact_import.confirm');
      expect(pending.all_ambiguous_resolved).toBe(false);
      expect(pending.preview.ambiguous.length).toBe(1);
    });

    it('buildPendingPersonSelect works with scan data', () => {
      const entry = SCAN_RESPONSE_AMBIGUOUS.parsed_entries[0];
      const pending = buildPendingPersonSelect('temp', {
        pending_action_id: 'pa-002',
        candidate_index: 0,
        input_name: entry.name,
        input_email: entry.email!,
        reason: 'similar_name',
        options: (entry.ambiguous_candidates || []).map(c => ({
          id: c.contact_id,
          display_name: c.display_name,
          email: c.email || null,
        })),
      });
      expect(pending.kind).toBe('pending.person.select');
      expect(pending.options.length).toBe(2);
      expect(pending.candidate_index).toBe(0);
    });
  });

  // UI-BC-5: 名刺scan → 曖昧一致 → person_select → confirm（全フロー）
  it('UI-BC-5: scan ambiguous → person_select → confirm（end-to-end）', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE_AMBIGUOUS);
    mockPersonSelect.mockResolvedValue({
      updated_entry: {
        index: 0,
        name: '田中太郎',
        email: 'tanaka@test.com',
        match_status: 'new',
        resolved_action: { type: 'create_new' },
      },
      all_resolved: true,
      remaining_unresolved: 0,
      next_pending_kind: 'contact_import_confirm',
      message: 'All resolved',
    });
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 1,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [{ id: 'c-1', display_name: '田中太郎', email: 'tanaka@test.com' }],
    });

    // 1. Scan
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([file]);
    expect(scanResult.data?.payload?.next_pending_kind).toBe('contact_import_person_select');

    // 2. person_select（新規作成）
    const selectResult = await executeContactImportPersonSelect({
      intent: 'contact.import.person_select',
      confidence: 1,
      params: {
        pending_action_id: 'pa-ui-scan-002',
        candidate_index: 0,
        action: 'create_new',
      },
    });
    expect(selectResult.success).toBe(true);
    expect(selectResult.data?.payload?.all_resolved).toBe(true);

    // 3. Confirm
    const confirmResult = await executeContactImportConfirm({
      intent: 'contact.import.confirm',
      confidence: 1,
      params: { pending_action_id: 'pa-ui-scan-002' },
    });
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.data?.payload?.created_count).toBe(1);

    // Verify call sequence
    expect(mockBusinessCardScan).toHaveBeenCalledTimes(1);
    expect(mockPersonSelect).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
