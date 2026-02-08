/**
 * PR-D-FE-3.1: Post-Import Next Step Tests
 *
 * 名刺取り込み完了後の「次手チャット分岐」テスト:
 *   NX-1: classifyUploadIntent — 招待意図の抽出
 *   NX-2: classifyUploadIntent — 日程調整意図の抽出
 *   NX-3: classifyUploadIntent — 登録だけ（message_only）意図の抽出
 *   NX-4: classifyUploadIntent — 空テキスト → unknown
 *   NX-5: classifyUploadIntent — 曖昧テキスト → unknown + message保持
 *   NX-6: buildPostImportNextStepMessage — send_invite
 *   NX-7: buildPostImportNextStepMessage — schedule
 *   NX-8: buildPostImportNextStepMessage — message_only
 *   NX-9: buildPostImportNextStepMessage — unknown（3択提示）
 *   NX-10: parseNextStepSelection — 番号選択（1=invite, 2=schedule, 3=完了）
 *   NX-11: parseNextStepSelection — はい/いいえ（intent明確時）
 *   NX-12: parseNextStepSelection — キーワードマッチ
 *   NX-13: executeBusinessCardScan — contextが結果に含まれる
 *   NX-14: executeContactImportConfirm — contextあり→次手メッセージ
 *   NX-15: E2E: scan(intent=invite) → confirm → next_step pending → 選択 → 完了
 *   NX-16: 事故ゼロ: 次手フローでは何も書き込まない（confirm以外writes=0）
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
  classifyUploadIntent,
  buildPostImportNextStepMessage,
  parseNextStepSelection,
  executeBusinessCardScan,
  executeContactImportConfirm,
  buildPendingContactImportConfirm,
  executePostImportNextStepDecide,
} from '../core/chat/executors/contactImport';

import type { BusinessCardScanResponse } from '../core/api/contacts';
import type { ContactImportContext } from '../core/chat/executors/types';

// ============================================================
// Test Data
// ============================================================
const SCAN_RESPONSE: BusinessCardScanResponse = {
  pending_action_id: 'pa-nx-001',
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
      { name: '鈴木一郎', email: 'suzuki@test.com', match_status: 'new' },
      { name: '佐藤花子', email: 'sato@test.com', match_status: 'new' },
    ],
  },
  parsed_entries: [
    { index: 0, name: '鈴木一郎', email: 'suzuki@test.com', missing_email: false, match_status: 'new', resolved_action: { type: 'create_new' } },
    { index: 1, name: '佐藤花子', email: 'sato@test.com', missing_email: false, match_status: 'new', resolved_action: { type: 'create_new' } },
  ],
  business_card_ids: ['bc-nx-001', 'bc-nx-002'],
  next_pending_kind: 'contact_import_confirm',
  message: 'OK',
};

const IMPORT_SUMMARY = {
  created_count: 2,
  updated_count: 0,
  skipped_count: 0,
  imported_contacts: [
    { display_name: '鈴木一郎', email: 'suzuki@test.com' },
    { display_name: '佐藤花子', email: 'sato@test.com' },
  ],
};

// ============================================================
// Tests
// ============================================================

describe('PR-D-FE-3.1: classifyUploadIntent', () => {
  // NX-1: 招待意図
  it('NX-1: "招待を送りたい" → send_invite', () => {
    const result = classifyUploadIntent('この人に招待を送りたい');
    expect(result.intent).toBe('send_invite');
    expect(result.message).toBe('この人に招待を送りたい');
  });

  it('NX-1b: "invite send" → send_invite', () => {
    expect(classifyUploadIntent('Please send invite').intent).toBe('send_invite');
  });

  it('NX-1c: "メール送って" → send_invite', () => {
    expect(classifyUploadIntent('メール送って').intent).toBe('send_invite');
  });

  // NX-2: 日程調整意図
  it('NX-2: "日程調整したい" → schedule', () => {
    const result = classifyUploadIntent('この人と日程調整したい');
    expect(result.intent).toBe('schedule');
    expect(result.message).toBe('この人と日程調整したい');
  });

  it('NX-2b: "ミーティング設定して" → schedule', () => {
    expect(classifyUploadIntent('ミーティング設定して').intent).toBe('schedule');
  });

  it('NX-2c: "schedule a meeting" → schedule', () => {
    expect(classifyUploadIntent('schedule a meeting').intent).toBe('schedule');
  });

  // NX-3: 登録だけ
  it('NX-3: "登録だけ" → message_only', () => {
    const result = classifyUploadIntent('登録だけ');
    expect(result.intent).toBe('message_only');
  });

  it('NX-3b: "取り込みだけ" → message_only', () => {
    expect(classifyUploadIntent('取り込みだけ').intent).toBe('message_only');
  });

  // NX-4: 空テキスト
  it('NX-4: empty → unknown, no message', () => {
    const result = classifyUploadIntent('');
    expect(result.intent).toBe('unknown');
    expect(result.message).toBeUndefined();
  });

  it('NX-4b: whitespace only → unknown', () => {
    expect(classifyUploadIntent('   ').intent).toBe('unknown');
  });

  // NX-5: 曖昧テキスト
  it('NX-5: "よろしく" → unknown + message保持', () => {
    const result = classifyUploadIntent('よろしく');
    expect(result.intent).toBe('unknown');
    expect(result.message).toBe('よろしく');
  });

  it('NX-5b: 複数マッチ → unknown', () => {
    // "招待" + "日程" の両方にマッチ → unknown
    const result = classifyUploadIntent('招待して日程調整');
    expect(result.intent).toBe('unknown');
    expect(result.message).toBe('招待して日程調整');
  });
});

describe('PR-D-FE-3.1: buildPostImportNextStepMessage', () => {
  // NX-6: send_invite
  it('NX-6: send_invite → 招待送信の確認メッセージ', () => {
    const msg = buildPostImportNextStepMessage('send_invite', IMPORT_SUMMARY);
    expect(msg).toContain('連絡先取り込み完了');
    expect(msg).toContain('招待を送ります');
    expect(msg).toContain('鈴木一郎');
    expect(msg).toContain('「はい」');
  });

  // NX-7: schedule
  it('NX-7: schedule → 日程調整の確認メッセージ', () => {
    const msg = buildPostImportNextStepMessage('schedule', IMPORT_SUMMARY);
    expect(msg).toContain('連絡先取り込み完了');
    expect(msg).toContain('日程調整');
    expect(msg).toContain('鈴木一郎');
    expect(msg).toContain('「はい」');
  });

  // NX-8: message_only
  it('NX-8: message_only → 完了メッセージのみ', () => {
    const msg = buildPostImportNextStepMessage('message_only', IMPORT_SUMMARY);
    expect(msg).toContain('連絡先取り込み完了');
    expect(msg).toContain('鈴木一郎');
    expect(msg).not.toContain('「はい」');
  });

  // NX-9: unknown → 3択
  it('NX-9: unknown → 3択の選択肢提示', () => {
    const msg = buildPostImportNextStepMessage('unknown', IMPORT_SUMMARY);
    expect(msg).toContain('連絡先取り込み完了');
    expect(msg).toContain('次は何をしますか');
    expect(msg).toContain('1️⃣');
    expect(msg).toContain('2️⃣');
    expect(msg).toContain('3️⃣');
  });

  // 3名超の場合
  it('NX-9b: 4名以上 → "他N名" 表示', () => {
    const summary = {
      ...IMPORT_SUMMARY,
      imported_contacts: [
        { display_name: 'A', email: 'a@test.com' },
        { display_name: 'B', email: 'b@test.com' },
        { display_name: 'C', email: 'c@test.com' },
        { display_name: 'D', email: 'd@test.com' },
      ],
    };
    const msg = buildPostImportNextStepMessage('unknown', summary);
    expect(msg).toContain('他1名');
  });
});

describe('PR-D-FE-3.1: parseNextStepSelection', () => {
  // NX-10: 番号選択
  it('NX-10a: "1" → send_invite', () => {
    expect(parseNextStepSelection('1', 'unknown').action).toBe('send_invite');
  });

  it('NX-10b: "2" → schedule', () => {
    expect(parseNextStepSelection('2', 'unknown').action).toBe('schedule');
  });

  it('NX-10c: "3" → completed', () => {
    expect(parseNextStepSelection('3', 'unknown').action).toBe('completed');
  });

  // NX-11: はい/いいえ
  it('NX-11a: "はい" + intent=send_invite → send_invite', () => {
    expect(parseNextStepSelection('はい', 'send_invite').action).toBe('send_invite');
  });

  it('NX-11b: "はい" + intent=schedule → schedule', () => {
    expect(parseNextStepSelection('はい', 'schedule').action).toBe('schedule');
  });

  it('NX-11c: "いいえ" + intent=send_invite → completed', () => {
    expect(parseNextStepSelection('いいえ', 'send_invite').action).toBe('completed');
  });

  it('NX-11d: "キャンセル" → completed', () => {
    expect(parseNextStepSelection('キャンセル', 'unknown').action).toBe('completed');
  });

  it('NX-11e: "完了" → completed', () => {
    expect(parseNextStepSelection('完了', 'schedule').action).toBe('completed');
  });

  // NX-12: キーワードマッチ
  it('NX-12a: "招待送って" → send_invite', () => {
    expect(parseNextStepSelection('招待送って', 'unknown').action).toBe('send_invite');
  });

  it('NX-12b: "日程調整" → schedule', () => {
    expect(parseNextStepSelection('日程調整', 'unknown').action).toBe('schedule');
  });

  it('NX-12c: 不明テキスト → unclear', () => {
    expect(parseNextStepSelection('あああ', 'unknown').action).toBe('unclear');
  });
});

describe('PR-D-FE-3.1: executeBusinessCardScan with context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NX-13: contextがscan結果に含まれる
  it('NX-13: context付きscan → payload.contact_import_context', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE);
    const context: ContactImportContext = { intent: 'send_invite', message: '招待送りたい' };
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    const result = await executeBusinessCardScan([file], context);

    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe('contact_import.preview');
    expect(result.data?.payload?.contact_import_context).toEqual(context);
  });

  it('NX-13b: contextなし → payload.contact_import_context=undefined', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE);
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    const result = await executeBusinessCardScan([file]);

    expect(result.success).toBe(true);
    expect(result.data?.payload?.contact_import_context).toBeUndefined();
  });
});

describe('PR-D-FE-3.1: executeContactImportConfirm with context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NX-14: context付きconfirm → 次手メッセージ
  it('NX-14: context=send_invite → 次手メッセージに招待確認', async () => {
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 2,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [
        { id: 'c-1', display_name: '鈴木一郎', email: 'suzuki@test.com' },
        { id: 'c-2', display_name: '佐藤花子', email: 'sato@test.com' },
      ],
    });

    const pending = buildPendingContactImportConfirm('temp', {
      pending_action_id: 'pa-nx-001',
      source: 'business_card',
      summary: SCAN_RESPONSE.summary,
      parsed_entries: SCAN_RESPONSE.parsed_entries,
      next_pending_kind: 'contact_import_confirm',
    });
    // contextを付与
    (pending as any).contact_import_context = { intent: 'send_invite', message: '招待送りたい' };

    const result = await executeContactImportConfirm(
      { intent: 'contact.import.confirm', confidence: 1, params: { pending_action_id: 'pa-nx-001' } },
      { pendingForThread: pending as any },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('連絡先取り込み完了');
    expect(result.message).toContain('招待');
    expect(result.data?.payload?.contact_import_context).toEqual({ intent: 'send_invite', message: '招待送りたい' });
    expect(result.data?.payload?.imported_contacts).toHaveLength(2);
  });

  // NX-14b: contextなし → 従来のメッセージ
  it('NX-14b: contextなし → 従来のconfirmメッセージ', async () => {
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 1,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [{ id: 'c-1', display_name: '鈴木一郎', email: 'suzuki@test.com' }],
    });

    const result = await executeContactImportConfirm(
      { intent: 'contact.import.confirm', confidence: 1, params: { pending_action_id: 'pa-nx-002' } },
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('連絡先取り込み完了');
    expect(result.message).toContain('新規登録: 1件');
    expect(result.data?.payload?.contact_import_context).toBeUndefined();
  });
});

describe('PR-D-FE-3.1: E2E - scan with intent → confirm → next_step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NX-15: E2E フルフロー
  it('NX-15: scan(intent=invite) → confirm → next_step pending ready', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE);
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 2,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [
        { id: 'c-1', display_name: '鈴木一郎', email: 'suzuki@test.com' },
        { id: 'c-2', display_name: '佐藤花子', email: 'sato@test.com' },
      ],
    });

    // 1. Scan with intent
    const context: ContactImportContext = { intent: 'send_invite', message: '招待送って' };
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([file], context);

    expect(scanResult.data?.payload?.contact_import_context).toEqual(context);

    // 2. Build pending (simulating useChatReducer)
    const pending = buildPendingContactImportConfirm('temp', {
      pending_action_id: 'pa-nx-001',
      source: 'business_card',
      summary: SCAN_RESPONSE.summary,
      parsed_entries: SCAN_RESPONSE.parsed_entries,
      next_pending_kind: 'contact_import_confirm',
    });
    (pending as any).contact_import_context = context;

    // 3. Confirm
    const confirmResult = await executeContactImportConfirm(
      { intent: 'contact.import.confirm', confidence: 1, params: { pending_action_id: 'pa-nx-001' } },
      { pendingForThread: pending as any },
    );

    // Confirm結果にcontextが含まれる → useChatReducerが次手pendingをセット可能
    expect(confirmResult.data?.kind).toBe('contact_import.confirmed');
    expect(confirmResult.data?.payload?.contact_import_context).toEqual(context);
    expect(confirmResult.data?.payload?.imported_contacts).toHaveLength(2);
    expect(confirmResult.data?.payload?.created_count).toBe(2);

    // 4. Next step selection (simulated)
    const selection = parseNextStepSelection('はい', 'send_invite');
    expect(selection.action).toBe('send_invite');
  });

  // NX-16: 事故ゼロ
  it('NX-16: 次手フローではconfirm以外writes=0', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE);

    // Scan with unknown intent
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    await executeBusinessCardScan([file], { intent: 'unknown' });

    // verify: cancel was never called, confirm was never called
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();

    // Next step selection → completed
    const selection = parseNextStepSelection('3', 'unknown');
    expect(selection.action).toBe('completed');
    // No writes happened → ゼロ writes confirmed
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

// ============================================================
// PR-D-FE-4: executePostImportNextStepDecide Integration Tests
// ============================================================

describe('PR-D-FE-4: executePostImportNextStepDecide', () => {
  // FE4-1: 「はい」+ intent=send_invite → selected(send_invite) + メール一覧
  it('FE4-1: "はい" + intent=send_invite → send_invite selected', () => {
    const result = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: 'はい',
        currentIntent: 'send_invite',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe('post_import.next_step.selected');
    expect(result.data?.payload?.action).toBe('send_invite');
    expect(result.data?.payload?.emails).toEqual(['suzuki@test.com', 'sato@test.com']);
    expect(result.message).toContain('招待');
    // 事故ゼロ: APIコールなし
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  // FE4-2: 「2」+ intent=unknown → schedule selected
  it('FE4-2: "2" + intent=unknown → schedule selected', () => {
    const result = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: '2',
        currentIntent: 'unknown',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe('post_import.next_step.selected');
    expect(result.data?.payload?.action).toBe('schedule');
    expect(result.message).toContain('日程調整');
  });

  // FE4-3: 「3」+ intent=unknown → completed (cancelled)
  it('FE4-3: "3" + intent=unknown → completed', () => {
    const result = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: '3',
        currentIntent: 'unknown',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe('post_import.next_step.cancelled');
    expect(result.message).toContain('完了');
  });

  // FE4-4: 「いいえ」+ intent=schedule → completed
  it('FE4-4: "いいえ" + intent=schedule → completed', () => {
    const result = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: 'いいえ',
        currentIntent: 'schedule',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.kind).toBe('post_import.next_step.cancelled');
  });

  // FE4-5: 不明入力 → ガイダンス再表示（pendingクリアしない）
  it('FE4-5: unclear input → guidance with needsClarification', () => {
    const result = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: 'あああ',
        currentIntent: 'unknown',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined(); // pendingクリアしない
    expect(result.needsClarification).toBeDefined();
    expect(result.message).toContain('1️⃣');
    expect(result.message).toContain('2️⃣');
    expect(result.message).toContain('3️⃣');
  });

  // FE4-6: intent=send_invite で不明入力 → 招待専用ガイダンス
  it('FE4-6: unclear input + intent=send_invite → invite guidance', () => {
    const result = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: 'あああ',
        currentIntent: 'send_invite',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(result.message).toContain('招待を送りますか');
    expect(result.message).toContain('「はい」');
  });

  // FE4-7: E2E フルフロー: scan(intent) → confirm → next_step → decide → selected
  it('FE4-7: E2E: scan→confirm→next_step decide→selected', async () => {
    mockBusinessCardScan.mockResolvedValue(SCAN_RESPONSE);
    mockConfirm.mockResolvedValue({
      success: true,
      created_count: 2,
      updated_count: 0,
      skipped_count: 0,
      created_contacts: [
        { id: 'c-1', display_name: '鈴木一郎', email: 'suzuki@test.com' },
        { id: 'c-2', display_name: '佐藤花子', email: 'sato@test.com' },
      ],
    });

    // 1. Scan with intent
    const context: ContactImportContext = { intent: 'schedule', message: '日程調整したい' };
    const file = new File(['img'], 'card.jpg', { type: 'image/jpeg' });
    const scanResult = await executeBusinessCardScan([file], context);
    expect(scanResult.data?.payload?.contact_import_context).toEqual(context);

    // 2. Build pending → confirm
    const pending = buildPendingContactImportConfirm('temp', {
      pending_action_id: 'pa-nx-001',
      source: 'business_card',
      summary: SCAN_RESPONSE.summary,
      parsed_entries: SCAN_RESPONSE.parsed_entries,
      next_pending_kind: 'contact_import_confirm',
    });
    (pending as any).contact_import_context = context;

    const confirmResult = await executeContactImportConfirm(
      { intent: 'contact.import.confirm', confidence: 1, params: { pending_action_id: 'pa-nx-001' } },
      { pendingForThread: pending as any },
    );
    expect(confirmResult.data?.kind).toBe('contact_import.confirmed');

    // 3. Next step decide: 「はい」
    const decideResult = executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: 'はい',
        currentIntent: 'schedule',
        importSummary: {
          created_count: 2,
          updated_count: 0,
          skipped_count: 0,
          imported_contacts: [
            { display_name: '鈴木一郎', email: 'suzuki@test.com' },
            { display_name: '佐藤花子', email: 'sato@test.com' },
          ],
        },
        source: 'business_card',
      },
    });

    expect(decideResult.success).toBe(true);
    expect(decideResult.data?.kind).toBe('post_import.next_step.selected');
    expect(decideResult.data?.payload?.action).toBe('schedule');
    expect(decideResult.data?.payload?.emails).toEqual(['suzuki@test.com', 'sato@test.com']);
    expect(decideResult.message).toContain('日程調整');
  });

  // FE4-8: 事故ゼロ確認 — executePostImportNextStepDecide は APIコールゼロ
  it('FE4-8: 事故ゼロ — API calls = 0', () => {
    vi.clearAllMocks();

    executePostImportNextStepDecide({
      intent: 'post_import.next_step.decide' as any,
      confidence: 1,
      params: {
        userInput: 'はい',
        currentIntent: 'send_invite',
        importSummary: IMPORT_SUMMARY,
        source: 'business_card',
      },
    });

    // 全APIモックがコールされていないこと
    expect(mockBusinessCardScan).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockPersonSelect).not.toHaveBeenCalled();
  });
});
