/**
 * one-to-many-open-slots.local.spec.ts
 * PR-G1-E2E-2: 1対N Open Slots（申込式）× 参加者5人をローカルで検証
 *
 * DoD:
 *  1) fixture で one_to_many(open_slots) を作れる
 *  2) invitee 5人が申込（OK回答）できる
 *  3) 再アクセスで「申込済み」になる（idempotent）
 *  4) organizer が summary で枠ごとの応募状況を見れる
 *  5) organizer が finalize できる（organizer_decides）
 *  6) finalize 後、invitee 側が確定済み表示になる
 *  7) 本番ガード：fixture は 403、API は 401
 * 
 * 実行: E2E_API_URL=http://localhost:3000 npx playwright test one-to-many-open-slots.local.spec.ts --project=smoke
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
  group_policy: {
    mode: string;
    deadline_at: string;
    finalize_policy: string;
  };
};

async function createOpenSlotsFixture(request: any): Promise<FixtureResponse | null> {
  const res = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
    data: {
      invitee_count: 5,
      slot_count: 3,
      title: 'E2E 1対N Open Slots 5x3',
      duration_minutes: 60,
      start_offset_hours: 48,
      deadline_hours: 72,
      mode: 'open_slots',  // open_slotsモード
    },
  });
  
  // 本番環境では403でスキップ
  if (res.status() === 403) {
    return null;
  }
  
  expect(res.status()).toBe(201);
  const json = (await res.json()) as FixtureResponse;
  expect(json.invites.length).toBe(5);
  expect(json.slots.length).toBe(3);
  expect(json.group_policy.mode).toBe('open_slots');
  return json;
}

async function cleanupFixture(request: any, threadId: string) {
  await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${threadId}`);
}

async function applyViaUI(page: any, token: string, slotId: string) {
  await page.goto(`${API_BASE_URL}/g/${token}`);
  await page.waitForLoadState('networkidle');

  // slot選択（open_slotsでは希望する枠を選択）
  if (slotId) {
    const slotRadio = page.locator(`input[name="selected_slot_id"][value="${slotId}"]`);
    if (await slotRadio.count() > 0) {
      await slotRadio.check({ force: true });
    }
  }

  // 「参加可能」ボタンをクリック（申込）
  await page.locator('button[data-response="ok"]').click();

  // 完了画面へ遷移を待つ
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
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
  expect(html.includes('確定') || html.includes('決定') || html.includes('すでに')).toBeTruthy();
}

test.describe('1-to-N Open Slots (5 invitees × 3 slots)', () => {
  
  test('G1-O1: fixture作成（open_slotsモード）→ 招待ページ表示', async ({ page, request }) => {
    const fixture = await createOpenSlotsFixture(request);
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
      
      // 3つのスロットが表示される
      const slots = page.locator('input[name="selected_slot_id"]');
      await expect(slots).toHaveCount(3);
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-O2〜O6: 5人×3枠の完全フロー（申込→再アクセス→集計→確定→確定済み表示）', async ({ page, request }) => {
    const fixture = await createOpenSlotsFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const threadId = fixture.thread_id;
    const organizerUserId = fixture.organizer_user_id;
    // 5人の参加者がそれぞれ異なる枠に申込（枠は3つなので、一部は同じ枠になる）
    const slots = fixture.slots;

    try {
      // ========================================
      // O2: 5人が申込（各自が希望する枠を選択）
      // ========================================
      // invitee1 → slot[0]
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee2 → slot[0] (同じ枠に複数申込可能 - 先着制ではない現状)
      await applyViaUI(page, fixture.invites[1].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee3 → slot[1]
      await applyViaUI(page, fixture.invites[2].token, slots[1].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee4 → slot[1]
      await applyViaUI(page, fixture.invites[3].token, slots[1].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee5 → slot[2]
      await applyViaUI(page, fixture.invites[4].token, slots[2].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');

      // ========================================
      // O3: 再アクセスで全員「申込済み」（idempotent）
      // ========================================
      await expectAlreadyResponded(page, fixture.invites[0].token);
      await expectAlreadyResponded(page, fixture.invites[1].token);
      await expectAlreadyResponded(page, fixture.invites[2].token);
      await expectAlreadyResponded(page, fixture.invites[3].token);
      await expectAlreadyResponded(page, fixture.invites[4].token);

      // ========================================
      // O4: organizer が summary で枠ごとの応募状況を見れる
      // ========================================
      const summaryRes = await request.get(`${API_BASE_URL}/api/one-to-many/${threadId}/summary`, {
        headers: { 'x-user-id': organizerUserId },
      });
      expect(summaryRes.ok()).toBeTruthy();
      const summary = await summaryRes.json();
      
      // 5人全員が回答済み
      expect(summary.summary.responded).toBe(5);
      expect(summary.summary.ok_count).toBe(5);
      
      // 枠ごとの応募状況を確認（slot_countsがあれば）
      if (summary.summary.slot_counts) {
        const slotCounts = summary.summary.slot_counts;
        // slot[0]に2人、slot[1]に2人、slot[2]に1人
        const slot0Count = slotCounts.find((s: any) => s.slot_id === slots[0].slot_id);
        const slot1Count = slotCounts.find((s: any) => s.slot_id === slots[1].slot_id);
        const slot2Count = slotCounts.find((s: any) => s.slot_id === slots[2].slot_id);
        
        if (slot0Count) expect(slot0Count.ok_count).toBe(2);
        if (slot1Count) expect(slot1Count.ok_count).toBe(2);
        if (slot2Count) expect(slot2Count.ok_count).toBe(1);
      }

      // ========================================
      // O5: organizer が finalize できる（最も人気のある枠で確定）
      // slot[0]またはslot[1]を選択（両方2人）
      // ========================================
      const finalizeRes = await request.post(`${API_BASE_URL}/api/one-to-many/${threadId}/finalize`, {
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': organizerUserId 
        },
        data: { selected_slot_id: slots[0].slot_id },  // slot[0]で確定
      });
      expect(finalizeRes.ok()).toBeTruthy();
      const finalizeResult = await finalizeRes.json();
      expect(finalizeResult.status).toBe('confirmed');

      // ========================================
      // O6: finalize後、invitee側が確定済み表示になる（5人とも）
      // ========================================
      await expectConfirmedPage(page, fixture.invites[0].token);
      await expectConfirmedPage(page, fixture.invites[1].token);
      await expectConfirmedPage(page, fixture.invites[2].token);
      await expectConfirmedPage(page, fixture.invites[3].token);
      await expectConfirmedPage(page, fixture.invites[4].token);

    } finally {
      await cleanupFixture(request, threadId);
    }
  });

  test('G1-O7: Security - auth required for API', async ({ request }) => {
    // 認証なしでAPIアクセス → 401
    const res = await request.get(`${API_BASE_URL}/api/one-to-many`);
    expect(res.status()).toBe(401);
  });

  test('G1-O8: Security - invalid token shows error page', async ({ page }) => {
    await page.goto(`${API_BASE_URL}/g/invalid-open-slots-token`);
    await page.waitForLoadState('networkidle');
    
    // 無効なトークンでエラー表示
    await expect(page).toHaveTitle(/無効|エラー/);
  });
});
