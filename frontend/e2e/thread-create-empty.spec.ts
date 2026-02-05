/**
 * thread-create-empty.spec.ts
 * E2E: 新規スレッド作成時の空状態検証
 * 
 * SSOT要件:
 * - 新規スレッド作成直後は空状態（invitee=0, slots=0, リンク無し, 状態は draft）
 * - seed_mode: 'empty' がデフォルト動作
 * - 旧挙動（デモ用）は seed_mode: 'legacy_default_slots' で再現可能
 */

import { test, expect } from '@playwright/test';
import {
  waitForUIStable,
  assertNoErrorEnhanced,
} from './helpers/test-helpers';

test.describe('Thread Create: SSOT Empty State', () => {
  // 各テストの前に認証を設定
  test.beforeEach(async ({ page }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (authToken) {
      await page.goto('/');
      await page.evaluate((token) => {
        sessionStorage.setItem('tomoniwao_token', token);
        sessionStorage.setItem('tomoniwao_user', JSON.stringify({
          id: 'e2e-test-user',
          email: 'e2e@example.com',
          name: 'E2E Test User',
        }));
      }, authToken);
    }
  });

  // ============================================================
  // Test: 新規スレッド作成時に invites=0, slots=0 を検証
  // ============================================================
  
  test('新規スレッド作成後、invites=0, slots=0 であること', async ({ page, request }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (!authToken) {
      test.skip();
      return;
    }

    // 1. API経由でスレッドを作成（seed_mode: 'empty'）
    const createResponse = await request.post('/api/threads', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: 'E2E Empty Thread Test',
        description: 'Testing SSOT empty state',
        seed_mode: 'empty',  // 明示的に空状態を指定
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const createResult = await createResponse.json();
    
    // スレッドが作成されたことを確認
    expect(createResult.thread).toBeDefined();
    expect(createResult.thread.id).toBeDefined();
    expect(createResult.thread.status).toBe('draft');
    
    const threadId = createResult.thread.id;
    console.log(`[E2E] Created empty thread: ${threadId}`);

    // 2. candidates が空（または undefined/null）であることを確認
    const candidates = createResult.candidates || [];
    expect(candidates.length).toBe(0);
    console.log(`[E2E] Candidates count: ${candidates.length} (expected: 0)`);

    // 3. API経由でスレッドのステータスを取得
    const statusResponse = await request.get(`/api/threads/${threadId}/status`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    expect(statusResponse.ok()).toBeTruthy();
    const statusResult = await statusResponse.json();

    // 4. invites が空であることを確認
    const invites = statusResult.invites || [];
    expect(invites.length).toBe(0);
    console.log(`[E2E] Invites count: ${invites.length} (expected: 0)`);

    // 5. slots が空であることを確認
    const slots = statusResult.slots || [];
    expect(slots.length).toBe(0);
    console.log(`[E2E] Slots count: ${slots.length} (expected: 0)`);

    // 6. ステータスが draft であることを確認
    expect(statusResult.status).toBe('draft');
    console.log(`[E2E] Status: ${statusResult.status} (expected: draft)`);

    console.log('[E2E] ✅ SSOT Empty State Test PASSED');
  });

  // ============================================================
  // Test: seed_mode が未指定でもデフォルトで empty になること
  // ============================================================

  test('seed_mode 未指定時もデフォルトで空状態', async ({ page, request }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (!authToken) {
      test.skip();
      return;
    }

    // seed_mode を指定せずに作成
    const createResponse = await request.post('/api/threads', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: 'E2E Default Mode Test',
        // seed_mode は未指定（デフォルトで 'empty' になるはず）
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const createResult = await createResponse.json();
    const threadId = createResult.thread.id;

    // ステータス取得
    const statusResponse = await request.get(`/api/threads/${threadId}/status`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    expect(statusResponse.ok()).toBeTruthy();
    const statusResult = await statusResponse.json();

    // デフォルトでも空状態であること
    const invites = statusResult.invites || [];
    const slots = statusResult.slots || [];
    
    expect(invites.length).toBe(0);
    expect(slots.length).toBe(0);
    expect(statusResult.status).toBe('draft');

    console.log('[E2E] ✅ Default Empty Mode Test PASSED');
  });

  // ============================================================
  // Test: UIで新規スレッド作成後、右ペインに空状態が表示されること
  // ============================================================

  test('UI: 新規スレッド作成後、空状態表示が正しいこと', async ({ page }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (!authToken) {
      test.skip();
      return;
    }

    // /threads/new にアクセス
    await page.goto('/threads/new');
    await waitForUIStable(page);

    // タイトルを入力
    const titleInput = page.locator('input[name="title"], input[placeholder*="タイトル"]');
    await titleInput.fill('E2E UI Test Thread');

    // 作成ボタンをクリック
    const createButton = page.locator('button:has-text("作成")');
    await createButton.click();

    // スレッド詳細ページにリダイレクトされるのを待つ
    await page.waitForURL(/\/threads\/[a-f0-9-]+/, { timeout: 10000 });
    await waitForUIStable(page);

    // エラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 右ペインの空状態メッセージを確認
    // SlotsCard: 「候補日時はまだありません」
    const slotsEmptyMessage = page.locator('text=候補日時はまだありません');
    // InvitesCard: 「招待者はまだいません」
    const invitesEmptyMessage = page.locator('text=招待者はまだいません');

    // どちらかの空状態メッセージが表示されていることを確認
    const hasEmptySlots = await slotsEmptyMessage.isVisible().catch(() => false);
    const hasEmptyInvites = await invitesEmptyMessage.isVisible().catch(() => false);

    // 少なくとも一つの空状態表示があること
    expect(hasEmptySlots || hasEmptyInvites).toBeTruthy();
    
    console.log('[E2E] ✅ UI Empty State Display Test PASSED');
  });

  // ============================================================
  // Test: legacy_default_slots モードで旧挙動が再現されること
  // ============================================================

  test('legacy_default_slots モードでデフォルトスロットが作成される', async ({ page, request }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (!authToken) {
      test.skip();
      return;
    }

    // seed_mode: 'legacy_default_slots' で作成
    const createResponse = await request.post('/api/threads', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: 'E2E Legacy Mode Test',
        seed_mode: 'legacy_default_slots',
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const createResult = await createResponse.json();
    const threadId = createResult.thread.id;

    // ステータス取得
    const statusResponse = await request.get(`/api/threads/${threadId}/status`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    expect(statusResponse.ok()).toBeTruthy();
    const statusResult = await statusResponse.json();

    // legacy モードではデフォルトスロットが作成されること
    const slots = statusResult.slots || [];
    expect(slots.length).toBe(3); // デフォルトで3つのスロット
    console.log(`[E2E] Legacy slots count: ${slots.length} (expected: 3)`);

    console.log('[E2E] ✅ Legacy Default Slots Mode Test PASSED');
  });
});
