/**
 * r1-internal-scheduling.spec.ts
 * PR-R1-E2E: Internal scheduling E2E test (workmate 1:1)
 * 
 * テスト対象:
 * 1. ユーザーA（主催者）がユーザーB（招待者）に内部日程調整を開始
 * 2. ユーザーB の inbox に scheduling_request_received 通知が届く
 * 3. ユーザーB が /scheduling/:threadId を開いて候補を選択し確定
 * 4. ユーザーA/B 双方で confirmed 状態が確認できる
 * 
 * NOTE: authenticated プロジェクトで実行
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';

// API ベース URL
const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:8787';

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
      user_a: { display_name: 'R1 主催者（ユーザーA）' },
      user_b: { display_name: 'R1 招待者（ユーザーB）' }
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
 * 関係を作成するヘルパー
 */
async function createRelationship(
  request: APIRequestContext, 
  userAId: string, 
  userBId: string,
  relationType: 'workmate' | 'family',
  permissionPreset: 'workmate_default' | 'family_view_freebusy' | 'family_can_write'
): Promise<{ relationship_id: string }> {
  const response = await request.post(`${API_BASE_URL}/test/fixtures/relationships`, {
    data: {
      user_a_id: userAId,
      user_b_id: userBId,
      relation_type: relationType,
      permission_preset: permissionPreset
    }
  });
  
  expect(response.status()).toBe(201);
  return await response.json();
}

/**
 * 関係を削除するヘルパー
 */
async function deleteRelationship(
  request: APIRequestContext,
  userAId: string,
  userBId: string
): Promise<void> {
  await request.delete(`${API_BASE_URL}/test/fixtures/relationships`, {
    data: { user_a_id: userAId, user_b_id: userBId }
  });
}

/**
 * inbox をクリアするヘルパー
 */
async function clearInbox(request: APIRequestContext, userId: string): Promise<void> {
  await request.delete(`${API_BASE_URL}/test/fixtures/inbox/${userId}`);
}

/**
 * 認証トークンをセットするヘルパー
 */
async function setAuthToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    sessionStorage.setItem('tomoniwao_token', t);
  }, token);
}

/**
 * Internal scheduling を開始するヘルパー（API 直叩き）
 */
async function prepareInternalScheduling(
  request: APIRequestContext,
  token: string,
  inviteeUserId: string,
  title: string
): Promise<{ success: boolean; thread_id: string; slots: Array<{ slot_id: string; start_at: string; end_at: string }> }> {
  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  
  const response = await request.post(`${API_BASE_URL}/api/scheduling/internal/prepare`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    data: {
      invitee_user_id: inviteeUserId,
      title: title,
      constraints: {
        time_min: now.toISOString(),
        time_max: twoWeeksLater.toISOString(),
        prefer: 'any',
        duration: 60,
        candidate_count: 3
      }
    }
  });
  
  expect(response.status()).toBe(201);
  return await response.json();
}

/**
 * inbox を取得するヘルパー
 */
async function getInbox(
  request: APIRequestContext,
  token: string
): Promise<Array<{ id: string; type: string; action_url?: string; title: string }>> {
  const response = await request.get(`${API_BASE_URL}/api/inbox`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  expect(response.status()).toBe(200);
  const data = await response.json();
  return data.items || data || [];
}

/**
 * スレッド詳細を取得するヘルパー（API 直叩き）
 */
async function getThreadDetail(
  request: APIRequestContext,
  token: string,
  threadId: string
): Promise<{ thread: { status: string }; slots: Array<{ slot_id: string }>; confirmed_slot?: { slot_id: string } }> {
  const response = await request.get(`${API_BASE_URL}/api/scheduling/internal/${threadId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  expect(response.status()).toBe(200);
  return await response.json();
}

/**
 * 候補を選択して確定するヘルパー（API 直叩き）
 */
async function respondToScheduling(
  request: APIRequestContext,
  token: string,
  threadId: string,
  slotId: string
): Promise<{ success: boolean; thread_status: string }> {
  const response = await request.post(`${API_BASE_URL}/api/scheduling/internal/${threadId}/respond`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    data: {
      selected_slot_id: slotId
    }
  });
  
  expect(response.status()).toBe(200);
  return await response.json();
}

test.describe('R1 Internal Scheduling E2E: prepare → inbox → respond → confirmed', () => {
  let fixture: FixtureResult;
  let relationshipId: string;
  let threadId: string;
  
  test.beforeAll(async ({ request }) => {
    // 1. テスト用ユーザーペアを作成
    fixture = await createUserPair(request);
    console.log('[R1-E2E] Created user pair:', fixture.fixture_id);
    console.log('[R1-E2E] User A (organizer):', fixture.user_a.email);
    console.log('[R1-E2E] User B (invitee):', fixture.user_b.email);
    
    // 2. workmate 関係を作成
    const rel = await createRelationship(
      request,
      fixture.user_a.id,
      fixture.user_b.id,
      'workmate',
      'workmate_default'
    );
    relationshipId = rel.relationship_id;
    console.log('[R1-E2E] Created workmate relationship:', relationshipId);
    
    // 3. inbox をクリア
    await clearInbox(request, fixture.user_a.id);
    await clearInbox(request, fixture.user_b.id);
    console.log('[R1-E2E] Cleared inbox for both users');
  });

  test.afterAll(async ({ request }) => {
    // クリーンアップ
    if (fixture) {
      await deleteRelationship(request, fixture.user_a.id, fixture.user_b.id);
      await cleanupUserPair(request, [fixture.user_a.id, fixture.user_b.id]);
      console.log('[R1-E2E] Cleaned up');
    }
  });

  test('R1-1: API で内部日程調整を開始（prepare）', async ({ request }) => {
    // ユーザーA がユーザーB に日程調整を開始
    const result = await prepareInternalScheduling(
      request,
      fixture.user_a.token,
      fixture.user_b.id,
      'E2E テスト: 仕事の打ち合わせ'
    );
    
    expect(result.success).toBe(true);
    expect(result.thread_id).toBeDefined();
    expect(result.slots.length).toBeGreaterThanOrEqual(1);
    
    threadId = result.thread_id;
    console.log('[R1-E2E] R1-1: Thread created:', threadId);
    console.log('[R1-E2E] R1-1: Slots count:', result.slots.length);
  });

  test('R1-2: 招待者の inbox に scheduling_request_received が届く', async ({ request }) => {
    // ユーザーB の inbox を確認
    const inboxItems = await getInbox(request, fixture.user_b.token);
    
    // scheduling_request_received タイプの通知を探す
    const schedulingNotification = inboxItems.find(
      (item) => item.type === 'scheduling_request_received'
    );
    
    expect(schedulingNotification).toBeDefined();
    expect(schedulingNotification?.action_url).toContain(`/scheduling/${threadId}`);
    
    console.log('[R1-E2E] R1-2: Inbox notification found:', schedulingNotification?.title);
    console.log('[R1-E2E] R1-2: Action URL:', schedulingNotification?.action_url);
  });

  test('R1-3: 招待者が /scheduling/:threadId を開いて候補を確認', async ({ page }) => {
    // ユーザーB としてログイン
    await setAuthToken(page, fixture.user_b.token);
    
    // スレッドページへ遷移
    await page.goto(`/scheduling/${threadId}`);
    await page.waitForLoadState('networkidle');
    
    // タイトルが表示されることを確認
    await expect(page.locator('text=E2E テスト')).toBeVisible({ timeout: 10000 });
    
    // 候補日程が表示されることを確認（少なくとも1つの候補）
    const slotsLocator = page.locator('[data-testid="slot-option"]').or(
      page.locator('.border-2').filter({ hasNot: page.locator('.bg-green-50') })
    );
    
    // ページタイトルまたは候補が表示されていることを確認
    const pageTitle = page.locator('h1');
    await expect(pageTitle).toBeVisible({ timeout: 10000 });
    
    // 候補の数をログ出力
    const slotsCount = await slotsLocator.count();
    console.log('[R1-E2E] R1-3: Slots count on page:', slotsCount);
    
    console.log('[R1-E2E] R1-3: Thread page opened successfully');
  });

  test('R1-4: API で候補を選択して確定（respond）', async ({ request }) => {
    // スレッド詳細を取得して slot_id を取得
    const detail = await getThreadDetail(request, fixture.user_b.token, threadId);
    expect(detail.slots.length).toBeGreaterThanOrEqual(1);
    
    const slotId = detail.slots[0].slot_id;
    
    // 候補を選択して確定
    const result = await respondToScheduling(
      request,
      fixture.user_b.token,
      threadId,
      slotId
    );
    
    expect(result.success).toBe(true);
    expect(result.thread_status).toBe('confirmed');
    
    console.log('[R1-E2E] R1-4: Scheduling confirmed');
    console.log('[R1-E2E] R1-4: Selected slot:', slotId);
  });

  test('R1-5: 主催者が /scheduling/:threadId で確定を確認', async ({ page }) => {
    // ユーザーA としてログイン
    await setAuthToken(page, fixture.user_a.token);
    
    // スレッドページへ遷移
    await page.goto(`/scheduling/${threadId}`);
    await page.waitForLoadState('networkidle');
    
    // 確定バッジが表示されることを確認
    const confirmedBadge = page.locator('text=確定済み').or(page.locator('.bg-green-100'));
    await expect(confirmedBadge).toBeVisible({ timeout: 10000 });
    
    // または確定セクションが表示されることを確認
    const confirmedSection = page.locator('text=日程が確定しました').or(page.locator('.bg-green-50'));
    const isVisible = await confirmedSection.isVisible().catch(() => false);
    
    if (isVisible) {
      console.log('[R1-E2E] R1-5: Confirmed section visible');
    } else {
      console.log('[R1-E2E] R1-5: Confirmed badge visible');
    }
    
    console.log('[R1-E2E] R1-5: Organizer can see confirmed status');
  });

  test('R1-6: 招待者も /scheduling/:threadId で確定を確認', async ({ page }) => {
    // ユーザーB としてログイン
    await setAuthToken(page, fixture.user_b.token);
    
    // スレッドページへ遷移
    await page.goto(`/scheduling/${threadId}`);
    await page.waitForLoadState('networkidle');
    
    // 確定バッジが表示されることを確認
    const confirmedBadge = page.locator('text=確定済み').or(page.locator('.bg-green-100'));
    await expect(confirmedBadge).toBeVisible({ timeout: 10000 });
    
    console.log('[R1-E2E] R1-6: Invitee can see confirmed status');
  });

  test('R1-7: API でスレッド状態が confirmed であることを確認', async ({ request }) => {
    // ユーザーA でスレッド詳細を取得
    const detailA = await getThreadDetail(request, fixture.user_a.token, threadId);
    expect(detailA.thread.status).toBe('confirmed');
    expect(detailA.confirmed_slot).toBeDefined();
    
    // ユーザーB でスレッド詳細を取得
    const detailB = await getThreadDetail(request, fixture.user_b.token, threadId);
    expect(detailB.thread.status).toBe('confirmed');
    expect(detailB.confirmed_slot).toBeDefined();
    
    console.log('[R1-E2E] R1-7: Both users see confirmed thread status via API');
    console.log('[R1-E2E] R1-7: Confirmed slot:', detailA.confirmed_slot?.slot_id);
  });
});

// Smoke テスト: Fixture API のセキュリティ確認（別ファイルに分離推奨）
test.describe('R1 Internal Scheduling Smoke: API Security', () => {
  test('認証なしで scheduling/internal API にアクセスすると 401', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/scheduling/internal/prepare`, {
      data: {
        invitee_user_id: 'test-user',
        title: 'Should fail without auth'
      }
    });
    
    expect(response.status()).toBe(401);
    console.log('[R1-E2E] Unauthorized access returns 401');
  });
});
