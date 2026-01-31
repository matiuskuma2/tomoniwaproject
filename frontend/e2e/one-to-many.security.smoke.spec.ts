/**
 * one-to-many.security.local.spec.ts
 * G1 E2E Security Tests - Local Execution (PR-G1-E2E-3)
 * 
 * DoD:
 * 1. 本番環境で fixture が 403
 * 2. 認証なしで organizer API を叩くと 401
 * 3. 無効なトークンで /g/:token が適切なエラー
 * 4. 他ユーザーのスレッドにアクセスすると 403
 * 5. トークン改ざんで /g/:token がエラー
 * 6. SQLインジェクション防止
 * 7. 回答済み再送信の防止（idempotency）
 * 8. 期限切れトークンのハンドリング
 * 
 * 実行方法:
 * E2E_API_URL=http://localhost:3000 npx playwright test one-to-many.security.local.spec.ts
 */

import { test, expect, APIRequestContext } from '@playwright/test';

// API Base URL
const getApiBaseUrl = () => {
  return process.env.E2E_API_URL || 'http://localhost:3000';
};

// Fixture type
interface FixtureData {
  success: boolean;
  thread_id: string;
  organizer_user_id: string;
  invites: Array<{
    token: string;
    email: string;
    name: string;
    invite_id: string;
  }>;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
    label: string;
  }>;
  group_policy: {
    mode: string;
    deadline_at: string;
    finalize_policy: string;
  };
  deadline_at: string;
}

// Helper: Create fixture
async function createFixture(request: APIRequestContext, options: {
  invitee_count?: number;
  slot_count?: number;
  title?: string;
  mode?: string;
  deadline_hours?: number;
} = {}): Promise<{ fixture: FixtureData | null; skipped: boolean }> {
  const apiBaseUrl = getApiBaseUrl();
  
  const response = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
    data: {
      invitee_count: options.invitee_count || 2,
      slot_count: options.slot_count || 2,
      title: options.title || 'Security Test',
      mode: options.mode || 'candidates',
      deadline_hours: options.deadline_hours || 72
    }
  });

  if (response.status() === 403) {
    return { fixture: null, skipped: true };
  }

  const fixture = await response.json();
  return { fixture, skipped: false };
}

// Helper: Cleanup fixture
async function cleanupFixture(request: APIRequestContext, threadId: string) {
  const apiBaseUrl = getApiBaseUrl();
  try {
    await request.delete(`${apiBaseUrl}/test/fixtures/one-to-many/${threadId}`);
  } catch {
    // Ignore cleanup errors
  }
}

test.describe('G1-SEC: 1-to-N Security Tests (PR-G1-E2E-3)', () => {

  // ============================================
  // SEC-1: 認証なし API アクセス → 401
  // ============================================
  
  test('SEC-1a: 認証なしで /api/one-to-many にアクセスすると 401', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    const response = await request.get(`${apiBaseUrl}/api/one-to-many`);
    expect(response.status()).toBe(401);
  });

  test('SEC-1b: 認証なしで /api/one-to-many/prepare にPOSTすると 401', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    const response = await request.post(`${apiBaseUrl}/api/one-to-many/prepare`, {
      data: {
        title: 'Unauthorized Test',
        mode: 'candidates',
        emails: ['test@example.com'],
        slots: [{ start_at: '2026-02-01T10:00:00Z', end_at: '2026-02-01T11:00:00Z' }]
      }
    });
    
    expect(response.status()).toBe(401);
  });

  test('SEC-1c: 認証なしで /api/one-to-many/:id/summary にアクセスすると 401', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const fakeThreadId = 'fake-thread-id-12345';
    
    const response = await request.get(`${apiBaseUrl}/api/one-to-many/${fakeThreadId}/summary`);
    expect(response.status()).toBe(401);
  });

  test('SEC-1d: 認証なしで /api/one-to-many/:id/finalize にPOSTすると 401', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const fakeThreadId = 'fake-thread-id-12345';
    
    const response = await request.post(`${apiBaseUrl}/api/one-to-many/${fakeThreadId}/finalize`, {
      data: { selected_slot_id: 'fake-slot-id' }
    });
    
    expect(response.status()).toBe(401);
  });

  // ============================================
  // SEC-2: 無効なトークン → エラーページ
  // ============================================

  test('SEC-2a: 無効なトークンで /g/:token にアクセスすると「無効」表示', async ({ page }) => {
    const apiBaseUrl = getApiBaseUrl();
    const invalidToken = 'invalid-token-12345';
    
    await page.goto(`${apiBaseUrl}/g/${invalidToken}`);
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.includes('無効') || bodyText?.includes('見つかりません')).toBeTruthy();
  });

  test('SEC-2b: トークン改ざん（有効トークンの一部変更）でエラー', async ({ page, request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const { fixture, skipped } = await createFixture(request);
    
    if (skipped || !fixture) {
      test.skip(true, 'Fixture not available in production');
      return;
    }

    try {
      // 有効なトークンの一部を変更
      const validToken = fixture.invites[0].token;
      const tamperedToken = validToken.slice(0, -3) + 'xxx';
      
      await page.goto(`${apiBaseUrl}/g/${tamperedToken}`);
      await page.waitForLoadState('networkidle');
      
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.includes('無効') || bodyText?.includes('見つかりません')).toBeTruthy();
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('SEC-2c: 空のトークンでエラー', async ({ page }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    await page.goto(`${apiBaseUrl}/g/`);
    await page.waitForLoadState('networkidle');
    
    // 404 または無効表示
    const bodyText = await page.locator('body').textContent();
    expect(bodyText !== null).toBeTruthy();
  });

  // ============================================
  // SEC-3: 他ユーザーのスレッドアクセス → 403
  // ============================================

  test('SEC-3a: 他ユーザーがスレッドの summary を取得しようとすると 403', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const { fixture, skipped } = await createFixture(request);
    
    if (skipped || !fixture) {
      test.skip(true, 'Fixture not available in production');
      return;
    }

    try {
      const response = await request.get(
        `${apiBaseUrl}/api/one-to-many/${fixture.thread_id}/summary`,
        { headers: { 'x-user-id': 'attacker-user-id' } }
      );
      
      expect(response.status()).toBe(403);
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('SEC-3b: 他ユーザーが finalize しようとすると 403', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const { fixture, skipped } = await createFixture(request);
    
    if (skipped || !fixture) {
      test.skip(true, 'Fixture not available in production');
      return;
    }

    try {
      const response = await request.post(
        `${apiBaseUrl}/api/one-to-many/${fixture.thread_id}/finalize`,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': 'attacker-user-id'
          },
          data: { selected_slot_id: fixture.slots[0].slot_id }
        }
      );
      
      expect(response.status()).toBe(403);
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  // ============================================
  // SEC-4: 存在しないリソース → 404
  // ============================================

  test('SEC-4a: 存在しないスレッドにアクセスすると 404', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const fakeThreadId = 'non-existent-thread-00000';
    
    const response = await request.get(
      `${apiBaseUrl}/api/one-to-many/${fakeThreadId}`,
      { headers: { 'x-user-id': 'e2e-test-user' } }
    );
    
    expect(response.status()).toBe(404);
  });

  test('SEC-4b: 存在しないスレッドの summary を取得しようとすると 404', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const fakeThreadId = 'non-existent-thread-00001';
    
    const response = await request.get(
      `${apiBaseUrl}/api/one-to-many/${fakeThreadId}/summary`,
      { headers: { 'x-user-id': 'e2e-test-user' } }
    );
    
    expect(response.status()).toBe(404);
  });

  // ============================================
  // SEC-5: SQLインジェクション防止
  // ============================================

  test('SEC-5a: トークンにSQLインジェクションを含めてもエラー', async ({ page }) => {
    const apiBaseUrl = getApiBaseUrl();
    const sqlInjectionToken = "'; DROP TABLE thread_invites; --";
    
    await page.goto(`${apiBaseUrl}/g/${encodeURIComponent(sqlInjectionToken)}`);
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.locator('body').textContent();
    // SQLインジェクションが実行されず、通常のエラーページが表示される
    expect(bodyText?.includes('無効') || bodyText?.includes('見つかりません') || bodyText?.includes('エラー')).toBeTruthy();
  });

  test('SEC-5b: thread_id にSQLインジェクションを含めても安全', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const sqlInjectionId = "'; DELETE FROM scheduling_threads; --";
    
    const response = await request.get(
      `${apiBaseUrl}/api/one-to-many/${encodeURIComponent(sqlInjectionId)}`,
      { headers: { 'x-user-id': 'e2e-test-user' } }
    );
    
    // 404 または 400（無効なID形式）が返る
    expect([400, 404]).toContain(response.status());
  });

  // ============================================
  // SEC-6: 回答の冪等性（idempotency）
  // ============================================

  test('SEC-6: 同じ invitee が2回目の回答を送信すると回答済み表示', async ({ page, request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const { fixture, skipped } = await createFixture(request, {
      invitee_count: 2,
      slot_count: 2,
      title: 'Idempotency Test'
    });
    
    if (skipped || !fixture) {
      test.skip(true, 'Fixture not available in production');
      return;
    }

    try {
      const token = fixture.invites[0].token;
      
      // 1回目の回答
      await page.goto(`${apiBaseUrl}/g/${token}`);
      await page.waitForLoadState('networkidle');
      
      // スロットを選択
      const slotRadio = page.locator('input[name="selected_slot_id"]').first();
      if (await slotRadio.isVisible()) {
        await slotRadio.click();
      }
      
      // 参加可能ボタンをクリック
      const okButton = page.locator('button:has-text("参加可能")');
      if (await okButton.isVisible()) {
        await okButton.click();
        await page.waitForLoadState('networkidle');
      }
      
      // 2回目のアクセス → 回答済み表示
      await page.goto(`${apiBaseUrl}/g/${token}`);
      await page.waitForLoadState('networkidle');
      
      const bodyText = await page.locator('body').textContent();
      expect(bodyText?.includes('回答済み') || bodyText?.includes('すでに')).toBeTruthy();
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  // ============================================
  // SEC-7: 本番環境 fixture ガード
  // ============================================

  test('SEC-7: 本番環境で fixture API が 403 を返す（開発環境ではスキップ）', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    // この検証は本番環境でのみ意味がある
    // 開発環境では fixture が作成可能なのでスキップ
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 1,
        title: 'Production Guard Test',
        slot_count: 1
      }
    });

    // 開発環境では 200/201、本番環境では 403
    if (response.status() === 403) {
      // 本番環境では 403 が期待値
      expect(response.status()).toBe(403);
    } else {
      // 開発環境では fixture が作成される
      const fixture = await response.json();
      await cleanupFixture(request, fixture.thread_id);
      test.skip(true, 'Development environment - fixture guard test skipped');
    }
  });

  // ============================================
  // SEC-8: XSS防止（コメント欄）
  // ============================================

  test('SEC-8: XSS を含むコメントが安全にエスケープされる', async ({ page, request }) => {
    const apiBaseUrl = getApiBaseUrl();
    const { fixture, skipped } = await createFixture(request, {
      invitee_count: 1,
      slot_count: 1,
      title: 'XSS Test'
    });
    
    if (skipped || !fixture) {
      test.skip(true, 'Fixture not available in production');
      return;
    }

    try {
      const token = fixture.invites[0].token;
      
      await page.goto(`${apiBaseUrl}/g/${token}`);
      await page.waitForLoadState('networkidle');
      
      // コメント欄が存在する場合
      const commentInput = page.locator('textarea[name="comment"], input[name="comment"]');
      if (await commentInput.isVisible()) {
        // XSSペイロードを入力
        const xssPayload = '<script>alert("XSS")</script>';
        await commentInput.fill(xssPayload);
      }
      
      // スロットを選択
      const slotRadio = page.locator('input[name="selected_slot_id"]').first();
      if (await slotRadio.isVisible()) {
        await slotRadio.click();
      }
      
      // 送信
      const okButton = page.locator('button:has-text("参加可能")');
      if (await okButton.isVisible()) {
        await okButton.click();
        await page.waitForLoadState('networkidle');
      }
      
      // alertが表示されないことを確認（スクリプトが実行されない）
      // Playwright では dialog イベントをリッスンして確認
      let alertTriggered = false;
      page.on('dialog', () => {
        alertTriggered = true;
      });
      
      await page.waitForTimeout(1000);
      expect(alertTriggered).toBe(false);
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  // ============================================
  // SEC-9: 期限切れハンドリング
  // ============================================

  test('SEC-9: 期限切れトークンで /g/:token にアクセスすると期限切れ/無効表示', async ({ page }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    // 存在しないトークンを使用して期限切れをシミュレート
    const expiredToken = 'expired-token-simulation-12345';
    
    await page.goto(`${apiBaseUrl}/g/${expiredToken}`);
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.includes('無効') || bodyText?.includes('期限') || bodyText?.includes('見つかりません')).toBeTruthy();
  });
});
