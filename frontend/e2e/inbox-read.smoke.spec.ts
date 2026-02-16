/**
 * inbox-read.smoke.spec.ts
 * PR-P0-INBOX-READ: 通知の既読ロジックSSOT化 E2Eテスト
 * 
 * テスト対象:
 * 1. 通知クリックで既読になる
 * 2. 未読カウントが減る
 * 3. 全既読ボタンが動作する
 * 4. 既読クリアボタンが動作する
 * 
 * NOTE: authenticated プロジェクトで実行
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';

// API ベース URL
const API_BASE_URL = process.env.E2E_API_BASE_URL || process.env.E2E_API_URL || 'http://localhost:3000';

// フィクスチャで作成したユーザー情報
interface UserInfo {
  id: string;
  email: string;
  display_name: string;
  token: string;
}

interface FixtureResult {
  fixture_id: string;
  user_a: UserInfo;
  user_b: UserInfo;
}

/**
 * ユーザーペアを作成するヘルパー
 */
async function createUserPair(request: APIRequestContext): Promise<FixtureResult> {
  const response = await request.post(`${API_BASE_URL}/test/fixtures/users/pair`, {
    data: {
      user_a: { display_name: 'E2E Inbox ユーザーA' },
      user_b: { display_name: 'E2E Inbox ユーザーB' }
    }
  });
  
  expect(response.status()).toBe(201);
  return await response.json();
}

/**
 * ユーザーペアをクリーンアップするヘルパー
 */
async function cleanupUserPair(request: APIRequestContext, userIds: string[]): Promise<void> {
  await request.delete(`${API_BASE_URL}/test/fixtures/users/pair`, {
    data: { user_ids: userIds }
  });
}

/**
 * 認証トークンをセットし、API プロキシを設定するヘルパー
 * 
 * CI環境: フロントエンド(4173) と API(3000) が別サーバーで動作
 * production ビルドの VITE_API_BASE_URL='' なので /api/* は相対パスになる
 * → Vite preview にはプロキシがないため page.route で API サーバーに転送
 */
async function setupPageAuth(page: Page, token: string): Promise<void> {
  // 1. sessionStorage にトークンを設定
  await page.addInitScript((t) => {
    sessionStorage.setItem('tomoniwao_token', t);
  }, token);
  
  // 2. /api/** リクエストを API サーバーに転送（production ビルド対応）
  // CI環境: フロントエンド(:4173) と API(:3000) が別ポートで動作
  // production ビルドの VITE_API_BASE_URL='' → /api/* は http://127.0.0.1:4173/api/* になる
  // Vite preview にはプロキシがないため page.route で API サーバーに転送
  await page.route(/\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const apiUrl = `${API_BASE_URL}${url.pathname}${url.search}`;
    console.log(`[E2E] API proxy: ${url.pathname} → ${apiUrl}`);
    
    try {
      const headers = { ...route.request().headers() };
      // host ヘッダーを API サーバーに合わせる
      delete headers['host'];
      
      const fetchResponse = await fetch(apiUrl, {
        method: route.request().method(),
        headers,
        body: route.request().method() !== 'GET' ? route.request().postData() : undefined,
      });
      
      const body = await fetchResponse.text();
      await route.fulfill({
        status: fetchResponse.status,
        headers: Object.fromEntries(fetchResponse.headers.entries()),
        body,
      });
    } catch (error) {
      console.error(`[E2E] API proxy failed: ${apiUrl}`, error);
      await route.abort();
    }
  });
}

/**
 * テスト用通知を作成するヘルパー
 */
async function createTestNotification(
  request: APIRequestContext, 
  userId: string
): Promise<{ id: string }> {
  const response = await request.post(`${API_BASE_URL}/test/fixtures/inbox`, {
    data: {
      user_id: userId,
      type: 'test_notification',
      title: 'E2Eテスト通知',
      message: 'これはテスト用の通知です',
      priority: 'normal'
    }
  });
  
  expect(response.status()).toBe(201);
  return await response.json();
}

/**
 * 通知をクリアするヘルパー
 */
async function clearInbox(request: APIRequestContext, userId: string): Promise<void> {
  await request.delete(`${API_BASE_URL}/test/fixtures/inbox/${userId}`);
}

/**
 * 通知の既読状態を取得するヘルパー
 */
async function getInboxItem(
  request: APIRequestContext, 
  itemId: string,
  token: string
): Promise<{ is_read: number }> {
  const response = await request.get(`${API_BASE_URL}/api/inbox/${itemId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  expect(response.status()).toBe(200);
  const data = await response.json();
  return data.item;
}

test.describe('PR-P0-INBOX-READ: 通知の既読SSOT E2Eテスト', () => {
  let fixture: FixtureResult;
  
  test.beforeAll(async ({ request }) => {
    // テスト用ユーザーペアを作成
    fixture = await createUserPair(request);
    console.log('[E2E] Created user pair:', fixture.fixture_id);
  });

  test.afterAll(async ({ request }) => {
    // クリーンアップ
    if (fixture) {
      await cleanupUserPair(request, [fixture.user_a.id, fixture.user_b.id]);
      console.log('[E2E] Cleaned up user pair');
    }
  });

  test.beforeEach(async ({ request }) => {
    // 各テスト前にinboxをクリア
    if (fixture) {
      await clearInbox(request, fixture.user_a.id);
    }
  });

  test('INBOX-READ-1: 通知クリックで既読になる', async ({ page, request }) => {
    // 1. テスト用通知を作成
    const notification = await createTestNotification(request, fixture.user_a.id);
    console.log('[E2E] Created notification:', notification.id);
    
    // 2. ユーザーA としてログイン + API プロキシ設定
    await setupPageAuth(page, fixture.user_a.token);
    
    // 3. チャットページへ遷移
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');
    
    // 4. 未読バッジが表示されるまで待つ（inbox API の応答を待つ）
    const unreadBadge = page.locator('span.bg-red-600');
    await expect(unreadBadge).toBeVisible({ timeout: 15000 });
    const initialCount = await unreadBadge.textContent();
    expect(parseInt(initialCount || '0')).toBeGreaterThan(0);
    
    // 5. NotificationBell をクリックしてドロワーを開く
    const bellButton = page.locator('button').filter({ has: page.locator('svg path[d*="M15 17h5"]') });
    await bellButton.click();
    
    // 6. 通知アイテムをクリック（未読は青背景）
    const notificationItem = page.locator('.bg-blue-50').first();
    await expect(notificationItem).toBeVisible({ timeout: 5000 });
    await notificationItem.click();
    
    // 7. 少し待って状態を確認（即ローカル既読なのですぐ反映されるはず）
    await page.waitForTimeout(1000);
    
    // 8. API で既読になっていることを確認
    const item = await getInboxItem(request, notification.id, fixture.user_a.token);
    expect(item.is_read).toBe(1);
    
    console.log('[E2E] Notification marked as read successfully');
  });

  test('INBOX-READ-2: 全既読ボタンで全通知が既読になる', async ({ page, request }) => {
    // 1. 複数のテスト用通知を作成
    const notification1 = await createTestNotification(request, fixture.user_a.id);
    const notification2 = await createTestNotification(request, fixture.user_a.id);
    console.log('[E2E] Created notifications:', notification1.id, notification2.id);
    
    // 2. ユーザーA としてログイン + API プロキシ設定
    await setupPageAuth(page, fixture.user_a.token);
    
    // 3. チャットページへ遷移
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');
    
    // 4. 未読バッジが表示されるまで待つ
    const unreadBadge = page.locator('span.bg-red-600');
    await expect(unreadBadge).toBeVisible({ timeout: 15000 });
    
    // 5. NotificationBell をクリックしてドロワーを開く
    const bellButton = page.locator('button').filter({ has: page.locator('svg path[d*="M15 17h5"]') });
    await bellButton.click();
    
    // 6. 「すべて既読」ボタンをクリック
    const markAllReadButton = page.locator('button:text("すべて既読")');
    await expect(markAllReadButton).toBeVisible({ timeout: 5000 });
    await markAllReadButton.click();
    
    // 7. 少し待って状態を確認
    await page.waitForTimeout(1500);
    
    // 8. API で全て既読になっていることを確認
    const item1 = await getInboxItem(request, notification1.id, fixture.user_a.token);
    const item2 = await getInboxItem(request, notification2.id, fixture.user_a.token);
    expect(item1.is_read).toBe(1);
    expect(item2.is_read).toBe(1);
    
    console.log('[E2E] All notifications marked as read successfully');
  });

  test('INBOX-READ-3: 未読カウントが正しく更新される', async ({ page, request }) => {
    // 1. テスト用通知を作成
    await createTestNotification(request, fixture.user_a.id);
    await createTestNotification(request, fixture.user_a.id);
    
    // 2. ユーザーA としてログイン + API プロキシ設定
    await setupPageAuth(page, fixture.user_a.token);
    
    // 3. チャットページへ遷移
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');
    
    // 4. NotificationBell の未読バッジを確認
    const bellButton = page.locator('button').filter({ has: page.locator('svg path[d*="M15 17h5"]') });
    const unreadBadge = bellButton.locator('span.bg-red-600');
    
    // 5. 初期の未読数を取得（API応答を待つ）
    await expect(unreadBadge).toBeVisible({ timeout: 15000 });
    const initialCount = parseInt(await unreadBadge.textContent() || '0');
    expect(initialCount).toBeGreaterThanOrEqual(2);
    
    // 6. ドロワーを開く
    await bellButton.click();
    
    // 7. 「すべて既読」をクリック
    const markAllReadButton = page.locator('button:text("すべて既読")');
    await expect(markAllReadButton).toBeVisible({ timeout: 5000 });
    await markAllReadButton.click();
    
    // 8. 未読バッジが消えるか0になることを確認
    await page.waitForTimeout(1500);
    
    // バッジが非表示になるか確認
    const badgeVisible = await unreadBadge.isVisible().catch(() => false);
    if (badgeVisible) {
      const newCount = parseInt(await unreadBadge.textContent() || '0');
      expect(newCount).toBe(0);
    }
    
    console.log('[E2E] Unread count updated correctly');
  });
});

test.describe('PR-P0-INBOX-READ: Smoke Test（認証不要）', () => {
  test('INBOX-SMOKE-1: API エンドポイントが存在する', async ({ request }) => {
    // unread-count エンドポイントへのリクエスト（未認証なので 401 が返る）
    const response = await request.get(`${API_BASE_URL}/api/inbox/unread-count`);
    
    // 401 または 200 であればエンドポイントは存在
    expect([200, 401]).toContain(response.status());
    console.log('[E2E] Inbox API endpoint exists, status:', response.status());
  });
});
