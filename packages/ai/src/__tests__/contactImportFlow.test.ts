/**
 * Contact Import E2E テスト（最小2本）
 * 
 * 1. 曖昧一致 → person.select → confirm → 作成
 * 2. 曖昧一致 → cancel → 書き込みゼロ
 * 
 * 事故ゼロの検証ポイント:
 * - confirm前にall_ambiguous_resolvedガードが効くこと
 * - cancel時にDB書き込みがゼロであること
 * - person.selectで0=新規、s=スキップが正しく動作すること
 */

import { ClassifierChain, type ClassifierContext } from '../classifier';
import { ContactImportExecutor, type ContactImportDeps } from '../executor';
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

function createMockDeps(): ContactImportDeps & {
  _createdContacts: Array<any>;
  _cancelledActions: string[];
  _executedActions: string[];
  _pendingActions: Map<string, any>;
} {
  const _createdContacts: Array<any> = [];
  const _cancelledActions: string[] = [];
  const _executedActions: string[] = [];
  const _pendingActions = new Map<string, any>();

  return {
    _createdContacts,
    _cancelledActions,
    _executedActions,
    _pendingActions,

    async createPendingAction(params) {
      const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      // シンプルなモック: 改行区切りで名前を抽出
      return text.split('\n')
        .filter(line => line.trim())
        .filter(line => !/^(登録|取り込|インポート)/.test(line.trim()))
        .map((line, i) => ({
          index: i,
          name: line.trim().split(/\s+/)[0],
          email: line.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0],
          match_status: 'new' as const,
        }));
    },

    async findAmbiguousCandidates(entry, userId): Promise<AmbiguousCandidate[]> {
      // "田中" は曖昧一致を返す
      if (entry.name === '田中') {
        return [
          { number: 1, contact_id: 'c-tanaka-1', display_name: '田中太郎', email: 'tanaka.t@example.com', score: 0.8 },
          { number: 2, contact_id: 'c-tanaka-2', display_name: '田中花子', email: 'tanaka.h@example.com', score: 0.7 },
        ];
      }
      // "鈴木" は完全一致
      if (entry.name === '鈴木') {
        return [
          { number: 1, contact_id: 'c-suzuki-1', display_name: '鈴木一郎', email: 'suzuki@example.com', score: 0.98 },
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
      // mock - do nothing
    },
  };
}

// ============================================================
// Helper
// ============================================================

function noPendingState(): PendingConfirmationState {
  return { hasPending: false, kind: null, pending_action_id: null, ui_hint: null };
}

function pendingState(kind: any, actionId: string): PendingConfirmationState {
  return { hasPending: true, kind, pending_action_id: actionId, ui_hint: null };
}

// ============================================================
// Test 1: 曖昧一致 → person.select → confirm → 作成
// ============================================================

async function test_ambiguous_select_confirm_create() {
  console.log('\n=== Test 1: 曖昧一致 → select → confirm → 作成 ===\n');
  
  const chain = new ClassifierChain();
  const deps = createMockDeps();
  const executor = new ContactImportExecutor(deps);
  const userId = 'user-test-1';

  // Step 1: テキスト入力
  const ctx1: ClassifierContext = {
    user_input: '登録して\n田中 tanaka@example.com\n佐藤 sato@example.com',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  console.log('Step 1 classified:', classified1.category);
  assert(classified1.category === 'contact.import.text', 'Should be contact.import.text');

  // Step 2: Execute preview
  const result1 = await executor.execute(classified1, userId);
  console.log('Step 2 preview result:', result1.message.substring(0, 80) + '...');
  assert(result1.success, 'Preview should succeed');
  assert(result1.pending_action_id !== null, 'Should have pending action');
  const paId = result1.pending_action_id!;

  // Step 3: 曖昧一致が残っている状態でconfirmを試みる（ガードが効くはず）
  const ctx3: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  
  // しかしまだ曖昧未解決 → person.selectのkindであるべき
  // confirmのkindでYESを送ると、ガードで弾かれる
  const ctx3_force: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  const classified3 = chain.classify(ctx3_force);
  console.log('Step 3 classified (force confirm):', classified3.category);
  
  if (classified3.category === 'contact.import.confirm') {
    const result3 = await executor.execute(classified3, userId, paId);
    console.log('Step 3 guard result:', result3.message);
    assert(!result3.success, 'Should be blocked by ambiguous guard');
    assert(result3.message.includes('未解決'), 'Should mention unresolved');
    console.log('  ✅ all_ambiguous_resolved ガードが正しく動作');
  }

  // Step 4: person.select で番号1を選択（田中太郎を選択）
  const ctx4: ClassifierContext = {
    user_input: '1',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, paId),
    user_id: userId,
    current_ambiguous_entry_index: 0, // 田中のindex
  };
  const classified4 = chain.classify(ctx4);
  console.log('Step 4 classified:', classified4.category);
  assert(classified4.category === 'contact.import.person_select', 'Should be person_select');
  
  const result4 = await executor.execute(classified4, userId, paId);
  console.log('Step 4 select result:', result4.message.substring(0, 80) + '...');
  assert(result4.success, 'Person select should succeed');

  // Step 5: 全曖昧解決済み → confirm
  const ctx5: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  const classified5 = chain.classify(ctx5);
  console.log('Step 5 classified:', classified5.category);
  assert(classified5.category === 'contact.import.confirm', 'Should be confirm');

  const result5 = await executor.execute(classified5, userId, paId);
  console.log('Step 5 confirm result:', result5.message);
  assert(result5.success, 'Confirm should succeed now');
  assert(result5.next_pending_kind === null, 'No more pending');

  // Verify: contacts が作成された
  console.log('Created contacts:', deps._createdContacts.length);
  assert(deps._createdContacts.length >= 1, 'Should have created at least 1 contact');
  assert(deps._executedActions.includes(paId), 'Action should be executed');
  
  console.log('  ✅ Test 1 PASSED: 曖昧一致 → select → confirm → 作成');
}

// ============================================================
// Test 2: 曖昧一致 → cancel → 書き込みゼロ
// ============================================================

async function test_ambiguous_cancel_zero_writes() {
  console.log('\n=== Test 2: 曖昧一致 → cancel → 書き込みゼロ ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps();
  const executor = new ContactImportExecutor(deps);
  const userId = 'user-test-2';

  // Step 1: テキスト入力
  const ctx1: ClassifierContext = {
    user_input: '登録して\n田中 tanaka@example.com',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  const result1 = await executor.execute(classified1, userId);
  assert(result1.success, 'Preview should succeed');
  const paId = result1.pending_action_id!;
  console.log('Step 1: Preview created, action:', paId);

  // Step 2: キャンセル
  const ctx2: ClassifierContext = {
    user_input: 'いいえ',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, paId),
    user_id: userId,
  };
  const classified2 = chain.classify(ctx2);
  console.log('Step 2 classified:', classified2.category);
  assert(classified2.category === 'contact.import.cancel', 'Should be cancel');

  const result2 = await executor.execute(classified2, userId, paId);
  console.log('Step 2 cancel result:', result2.message);
  assert(result2.success, 'Cancel should succeed');
  assert(result2.next_pending_kind === null, 'No more pending');

  // Verify: 書き込みゼロ
  assert(deps._createdContacts.length === 0, 'ZERO contacts should be created');
  assert(deps._cancelledActions.includes(paId), 'Action should be cancelled');
  assert(!deps._executedActions.includes(paId), 'Action should NOT be executed');

  console.log('  ✅ Test 2 PASSED: cancel → 書き込みゼロ');
}

// ============================================================
// Test 3: 0=新規 と s=スキップ の動作確認
// ============================================================

async function test_new_and_skip_options() {
  console.log('\n=== Test 3: 0=新規 / s=スキップ の動作確認 ===\n');

  const chain = new ClassifierChain();

  // Test "0" → create_new
  const ctx_zero: ClassifierContext = {
    user_input: '0',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, 'pa-test'),
    user_id: 'u1',
    current_ambiguous_entry_index: 0,
  };
  const classified_zero = chain.classify(ctx_zero);
  assert(classified_zero.category === 'contact.import.person_select', '0 should be person_select');
  assert(classified_zero.person_selection?.selected_number === 0, '0 → number 0');
  assert(classified_zero.person_selection?.is_skip === false, '0 is not skip');
  console.log('  ✅ "0" → 新規作成');

  // Test "新規" → create_new
  const ctx_new: ClassifierContext = {
    user_input: '新規',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, 'pa-test'),
    user_id: 'u1',
    current_ambiguous_entry_index: 0,
  };
  const classified_new = chain.classify(ctx_new);
  assert(classified_new.category === 'contact.import.person_select', '"新規" should be person_select');
  assert(classified_new.person_selection?.selected_number === 0, '"新規" → number 0');
  console.log('  ✅ "新規" → 新規作成');

  // Test "s" → skip
  const ctx_skip: ClassifierContext = {
    user_input: 's',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, 'pa-test'),
    user_id: 'u1',
    current_ambiguous_entry_index: 0,
  };
  const classified_skip = chain.classify(ctx_skip);
  assert(classified_skip.category === 'contact.import.person_select', '"s" should be person_select');
  assert(classified_skip.person_selection?.is_skip === true, '"s" is skip');
  console.log('  ✅ "s" → スキップ');

  // Test "スキップ" → skip
  const ctx_skip_ja: ClassifierContext = {
    user_input: 'スキップ',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, 'pa-test'),
    user_id: 'u1',
    current_ambiguous_entry_index: 0,
  };
  const classified_skip_ja = chain.classify(ctx_skip_ja);
  assert(classified_skip_ja.category === 'contact.import.person_select', '"スキップ" should be person_select');
  assert(classified_skip_ja.person_selection?.is_skip === true, '"スキップ" is skip');
  console.log('  ✅ "スキップ" → スキップ');

  console.log('  ✅ Test 3 PASSED: 新規/スキップ表現が正しく分類される');
}

// ============================================================
// Test 4: pendingDecision が contact_import を拾わないこと
// ============================================================

async function test_pending_decision_does_not_steal_contact_import() {
  console.log('\n=== Test 4: pendingDecision が contact_import のYES/NOを拾わない ===\n');

  const chain = new ClassifierChain();

  // contact_import.confirm のpending中に "はい" と入力
  const ctx: ClassifierContext = {
    user_input: 'はい',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM, 'pa-ci-1'),
    user_id: 'u1',
  };

  const classified = chain.classify(ctx);
  console.log('Classified category:', classified.category);
  
  // pendingDecision ではなく contactImport が拾うべき
  assert(
    classified.category === 'contact.import.confirm',
    `Should be "contact.import.confirm" but got "${classified.category}"`
  );
  
  // person_select のpending中に "いいえ" と入力しても pendingDecision が拾わない
  const ctx2: ClassifierContext = {
    user_input: 'いいえ',
    pending_state: pendingState(PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT, 'pa-ci-2'),
    user_id: 'u1',
    current_ambiguous_entry_index: 0,
  };
  const classified2 = chain.classify(ctx2);
  console.log('Classified category 2:', classified2.category);
  
  // person_select中の "いいえ" はどのclassifierにもマッチしない → unknown
  // （person_selectは番号/0/スキップのみ受け付ける）
  assert(
    classified2.category !== 'pending.decision',
    'pendingDecision should NOT steal this'
  );

  console.log('  ✅ Test 4 PASSED: pendingDecision と contactImport の衝突ゼロ');
}

// ============================================================
// Assertion Helper
// ============================================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ============================================================
// Run All Tests
// ============================================================

async function runAllTests() {
  console.log('🧪 Contact Import Flow Tests - 事故ゼロ検証\n');
  console.log('='.repeat(60));

  try {
    await test_ambiguous_select_confirm_create();
    await test_ambiguous_cancel_zero_writes();
    await test_new_and_skip_options();
    await test_pending_decision_does_not_steal_contact_import();

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ TEST FAILED:', error);
    console.error('='.repeat(60));
    throw error;
  }
}

runAllTests();
