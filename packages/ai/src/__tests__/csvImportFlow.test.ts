/**
 * CSV Import E2E テスト（PR-D-2: 5本）
 * 
 * 1. CSV正常パース → preview → confirm → 作成
 * 2. メール欠落行 → skipped（Hard fail明示）
 * 3. ヘッダ自動推定（name,email / email,名前 等）
 * 4. 上限超過 → 切り捨て + 警告
 * 5. CSV曖昧一致 → person.select → confirm → 作成
 * 
 * 事故ゼロの検証ポイント:
 * - メール欠落は常にskipped（登録不可）
 * - 上限100行で切り捨て
 * - ヘッダ有無の自動推定
 * - 曖昧一致 → confirm前にall_ambiguous_resolvedガード
 */

import { ClassifierChain, type ClassifierContext } from '../classifier';
import { ContactImportExecutor, type ContactImportDeps } from '../executor';
import { parseCSV, CSV_MAX_ROWS } from '../parser/csvParser';
import {
  PENDING_CONFIRMATION_KIND,
  type ContactImportPayload,
  type ContactImportSummary,
  type ContactImportEntry,
  type AmbiguousCandidate,
  type PendingConfirmationState,
} from '../../../../packages/shared/src/types/pendingAction';

// ============================================================
// Mock Dependencies
// ============================================================

function createMockDeps(ambiguousNames: string[] = []): ContactImportDeps & {
  _createdContacts: Array<any>;
  _updatedContacts: Array<{ id: string; params: any }>;
  _cancelledActions: string[];
  _executedActions: string[];
  _pendingActions: Map<string, any>;
} {
  const _createdContacts: Array<any> = [];
  const _updatedContacts: Array<{ id: string; params: any }> = [];
  const _cancelledActions: string[] = [];
  const _executedActions: string[] = [];
  const _pendingActions = new Map<string, any>();

  return {
    _createdContacts,
    _updatedContacts,
    _cancelledActions,
    _executedActions,
    _pendingActions,

    async createPendingAction(params) {
      const id = `pa-csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const action = {
        id,
        payload: params.payload,
        summary: params.summary,
        status: 'pending',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
      _pendingActions.set(id, action);
      return { id, expires_at: action.expires_at };
    },

    async getPendingAction(id) {
      return _pendingActions.get(id) || null;
    },

    async updatePendingAction(id, payload, summary) {
      const action = _pendingActions.get(id);
      if (action) {
        action.payload = payload;
        action.summary = summary;
      }
    },

    async cancelPendingAction(id) {
      _cancelledActions.push(id);
      const action = _pendingActions.get(id);
      if (action) action.status = 'cancelled';
    },

    async executePendingAction(id) {
      _executedActions.push(id);
      const action = _pendingActions.get(id);
      if (action) action.status = 'executed';
    },

    async parseContactText(text: string): Promise<ContactImportEntry[]> {
      // CSVテストでは使わない（handleImportCSVがparseCSVを直接呼ぶ）
      return [];
    },

    async findAmbiguousCandidates(entry, userId): Promise<AmbiguousCandidate[]> {
      // ambiguousNamesに含まれる名前の場合のみ曖昧一致を返す
      if (ambiguousNames.includes(entry.name)) {
        return [
          { number: 1, contact_id: `c-${entry.name}-1`, display_name: `${entry.name}太郎`, email: `${entry.name.toLowerCase()}1@example.com`, score: 0.8 },
          { number: 2, contact_id: `c-${entry.name}-2`, display_name: `${entry.name}花子`, email: `${entry.name.toLowerCase()}2@example.com`, score: 0.7 },
        ];
      }
      return [];
    },

    async createContact(params) {
      const contact = {
        id: `c-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        display_name: params.display_name,
        email: params.email,
      };
      _createdContacts.push(contact);
      return contact;
    },

    async updateContact(contactId, params) {
      _updatedContacts.push({ id: contactId, params });
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function noPendingState(): PendingConfirmationState {
  return { hasPending: false, kind: null, pending_action_id: null, ui_hint: null };
}

function pendingState(kind: any, actionId: string): PendingConfirmationState {
  return { hasPending: true, kind, pending_action_id: actionId, ui_hint: null };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ============================================================
// Test 1: CSV正常パース → preview → confirm → 作成
// ============================================================

async function test_csv_normal_flow() {
  console.log('\n=== Test 1: CSV正常パース → preview → confirm → 作成 ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps();
  const executor = new ContactImportExecutor(deps);
  const userId = 'user-csv-1';

  // CSV入力（ヘッダ付き）
  const csvInput = `CSV取り込んで
name,email
田中太郎,tanaka@example.com
佐藤花子,sato@example.com
山田一郎,yamada@example.com`;

  // Step 1: Classifierで分類
  const ctx1: ClassifierContext = {
    user_input: csvInput,
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  console.log('Step 1 classified:', classified1.category);
  assert(classified1.category === 'contact.import.csv', 'Should be contact.import.csv');

  // Step 2: Execute CSV preview
  const result1 = await executor.execute(classified1, userId);
  console.log('Step 2 preview:', result1.message.substring(0, 100) + '...');
  assert(result1.success, 'Preview should succeed');
  assert(result1.pending_action_id !== null, 'Should have pending action');

  // previewの中身を検証
  const previewData = result1.data as any;
  assert(previewData.summary.total_count === 3, `Should have 3 entries, got ${previewData.summary.total_count}`);
  assert(previewData.summary.source === 'csv', 'Source should be csv');
  assert(previewData.summary.missing_email_count === 0, 'No missing emails');

  const paId = result1.pending_action_id!;

  // Step 3: Confirm
  const ctx3: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  const classified3 = chain.classify(ctx3);
  assert(classified3.category === 'contact.import.confirm', 'Should be confirm');

  const result3 = await executor.execute(classified3, userId, paId);
  console.log('Step 3 confirm:', result3.message);
  assert(result3.success, 'Confirm should succeed');
  assert(result3.next_pending_kind === null, 'No more pending');

  // Verify DB writes
  console.log('Created contacts:', deps._createdContacts.length);
  assert(deps._createdContacts.length === 3, `Should create 3 contacts, got ${deps._createdContacts.length}`);
  assert(deps._executedActions.includes(paId), 'Action should be executed');

  // メールが正しく記録されている
  const emails = deps._createdContacts.map(c => c.email).sort();
  assert(emails.includes('sato@example.com'), 'Should have sato email');
  assert(emails.includes('tanaka@example.com'), 'Should have tanaka email');
  assert(emails.includes('yamada@example.com'), 'Should have yamada email');

  console.log('  ✅ Test 1 PASSED: CSV正常フロー完了');
}

// ============================================================
// Test 2: メール欠落行 → skipped（Hard fail明示）
// ============================================================

async function test_csv_missing_email() {
  console.log('\n=== Test 2: メール欠落行 → skipped（Hard fail） ===\n');

  // パーサ単体テスト
  const csvText = `name,email
田中太郎,tanaka@example.com
佐藤花子,
山田一郎,yamada@example.com
高橋次郎,invalid-email
鈴木三郎,suzuki@example.com`;

  const result = parseCSV(csvText);
  console.log(`Parsed: ${result.entries.length} entries, ${result.missing_email_count} missing emails`);

  // 5行中、メール欠落は2行（佐藤=空, 高橋=invalid）
  assert(result.missing_email_count === 2, `Should have 2 missing emails, got ${result.missing_email_count}`);
  assert(result.header_detected === true, 'Header should be detected');

  // メール欠落行はskipped
  const skippedEntries = result.entries.filter(e => e.match_status === 'skipped');
  assert(skippedEntries.length === 2, `Should have 2 skipped entries, got ${skippedEntries.length}`);

  // メール欠落行にはresolved_action: skipがセットされている
  for (const entry of skippedEntries) {
    assert(entry.missing_email === true, `${entry.name} should have missing_email=true`);
    assert(entry.resolved_action?.type === 'skip', `${entry.name} should have resolved_action.type=skip`);
  }

  // メール有効行は正常にパース
  const validEntries = result.entries.filter(e => e.match_status !== 'skipped');
  assert(validEntries.length === 3, `Should have 3 valid entries, got ${validEntries.length}`);

  // Executor経由のテスト
  const chain = new ClassifierChain();
  const deps = createMockDeps();
  const executor = new ContactImportExecutor(deps);

  const ctx: ClassifierContext = {
    user_input: `CSV取り込み\n${csvText}`,
    pending_state: noPendingState(),
    user_id: 'user-csv-2',
  };
  const classified = chain.classify(ctx);
  assert(classified.category === 'contact.import.csv', 'Should be csv');

  const previewResult = await executor.execute(classified, 'user-csv-2');
  assert(previewResult.success, 'Preview should succeed');

  // メッセージにメール欠落の警告が含まれている
  assert(
    previewResult.message.includes('メール欠落') || previewResult.message.includes('スキップ'),
    'Should show missing email warning'
  );

  const paId = previewResult.pending_action_id!;

  // Confirm
  const ctxConfirm: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: 'user-csv-2',
  };
  const classifiedConfirm = chain.classify(ctxConfirm);
  const confirmResult = await executor.execute(classifiedConfirm, 'user-csv-2', paId);
  assert(confirmResult.success, 'Confirm should succeed');

  // メール欠落行はDB書き込みされない
  console.log('Created:', deps._createdContacts.length, 'contacts');
  assert(deps._createdContacts.length === 3, `Should create only 3 contacts (not 5), got ${deps._createdContacts.length}`);

  console.log('  ✅ Test 2 PASSED: メール欠落 → skipped → DB書き込みなし');
}

// ============================================================
// Test 3: ヘッダ自動推定
// ============================================================

async function test_csv_header_detection() {
  console.log('\n=== Test 3: ヘッダ自動推定 ===\n');

  // Case A: name,email ヘッダ（順序通り）
  const csvA = `name,email\n田中,tanaka@example.com\n佐藤,sato@example.com`;
  const resultA = parseCSV(csvA);
  assert(resultA.header_detected === true, 'Case A: Header should be detected');
  assert(resultA.entries.length === 2, 'Case A: Should have 2 entries');
  assert(resultA.entries[0].name === '田中', 'Case A: First name should be 田中');
  assert(resultA.entries[0].email === 'tanaka@example.com', 'Case A: First email should match');
  console.log('  ✅ Case A: name,email ヘッダ');

  // Case B: email,名前 ヘッダ（逆順・日本語）
  const csvB = `メール,名前\ntanaka@example.com,田中\nsato@example.com,佐藤`;
  const resultB = parseCSV(csvB);
  assert(resultB.header_detected === true, 'Case B: Header should be detected');
  assert(resultB.entries.length === 2, 'Case B: Should have 2 entries');
  assert(resultB.entries[0].name === '田中', `Case B: First name should be 田中, got ${resultB.entries[0].name}`);
  assert(resultB.entries[0].email === 'tanaka@example.com', `Case B: First email should match, got ${resultB.entries[0].email}`);
  console.log('  ✅ Case B: メール,名前 ヘッダ（逆順）');

  // Case C: ヘッダなし（メール列を自動検出）
  const csvC = `田中,tanaka@example.com\n佐藤,sato@example.com`;
  const resultC = parseCSV(csvC);
  assert(resultC.header_detected === false, 'Case C: Header should NOT be detected');
  assert(resultC.entries.length === 2, 'Case C: Should have 2 entries');
  assert(resultC.entries[0].email === 'tanaka@example.com', 'Case C: Email should be auto-detected');
  console.log('  ✅ Case C: ヘッダなし（メール列自動検出）');

  // Case D: タブ区切り
  const csvD = `name\temail\n田中\ttanaka@example.com\n佐藤\tsato@example.com`;
  const resultD = parseCSV(csvD);
  assert(resultD.header_detected === true, 'Case D: Header should be detected');
  assert(resultD.entries.length === 2, 'Case D: Should have 2 entries');
  assert(resultD.entries[0].email === 'tanaka@example.com', 'Case D: Tab-separated email should work');
  console.log('  ✅ Case D: タブ区切り');

  // Case E: 3列以上（name, email, phone）
  const csvE = `名前,メール,電話\n田中,tanaka@example.com,090-1234-5678\n佐藤,sato@example.com,080-9876-5432`;
  const resultE = parseCSV(csvE);
  assert(resultE.header_detected === true, 'Case E: Header should be detected');
  assert(resultE.entries[0].phone === '090-1234-5678', `Case E: Phone should be parsed, got ${resultE.entries[0].phone}`);
  console.log('  ✅ Case E: 3列以上（名前,メール,電話）');

  console.log('  ✅ Test 3 PASSED: ヘッダ自動推定が全パターンで正しく動作');
}

// ============================================================
// Test 4: 上限超過 → 切り捨て + 警告
// ============================================================

async function test_csv_truncation() {
  console.log('\n=== Test 4: 上限超過 → 切り捨て + 警告 ===\n');

  // 150行のCSV生成
  const lines: string[] = ['name,email'];
  for (let i = 1; i <= 150; i++) {
    lines.push(`user${i},user${i}@example.com`);
  }
  const csvText = lines.join('\n');

  const result = parseCSV(csvText);

  console.log(`Input: 150 rows, Parsed: ${result.entries.length}, Truncated: ${result.truncated_rows}`);

  assert(result.header_detected === true, 'Header should be detected');
  assert(result.entries.length === CSV_MAX_ROWS, `Should have exactly ${CSV_MAX_ROWS} entries, got ${result.entries.length}`);
  assert(result.truncated_rows === 50, `Should truncate 50 rows, got ${result.truncated_rows}`);
  assert(result.warnings.length > 0, 'Should have warnings');
  assert(result.warnings[0].includes('上限'), 'Warning should mention limit');

  // 先頭と末尾のエントリを確認
  assert(result.entries[0].name === 'user1', 'First entry should be user1');
  assert(result.entries[0].email === 'user1@example.com', 'First email should match');
  assert(result.entries[CSV_MAX_ROWS - 1].name === `user${CSV_MAX_ROWS}`, `Last entry should be user${CSV_MAX_ROWS}`);

  // サイズ上限テスト
  const hugeText = 'a'.repeat(60 * 1024); // 60KB > 50KB limit
  const hugeResult = parseCSV(hugeText);
  assert(hugeResult.entries.length === 0, 'Huge text should return 0 entries');
  assert(hugeResult.warnings.some(w => w.includes('大きすぎます')), 'Should warn about size limit');
  console.log('  ✅ サイズ上限テスト合格');

  // 空入力テスト
  const emptyResult = parseCSV('');
  assert(emptyResult.entries.length === 0, 'Empty should return 0 entries');
  assert(emptyResult.warnings.some(w => w.includes('空')), 'Should warn about empty input');
  console.log('  ✅ 空入力テスト合格');

  console.log('  ✅ Test 4 PASSED: 上限超過で正しく切り捨て + 警告');
}

// ============================================================
// Test 5: CSV曖昧一致 → person.select → confirm → 作成
// ============================================================

async function test_csv_ambiguous_flow() {
  console.log('\n=== Test 5: CSV曖昧一致 → person.select → confirm → 作成 ===\n');

  const chain = new ClassifierChain();
  // "田中" を曖昧一致対象に設定
  const deps = createMockDeps(['田中']);
  const executor = new ContactImportExecutor(deps);
  const userId = 'user-csv-5';

  // CSV入力（田中は曖昧一致になる）
  const csvInput = `CSV取り込み
name,email
田中,tanaka@example.com
佐藤,sato@example.com
山田,yamada@example.com`;

  // Step 1: CSV分類
  const ctx1: ClassifierContext = {
    user_input: csvInput,
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  assert(classified1.category === 'contact.import.csv', 'Should be csv');

  // Step 2: Preview
  const result1 = await executor.execute(classified1, userId);
  console.log('Step 2 preview:', result1.message.substring(0, 100) + '...');
  assert(result1.success, 'Preview should succeed');
  const paId = result1.pending_action_id!;

  // 田中が曖昧一致のはず
  assert(
    result1.next_pending_kind === PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT,
    'Should need person select'
  );

  // Step 3: 曖昧未解決でconfirmを試みる → ガードで拒否
  const ctx3: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  const classified3 = chain.classify(ctx3);
  if (classified3.category === 'contact.import.confirm') {
    const guardResult = await executor.execute(classified3, userId, paId);
    assert(!guardResult.success, 'Should be blocked by guard');
    console.log('  ✅ 事故ゼロガード: confirm拒否');
  }

  // Step 4: person.select で1番を選択
  const ctx4: ClassifierContext = {
    user_input: '1',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, paId),
    user_id: userId,
    current_ambiguous_entry_index: 0,
  };
  const classified4 = chain.classify(ctx4);
  assert(classified4.category === 'contact.import.person_select', 'Should be person_select');

  const result4 = await executor.execute(classified4, userId, paId);
  console.log('Step 4 select:', result4.message.substring(0, 80) + '...');
  assert(result4.success, 'Select should succeed');

  // 全曖昧解決済み → confirm可能
  assert(
    result4.next_pending_kind === PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM,
    `Should be ready for confirm, got ${result4.next_pending_kind}`
  );

  // Step 5: Confirm
  const ctx5: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  const classified5 = chain.classify(ctx5);
  const result5 = await executor.execute(classified5, userId, paId);
  console.log('Step 5 confirm:', result5.message);
  assert(result5.success, 'Confirm should succeed');

  // 検証: 田中は既存更新、佐藤・山田は新規作成
  console.log(`Created: ${deps._createdContacts.length}, Updated: ${deps._updatedContacts.length}`);
  assert(deps._createdContacts.length === 2, `Should create 2 contacts (佐藤,山田), got ${deps._createdContacts.length}`);
  assert(deps._updatedContacts.length === 1, `Should update 1 contact (田中), got ${deps._updatedContacts.length}`);
  assert(deps._executedActions.includes(paId), 'Action should be executed');

  console.log('  ✅ Test 5 PASSED: CSV曖昧一致 → select → confirm → 作成');
}

// ============================================================
// Run All Tests
// ============================================================

async function runAllTests() {
  console.log('🧪 CSV Import Flow Tests - PR-D-2 事故ゼロ検証\n');
  console.log('='.repeat(60));

  try {
    await test_csv_normal_flow();
    await test_csv_missing_email();
    await test_csv_header_detection();
    await test_csv_truncation();
    await test_csv_ambiguous_flow();

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL 5 CSV TESTS PASSED');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ CSV TEST FAILED:', error);
    console.error('='.repeat(60));
    throw error;
  }
}

runAllTests();
