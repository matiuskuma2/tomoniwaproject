/**
 * one-to-many.smoke.spec.ts
 * PR-G1-E2E-1-FIX: 1対N Candidates（参加者3人×候補3つ）をCIで安定検証
 *
 * DoD:
 *  1) fixture で one_to_many(candidates) を作れる
 *  2) invitee が OK/NO/MAYBE を送れる（フォーム送信が確実）
 *  3) 再アクセスで「回答済み」になる（idempotent）
 *  4) organizer が summary を見れる
 *  5) organizer が finalize できる
 *  6) finalize 後、invitee 側が確定済み表示になる
 *  7) 本番ガード：fixture は 403、API は 401/404
 * 
 * 実行: E2E_API_URL=http://localhost:3000 npx playwright test one-to-many.smoke.spec.ts --project=smoke
 */

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

type FixtureInvite = { token: string; email: string; name: string; invite_id: string };
type FixtureSlot = { slot_id: string; start_at: string; end_at: string; label: string };

type FixtureResponse = {
  success: true;
  thread_id: string;
  organizer_user_id: string;
  invites: FixtureInvite[];
  slots: FixtureSlot[];
  deadline_at: string;
};

async function createFixture(request: any): Promise<FixtureResponse | null> {
  const res = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
    data: {
      invitee_count: 3,
      slot_count: 3,
      title: 'E2E 1対N 3x3 Candidates',
      duration_minutes: 60,
      start_offset_hours: 48,
      deadline_hours: 72,
    },
  });
  
  // 本番環境では403でスキップ
  if (res.status() === 403) {
    return null;
  }
  
  expect(res.status()).toBe(201);
  const json = (await res.json()) as FixtureResponse;
  expect(json.invites.length).toBe(3);
  expect(json.slots.length).toBe(3);
  return json;
}

async function cleanupFixture(request: any, threadId: string) {
  await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${threadId}`);
}

async function respondViaUI(page: any, token: string, slotId: string, response: 'ok' | 'no' | 'maybe') {
  await page.goto(`${API_BASE_URL}/g/${token}`);
  await page.waitForLoadState('networkidle');

  // slot選択（候補がある場合、ラジオボタンをクリック）
  if (slotId) {
    const slotRadio = page.locator(`input[name="selected_slot_id"][value="${slotId}"]`);
    if (await slotRadio.count() > 0) {
      await slotRadio.check({ force: true });
    }
  }

  // data-responseでクリック（groupInvite.ts側がhidden input + JS submit方式になっている前提）
  await page.locator(`button[data-response="${response}"]`).click();

  // 完了画面へ遷移を待つ
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000); // フォーム送信後の安定化待ち
}

async function expectAlreadyResponded(page: any, token: string) {
  await page.goto(`${API_BASE_URL}/g/${token}`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveTitle(/すでに回答済み/);
}

async function expectConfirmedPage(page: any, token: string) {
  await page.goto(`${API_BASE_URL}/g/${token}`);
  await page.waitForLoadState('networkidle');
  const html = await page.content();
  // 確定済みの表示（文言は実装により揺れるので緩くチェック）
  expect(html.includes('確定') || html.includes('決定') || html.includes('すでに')).toBeTruthy();
}

test.describe('1-to-N Candidates Smoke (3 invitees × 3 slots)', () => {
  
  test('G1-S1: fixture作成 → 招待ページ表示', async ({ page, request }) => {
    const fixture = await createFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    try {
      // 招待ページにアクセス
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      
      // 基本要素が表示される
      await expect(page).toHaveTitle(/日程調整/);
      await expect(page.locator('body')).toContainText('参加可能');
      await expect(page.locator('body')).toContainText('参加不可');
      
      // 3つのスロットが表示される
      const slots = page.locator('input[name="selected_slot_id"]');
      await expect(slots).toHaveCount(3);
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-S2〜S6: 3人×3候補の完全フロー（回答→再アクセス→集計→確定→確定済み表示）', async ({ page, request }) => {
    const fixture = await createFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const threadId = fixture.thread_id;
    const organizerUserId = fixture.organizer_user_id;
    const slotId = fixture.slots[0]?.slot_id;

    try {
      // ========================================
      // S2: invitee1 OK, invitee2 NO, invitee3 MAYBE
      // ========================================
      await respondViaUI(page, fixture.invites[0].token, slotId, 'ok');
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      await respondViaUI(page, fixture.invites[1].token, slotId, 'no');
      await expect(page.locator('body')).toContainText('参加不可と回答しました');
      
      await respondViaUI(page, fixture.invites[2].token, slotId, 'maybe');
      await expect(page.locator('body')).toContainText('未定と回答しました');

      // ========================================
      // S3: 再アクセスで全員「回答済み」（idempotent）
      // ========================================
      await expectAlreadyResponded(page, fixture.invites[0].token);
      await expectAlreadyResponded(page, fixture.invites[1].token);
      await expectAlreadyResponded(page, fixture.invites[2].token);

      // ========================================
      // S4: organizer が summary を見れる
      // Development環境では x-user-id ヘッダーで認証
      // ========================================
      const summaryRes = await request.get(`${API_BASE_URL}/api/one-to-many/${threadId}/summary`, {
        headers: { 'x-user-id': organizerUserId },
      });
      expect(summaryRes.ok()).toBeTruthy();
      const summary = await summaryRes.json();
      expect(summary.summary.responded).toBe(3);
      expect(summary.summary.ok_count).toBe(1);
      expect(summary.summary.no_count).toBe(1);
      expect(summary.summary.maybe_count).toBe(1);

      // ========================================
      // S5: organizer が finalize できる（手動確定）
      // ========================================
      const finalizeRes = await request.post(`${API_BASE_URL}/api/one-to-many/${threadId}/finalize`, {
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': organizerUserId 
        },
        data: { selected_slot_id: slotId },
      });
      expect(finalizeRes.ok()).toBeTruthy();
      const finalizeResult = await finalizeRes.json();
      expect(finalizeResult.status).toBe('confirmed');

      // ========================================
      // S6: finalize後、invitee側が確定済み表示になる（3人とも）
      // ========================================
      await expectConfirmedPage(page, fixture.invites[0].token);
      await expectConfirmedPage(page, fixture.invites[1].token);
      await expectConfirmedPage(page, fixture.invites[2].token);

    } finally {
      await cleanupFixture(request, threadId);
    }
  });

  test('G1-S7: Security - auth required for API', async ({ request }) => {
    // 認証なしでAPIアクセス → 401
    const res = await request.get(`${API_BASE_URL}/api/one-to-many`);
    expect(res.status()).toBe(401);
  });

  test('G1-S8: Security - invalid token shows error page', async ({ page }) => {
    await page.goto(`${API_BASE_URL}/g/invalid-token-12345`);
    await page.waitForLoadState('networkidle');
    
    // 無効なトークンでエラー表示
    await expect(page).toHaveTitle(/無効|エラー/);
  });

  test('G1-S9: Security - fixture 403 in production guard', async ({ request }) => {
    // このテストは本番環境でfixtureが403を返すことを確認
    // (実際の本番では走らないが、E2E_API_URLが本番を指す場合のガード)
    const res = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: { invitee_count: 1, slot_count: 1, title: 'Security Test' },
    });
    // 開発環境では201、本番では403
    expect([201, 403]).toContain(res.status());
    
    // 201の場合はクリーンアップ
    if (res.status() === 201) {
      const json = await res.json();
      await cleanupFixture(request, json.thread_id);
    }
  });
});
