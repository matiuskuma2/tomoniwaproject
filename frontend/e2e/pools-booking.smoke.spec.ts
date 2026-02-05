/**
 * pools-booking.smoke.spec.ts
 * G2-A Pool Booking API Smoke Tests
 * 
 * テスト対象:
 * 1. Pool作成ができる
 * 2. Member追加ができる
 * 3. Slot作成ができる
 * 4. 予約（book）ができる
 * 5. 公開リンク（public-link）が取得できる
 * 6. 予約キャンセル（cancel）ができる
 * 7. ブロック機能が動作する
 * 
 * NOTE: API レベルのスモークテスト
 */

import { test, expect, APIRequestContext } from '@playwright/test';

// API ベース URL
// NOTE: Development 環境では port 3000 で wrangler が動作
const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3000';

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

interface PoolInfo {
  id: string;
  name: string;
  workspace_id: string;
}

interface SlotInfo {
  id: string;
  pool_id: string;
  start_at: string;
  end_at: string;
  status: string;
}

/**
 * ユーザーペアを作成するヘルパー
 */
async function createUserPair(request: APIRequestContext, suffix: string = ''): Promise<FixtureResult> {
  const response = await request.post(`${API_BASE_URL}/test/fixtures/users/pair`, {
    data: {
      user_a: { display_name: `E2E Pool オーナー${suffix}` },
      user_b: { display_name: `E2E Pool 申込者${suffix}` }
    }
  });
  
  if (response.status() !== 201) {
    const text = await response.text();
    throw new Error(`Failed to create user pair: ${response.status()} - ${text}`);
  }
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
 * API リクエストヘルパー（認証付き）
 * NOTE: Development環境では x-user-id ヘッダーを使用
 *       token は実際には user_id が入っている（E2E fixture）
 */
async function apiRequest(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  token: string,
  data?: object
): Promise<{ status: number; body: any }> {
  const options: any = {
    headers: {
      // Development環境: x-user-id ヘッダーを使用
      'x-user-id': token,
      'Content-Type': 'application/json',
    }
  };
  
  if (data) {
    options.data = data;
  }
  
  let response;
  switch (method) {
    case 'GET':
      response = await request.get(`${API_BASE_URL}${path}`, options);
      break;
    case 'POST':
      response = await request.post(`${API_BASE_URL}${path}`, options);
      break;
    case 'PATCH':
      response = await request.patch(`${API_BASE_URL}${path}`, options);
      break;
    case 'DELETE':
      response = await request.delete(`${API_BASE_URL}${path}`, options);
      break;
  }
  
  const body = await response.json().catch(() => null);
  return { status: response.status(), body };
}

test.describe.serial('G2-A Pool Booking API Smoke Tests', () => {
  let fixture: FixtureResult;
  let poolId: string;
  let slotId: string;
  let bookingId: string;
  let poolName: string; // 一意のプール名を保持
  
  test.beforeAll(async ({ request }) => {
    // テスト用ユーザーペアを作成
    fixture = await createUserPair(request, ' (Pools)');
    // 一意のプール名を生成
    poolName = `E2E Test Pool ${Date.now()}`;
    console.log('[E2E-Pools] Created user pair:', fixture.fixture_id);
    console.log('[E2E-Pools] User A (owner):', fixture.user_a.email);
    console.log('[E2E-Pools] User B (requester):', fixture.user_b.email);
  });

  test.afterAll(async ({ request }) => {
    // クリーンアップ
    if (fixture) {
      await cleanupUserPair(request, [fixture.user_a.id, fixture.user_b.id]);
      console.log('[E2E-Pools] Cleaned up user pair');
    }
  });

  test('POOL-1: Pool作成ができる', async ({ request }) => {
    const result = await apiRequest(request, 'POST', '/api/pools', fixture.user_a.token, {
      name: poolName,
      description: 'E2E テスト用プール'
    });
    
    expect(result.status).toBe(201);
    expect(result.body.pool).toBeDefined();
    expect(result.body.pool.name).toBe(poolName);
    
    poolId = result.body.pool.id;
    console.log('[E2E-Pools] POOL-1: Pool created:', poolId);
  });

  test('POOL-2: Member追加ができる', async ({ request }) => {
    // オーナー（user_a）がリクエスター（user_b）をメンバーとして追加
    const result = await apiRequest(request, 'POST', `/api/pools/${poolId}/members`, fixture.user_a.token, {
      user_id: fixture.user_a.id // オーナー自身をメンバーに追加（round-robin 用）
    });
    
    expect(result.status).toBe(201);
    expect(result.body.member).toBeDefined();
    
    console.log('[E2E-Pools] POOL-2: Member added');
  });

  test('POOL-3: Slot作成ができる', async ({ request }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    
    const endTime = new Date(tomorrow);
    endTime.setHours(11, 0, 0, 0);
    
    const result = await apiRequest(request, 'POST', `/api/pools/${poolId}/slots`, fixture.user_a.token, {
      start_at: tomorrow.toISOString(),
      end_at: endTime.toISOString(),
      label: 'E2E テスト枠'
    });
    
    expect(result.status).toBe(201);
    expect(result.body.slots).toBeDefined();
    expect(result.body.slots.length).toBe(1);
    
    slotId = result.body.slots[0].id;
    console.log('[E2E-Pools] POOL-3: Slot created:', slotId);
  });

  test('POOL-4: 予約（book）ができる', async ({ request }) => {
    const result = await apiRequest(request, 'POST', `/api/pools/${poolId}/book`, fixture.user_b.token, {
      slot_id: slotId,
      note: 'E2E テスト予約'
    });
    
    expect(result.status).toBe(201);
    expect(result.body.booking_id).toBeDefined();
    expect(result.body.status).toBe('confirmed');
    
    bookingId = result.body.booking_id;
    console.log('[E2E-Pools] POOL-4: Booking created:', bookingId);
  });

  test('POOL-5: 公開リンク（public-link）が取得できる', async ({ request }) => {
    const result = await apiRequest(request, 'GET', `/api/pools/${poolId}/public-link`, fixture.user_a.token);
    
    expect(result.status).toBe(200);
    expect(result.body.public_link_token).toBeDefined();
    expect(result.body.public_url).toBeDefined();
    expect(result.body.pool_name).toBe(poolName);
    
    console.log('[E2E-Pools] POOL-5: Public link:', result.body.public_url);
  });

  test('POOL-6: 予約キャンセル（cancel）ができる', async ({ request }) => {
    const result = await apiRequest(
      request, 
      'PATCH', 
      `/api/pools/${poolId}/bookings/${bookingId}/cancel`, 
      fixture.user_b.token,
      { reason: 'E2E テストキャンセル' }
    );
    
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.booking.status).toBe('cancelled');
    
    console.log('[E2E-Pools] POOL-6: Booking cancelled');
  });

  test('POOL-7: キャンセル後にスロットが open に戻る', async ({ request }) => {
    const result = await apiRequest(request, 'GET', `/api/pools/${poolId}/slots`, fixture.user_a.token);
    
    expect(result.status).toBe(200);
    
    const slot = result.body.slots.find((s: SlotInfo) => s.id === slotId);
    expect(slot).toBeDefined();
    expect(slot.status).toBe('open');
    
    console.log('[E2E-Pools] POOL-7: Slot status is open again');
  });
});

test.describe.serial('D0 Relationships Block API Smoke Tests', () => {
  let fixture: FixtureResult;
  
  test.beforeAll(async ({ request }) => {
    fixture = await createUserPair(request, ' (Block)');
    console.log('[E2E-Block] Created user pair:', fixture.fixture_id);
  });

  test.afterAll(async ({ request }) => {
    if (fixture) {
      await cleanupUserPair(request, [fixture.user_a.id, fixture.user_b.id]);
      console.log('[E2E-Block] Cleaned up user pair');
    }
  });

  test('BLOCK-1: ユーザーをブロックできる', async ({ request }) => {
    const result = await apiRequest(request, 'POST', '/api/relationships/block', fixture.user_a.token, {
      target_user_id: fixture.user_b.id,
      reason: 'E2E テストブロック'
    });
    
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.block_id).toBeDefined();
    
    console.log('[E2E-Block] BLOCK-1: User blocked');
  });

  test('BLOCK-2: ブロック一覧を取得できる', async ({ request }) => {
    const result = await apiRequest(request, 'GET', '/api/relationships/blocked', fixture.user_a.token);
    
    expect(result.status).toBe(200);
    expect(result.body.blocked_users).toBeDefined();
    expect(result.body.blocked_users.length).toBeGreaterThan(0);
    
    const blockedUser = result.body.blocked_users.find(
      (b: any) => b.user.id === fixture.user_b.id
    );
    expect(blockedUser).toBeDefined();
    expect(blockedUser.reason).toBe('E2E テストブロック');
    
    console.log('[E2E-Block] BLOCK-2: Block list retrieved');
  });

  test('BLOCK-3: 同じユーザーを重複ブロックできない', async ({ request }) => {
    const result = await apiRequest(request, 'POST', '/api/relationships/block', fixture.user_a.token, {
      target_user_id: fixture.user_b.id
    });
    
    expect(result.status).toBe(409);
    expect(result.body.error).toContain('already blocked');
    
    console.log('[E2E-Block] BLOCK-3: Duplicate block prevented');
  });

  test('BLOCK-4: ブロックを解除できる', async ({ request }) => {
    const result = await apiRequest(
      request, 
      'DELETE', 
      `/api/relationships/block/${fixture.user_b.id}`, 
      fixture.user_a.token
    );
    
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    
    console.log('[E2E-Block] BLOCK-4: Block removed');
  });

  test('BLOCK-5: 解除後はブロック一覧から消える', async ({ request }) => {
    const result = await apiRequest(request, 'GET', '/api/relationships/blocked', fixture.user_a.token);
    
    expect(result.status).toBe(200);
    
    const blockedUser = result.body.blocked_users.find(
      (b: any) => b.user.id === fixture.user_b.id
    );
    expect(blockedUser).toBeUndefined();
    
    console.log('[E2E-Block] BLOCK-5: User no longer in block list');
  });
});

// Smoke テスト: 重複予約の競合チェック
test.describe.serial('G2-A Pool Booking Conflict Tests', () => {
  let fixture: FixtureResult;
  let poolId: string;
  let slotId: string;
  
  test.beforeAll(async ({ request }) => {
    fixture = await createUserPair(request, ' (Conflict)');
    
    // Pool作成
    const poolResult = await apiRequest(request, 'POST', '/api/pools', fixture.user_a.token, {
      name: 'E2E Conflict Test Pool'
    });
    poolId = poolResult.body.pool.id;
    
    // Member追加
    await apiRequest(request, 'POST', `/api/pools/${poolId}/members`, fixture.user_a.token, {
      user_id: fixture.user_a.id
    });
    
    // Slot作成
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);
    
    const endTime = new Date(tomorrow);
    endTime.setHours(15, 0, 0, 0);
    
    const slotResult = await apiRequest(request, 'POST', `/api/pools/${poolId}/slots`, fixture.user_a.token, {
      start_at: tomorrow.toISOString(),
      end_at: endTime.toISOString()
    });
    slotId = slotResult.body.slots[0].id;
    
    console.log('[E2E-Conflict] Setup complete: pool=' + poolId + ', slot=' + slotId);
  });

  test.afterAll(async ({ request }) => {
    if (fixture) {
      await cleanupUserPair(request, [fixture.user_a.id, fixture.user_b.id]);
    }
  });

  test('CONFLICT-1: 予約済みスロットへの再予約は409を返す', async ({ request }) => {
    // 最初の予約
    const firstResult = await apiRequest(request, 'POST', `/api/pools/${poolId}/book`, fixture.user_b.token, {
      slot_id: slotId
    });
    expect(firstResult.status).toBe(201);
    
    // 二回目の予約（競合）
    const secondResult = await apiRequest(request, 'POST', `/api/pools/${poolId}/book`, fixture.user_b.token, {
      slot_id: slotId
    });
    expect(secondResult.status).toBe(409);
    expect(secondResult.body.code).toBe('SLOT_TAKEN');
    
    console.log('[E2E-Conflict] CONFLICT-1: Duplicate booking rejected with 409');
  });
});
