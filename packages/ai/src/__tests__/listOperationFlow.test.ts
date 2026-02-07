/**
 * List Operation E2E テスト（PR-D-4: 5本）
 * 
 * 1. リスト作成 → 成功
 * 2. リスト作成 → 重複拒否
 * 3. メンバー追加（単体 + 複数人）
 * 4. メンバー削除
 * 5. リスト一覧 / メンバー表示
 * 
 * 事故ゼロの検証ポイント:
 * - pending中はリスト操作を受け付けない
 * - 存在しないリスト/連絡先はエラー
 * - 重複追加は「既にメンバー」として処理
 */

import { ClassifierChain, type ClassifierContext } from '../classifier';
import { ListOperationExecutor, type ListOperationDeps } from '../executor/listOperationExecutor';
import type { PendingConfirmationState } from '../../../../packages/shared/src/types/pendingAction';

// ============================================================
// Mock Dependencies
// ============================================================

interface MockList {
  id: string;
  name: string;
  description?: string;
  members: Map<string, { contact_id: string; display_name: string; email?: string }>;
}

interface MockContact {
  id: string;
  display_name: string;
  email?: string;
}

function createMockDeps(
  initialContacts: MockContact[] = []
): ListOperationDeps & {
  _lists: Map<string, MockList>;
  _contacts: Map<string, MockContact>;
} {
  const _lists = new Map<string, MockList>();
  const _contacts = new Map<string, MockContact>();

  // 初期連絡先をセット
  for (const c of initialContacts) {
    _contacts.set(c.id, c);
  }

  return {
    _lists,
    _contacts,

    async createList(params) {
      const id = `list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const list: MockList = {
        id,
        name: params.name,
        description: params.description,
        members: new Map(),
      };
      _lists.set(id, list);
      return { id, name: params.name, description: params.description };
    },

    async getLists(userId) {
      return Array.from(_lists.values()).map(l => ({
        id: l.id,
        name: l.name,
        description: l.description,
        member_count: l.members.size,
      }));
    },

    async findListByName(userId, name) {
      for (const l of _lists.values()) {
        if (l.name === name || l.name.includes(name) || name.includes(l.name)) {
          return {
            id: l.id,
            name: l.name,
            description: l.description,
            member_count: l.members.size,
          };
        }
      }
      return null;
    },

    async getListMembers(listId) {
      const list = _lists.get(listId);
      if (!list) return [];
      return Array.from(list.members.values());
    },

    async findContact(userId, query) {
      for (const c of _contacts.values()) {
        if (
          c.display_name.includes(query) ||
          c.email?.includes(query) ||
          query.includes(c.display_name)
        ) {
          return { id: c.id, display_name: c.display_name, email: c.email };
        }
      }
      return null;
    },

    async addMember(listId, contactId) {
      const list = _lists.get(listId);
      if (!list) throw new Error('List not found');
      if (list.members.has(contactId)) {
        throw new Error('Contact is already a member of this list');
      }
      const contact = _contacts.get(contactId);
      if (!contact) throw new Error('Contact not found');
      list.members.set(contactId, {
        contact_id: contact.id,
        display_name: contact.display_name,
        email: contact.email,
      });
    },

    async removeMember(listId, contactId) {
      const list = _lists.get(listId);
      if (!list) throw new Error('List not found');
      list.members.delete(contactId);
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function noPendingState(): PendingConfirmationState {
  return { hasPending: false, kind: null, pending_action_id: null, ui_hint: null };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// テスト用の連絡先
const TEST_CONTACTS: MockContact[] = [
  { id: 'c-tanaka', display_name: '田中太郎', email: 'tanaka@example.com' },
  { id: 'c-sato', display_name: '佐藤花子', email: 'sato@example.com' },
  { id: 'c-yamada', display_name: '山田一郎', email: 'yamada@example.com' },
  { id: 'c-suzuki', display_name: '鈴木次郎', email: 'suzuki@example.com' },
];

// ============================================================
// Test 1: リスト作成 → 成功
// ============================================================

async function test_list_create() {
  console.log('\n=== Test 1: リスト作成 → 成功 ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps();
  const executor = new ListOperationExecutor(deps);
  const userId = 'user-list-1';

  // 「営業チームリスト作って」
  const ctx1: ClassifierContext = {
    user_input: '営業チームリスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  console.log('Classified:', classified1.category, 'params:', classified1.list_params);
  assert(classified1.category === 'list.create', `Should be list.create, got ${classified1.category}`);
  assert(classified1.list_params?.list_name === '営業チーム', `Name should be '営業チーム', got '${classified1.list_params?.list_name}'`);

  const result1 = await executor.execute(classified1, userId);
  console.log('Result:', result1.message);
  assert(result1.success, 'Should succeed');
  assert(result1.data?.list?.name === '営業チーム', 'List name should match');
  assert(deps._lists.size === 1, 'Should have 1 list');

  // 「「ゴルフ仲間」リスト作成」（カッコ付き）
  const ctx2: ClassifierContext = {
    user_input: '「ゴルフ仲間」リスト作成',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified2 = chain.classify(ctx2);
  assert(classified2.category === 'list.create', 'Should be list.create');
  assert(classified2.list_params?.list_name === 'ゴルフ仲間', `Name should be 'ゴルフ仲間', got '${classified2.list_params?.list_name}'`);

  const result2 = await executor.execute(classified2, userId);
  assert(result2.success, 'Should succeed');
  assert(deps._lists.size === 2, 'Should have 2 lists');

  console.log('  ✅ Test 1 PASSED: リスト作成');
}

// ============================================================
// Test 2: リスト作成 → 重複拒否
// ============================================================

async function test_list_create_duplicate() {
  console.log('\n=== Test 2: リスト作成 → 重複拒否 ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps();
  const executor = new ListOperationExecutor(deps);
  const userId = 'user-list-2';

  // 最初の作成
  const ctx1: ClassifierContext = {
    user_input: '営業リスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  const result1 = await executor.execute(classified1, userId);
  assert(result1.success, 'First create should succeed');

  // 同名リスト作成 → 拒否
  const ctx2: ClassifierContext = {
    user_input: '営業リスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified2 = chain.classify(ctx2);
  const result2 = await executor.execute(classified2, userId);
  console.log('Duplicate result:', result2.message);
  assert(!result2.success, 'Should be rejected');
  assert(result2.message.includes('既に存在'), 'Should mention exists');

  console.log('  ✅ Test 2 PASSED: 重複リスト拒否');
}

// ============================================================
// Test 3: メンバー追加（単体 + 複数人）
// ============================================================

async function test_list_add_member() {
  console.log('\n=== Test 3: メンバー追加（単体 + 複数人） ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps(TEST_CONTACTS);
  const executor = new ListOperationExecutor(deps);
  const userId = 'user-list-3';

  // 先にリスト作成
  const createCtx: ClassifierContext = {
    user_input: '営業リスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const createClassified = chain.classify(createCtx);
  await executor.execute(createClassified, userId);
  assert(deps._lists.size === 1, 'List should exist');

  // 単体追加: 「営業リストに田中さん追加」
  const ctx1: ClassifierContext = {
    user_input: '営業リストに田中さん追加',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  console.log('Add classified:', classified1.category, 'params:', classified1.list_params);
  assert(classified1.category === 'list.add_member', `Should be list.add_member, got ${classified1.category}`);

  const result1 = await executor.execute(classified1, userId);
  console.log('Add result:', result1.message);
  assert(result1.success, 'Should succeed');
  assert(result1.data?.added_count === 1, 'Should add 1 member');

  // 複数人追加: 「営業リストに佐藤、山田を追加」
  const ctx2: ClassifierContext = {
    user_input: '営業リストに佐藤、山田を追加',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified2 = chain.classify(ctx2);
  assert(classified2.category === 'list.add_member', 'Should be list.add_member');

  const result2 = await executor.execute(classified2, userId);
  console.log('Multi-add result:', result2.message);
  assert(result2.success, 'Should succeed');
  assert(result2.data?.added_count === 2, `Should add 2 members, got ${result2.data?.added_count}`);

  // リストのメンバー数確認
  const list = Array.from(deps._lists.values())[0];
  assert(list.members.size === 3, `Should have 3 members, got ${list.members.size}`);

  // 存在しない連絡先の追加 → not_found
  const ctx3: ClassifierContext = {
    user_input: '営業リストに高橋さん追加',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified3 = chain.classify(ctx3);
  const result3 = await executor.execute(classified3, userId);
  console.log('Not-found result:', result3.message);
  assert(!result3.success, 'Should fail for unknown contact');
  assert(result3.data?.not_found?.length === 1, 'Should have 1 not found');

  console.log('  ✅ Test 3 PASSED: メンバー追加（単体 + 複数 + 不存在）');
}

// ============================================================
// Test 4: メンバー削除
// ============================================================

async function test_list_remove_member() {
  console.log('\n=== Test 4: メンバー削除 ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps(TEST_CONTACTS);
  const executor = new ListOperationExecutor(deps);
  const userId = 'user-list-4';

  // リスト作成 + メンバー追加
  const createCtx: ClassifierContext = {
    user_input: '営業リスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  await executor.execute(chain.classify(createCtx), userId);

  const addCtx: ClassifierContext = {
    user_input: '営業リストに田中、佐藤を追加',
    pending_state: noPendingState(),
    user_id: userId,
  };
  await executor.execute(chain.classify(addCtx), userId);

  const list = Array.from(deps._lists.values())[0];
  assert(list.members.size === 2, 'Should have 2 members before remove');

  // 「営業リストから田中さん外して」
  const ctx1: ClassifierContext = {
    user_input: '営業リストから田中さん外して',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classified1 = chain.classify(ctx1);
  console.log('Remove classified:', classified1.category, 'params:', classified1.list_params);
  assert(classified1.category === 'list.remove_member', `Should be list.remove_member, got ${classified1.category}`);

  const result1 = await executor.execute(classified1, userId);
  console.log('Remove result:', result1.message);
  assert(result1.success, 'Should succeed');
  assert(list.members.size === 1, `Should have 1 member after remove, got ${list.members.size}`);
  assert(!list.members.has('c-tanaka'), 'Tanaka should be removed');

  console.log('  ✅ Test 4 PASSED: メンバー削除');
}

// ============================================================
// Test 5: リスト一覧 / メンバー表示
// ============================================================

async function test_list_show() {
  console.log('\n=== Test 5: リスト一覧 / メンバー表示 ===\n');

  const chain = new ClassifierChain();
  const deps = createMockDeps(TEST_CONTACTS);
  const executor = new ListOperationExecutor(deps);
  const userId = 'user-list-5';

  // 空の状態でリスト一覧
  const ctxEmpty: ClassifierContext = {
    user_input: 'リスト一覧',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classifiedEmpty = chain.classify(ctxEmpty);
  assert(classifiedEmpty.category === 'list.show', `Should be list.show, got ${classifiedEmpty.category}`);

  const resultEmpty = await executor.execute(classifiedEmpty, userId);
  console.log('Empty list:', resultEmpty.message);
  assert(resultEmpty.success, 'Should succeed');
  assert(resultEmpty.message.includes('まだありません'), 'Should say no lists');

  // リスト作成 + メンバー追加
  const createCtx1: ClassifierContext = {
    user_input: '営業リスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  await executor.execute(chain.classify(createCtx1), userId);

  const createCtx2: ClassifierContext = {
    user_input: 'ゴルフリスト作って',
    pending_state: noPendingState(),
    user_id: userId,
  };
  await executor.execute(chain.classify(createCtx2), userId);

  const addCtx: ClassifierContext = {
    user_input: '営業リストに田中、佐藤を追加',
    pending_state: noPendingState(),
    user_id: userId,
  };
  await executor.execute(chain.classify(addCtx), userId);

  // リスト一覧
  const ctxList: ClassifierContext = {
    user_input: 'リスト一覧表示',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const resultList = await executor.execute(chain.classify(ctxList), userId);
  console.log('List result:', resultList.message);
  assert(resultList.success, 'Should succeed');
  assert(resultList.data?.lists?.length === 2, `Should have 2 lists, got ${resultList.data?.lists?.length}`);
  assert(resultList.message.includes('営業'), 'Should contain 営業');
  assert(resultList.message.includes('ゴルフ'), 'Should contain ゴルフ');

  // 特定リストのメンバー表示
  const ctxMembers: ClassifierContext = {
    user_input: '営業リストのメンバー',
    pending_state: noPendingState(),
    user_id: userId,
  };
  const classifiedMembers = chain.classify(ctxMembers);
  assert(classifiedMembers.category === 'list.show', 'Should be list.show');
  assert(classifiedMembers.list_params?.list_name === '営業', `Should extract name '営業', got '${classifiedMembers.list_params?.list_name}'`);

  const resultMembers = await executor.execute(classifiedMembers, userId);
  console.log('Members result:', resultMembers.message);
  assert(resultMembers.success, 'Should succeed');
  assert(resultMembers.data?.members?.length === 2, `Should have 2 members, got ${resultMembers.data?.members?.length}`);
  assert(resultMembers.message.includes('田中'), 'Should contain 田中');
  assert(resultMembers.message.includes('佐藤'), 'Should contain 佐藤');

  // pending中はリスト操作を受け付けない
  const ctxPending: ClassifierContext = {
    user_input: 'リスト一覧',
    pending_state: { hasPending: true, kind: 'contact_import_confirm', pending_action_id: 'pa-1', ui_hint: null },
    user_id: userId,
  };
  const classifiedPending = chain.classify(ctxPending);
  assert(
    classifiedPending.category !== 'list.show',
    `Pending中はlist.showにならないはず, got ${classifiedPending.category}`
  );
  console.log('  ✅ pending中はリスト操作を受け付けない');

  console.log('  ✅ Test 5 PASSED: リスト一覧 / メンバー表示');
}

// ============================================================
// Run All Tests
// ============================================================

async function runAllTests() {
  console.log('🧪 List Operation Flow Tests - PR-D-4 チャット経由リスト操作\n');
  console.log('='.repeat(60));

  try {
    await test_list_create();
    await test_list_create_duplicate();
    await test_list_add_member();
    await test_list_remove_member();
    await test_list_show();

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL 5 LIST TESTS PASSED');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ LIST TEST FAILED:', error);
    console.error('='.repeat(60));
    throw error;
  }
}

runAllTests();
