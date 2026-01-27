/**
 * one-on-one.spec.ts
 * E2E Authenticated Test for 1-on-1 Fixed Schedule Flow
 * 
 * テスト対象:
 * 1. fixture 作成 → token 取得
 * 2. /i/:token を開く → 固定1枠UIが表示される
 * 3. 「承諾する」クリック → thank-you に遷移
 * 4. サンキューページの要素確認
 * 
 * 実行条件:
 * - authenticated プロジェクト（[e2e] タグ付きコミット or 手動実行）
 * - 本番 API を使用
 */

import { test, expect } from '@playwright/test';

// API Base URL（fixture作成用）
// E2E_BASE_URL から Workers API URL を推定
const getApiBaseUrl = () => {
  const e2eBaseUrl = process.env.E2E_BASE_URL || '';
  
  // Pages URL から Workers URL を推定
  if (e2eBaseUrl.includes('pages.dev') || e2eBaseUrl.includes('tomoniwao.jp')) {
    return 'https://webapp.snsrilarc.workers.dev';
  }
  
  // ローカル開発（環境変数が設定されていない場合）
  return 'http://localhost:3000';
};

test.describe('1-on-1 Fixed Schedule Flow (Authenticated)', () => {
  let fixtureToken: string | null = null;
  
  // テスト前に fixture を作成
  test.beforeAll(async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    console.log(`[E2E] Creating fixture on ${apiBaseUrl}`);
    
    // fixture 作成（development/staging 環境でのみ動作）
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one`, {
      data: {
        invitee_name: 'E2Eテスト太郎',
        invitee_email: 'e2e-test@example.com',
        title: 'E2E Auth Test Meeting',
        start_offset_hours: 48, // 2日後
        duration_minutes: 60
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
    expect(data.share_url).toBeTruthy();
    
    fixtureToken = data.token;
    
    console.log(`[E2E] Created fixture with token: ${fixtureToken}`);
  });
  
  // テスト後に fixture をクリーンアップ
  test.afterAll(async ({ request }) => {
    if (!fixtureToken) return;
    
    const apiBaseUrl = getApiBaseUrl();
    
    try {
      await request.delete(`${apiBaseUrl}/test/fixtures/one-on-one/${fixtureToken}`);
      console.log(`[E2E] Cleaned up fixture: ${fixtureToken}`);
    } catch {
      console.log(`[E2E] Cleanup failed (may already be deleted): ${fixtureToken}`);
    }
  });
  
  test('招待ページが表示される（固定1枠UI）', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 招待ページに遷移（E2E_BASE_URL を使用）
    await page.goto(`/i/${fixtureToken}`);
    
    // 日程確認ページが表示されることを確認
    await expect(page.locator('h1')).toContainText('日程確認');
    
    // 「この日程で承諾する」ボタンが表示されることを確認
    const acceptButton = page.locator('button', { hasText: /承諾する/ });
    await expect(acceptButton).toBeVisible();
    
    // 「別の日程を希望する」ボタンが表示されることを確認
    const declineButton = page.locator('button', { hasText: /別の日程/ });
    await expect(declineButton).toBeVisible();
    
    // 日時カード（提案日時）が表示されることを確認
    const dateCard = page.locator('text=/ご提案の日時/');
    await expect(dateCard).toBeVisible();
  });
  
  test('承諾するとサンキューページに遷移する', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成（前のテストで状態が変わっている可能性があるため）
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/one-on-one`, {
      data: {
        invitee_name: 'E2E承諾テスト',
        invitee_email: 'e2e-accept@example.com',
        title: 'E2E Accept Flow Test',
        start_offset_hours: 72,
        duration_minutes: 60
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
      
      // 「この日程で承諾する」ボタンをクリック
      const acceptButton = page.locator('button', { hasText: /承諾する/ });
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
        await page.request.delete(`${apiBaseUrl}/test/fixtures/one-on-one/${acceptToken}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('別日希望をクリックすると確認ダイアログが表示される', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/one-on-one`, {
      data: {
        invitee_name: 'E2E辞退テスト',
        invitee_email: 'e2e-decline@example.com',
        title: 'E2E Decline Flow Test',
        start_offset_hours: 96,
        duration_minutes: 30
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
      
      // 「別の日程を希望する」ボタンをクリック
      const declineButton = page.locator('button', { hasText: /別の日程/ });
      await expect(declineButton).toBeVisible();
      await declineButton.click();
      
      // ダイアログが表示されたことを確認
      await page.waitForTimeout(500);
      expect(dialogMessage).toContain('別の日程');
    } finally {
      // クリーンアップ
      try {
        await page.request.delete(`${apiBaseUrl}/test/fixtures/one-on-one/${declineToken}`);
      } catch {
        // ignore
      }
    }
  });
});
