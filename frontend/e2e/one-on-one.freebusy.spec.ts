/**
 * one-on-one.freebusy.spec.ts
 * E2E Authenticated Test for 1-on-1 Freebusy Schedule Flow (Phase B-2)
 * 
 * テスト対象:
 * 1. fixture 作成（freebusy-context, 候補3つ）→ token 取得
 * 2. /i/:token を開く → multiSlotUI が表示される（3候補）
 * 3. 1つ選択して「この日程で参加する」クリック → thank-you に遷移
 * 4. サンキューページの要素確認
 * 5. no_available_slots パターンのテスト（all_busy fixture）
 * 
 * 実行条件:
 * - authenticated プロジェクト（[e2e] タグ付きコミット or 手動実行）
 * - staging/development API を使用（本番では fixture が 403）
 */

import { test, expect } from '@playwright/test';

// API Base URL（fixture作成用）
const getApiBaseUrl = () => {
  const e2eBaseUrl = process.env.E2E_BASE_URL || '';
  
  // Pages URL から Workers URL を推定
  if (e2eBaseUrl.includes('pages.dev') || e2eBaseUrl.includes('tomoniwao.jp')) {
    return 'https://webapp.snsrilarc.workers.dev';
  }
  
  // ローカル開発
  return 'http://localhost:3000';
};

test.describe('1-on-1 Freebusy Schedule Flow (Phase B-2)', () => {
  let fixtureToken: string | null = null;
  
  // テスト前に fixture を作成
  test.beforeAll(async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    console.log(`[E2E] Creating freebusy-context fixture on ${apiBaseUrl}`);
    
    // fixture 作成（development/staging 環境でのみ動作）
    const response = await request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'standard',
        invitee_name: 'E2Eフリービジーテスト太郎',
        invitee_email: 'e2e-freebusy@example.com',
        title: 'E2E Freebusy Test Meeting',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    // production では 403 が返る → テストスキップ
    if (response.status() === 403) {
      console.log('[E2E] Test fixtures not available (production environment) - tests will skip');
      fixtureToken = null;
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.token).toBeTruthy();
    expect(data.slots).toHaveLength(3);
    expect(data.busy_pattern).toBe('standard');
    
    fixtureToken = data.token;
    
    console.log(`[E2E] Created freebusy fixture with token: ${fixtureToken}, slots: ${data.slots.length}`);
  });
  
  // テスト後に fixture をクリーンアップ
  test.afterAll(async ({ request }) => {
    if (!fixtureToken) return;
    
    const apiBaseUrl = getApiBaseUrl();
    
    try {
      await request.delete(`${apiBaseUrl}/test/fixtures/freebusy-context/${fixtureToken}`);
      console.log(`[E2E] Cleaned up freebusy fixture: ${fixtureToken}`);
    } catch {
      console.log(`[E2E] Cleanup failed (may already be deleted): ${fixtureToken}`);
    }
  });
  
  test('freebusy由来の候補3つの招待ページが表示される（multiSlotUI）', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 招待ページに遷移
    await page.goto(`/i/${fixtureToken}`);
    await page.waitForLoadState('networkidle');
    
    // 日程調整ページが表示されることを確認
    await expect(page.locator('h1')).toContainText('日程調整');
    
    // 候補選択の説明文が表示されることを確認
    await expect(page.locator('text=/ご都合の良い日時を選択/')).toBeVisible();
    
    // スロットカードが3つ表示されることを確認
    const slotCards = page.locator('label.slot-card');
    await expect(slotCards).toHaveCount(3);
    
    // 「この日程で参加する」ボタンが表示されることを確認
    const acceptButton = page.locator('button#acceptBtn');
    await expect(acceptButton).toBeVisible();
    await expect(acceptButton).toContainText('この日程で参加する');
    
    // 「辞退する」ボタンが表示されることを確認
    const declineButton = page.locator('button#declineBtn');
    await expect(declineButton).toBeVisible();
    await expect(declineButton).toContainText('辞退する');
  });
  
  test('候補を選択して承諾するとサンキューページに遷移する', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成（前のテストで状態が変わっている可能性があるため）
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'standard',
        invitee_name: 'E2E承諾テスト',
        invitee_email: 'e2e-freebusy-accept@example.com',
        title: 'E2E Freebusy Accept Flow Test',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for accept test');
      return;
    }
    
    const data = await response.json();
    const acceptToken = data.token;
    
    try {
      // 招待ページに遷移
      await page.goto(`/i/${acceptToken}`);
      await page.waitForLoadState('networkidle');
      
      // スロットカードが3つ表示されることを確認
      const slotCards = page.locator('label.slot-card');
      await expect(slotCards).toHaveCount(3);
      
      // 2番目のスロットを選択（デフォルトは1番目なので違うものを選ぶ）
      const secondSlot = slotCards.nth(1);
      await secondSlot.click();
      
      // 選択されたことを確認（selectedクラスが付与される）
      await expect(secondSlot).toHaveClass(/selected/);
      
      // 「この日程で参加する」ボタンをクリック
      const acceptButton = page.locator('button#acceptBtn');
      await expect(acceptButton).toBeVisible();
      await acceptButton.click();
      
      // サンキューページに遷移することを確認
      await page.waitForURL(/\/i\/.*\/thank-you/, { timeout: 10000 });
      
      // サンキューページの要素を確認
      // 1. 「予定が確定しました」
      await expect(page.locator('h1')).toContainText('予定が確定しました');
      
      // 2. Googleカレンダー追加ボタン
      const calendarButton = page.locator('a', { hasText: /Google.*カレンダー.*追加/ });
      await expect(calendarButton).toBeVisible();
      
      // 3. Google Calendar URL が正しいことを確認
      const calendarHref = await calendarButton.getAttribute('href');
      expect(calendarHref).toContain('calendar.google.com');
      
      // 4. 成長導線「あなたも予定調整を楽にしませんか？」
      const growthCTA = page.locator('text=/予定調整.*楽に/');
      await expect(growthCTA).toBeVisible();
      
      // 5. 「無料で始める」ボタン
      const signupCTA = page.locator('a', { hasText: /無料で始める/ });
      await expect(signupCTA).toBeVisible();
    } finally {
      // クリーンアップ
      try {
        await page.request.delete(`${apiBaseUrl}/test/fixtures/freebusy-context/${acceptToken}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('prefer=afternoon で生成されたスロットが午後の時間帯である', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'standard',
        invitee_name: 'E2E午後テスト',
        invitee_email: 'e2e-afternoon@example.com',
        title: 'E2E Afternoon Preference Test',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for afternoon test');
      return;
    }
    
    const data = await response.json();
    const afternoonToken = data.token;
    
    // スロットが午後の時間帯（12:00-18:00）であることを確認
    for (const slot of data.slots) {
      const startHour = new Date(slot.start_at).getHours();
      // 決定論的fixture: 14:00, 15:00, 16:00 の時間帯
      expect(startHour).toBeGreaterThanOrEqual(12);
      expect(startHour).toBeLessThan(18);
    }
    
    try {
      // 招待ページに遷移
      await page.goto(`/i/${afternoonToken}`);
      await page.waitForLoadState('networkidle');
      
      // スロットカードが3つ表示されることを確認
      const slotCards = page.locator('label.slot-card');
      await expect(slotCards).toHaveCount(3);
      
      // 各スロットカードに午後の時間帯が表示されていることを確認
      // (例: "14:00", "15:00", "16:00" など)
      for (let i = 0; i < 3; i++) {
        const slotText = await slotCards.nth(i).textContent();
        // 12時〜17時のいずれかの時間が含まれていることを確認
        expect(slotText).toMatch(/1[2-7]:\d{2}/);
      }
    } finally {
      // クリーンアップ
      try {
        await page.request.delete(`${apiBaseUrl}/test/fixtures/freebusy-context/${afternoonToken}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('all_busy パターンでは空きなしが返される（API レベル）', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    // all_busy パターンで fixture を作成
    const response = await request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'all_busy',
        invitee_name: 'E2E全埋まりテスト',
        invitee_email: 'e2e-allbusy@example.com',
        title: 'E2E All Busy Test',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    // production では 403 が返る → テストスキップ
    if (response.status() === 403) {
      test.skip(true, 'Fixture not available (production environment)');
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    // all_busy パターンは no_slots: true を返す
    expect(data.success).toBe(true);
    expect(data.busy_pattern).toBe('all_busy');
    expect(data.no_slots).toBe(true);
    expect(data.message).toContain('空き枠がありません');
    
    // token や share_url は返されない
    expect(data.token).toBeUndefined();
    expect(data.share_url).toBeUndefined();
  });
  
  test('先頭候補がデフォルトで選択されている', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'standard',
        invitee_name: 'E2Eデフォルト選択テスト',
        invitee_email: 'e2e-default-select@example.com',
        title: 'E2E Default Selection Test',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for default selection test');
      return;
    }
    
    const data = await response.json();
    const defaultToken = data.token;
    
    try {
      // 招待ページに遷移
      await page.goto(`/i/${defaultToken}`);
      await page.waitForLoadState('networkidle');
      
      // スロットカードを取得
      const slotCards = page.locator('label.slot-card');
      await expect(slotCards).toHaveCount(3);
      
      // 1番目のスロットがデフォルトで selected クラスを持つことを確認
      const firstSlot = slotCards.first();
      await expect(firstSlot).toHaveClass(/selected/);
      
      // 2番目・3番目は selected クラスを持たないことを確認
      const secondSlot = slotCards.nth(1);
      const thirdSlot = slotCards.nth(2);
      await expect(secondSlot).not.toHaveClass(/selected/);
      await expect(thirdSlot).not.toHaveClass(/selected/);
      
    } finally {
      // クリーンアップ
      try {
        await page.request.delete(`${apiBaseUrl}/test/fixtures/freebusy-context/${defaultToken}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('辞退ボタンで確認ダイアログが表示される', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'standard',
        invitee_name: 'E2E辞退テスト',
        invitee_email: 'e2e-freebusy-decline@example.com',
        title: 'E2E Freebusy Decline Test',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for decline test');
      return;
    }
    
    const data = await response.json();
    const declineToken = data.token;
    
    try {
      // 招待ページに遷移
      await page.goto(`/i/${declineToken}`);
      await page.waitForLoadState('networkidle');
      
      // confirm ダイアログをハンドル
      let dialogMessage = '';
      page.on('dialog', async dialog => {
        dialogMessage = dialog.message();
        await dialog.dismiss(); // キャンセル
      });
      
      // 「辞退する」ボタンをクリック
      const declineButton = page.locator('button#declineBtn');
      await expect(declineButton).toBeVisible();
      await declineButton.click();
      
      // ダイアログが表示されたことを確認
      await page.waitForTimeout(500);
      // 辞退確認メッセージが含まれていることを確認
      expect(dialogMessage.length).toBeGreaterThan(0);
    } finally {
      // クリーンアップ
      try {
        await page.request.delete(`${apiBaseUrl}/test/fixtures/freebusy-context/${declineToken}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('all_free パターンでも正常に候補が生成される', async ({ page }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    // all_free パターンで fixture を作成
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/freebusy-context`, {
      data: {
        busy_pattern: 'all_free',
        invitee_name: 'E2E全空きテスト',
        invitee_email: 'e2e-allfree@example.com',
        title: 'E2E All Free Test',
        prefer: 'afternoon',
        candidate_count: 3
      }
    });
    
    // production では 403 が返る → テストスキップ
    if (response.status() === 403) {
      test.skip(true, 'Fixture not available (production environment)');
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    // all_free パターンでも slots が生成される
    expect(data.success).toBe(true);
    expect(data.busy_pattern).toBe('all_free');
    expect(data.slots).toHaveLength(3);
    expect(data.token).toBeTruthy();
    
    try {
      // 招待ページに遷移
      await page.goto(`/i/${data.token}`);
      await page.waitForLoadState('networkidle');
      
      // スロットカードが3つ表示されることを確認
      const slotCards = page.locator('label.slot-card');
      await expect(slotCards).toHaveCount(3);
    } finally {
      // クリーンアップ
      try {
        await page.request.delete(`${apiBaseUrl}/test/fixtures/freebusy-context/${data.token}`);
      } catch {
        // ignore
      }
    }
  });
});
