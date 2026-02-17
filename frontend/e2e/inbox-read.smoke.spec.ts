/**
 * inbox-read.smoke.spec.ts
 * PR-P0-INBOX-READ: 通知の既読ロジックSSOT化 E2Eテスト
 * 
 * テスト対象（APIベース）:
 * 1. 個別通知を既読にする (PATCH /api/inbox/:id/read)
 * 2. 全通知を既読にする (POST /api/inbox/mark-all-read)
 * 3. 未読カウントが正しく更新される (GET /api/inbox/unread-count)
 * 
 * NOTE: CI環境ではフロントエンド(4173)とAPI(3000)が別サーバーで動作するため
 * ブラウザUI経由の検証は避け、APIを直接テストする（smoke プロジェクト）
 * UIインタラクションテストは authenticated プロジェクトで実施
 */

import { test, expect, APIRequestContext } from '@playwright/test';

// API ベース URL（CI: http://127.0.0.1:3000）
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
 * 認証付きリクエストヘルパー
 */
function authHeaders(token: string): Record<string, string> {
  return { 'Authorization': `Bearer ${token}` };
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

  test('INBOX-READ-1: 個別通知を既読にできる', async ({ request }) => {
    // 1. テスト用通知を作成
    const notification = await createTestNotification(request, fixture.user_a.id);
    console.log('[E2E] Created notification:', notification.id);
    
    // 2. 通知一覧を取得し、未読であることを確認
    const listRes = await request.get(`${API_BASE_URL}/api/inbox`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(listRes.status()).toBe(200);
    const listData = await listRes.json();
    const items = listData.items || listData;
    const targetItem = Array.isArray(items) 
      ? items.find((item: { id: string }) => item.id === notification.id)
      : null;
    expect(targetItem).toBeTruthy();
    expect(targetItem.is_read).toBe(0);
    
    // 3. 通知を既読にする
    const markRes = await request.patch(`${API_BASE_URL}/api/inbox/${notification.id}/read`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(markRes.status()).toBe(200);
    
    // 4. 再度一覧を取得し、既読になっていることを確認
    const listRes2 = await request.get(`${API_BASE_URL}/api/inbox`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(listRes2.status()).toBe(200);
    const listData2 = await listRes2.json();
    const items2 = listData2.items || listData2;
    const updatedItem = Array.isArray(items2) 
      ? items2.find((item: { id: string }) => item.id === notification.id)
      : null;
    expect(updatedItem).toBeTruthy();
    expect(updatedItem.is_read).toBe(1);
    
    console.log('[E2E] Notification marked as read successfully');
  });

  test('INBOX-READ-2: 全既読ボタンで全通知が既読になる', async ({ request }) => {
    // 1. 複数のテスト用通知を作成
    const notification1 = await createTestNotification(request, fixture.user_a.id);
    const notification2 = await createTestNotification(request, fixture.user_a.id);
    console.log('[E2E] Created notifications:', notification1.id, notification2.id);
    
    // 2. 未読数を確認
    const countRes = await request.get(`${API_BASE_URL}/api/inbox/unread-count`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(countRes.status()).toBe(200);
    const countData = await countRes.json();
    expect(countData.unread_count).toBeGreaterThanOrEqual(2);
    
    // 3. 全既読にする
    const markAllRes = await request.post(`${API_BASE_URL}/api/inbox/mark-all-read`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(markAllRes.status()).toBe(200);
    
    // 4. 未読数が0になっていることを確認
    const countRes2 = await request.get(`${API_BASE_URL}/api/inbox/unread-count`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(countRes2.status()).toBe(200);
    const countData2 = await countRes2.json();
    expect(countData2.unread_count).toBe(0);
    
    // 5. 各通知が既読になっていることを確認
    const listRes = await request.get(`${API_BASE_URL}/api/inbox`, {
      headers: authHeaders(fixture.user_a.token)
    });
    const listData = await listRes.json();
    const items = listData.items || listData;
    if (Array.isArray(items)) {
      for (const item of items) {
        expect(item.is_read).toBe(1);
      }
    }
    
    console.log('[E2E] All notifications marked as read successfully');
  });

  test('INBOX-READ-3: 未読カウントが正しく更新される', async ({ request }) => {
    // 1. テスト用通知を2つ作成
    await createTestNotification(request, fixture.user_a.id);
    await createTestNotification(request, fixture.user_a.id);
    
    // 2. 未読数が2以上であることを確認
    const countRes1 = await request.get(`${API_BASE_URL}/api/inbox/unread-count`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(countRes1.status()).toBe(200);
    const countData1 = await countRes1.json();
    const initialCount = countData1.unread_count;
    expect(initialCount).toBeGreaterThanOrEqual(2);
    
    // 3. 全既読にする
    await request.post(`${API_BASE_URL}/api/inbox/mark-all-read`, {
      headers: authHeaders(fixture.user_a.token)
    });
    
    // 4. 未読数が0になることを確認
    const countRes2 = await request.get(`${API_BASE_URL}/api/inbox/unread-count`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(countRes2.status()).toBe(200);
    const countData2 = await countRes2.json();
    expect(countData2.unread_count).toBe(0);
    
    // 5. 新しい通知を追加して未読数が増えることを確認
    await createTestNotification(request, fixture.user_a.id);
    
    const countRes3 = await request.get(`${API_BASE_URL}/api/inbox/unread-count`, {
      headers: authHeaders(fixture.user_a.token)
    });
    expect(countRes3.status()).toBe(200);
    const countData3 = await countRes3.json();
    expect(countData3.unread_count).toBe(1);
    
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
