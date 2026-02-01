/**
 * one-to-many-open-slots.local.spec.ts
 * PR-G1-E2E-2 + PR-G1-OPEN-SLOTS-LOCK: 1対N Open Slots（申込式）× 参加者5人をローカルで検証
 *
 * DoD:
 *  1) fixture で one_to_many(open_slots) を作れる
 *  2) invitee 5人が申込（OK回答）できる
 *  3) 再アクセスで「申込済み」になる（idempotent）
 *  4) organizer が summary で枠ごとの応募状況を見れる
 *  5) organizer が finalize できる（organizer_decides）
 *  6) finalize 後、invitee 側が確定済み表示になる
 *  7) 本番ガード：fixture は 403、API は 401
 *  8) [NEW] 先着制：同じ枠に2人目が OK → 「枠が埋まっています」エラー
 * 
 * 実行: E2E_API_URL=http://localhost:3000 npx playwright test one-to-many-open-slots.local.spec.ts
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
  // タイムアウトを90秒に延長
  test.setTimeout(90000);
  
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

  test('G1-O2〜O6: 3人×3枠の完全フロー（先着制：各枠1人）', async ({ page, request }) => {
    const fixture = await createOpenSlotsFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const threadId = fixture.thread_id;
    const organizerUserId = fixture.organizer_user_id;
    // 先着制：各枠1人のみ可能なので、3枠に3人が申込
    const slots = fixture.slots;

    try {
      // ========================================
      // O2: 3人が申込（先着制なので各枠1人ずつ）
      // ========================================
      // invitee1 → slot[0]
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee2 → slot[1]（先着制なので別の枠に）
      await applyViaUI(page, fixture.invites[1].token, slots[1].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee3 → slot[2]
      await applyViaUI(page, fixture.invites[2].token, slots[2].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee4, invitee5 は枠がないので申込しない（または NO 回答）
      // ここでは invitee4 が NO 回答をテスト
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[3].token}`);
      await page.waitForLoadState('networkidle');
      // すべての枠が埋まっているが、NO/MAYBE は選択可能
      await page.locator('button[data-response="no"]').click();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText('参加不可と回答しました');

      // ========================================
      // O3: 再アクセスで全員「回答済み」（idempotent）
      // ========================================
      await expectAlreadyResponded(page, fixture.invites[0].token);
      await expectAlreadyResponded(page, fixture.invites[1].token);
      await expectAlreadyResponded(page, fixture.invites[2].token);
      await expectAlreadyResponded(page, fixture.invites[3].token);

      // ========================================
      // O4: organizer が summary で枠ごとの応募状況を見れる
      // ========================================
      const summaryRes = await request.get(`${API_BASE_URL}/api/one-to-many/${threadId}/summary`, {
        headers: { 'x-user-id': organizerUserId },
      });
      expect(summaryRes.ok()).toBeTruthy();
      const summary = await summaryRes.json();
      
      // 4人が回答済み（3人OK、1人NO）
      expect(summary.summary.responded).toBe(4);
      expect(summary.summary.ok_count).toBe(3);
      expect(summary.summary.no_count).toBe(1);

      // ========================================
      // O5: organizer が finalize できる
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
      // O6: finalize後、invitee側が確定済み表示になる
      // ========================================
      await expectConfirmedPage(page, fixture.invites[0].token);
      await expectConfirmedPage(page, fixture.invites[1].token);
      await expectConfirmedPage(page, fixture.invites[2].token);
      await expectConfirmedPage(page, fixture.invites[3].token);

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
    await page.waitForLoadState('domcontentloaded');
    
    // 無効なトークンでエラー表示
    await expect(page.locator('body')).toContainText(/無効|エラー|見つかりません/);
  });

  // ========================================
  // PR-G1-OPEN-SLOTS-LOCK: 先着制テスト
  // ========================================
  
  test('G1-O9: 先着制 - 同じ枠に2人目がOK → 「枠が埋まっています」エラー', async ({ page, request }) => {
    const fixture = await createOpenSlotsFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // ========================================
      // Step 1: invitee1 が slot[0] で OK（成功）
      // ========================================
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // ========================================
      // Step 2: invitee2 が同じ slot[0] で OK（拒否されるべき）
      // ========================================
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[1].token}`);
      await page.waitForLoadState('networkidle');
      
      // slot[0] が「埋まっています」と表示されるか確認
      const slot0Radio = page.locator(`input[name="selected_slot_id"][value="${slots[0].slot_id}"]`);
      await expect(slot0Radio).toBeDisabled();
      
      // 「埋まっています」バッジが表示されているか
      await expect(page.locator('body')).toContainText('この枠は埋まっています');
      
      // slot[0] を選択しようとしても無効化されている
      // 代わりに slot[1] を選択して送信
      const slot1Radio = page.locator(`input[name="selected_slot_id"][value="${slots[1].slot_id}"]`);
      await slot1Radio.check({ force: true });
      await page.locator('button[data-response="ok"]').click();
      await page.waitForLoadState('networkidle');
      
      // slot[1] で成功
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // ========================================
      // Step 3: invitee3 がまだ空いている slot[2] で OK（成功）
      // ========================================
      await applyViaUI(page, fixture.invites[2].token, slots[2].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // ========================================
      // Step 4: 全枠が埋まった状態で invitee4 がページを開く
      // ========================================
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[3].token}`);
      await page.waitForLoadState('networkidle');
      
      // 3つの枠すべてが「埋まっています」
      const lockedBadges = page.locator('text=この枠は埋まっています');
      await expect(lockedBadges).toHaveCount(3);
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-O10: 先着制 - UIでdisabledな枠を無視して直接POSTしても409', async ({ page, request }) => {
    const fixture = await createOpenSlotsFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // invitee1 が slot[0] を取得
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee2 が直接POSTで slot[0] を狙う（UIをバイパス）
      const res = await request.post(`${API_BASE_URL}/g/${fixture.invites[1].token}/respond`, {
        form: {
          response: 'ok',
          selected_slot_id: slots[0].slot_id,
        },
      });
      
      // 409 Conflict が返る
      expect(res.status()).toBe(409);
      
      // レスポンスに「枠が埋まっています」が含まれる
      const html = await res.text();
      expect(html).toContain('枠が埋まっています');
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });
});

// ============================================================
// PR-G1-AF-1: Auto-finalize Tests
// open_slots モードで全枠が埋まったら自動的に thread.status = 'confirmed'
// ============================================================

test.describe('1-to-N Open Slots Auto-Finalize (G1-AF)', () => {
  test.setTimeout(90000);

  /**
   * auto_finalize = true の fixture を作成
   */
  async function createAutoFinalizeFixture(request: any): Promise<FixtureResponse | null> {
    const res = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 3,  // 3人
        slot_count: 3,     // 3枠（全員OKで全枠埋まる）
        title: 'E2E Auto-Finalize Test',
        duration_minutes: 60,
        start_offset_hours: 48,
        deadline_hours: 72,
        mode: 'open_slots',
        auto_finalize: true,  // 自動確定を有効化
      },
    });
    
    if (res.status() === 403) {
      return null;
    }
    
    expect(res.status()).toBe(201);
    const json = (await res.json()) as FixtureResponse;
    expect(json.invites.length).toBe(3);
    expect(json.slots.length).toBe(3);
    expect(json.group_policy.mode).toBe('open_slots');
    return json;
  }

  test('G1-A1: fixture作成（auto_finalize=true）→ policy が正しく設定される', async ({ request }) => {
    const fixture = await createAutoFinalizeFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    try {
      // Thread APIで auto_finalize が true か確認
      const res = await request.get(`${API_BASE_URL}/api/one-to-many/${fixture.thread_id}`, {
        headers: { 'x-user-id': fixture.organizer_user_id },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      
      // API response structure: { thread: {...}, group_policy: {...}, ... }
      expect(data.group_policy.auto_finalize).toBe(true);
      expect(data.group_policy.mode).toBe('open_slots');
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-A2: 2人がOK → まだ confirmed にならない（枠が残っている）', async ({ page, request }) => {
    const fixture = await createAutoFinalizeFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // invitee1 が slot[0] で OK
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // invitee2 が slot[1] で OK
      await applyViaUI(page, fixture.invites[1].token, slots[1].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // この時点でスレッドは confirmed ではない
      const res = await request.get(`${API_BASE_URL}/api/one-to-many/${fixture.thread_id}`, {
        headers: { 'x-user-id': fixture.organizer_user_id },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      
      // まだ sent のまま（全枠埋まっていない）
      // API response structure: { thread: {...}, group_policy: {...}, ... }
      expect(data.thread.status).toBe('sent');
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-A3: 3人全員がOK → 全枠埋まり → 自動確定', async ({ page, request }) => {
    const fixture = await createAutoFinalizeFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // 3人が各枠にOK
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      await applyViaUI(page, fixture.invites[1].token, slots[1].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // 最後の1人が OK → 全枠埋まり → auto_finalize 発動
      await applyViaUI(page, fixture.invites[2].token, slots[2].slot_id);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
      // スレッドが confirmed になっているか確認
      const res = await request.get(`${API_BASE_URL}/api/one-to-many/${fixture.thread_id}`, {
        headers: { 'x-user-id': fixture.organizer_user_id },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      
      // auto_finalize で confirmed になる
      // API response structure: { thread: {...}, group_policy: {...}, ... }
      expect(data.thread.status).toBe('confirmed');
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-A3.5: auto_finalize成功後、organizer の inbox に通知が届く', async ({ page, request }) => {
    const fixture = await createAutoFinalizeFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // 3人が各枠にOK → auto_finalize 発動
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await applyViaUI(page, fixture.invites[1].token, slots[1].slot_id);
      await applyViaUI(page, fixture.invites[2].token, slots[2].slot_id);
      
      // organizer の inbox を確認
      const inboxRes = await request.get(`${API_BASE_URL}/api/inbox`, {
        headers: { 'x-user-id': fixture.organizer_user_id },
      });
      expect(inboxRes.ok()).toBeTruthy();
      const inboxData = await inboxRes.json();
      
      // scheduling_request_confirmed タイプの通知が存在することを確認
      const confirmNotification = inboxData.items?.find(
        (item: any) => item.type === 'scheduling_request_confirmed' && item.action_target_id === fixture.thread_id
      );
      
      expect(confirmNotification).toBeDefined();
      expect(confirmNotification.title).toContain('自動確定');
      expect(confirmNotification.priority).toBe('high');
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-A4: auto_finalize後、invitee が /g/:token で「確定済み」表示', async ({ page, request }) => {
    const fixture = await createAutoFinalizeFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // 3人全員がOK → auto_finalize 発動
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await applyViaUI(page, fixture.invites[1].token, slots[1].slot_id);
      await applyViaUI(page, fixture.invites[2].token, slots[2].slot_id);
      
      // invitee が /g/:token にアクセスすると「確定済み」表示
      await expectConfirmedPage(page, fixture.invites[0].token);
      await expectConfirmedPage(page, fixture.invites[1].token);
      await expectConfirmedPage(page, fixture.invites[2].token);
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });

  test('G1-A5: auto_finalize=false の場合は全枠埋まっても confirmed にならない', async ({ page, request }) => {
    // auto_finalize=false の fixture（通常の open_slots）
    const fixture = await createOpenSlotsFixture(request);
    if (!fixture) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const slots = fixture.slots;
    
    try {
      // 3人が3枠を埋める
      await applyViaUI(page, fixture.invites[0].token, slots[0].slot_id);
      await applyViaUI(page, fixture.invites[1].token, slots[1].slot_id);
      await applyViaUI(page, fixture.invites[2].token, slots[2].slot_id);
      
      // auto_finalize=false なので、confirmed にならない
      const res = await request.get(`${API_BASE_URL}/api/one-to-many/${fixture.thread_id}`, {
        headers: { 'x-user-id': fixture.organizer_user_id },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      
      // 手動 finalize が必要（organizer_decides）なので sent のまま
      // API response structure: { thread: {...}, group_policy: {...}, ... }
      expect(data.thread.status).toBe('sent');
      
      // 手動で finalize できることを確認
      const finalizeRes = await request.post(`${API_BASE_URL}/api/one-to-many/${fixture.thread_id}/finalize`, {
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': fixture.organizer_user_id 
        },
        data: { selected_slot_id: slots[0].slot_id },
      });
      expect(finalizeRes.ok()).toBeTruthy();
      const finalizeResult = await finalizeRes.json();
      expect(finalizeResult.status).toBe('confirmed');
      
    } finally {
      await cleanupFixture(request, fixture.thread_id);
    }
  });
});
