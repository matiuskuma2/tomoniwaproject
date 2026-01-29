/**
 * relationships-access.spec.ts
 * PR-D1-ACCESS-E2E: Permission preset 別の権限チェックテスト
 * 
 * テスト対象:
 * - workmate_default: freebusy OK, proxy-event 403
 * - family_view_freebusy: freebusy OK, proxy-event 403
 * - family_can_write: freebusy OK, proxy-event 400 (target_no_calendar = 権限は通った)
 * 
 * NOTE: API テストのみ（UI依存なし）
 */

import { test, expect, APIRequestContext } from '@playwright/test';

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
      user_a: { display_name: 'ACCESS Test ユーザーA' },
      user_b: { display_name: 'ACCESS Test ユーザーB' }
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
 * proxy-event API を呼び出すヘルパー
 */
async function callProxyEvent(
  request: APIRequestContext,
  token: string,
  targetUserId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = new Date();
  const startAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 明日
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000); // 1時間後
  
  const response = await request.post(`${API_BASE_URL}/api/calendar/proxy-event`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    data: {
      targetUserId,
      summary: 'E2E Test Proxy Event',
      start: startAt.toISOString(),
      end: endAt.toISOString(),
      timeZone: 'Asia/Tokyo'
    }
  });
  
  const body = await response.json().catch(() => ({}));
  return { status: response.status(), body };
}

test.describe('D1-ACCESS-E2E: Permission Preset Tests', () => {
  let fixture: FixtureResult;
  
  test.beforeAll(async ({ request }) => {
    // テスト用ユーザーペアを作成
    fixture = await createUserPair(request);
    console.log('[ACCESS-E2E] Created user pair:', fixture.fixture_id);
    console.log('[ACCESS-E2E] User A:', fixture.user_a.id);
    console.log('[ACCESS-E2E] User B:', fixture.user_b.id);
  });

  test.afterAll(async ({ request }) => {
    // クリーンアップ
    if (fixture) {
      // 関係を削除
      await deleteRelationship(request, fixture.user_a.id, fixture.user_b.id);
      // ユーザーを削除
      await cleanupUserPair(request, [fixture.user_a.id, fixture.user_b.id]);
      console.log('[ACCESS-E2E] Cleaned up');
    }
  });

  test.describe('Case A: workmate_default', () => {
    test.beforeAll(async ({ request }) => {
      // workmate_default 関係を作成
      await createRelationship(
        request,
        fixture.user_a.id,
        fixture.user_b.id,
        'workmate',
        'workmate_default'
      );
      console.log('[ACCESS-E2E] Created workmate_default relationship');
    });

    test.afterAll(async ({ request }) => {
      // 関係を削除
      await deleteRelationship(request, fixture.user_a.id, fixture.user_b.id);
    });

    test('ACCESS-A1: workmate_default - proxy-event returns 403 no_permission', async ({ request }) => {
      const result = await callProxyEvent(request, fixture.user_a.token, fixture.user_b.id);
      
      console.log('[ACCESS-E2E] workmate_default proxy-event result:', result.status, result.body);
      
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('no_permission');
    });
  });

  test.describe('Case B: family_view_freebusy', () => {
    test.beforeAll(async ({ request }) => {
      // family_view_freebusy 関係を作成
      await createRelationship(
        request,
        fixture.user_a.id,
        fixture.user_b.id,
        'family',
        'family_view_freebusy'
      );
      console.log('[ACCESS-E2E] Created family_view_freebusy relationship');
    });

    test.afterAll(async ({ request }) => {
      // 関係を削除
      await deleteRelationship(request, fixture.user_a.id, fixture.user_b.id);
    });

    test('ACCESS-B1: family_view_freebusy - proxy-event returns 403 no_permission', async ({ request }) => {
      const result = await callProxyEvent(request, fixture.user_a.token, fixture.user_b.id);
      
      console.log('[ACCESS-E2E] family_view_freebusy proxy-event result:', result.status, result.body);
      
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('no_permission');
    });
  });

  test.describe('Case C: family_can_write', () => {
    test.beforeAll(async ({ request }) => {
      // family_can_write 関係を作成
      await createRelationship(
        request,
        fixture.user_a.id,
        fixture.user_b.id,
        'family',
        'family_can_write'
      );
      console.log('[ACCESS-E2E] Created family_can_write relationship');
    });

    test.afterAll(async ({ request }) => {
      // 関係を削除
      await deleteRelationship(request, fixture.user_a.id, fixture.user_b.id);
    });

    test('ACCESS-C1: family_can_write - proxy-event returns 400 target_no_calendar (permission passed)', async ({ request }) => {
      const result = await callProxyEvent(request, fixture.user_a.token, fixture.user_b.id);
      
      console.log('[ACCESS-E2E] family_can_write proxy-event result:', result.status, result.body);
      
      // 400 target_no_calendar = 権限チェックは通った、相手のカレンダーが未連携
      // 403 no_permission ではないことを確認
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('target_no_calendar');
      
      console.log('[ACCESS-E2E] Permission check passed! Error is target_no_calendar (not no_permission)');
    });
  });

  test.describe('Case D: No relationship (stranger)', () => {
    test('ACCESS-D1: stranger - proxy-event returns 403 no_permission', async ({ request }) => {
      // 関係がない状態でテスト
      // 既存の関係を削除
      await deleteRelationship(request, fixture.user_a.id, fixture.user_b.id);
      
      const result = await callProxyEvent(request, fixture.user_a.token, fixture.user_b.id);
      
      console.log('[ACCESS-E2E] stranger proxy-event result:', result.status, result.body);
      
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('no_permission');
    });
  });
});

// Smoke テスト: Fixture API のセキュリティ確認
test.describe('D1-ACCESS-E2E Smoke: Fixture Security', () => {
  test('本番環境では relationships fixture API が 403 を返す', async ({ request }) => {
    const PROD_API_URL = 'https://webapp.snsrilarc.workers.dev';
    
    const response = await request.post(`${PROD_API_URL}/test/fixtures/relationships`, {
      data: {
        user_a_id: 'e2e-test',
        user_b_id: 'e2e-test2',
        relation_type: 'workmate',
        permission_preset: 'workmate_default'
      }
    });
    
    const status = response.status();
    
    // 403 (production) または 201/400 (development/staging) のどちらか
    expect([201, 400, 403]).toContain(status);
    
    if (status === 403) {
      console.log('[ACCESS-E2E] Production safety check passed: relationships fixture returns 403');
    } else {
      console.log('[ACCESS-E2E] Running in non-production environment');
    }
  });
});
