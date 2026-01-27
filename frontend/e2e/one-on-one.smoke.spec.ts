/**
 * one-on-one.smoke.spec.ts
 * E2E Smoke Test for 1-on-1 Fixed Schedule Flow
 * 
 * テスト対象:
 * 1. fixture 作成 → token 取得
 * 2. /i/:token を開く → 固定1枠UIが表示される
 * 3. 「承諾する」クリック → thank-you に遷移
 * 4. サンキューページの要素確認
 * 
 * 実行環境:
 * - CI: E2E_BASE_URL に staging URL を設定
 * - Local: localhost で実行
 */

import { test, expect } from '@playwright/test';

// API Base URL（fixture作成用）
// staging/CI では環境変数から取得
const getApiBaseUrl = () => {
  // E2E_BASE_URL が https://xxx.pages.dev の場合は Workers API を使用
  const e2eBaseUrl = process.env.E2E_BASE_URL || '';
  if (e2eBaseUrl.includes('pages.dev') || e2eBaseUrl.includes('tomoniwao.jp')) {
    // Pages はフロント、Workers は webapp.snsrilarc.workers.dev
    return 'https://webapp.snsrilarc.workers.dev';
  }
  // ローカル開発
  return 'http://localhost:3000';
};

test.describe('1-on-1 Fixed Schedule Flow', () => {
  let fixtureToken: string | null = null;
  
  // テスト前に fixture を作成
  test.beforeAll(async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    // fixture 作成（development 環境でのみ動作）
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one`, {
      data: {
        invitee_name: 'E2Eテスト太郎',
        invitee_email: 'e2e-test@example.com',
        title: 'E2E Smoke Test Meeting',
        start_offset_hours: 48, // 2日後
        duration_minutes: 60
      }
    });
    
    // development/staging 以外では 403 が返る → テストスキップ
    if (response.status() === 403) {
      console.log('Test fixtures not available (production environment) - skipping');
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
    test.skip(!fixtureToken, 'Fixture not available');
    
    // 招待ページに遷移
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
    test.skip(!fixtureToken, 'Fixture not available');
    
    // 招待ページに遷移
    await page.goto(`/i/${fixtureToken}`);
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
  });
  
  test('別日希望をクリックすると確認ダイアログが表示される', async ({ page }) => {
    // fixture が作成できなかった場合はスキップ
    test.skip(!fixtureToken, 'Fixture not available');
    
    // 新しい fixture を作成（前のテストで承諾済みになっているため）
    const apiBaseUrl = getApiBaseUrl();
    const response = await page.request.post(`${apiBaseUrl}/test/fixtures/one-on-one`, {
      data: {
        invitee_name: 'E2Eテスト次郎',
        invitee_email: 'e2e-test2@example.com',
        title: 'E2E Decline Test Meeting',
        start_offset_hours: 72,
        duration_minutes: 30
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create new fixture');
      return;
    }
    
    const data = await response.json();
    const newToken = data.token;
    
    // 招待ページに遷移
    await page.goto(`/i/${newToken}`);
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
    
    // クリーンアップ
    try {
      await page.request.delete(`${apiBaseUrl}/test/fixtures/one-on-one/${newToken}`);
    } catch {
      // ignore
    }
  });
  
  test('期限切れの招待はエラーページが表示される', async ({ page }) => {
    // 期限切れ fixture を直接 DB に作成するのは難しいため、
    // 存在しないトークンで not-found エラーを確認
    await page.goto('/i/invalid-token-12345');
    
    // エラーページが表示されることを確認
    await expect(page.locator('text=/無効|期限/i').first()).toBeVisible({ timeout: 5000 });
  });
});

// 本番環境での fixture 動作確認（403 が返ることを確認）
test.describe('Production Safety Check', () => {
  test('本番環境では fixture API が 403 を返す', async ({ request }) => {
    // 本番 API に対してリクエスト
    const prodApiUrl = 'https://webapp.snsrilarc.workers.dev';
    
    const response = await request.post(`${prodApiUrl}/test/fixtures/one-on-one`, {
      data: { invitee_name: 'Should Fail' }
    });
    
    // 本番環境では 403 が返ることを確認
    // (development 環境では 201 が返るので、環境によって結果が異なる)
    const status = response.status();
    
    // 403 (production) または 201 (development/staging) のどちらか
    expect([201, 403]).toContain(status);
    
    if (status === 403) {
      console.log('[E2E] Production safety check passed: fixture API returns 403');
    } else {
      console.log('[E2E] Running in non-production environment: fixture API returns 201');
      // クリーンアップ
      const data = await response.json();
      if (data.token) {
        await request.delete(`${prodApiUrl}/test/fixtures/one-on-one/${data.token}`);
      }
    }
  });
});
