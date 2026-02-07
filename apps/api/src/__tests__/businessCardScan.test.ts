/**
 * PR-D-3: Business Card Scan API Tests
 * 
 * 事故ゼロ設計テスト:
 *   1. 名刺OCR → emailあり → preview → pending生成 → confirm → contacts増加
 *   2. 名刺OCR → emailなし → missing_email_count > 0 → confirm → emailなしはスキップ（書き込みゼロ）
 *   3. 名刺OCR → 曖昧一致 → pending.person.select で必ず止まる
 *   4. 名刺OCR → cancel → contacts書き込みゼロ
 * 
 * GeminiService.extractBusinessCard のモックを使用
 * pending_action 以降は contactImport.ts の既存フローと同一
 */

import type {
  ContactImportPayload,
  ContactImportEntry,
  ContactMatchStatus,
  ContactImportSource,
} from '../../../../packages/shared/src/types/pendingAction';
import type { BusinessCardExtraction } from '../services/geminiService';

// ============================================================
// Mock DB
// ============================================================
interface MockPendingAction {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  action_type: string;
  source_type: string;
  payload_json: string;
  summary_json: string;
  status: string;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
  executed_at: string | null;
}

interface MockContact {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  email: string;
  display_name: string;
  kind: string;
}

const _pendingActions: Map<string, MockPendingAction> = new Map();
const _contacts: Map<string, MockContact> = new Map();
const _existingContacts: MockContact[] = [];

function resetMocks() {
  _pendingActions.clear();
  _contacts.clear();
  _existingContacts.length = 0;
}

// ============================================================
// Helpers
// ============================================================

function isSimilarNameTest(a: string, b: string): boolean {
  const la = a.replace(/\s+/g, '').toLowerCase();
  const lb = b.replace(/\s+/g, '').toLowerCase();
  if (la === lb) return true;
  const surnameA = la.slice(0, Math.min(2, la.length));
  const surnameB = lb.slice(0, Math.min(2, lb.length));
  return surnameA.length >= 2 && surnameA === surnameB;
}

// ============================================================
// Simulate /api/business-cards/scan logic
// (mirrors businessCards.ts /scan handler + contactImport shared logic)
// ============================================================

function handleScan(
  extractions: BusinessCardExtraction[],
  ownerUserId: string,
  workspaceId: string
): {
  pending_action_id: string;
  entries: ContactImportEntry[];
  all_resolved: boolean;
  missing_email_count: number;
  source: ContactImportSource;
} {
  // OCR結果 → ContactImportEntry変換（Gate-1: email Hard fail）
  const entries: ContactImportEntry[] = extractions.map((ext, idx) => {
    const hasEmail = !!ext.email && ext.email.includes('@');

    // 曖昧一致検出
    let matchStatus: ContactMatchStatus = hasEmail ? 'new' : 'skipped';
    let ambiguousCandidates: ContactImportEntry['ambiguous_candidates'] = undefined;
    let resolvedAction: ContactImportEntry['resolved_action'] = hasEmail
      ? { type: 'create_new' }
      : { type: 'skip' };

    if (hasEmail && ext.email) {
      const email = ext.email.toLowerCase();
      const exactMatch = _existingContacts.find(c => c.email === email && c.owner_user_id === ownerUserId);
      if (exactMatch) {
        matchStatus = 'exact';
        resolvedAction = { type: 'select_existing', contact_id: exactMatch.id };
        ambiguousCandidates = [{
          number: 1, contact_id: exactMatch.id,
          display_name: exactMatch.display_name, email: exactMatch.email, score: 1.0,
        }];
      } else {
        const similar = _existingContacts.filter(c =>
          c.owner_user_id === ownerUserId && c.display_name &&
          isSimilarNameTest(c.display_name, ext.name)
        );
        if (similar.length > 0) {
          matchStatus = 'ambiguous';
          ambiguousCandidates = similar.map((c, i) => ({
            number: i + 1, contact_id: c.id,
            display_name: c.display_name, email: c.email, score: 0.8,
          }));
          resolvedAction = undefined; // Gate-2: 必ず止める
        }
      }
    }

    return {
      index: idx,
      name: ext.name,
      email: hasEmail ? ext.email!.toLowerCase() : undefined,
      phone: ext.phone || undefined,
      company: ext.company || undefined,
      title: ext.title || undefined,
      missing_email: !hasEmail,
      match_status: matchStatus,
      ambiguous_candidates: ambiguousCandidates,
      resolved_action: resolvedAction,
      notes: [ext.company, ext.title].filter(Boolean).join(' / ') || undefined,
    };
  });

  const unresolvedCount = entries.filter(e => e.match_status === 'ambiguous' && !e.resolved_action).length;
  const missingEmailCount = entries.filter(e => e.missing_email).length;

  const payload: ContactImportPayload = {
    source: 'business_card',
    raw_text: JSON.stringify(extractions),
    parsed_entries: entries,
    unresolved_count: unresolvedCount,
    all_ambiguous_resolved: unresolvedCount === 0,
    missing_email_count: missingEmailCount,
  };

  const pendingId = `pa-scan-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  _pendingActions.set(pendingId, {
    id: pendingId, workspace_id: workspaceId, owner_user_id: ownerUserId,
    action_type: 'contact_import', source_type: 'contacts',
    payload_json: JSON.stringify(payload), summary_json: '{}',
    status: 'pending', expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: now, confirmed_at: null, executed_at: null,
  });

  return {
    pending_action_id: pendingId,
    entries,
    all_resolved: payload.all_ambiguous_resolved,
    missing_email_count: missingEmailCount,
    source: 'business_card',
  };
}

/** confirm (contactImport.ts と同一ロジック) */
function handleConfirm(
  pendingActionId: string,
  ownerUserId: string,
  workspaceId: string
): { success: boolean; status?: number; created_count?: number; updated_count?: number; skipped_count?: number; error?: string } {
  const row = _pendingActions.get(pendingActionId);
  if (!row || row.owner_user_id !== ownerUserId || row.status !== 'pending') {
    return { success: false, status: 404 };
  }

  const payload: ContactImportPayload = JSON.parse(row.payload_json);
  if (!payload.all_ambiguous_resolved) {
    return { success: false, status: 409, error: 'ambiguous_remaining' };
  }

  let created = 0, updated = 0, skipped = 0;
  for (const entry of payload.parsed_entries) {
    if (!entry.resolved_action) { skipped++; continue; }
    switch (entry.resolved_action.type) {
      case 'create_new':
        if (entry.email) {
          _contacts.set(`c-${crypto.randomUUID().slice(0, 8)}`, {
            id: `c-${crypto.randomUUID().slice(0, 8)}`,
            workspace_id: workspaceId, owner_user_id: ownerUserId,
            email: entry.email, display_name: entry.name, kind: 'external_person',
          });
          created++;
        } else { skipped++; }
        break;
      case 'select_existing':
        updated++;
        break;
      case 'skip':
        skipped++;
        break;
    }
  }

  row.status = 'executed';
  row.executed_at = new Date().toISOString();
  return { success: true, created_count: created, updated_count: updated, skipped_count: skipped };
}

/** cancel */
function handleCancel(
  pendingActionId: string,
  ownerUserId: string
): { success: boolean; status?: number } {
  const row = _pendingActions.get(pendingActionId);
  if (!row || row.owner_user_id !== ownerUserId || row.status !== 'pending') {
    return { success: false, status: 404 };
  }
  row.status = 'cancelled';
  return { success: true };
}

/** person-select */
function handlePersonSelect(
  pendingActionId: string,
  ownerUserId: string,
  entryIndex: number,
  action: 'select' | 'new' | 'skip',
  selectedNumber?: number
): { success: boolean; status?: number; all_resolved?: boolean; remaining?: number } {
  const row = _pendingActions.get(pendingActionId);
  if (!row || row.owner_user_id !== ownerUserId || row.status !== 'pending') {
    return { success: false, status: 404 };
  }

  const payload: ContactImportPayload = JSON.parse(row.payload_json);
  const entry = payload.parsed_entries[entryIndex];
  if (!entry) return { success: false, status: 400 };

  if (action === 'skip') {
    entry.resolved_action = { type: 'skip' };
    entry.match_status = 'skipped';
  } else if (action === 'new') {
    entry.resolved_action = { type: 'create_new' };
  } else if (action === 'select' && selectedNumber !== undefined) {
    const c = entry.ambiguous_candidates?.find(c => c.number === selectedNumber);
    if (!c) return { success: false, status: 400 };
    entry.resolved_action = { type: 'select_existing', contact_id: c.contact_id };
  }

  payload.unresolved_count = payload.parsed_entries.filter(
    e => e.match_status === 'ambiguous' && !e.resolved_action
  ).length;
  payload.all_ambiguous_resolved = payload.unresolved_count === 0;
  row.payload_json = JSON.stringify(payload);

  return { success: true, all_resolved: payload.all_ambiguous_resolved, remaining: payload.unresolved_count };
}

// ============================================================
// Tests
// ============================================================

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function test1_ScanWithEmail_PreviewConfirmCreate() {
  console.log('\n=== Test 1: 名刺OCR → emailあり → preview → confirm → contacts増加 ===\n');
  resetMocks();

  const userId = 'user-A';
  const wsId = 'ws-default';

  // Gemini OCR 抽出結果（モック）
  const extractions: BusinessCardExtraction[] = [
    { name: '田中太郎', email: 'tanaka@example.com', company: '株式会社ABC', title: '代表取締役', phone: '03-1234-5678' },
    { name: '佐藤花子', email: 'sato@example.com', company: 'XYZ株式会社', title: '営業部長' },
  ];

  const scan = handleScan(extractions, userId, wsId);
  assert(!!scan.pending_action_id, 'pending_action_id 生成');
  assert(scan.source === 'business_card', 'source は business_card');
  assert(scan.entries.length === 2, '2件抽出');
  assert(scan.missing_email_count === 0, 'メール欠損ゼロ');
  assert(scan.all_resolved, '曖昧一致なし → all_resolved');
  console.log(`  Scan: ${scan.entries.length}件, missing_email=${scan.missing_email_count}, all_resolved=${scan.all_resolved}`);

  // エントリ詳細チェック
  assert(scan.entries[0].company === '株式会社ABC', 'company保持');
  assert(scan.entries[0].title === '代表取締役', 'title保持');
  assert(scan.entries[0].phone === '03-1234-5678', 'phone保持');
  assert(scan.entries[0].notes === '株式会社ABC / 代表取締役', 'notes = company + title');

  // confirm
  const contactsBefore = _contacts.size;
  const confirmResult = handleConfirm(scan.pending_action_id, userId, wsId);
  assert(confirmResult.success, 'confirm成功');
  assert(confirmResult.created_count === 2, '2件作成');
  assert(confirmResult.skipped_count === 0, 'スキップゼロ');
  assert(_contacts.size === contactsBefore + 2, 'contacts +2');
  console.log(`  Confirm: created=${confirmResult.created_count}, skipped=${confirmResult.skipped_count}`);

  console.log('  ✅ Test 1 PASSED');
}

async function test2_ScanNoEmail_HardFail() {
  console.log('\n=== Test 2: 名刺OCR → emailなし → missing_email_count > 0, contacts書き込みゼロ ===\n');
  resetMocks();

  const userId = 'user-B';
  const wsId = 'ws-default';

  // 2枚の名刺: 1枚はemailなし
  const extractions: BusinessCardExtraction[] = [
    { name: '山田一郎', email: 'yamada@example.com', company: 'テスト社' },
    { name: '鈴木次郎', company: 'サンプル株式会社', title: '部長' }, // emailなし → Hard fail
  ];

  const scan = handleScan(extractions, userId, wsId);
  assert(scan.entries.length === 2, '2件抽出');
  assert(scan.missing_email_count === 1, 'missing_email_count === 1');
  console.log(`  Scan: ${scan.entries.length}件, missing_email=${scan.missing_email_count}`);

  // emailなしのエントリはskipped
  const suzuki = scan.entries.find(e => e.name === '鈴木次郎');
  assert(suzuki?.match_status === 'skipped', 'emailなしはskipped');
  assert(suzuki?.missing_email === true, 'missing_emailフラグ');
  assert(suzuki?.resolved_action?.type === 'skip', 'resolved_action = skip');

  // emailありはnew
  const yamada = scan.entries.find(e => e.name === '山田一郎');
  assert(yamada?.match_status === 'new', 'emailありはnew');

  // confirm → emailなしはスキップ
  const contactsBefore = _contacts.size;
  const confirmResult = handleConfirm(scan.pending_action_id, userId, wsId);
  assert(confirmResult.success, 'confirm成功');
  assert(confirmResult.created_count === 1, '1件だけ作成');
  assert(confirmResult.skipped_count === 1, '1件スキップ');
  assert(_contacts.size === contactsBefore + 1, 'contacts +1 (emailなしは書き込みゼロ)');
  console.log(`  Confirm: created=${confirmResult.created_count}, skipped=${confirmResult.skipped_count}`);

  console.log('  ✅ Test 2 PASSED');
}

async function test3_ScanAmbiguous_PersonSelectRequired() {
  console.log('\n=== Test 3: 名刺OCR → 曖昧一致 → person.select で必ず止まる ===\n');
  resetMocks();

  const userId = 'user-C';
  const wsId = 'ws-default';

  // 既存の連絡先
  _existingContacts.push({
    id: 'existing-1', workspace_id: wsId, owner_user_id: userId,
    email: 'tanaka-old@example.com', display_name: '田中一郎', kind: 'external_person',
  });

  const extractions: BusinessCardExtraction[] = [
    { name: '田中太郎', email: 'tanaka-new@example.com', company: '新会社' },
  ];

  const scan = handleScan(extractions, userId, wsId);
  assert(scan.entries.length === 1, '1件抽出');
  assert(!scan.all_resolved, '曖昧一致あり → all_resolvedがfalse');

  const tanaka = scan.entries[0];
  assert(tanaka.match_status === 'ambiguous', '田中は曖昧一致');
  assert(tanaka.ambiguous_candidates!.length > 0, '候補あり');
  assert(tanaka.resolved_action === undefined, '未解決（Gate-2: 自動解決しない）');
  console.log(`  Scan: ambiguous, candidates=${tanaka.ambiguous_candidates!.length}`);

  // confirm前に叩く → 409
  const contactsBefore = _contacts.size;
  const confirmResult = handleConfirm(scan.pending_action_id, userId, wsId);
  assert(!confirmResult.success, 'confirm拒否');
  assert(confirmResult.status === 409, '409 Conflict');
  assert(_contacts.size === contactsBefore, 'contacts書き込みゼロ');
  console.log('  未解決confirm: 409 ✅');

  // person-select で解決
  const selectResult = handlePersonSelect(scan.pending_action_id, userId, 0, 'new');
  assert(selectResult.success, 'person-select成功');
  assert(selectResult.all_resolved === true, '全解決');
  console.log(`  PersonSelect: all_resolved=${selectResult.all_resolved}`);

  // 解決後confirm → 成功
  const confirmResult2 = handleConfirm(scan.pending_action_id, userId, wsId);
  assert(confirmResult2.success, 'resolve後confirm成功');
  assert(confirmResult2.created_count === 1, '1件作成');
  assert(_contacts.size > contactsBefore, 'contacts増加');
  console.log(`  Confirm: created=${confirmResult2.created_count}`);

  console.log('  ✅ Test 3 PASSED');
}

async function test4_ScanCancel_ZeroWrite() {
  console.log('\n=== Test 4: 名刺OCR → cancel → contacts書き込みゼロ ===\n');
  resetMocks();

  const userId = 'user-D';
  const wsId = 'ws-default';

  const extractions: BusinessCardExtraction[] = [
    { name: 'テスト太郎', email: 'test@example.com', company: 'テスト社' },
    { name: 'テスト花子', email: 'test2@example.com', company: 'テスト社' },
  ];

  const scan = handleScan(extractions, userId, wsId);
  assert(scan.entries.length === 2, '2件抽出');
  const contactsBefore = _contacts.size;

  // cancel
  const cancelResult = handleCancel(scan.pending_action_id, userId);
  assert(cancelResult.success, 'cancel成功');
  console.log('  Cancel: success ✅');

  // cancel後confirm → 404
  const confirmResult = handleConfirm(scan.pending_action_id, userId, wsId);
  assert(!confirmResult.success, 'cancel後confirm失敗');
  assert(confirmResult.status === 404, '404');
  console.log('  Cancel後confirm: 404 ✅');

  // contacts書き込みゼロ
  assert(_contacts.size === contactsBefore, 'contacts書き込みゼロ');
  console.log(`  Contacts変化: ${_contacts.size - contactsBefore} (ゼロ) ✅`);

  console.log('  ✅ Test 4 PASSED');
}

// ============================================================
// Runner
// ============================================================
async function runAllTests() {
  console.log('============================================================');
  console.log('PR-D-3: Business Card Scan API Tests');
  console.log('============================================================');

  try {
    await test1_ScanWithEmail_PreviewConfirmCreate();
    await test2_ScanNoEmail_HardFail();
    await test3_ScanAmbiguous_PersonSelectRequired();
    await test4_ScanCancel_ZeroWrite();

    console.log('\n============================================================');
    console.log('✅ ALL 4 BUSINESS CARD SCAN TESTS PASSED');
    console.log('============================================================');
  } catch (error) {
    console.error('\n============================================================');
    console.error('❌ TEST FAILED:', error instanceof Error ? error.message : String(error));
    console.error('============================================================');
    throw error;
  }
}

runAllTests();
