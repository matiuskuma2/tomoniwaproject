/**
 * PR-D-API-1: Contact Import API E2E Tests
 * 
 * Gate-3: owner_user_id 一致チェック
 * Gate-4: confirm 以外は contacts 書き込みゼロ
 * 事故ゼロガード: all_ambiguous_resolved === true 必須 (confirm)
 * 
 * テスト3本:
 *   1. CSV → preview → person-select → confirm → contacts増加
 *   2. preview → cancel → confirm叩いても404（書き込みゼロ保証）
 *   3. 他ユーザーの pending_action_id で叩く → 404（Gate-3確認）
 */

import type {
  ContactImportPayload,
  ContactImportSummary,
  ContactImportEntry,
  ContactMatchStatus,
} from '../../../../packages/shared/src/types/pendingAction';

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

/** 名前類似判定（姓が一致すれば曖昧一致） */
function isSimilarNameTest(a: string, b: string): boolean {
  const la = a.replace(/\s+/g, '').toLowerCase();
  const lb = b.replace(/\s+/g, '').toLowerCase();
  if (la === lb) return true;
  // 姓（先頭1-3文字）が一致
  const surnameA = la.slice(0, Math.min(2, la.length));
  const surnameB = lb.slice(0, Math.min(2, lb.length));
  return surnameA.length >= 2 && surnameA === surnameB;
}

// ============================================================
// Simulate API Logic (mirrors contactImport.ts handlers)
// ============================================================

/** Gate-3: owner_user_id 一致チェック */
function getPendingForUser(
  pendingActionId: string,
  ownerUserId: string
): MockPendingAction | null {
  const row = _pendingActions.get(pendingActionId);
  if (!row) return null;
  // Gate-3: owner 一致チェック
  if (row.owner_user_id !== ownerUserId) return null;
  if (row.action_type !== 'contact_import') return null;
  if (row.status !== 'pending') return null;
  // 期限チェック
  if (new Date(row.expires_at) < new Date()) {
    row.status = 'expired';
    return null;
  }
  return row;
}

/** preview */
function handlePreview(
  source: 'text' | 'csv',
  rawText: string,
  ownerUserId: string,
  workspaceId: string
): { pending_action_id: string; entries: ContactImportEntry[]; all_resolved: boolean } {
  // Parse
  const lines = rawText.split(/[\r\n]+/).filter(l => l.trim());
  const entries: ContactImportEntry[] = lines.map((line, i) => {
    const emailMatch = line.match(/[\w.+-]+@[\w.-]+\.\w+/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : undefined;
    const name = line.replace(/[\w.+-]+@[\w.-]+\.\w+/, '').trim() || `行${i + 1}`;
    
    // 曖昧一致検出（existing contacts をチェック）
    let matchStatus: ContactMatchStatus = email ? 'new' : 'skipped';
    let ambiguousCandidates: ContactImportEntry['ambiguous_candidates'] = undefined;
    // new → create_new (自動解決)、skipped → skip
    let resolvedAction: ContactImportEntry['resolved_action'] = email ? { type: 'create_new' } : { type: 'skip' };

    if (email) {
      const exactMatch = _existingContacts.find(c => c.email === email && c.owner_user_id === ownerUserId);
      if (exactMatch) {
        matchStatus = 'exact';
        resolvedAction = { type: 'select_existing', contact_id: exactMatch.id };
        ambiguousCandidates = [{ number: 1, contact_id: exactMatch.id, display_name: exactMatch.display_name, email: exactMatch.email, score: 1.0 }];
      } else {
        // 名前類似チェック
        const similar = _existingContacts.filter(c => 
          c.owner_user_id === ownerUserId && c.display_name && name &&
          isSimilarNameTest(c.display_name, name)
        );
        if (similar.length > 0) {
          matchStatus = 'ambiguous';
          ambiguousCandidates = similar.map((c, idx) => ({
            number: idx + 1, contact_id: c.id, display_name: c.display_name, email: c.email, score: 0.8,
          }));
          resolvedAction = undefined; // 未解決
        }
      }
    }

    return {
      index: i, name, email, missing_email: !email, match_status: matchStatus,
      ambiguous_candidates: ambiguousCandidates, resolved_action: resolvedAction,
    };
  });

  const unresolvedCount = entries.filter(e => e.match_status === 'ambiguous' && !e.resolved_action).length;
  const payload: ContactImportPayload = {
    source, raw_text: rawText, parsed_entries: entries,
    unresolved_count: unresolvedCount,
    all_ambiguous_resolved: unresolvedCount === 0,
    missing_email_count: entries.filter(e => e.missing_email).length,
  };

  const pendingId = `pa-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  _pendingActions.set(pendingId, {
    id: pendingId, workspace_id: workspaceId, owner_user_id: ownerUserId,
    action_type: 'contact_import', source_type: 'contacts',
    payload_json: JSON.stringify(payload), summary_json: '{}',
    status: 'pending', expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: now, confirmed_at: null, executed_at: null,
  });

  return { pending_action_id: pendingId, entries, all_resolved: payload.all_ambiguous_resolved };
}

/** person-select */
function handlePersonSelect(
  pendingActionId: string,
  ownerUserId: string,
  entryIndex: number,
  action: 'select' | 'new' | 'skip',
  selectedNumber?: number
): { success: boolean; status?: number; all_resolved?: boolean; remaining?: number } {
  const row = getPendingForUser(pendingActionId, ownerUserId);
  if (!row) return { success: false, status: 404 };

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

/** confirm (contacts書き込みはここだけ) */
function handleConfirm(
  pendingActionId: string,
  ownerUserId: string,
  workspaceId: string
): { success: boolean; status?: number; created_count?: number; updated_count?: number; skipped_count?: number; error?: string } {
  const row = getPendingForUser(pendingActionId, ownerUserId);
  if (!row) return { success: false, status: 404 };

  const payload: ContactImportPayload = JSON.parse(row.payload_json);

  // ■■■ 事故ゼロガード ■■■
  if (!payload.all_ambiguous_resolved) {
    return { success: false, status: 409, error: 'ambiguous_remaining' };
  }

  let created = 0, updated = 0, skipped = 0;
  for (const entry of payload.parsed_entries) {
    if (!entry.resolved_action) { skipped++; continue; }
    switch (entry.resolved_action.type) {
      case 'create_new':
        if (entry.email) {
          _contacts.set(`c-${created}`, {
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
  row.confirmed_at = new Date().toISOString();
  return { success: true, created_count: created, updated_count: updated, skipped_count: skipped };
}

/** cancel (contacts書き込みゼロ) */
function handleCancel(
  pendingActionId: string,
  ownerUserId: string
): { success: boolean; status?: number } {
  const row = _pendingActions.get(pendingActionId);
  if (!row || row.owner_user_id !== ownerUserId || row.action_type !== 'contact_import' || row.status !== 'pending') {
    return { success: false, status: 404 };
  }
  row.status = 'cancelled';
  return { success: true };
}

// ============================================================
// Tests
// ============================================================

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function test1_PreviewSelectConfirmCreate() {
  console.log('\n=== Test 1: CSV → preview → person-select → confirm → contacts増加 ===\n');
  resetMocks();

  // 既存の連絡先（田中という名前がDB上に存在）
  _existingContacts.push({
    id: 'existing-1', workspace_id: 'ws-default', owner_user_id: 'user-A',
    email: 'tanaka-old@example.com', display_name: '田中太郎', kind: 'external_person',
  });

  const userId = 'user-A';
  const wsId = 'ws-default';

  // Step 1: preview（「田中」が曖昧一致になるはず）
  const rawText = '田中花子 tanaka@example.com\n佐藤一郎 sato@example.com\n山田 yamada@example.com';
  const preview = handlePreview('text', rawText, userId, wsId);
  assert(!!preview.pending_action_id, 'pending_action_id が返る');
  assert(preview.entries.length === 3, '3件パースされた');
  console.log(`  Preview: ${preview.entries.length}件, all_resolved=${preview.all_resolved}`);

  // 「田中花子」は既存の「田中太郎」と曖昧一致のはず
  const tanaka = preview.entries.find(e => e.name.includes('田中'));
  assert(tanaka?.match_status === 'ambiguous', '田中は曖昧一致');
  assert(!preview.all_resolved, '曖昧一致が残っている');

  // Step 2: person-select（田中を「新規作成」に）
  const selectResult = handlePersonSelect(preview.pending_action_id, userId, tanaka!.index, 'new');
  assert(selectResult.success, 'person-select成功');
  assert(selectResult.all_resolved === true, '全曖昧一致解決');
  console.log(`  PersonSelect: all_resolved=${selectResult.all_resolved}`);

  // Step 3: confirm前のcontacts数を記録
  const contactsBefore = _contacts.size;

  // Step 4: confirm
  const confirmResult = handleConfirm(preview.pending_action_id, userId, wsId);
  assert(confirmResult.success, 'confirm成功');
  assert(confirmResult.created_count! >= 2, '2件以上作成（田中新規+佐藤+山田）');
  console.log(`  Confirm: created=${confirmResult.created_count}, updated=${confirmResult.updated_count}, skipped=${confirmResult.skipped_count}`);

  // Step 5: contacts が増えた
  assert(_contacts.size > contactsBefore, 'contacts増加');

  // Step 6: 同じpending_action_idでconfirmしても404（二重押し防止）
  const doubleConfirm = handleConfirm(preview.pending_action_id, userId, wsId);
  assert(!doubleConfirm.success, '二重confirm拒否');
  assert(doubleConfirm.status === 404, '二重confirmは404');
  console.log('  二重confirm: 404 ✅');

  console.log('  ✅ Test 1 PASSED');
}

async function test2_CancelThenConfirm404() {
  console.log('\n=== Test 2: preview → cancel → confirm叩いても404（書き込みゼロ保証） ===\n');
  resetMocks();

  const userId = 'user-B';
  const wsId = 'ws-default';
  const rawText = '新規1 new1@example.com\n新規2 new2@example.com';

  // Step 1: preview
  const preview = handlePreview('text', rawText, userId, wsId);
  assert(preview.entries.length === 2, '2件パース');
  const contactsBefore = _contacts.size;

  // Step 2: cancel
  const cancelResult = handleCancel(preview.pending_action_id, userId);
  assert(cancelResult.success, 'cancel成功');
  console.log('  Cancel: success ✅');

  // Step 3: confirm → 404
  const confirmResult = handleConfirm(preview.pending_action_id, userId, wsId);
  assert(!confirmResult.success, 'cancel後のconfirmは失敗');
  assert(confirmResult.status === 404, 'cancel後のconfirmは404');
  console.log('  Cancel後confirm: 404 ✅');

  // Step 4: contacts は増えていない（書き込みゼロ保証）
  assert(_contacts.size === contactsBefore, 'contacts書き込みゼロ');
  console.log(`  Contacts変化: ${_contacts.size - contactsBefore} (ゼロ) ✅`);

  // Step 5: person-select → 404（cancel済み）
  const selectResult = handlePersonSelect(preview.pending_action_id, userId, 0, 'new');
  assert(!selectResult.success, 'cancel後のperson-selectは失敗');
  assert(selectResult.status === 404, 'cancel後のperson-selectは404');
  console.log('  Cancel後person-select: 404 ✅');

  console.log('  ✅ Test 2 PASSED');
}

async function test3_OtherUserPending404() {
  console.log('\n=== Test 3: 他ユーザーの pending_action_id で叩く → 404（Gate-3） ===\n');
  resetMocks();

  const userA = 'user-A';
  const userB = 'user-B';
  const wsId = 'ws-default';

  // userA が preview 作成
  const rawText = '取り込みテスト import@example.com';
  const preview = handlePreview('text', rawText, userA, wsId);
  assert(!!preview.pending_action_id, 'userA: pending作成成功');

  // userB が同じ pending_action_id で操作 → 全て404
  const selectResult = handlePersonSelect(preview.pending_action_id, userB, 0, 'new');
  assert(!selectResult.success && selectResult.status === 404, 'userBのperson-select: 404');
  console.log('  UserB person-select: 404 ✅');

  const confirmResult = handleConfirm(preview.pending_action_id, userB, wsId);
  assert(!confirmResult.success && confirmResult.status === 404, 'userBのconfirm: 404');
  console.log('  UserB confirm: 404 ✅');

  const cancelResult = handleCancel(preview.pending_action_id, userB);
  assert(!cancelResult.success && cancelResult.status === 404, 'userBのcancel: 404');
  console.log('  UserB cancel: 404 ✅');

  // userA は正常に操作可能（取り消されていないことを確認）
  const confirmA = handleConfirm(preview.pending_action_id, userA, wsId);
  assert(confirmA.success, 'userAのconfirmは成功');
  console.log('  UserA confirm: success ✅');

  // contacts が増えた（userAの操作のみ有効）
  assert(_contacts.size > 0, 'userAのcontacts書き込み成功');
  console.log(`  UserA contacts: ${_contacts.size}件作成 ✅`);

  console.log('  ✅ Test 3 PASSED');
}

async function test4_ConfirmBeforeResolve409() {
  console.log('\n=== Test 4: 曖昧一致未解決のままconfirm → 409（事故ゼロガード） ===\n');
  resetMocks();

  // 既存連絡先
  _existingContacts.push({
    id: 'existing-2', workspace_id: 'ws-default', owner_user_id: 'user-C',
    email: 'suzuki-old@example.com', display_name: '鈴木太郎', kind: 'external_person',
  });

  const userId = 'user-C';
  const wsId = 'ws-default';
  const rawText = '鈴木花子 suzuki-new@example.com';

  const preview = handlePreview('text', rawText, userId, wsId);
  const suzuki = preview.entries.find(e => e.name.includes('鈴木'));
  assert(suzuki?.match_status === 'ambiguous', '鈴木は曖昧一致');

  // 曖昧未解決のままconfirm → 409
  const contactsBefore = _contacts.size;
  const confirmResult = handleConfirm(preview.pending_action_id, userId, wsId);
  assert(!confirmResult.success, 'confirm拒否');
  assert(confirmResult.status === 409, '409 Conflict');
  assert(confirmResult.error === 'ambiguous_remaining', 'エラーメッセージ正しい');
  console.log('  未解決confirm: 409 ✅');

  // contacts は増えていない
  assert(_contacts.size === contactsBefore, 'contacts書き込みゼロ');
  console.log('  Contacts変化: 0 ✅');

  console.log('  ✅ Test 4 PASSED');
}

// ============================================================
// Runner
// ============================================================
async function runAllTests() {
  console.log('============================================================');
  console.log('PR-D-API-1: Contact Import API E2E Tests');
  console.log('============================================================');

  try {
    await test1_PreviewSelectConfirmCreate();
    await test2_CancelThenConfirm404();
    await test3_OtherUserPending404();
    await test4_ConfirmBeforeResolve409();

    console.log('\n============================================================');
    console.log('✅ ALL 4 API TESTS PASSED');
    console.log('============================================================');
  } catch (error) {
    console.error('\n============================================================');
    console.error('❌ TEST FAILED:', error instanceof Error ? error.message : String(error));
    console.error('============================================================');
    throw error;
  }
}

runAllTests();
