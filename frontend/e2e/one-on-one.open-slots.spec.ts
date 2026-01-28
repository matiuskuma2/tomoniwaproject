/**
 * E2E Test: 1-on-1 Open Slots フロー（Phase B-4）
 * 
 * TimeRex型の空き枠公開体験
 * 
 * テストケース:
 * 1. 空き枠一覧ページが表示される
 * 2. 枠を選択して確定できる
 * 3. 確定後にサンキューページが表示される
 * 4. 二重選択が防止される
 * 5. 期限切れの場合はエラー表示
 * 
 * @see docs/plans/PR-B4.md
 */

import { test, expect } from '@playwright/test';

// API URL を取得するヘルパー
function getApiBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) {
    return 'http://localhost:3000';
  }
  // E2B sandbox の場合: e2b.dev ドメインを workers.dev に変換
  if (baseUrl.includes('e2b.dev')) {
    return baseUrl.replace('e2b.dev', 'workers.dev');
  }
  // staging/production
  return baseUrl.replace('app.tomoniwao.jp', 'api.tomoniwao.jp');
}

test.describe('1-on-1 Open Slots フロー（B-4）', () => {
  // fixture 管理用
  let fixtureToken: string | null = null;
  let apiBaseUrl: string;

  test.beforeAll(async () => {
    apiBaseUrl = getApiBaseUrl(process.env.E2E_BASE_URL);
    console.log('[B4-E2E] API Base URL:', apiBaseUrl);
  });

  test.afterEach(async ({ request }) => {
    // fixture cleanup
    if (fixtureToken) {
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/open-slots/${fixtureToken}`);
        console.log('[B4-E2E] Cleaned up fixture:', fixtureToken);
      } catch (e) {
        console.warn('[B4-E2E] Cleanup failed:', e);
      }
      fixtureToken = null;
    }
  });

  test('空き枠一覧ページが表示される', async ({ page, request }) => {
    // 1. Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/open-slots`, {
      data: {
        invitee_name: 'B4テスト太郎',
        invitee_email: 'b4-test@example.com',
        title: 'B4 Open Slots テスト',
        slot_count: 5,
        duration_minutes: 60
      }
    });

    // production では 403 → skip
    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    expect(fixtureRes.ok()).toBeTruthy();
    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;
    expect(fixture.slots).toHaveLength(5);

    // 2. 公開ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/open/${fixtureToken}`);

    // 3. タイトルが表示されることを確認
    await expect(page.getByText('B4 Open Slots テスト')).toBeVisible();

    // 4. 空き枠ボタンが表示されることを確認
    const slotButtons = page.locator('.slot-btn');
    await expect(slotButtons).toHaveCount(5);

    // 5. 「空いている時間」セクションが表示されることを確認
    await expect(page.getByText('空いている時間')).toBeVisible();
  });

  test('枠を選択して確定できる', async ({ page, request }) => {
    // 1. Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/open-slots`, {
      data: {
        invitee_name: 'B4選択テスト',
        title: 'B4 選択確定テスト',
        slot_count: 3
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    expect(fixtureRes.ok()).toBeTruthy();
    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 公開ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/open/${fixtureToken}`);

    // 3. 最初の枠をクリック
    const slotButtons = page.locator('.slot-btn');
    await slotButtons.first().click();

    // 4. 確認セクションが表示されることを確認
    await expect(page.locator('#confirmSection')).toBeVisible();

    // 5. 選択した日時が表示されることを確認
    await expect(page.locator('#selectedDateTime')).not.toHaveText('-');

    // 6. 「この時間で確定する」ボタンをクリック
    await page.getByRole('button', { name: /この時間で確定する/i }).click();

    // 7. サンキューページにリダイレクトされることを確認
    await page.waitForURL(/\/open\/.*\/thank-you/);

    // 8. 「予約完了」メッセージが表示されることを確認
    await expect(page.getByText('予約完了')).toBeVisible();
  });

  test('サンキューページにGoogleカレンダー追加ボタンがある', async ({ page, request }) => {
    // 1. Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/open-slots`, {
      data: {
        invitee_name: 'B4サンキューテスト',
        title: 'B4 サンキューページテスト',
        slot_count: 1
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 公開ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/open/${fixtureToken}`);

    // 3. 枠を選択して確定
    await page.locator('.slot-btn').first().click();
    await page.getByRole('button', { name: /この時間で確定する/i }).click();

    // 4. サンキューページで確認
    await page.waitForURL(/\/open\/.*\/thank-you/);
    
    // 5. Googleカレンダー追加リンクが存在することを確認
    const gcalLink = page.getByRole('link', { name: /Googleカレンダーに追加/i });
    await expect(gcalLink).toBeVisible();
    
    // 6. リンクのhrefがcalendar.google.comを含むことを確認
    const href = await gcalLink.getAttribute('href');
    expect(href).toContain('calendar.google.com');

    // 7. 成長導線（無料で始める）が表示されることを確認
    await expect(page.getByRole('link', { name: /無料で始める/i })).toBeVisible();
  });

  test('複数の枠から選択を変更できる', async ({ page, request }) => {
    // 1. Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/open-slots`, {
      data: {
        invitee_name: 'B4変更テスト',
        title: 'B4 選択変更テスト',
        slot_count: 5
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 公開ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/open/${fixtureToken}`);

    const slotButtons = page.locator('.slot-btn');

    // 3. 最初の枠をクリック
    await slotButtons.first().click();
    
    // 4. 最初の枠が selected クラスを持つことを確認
    await expect(slotButtons.first()).toHaveClass(/selected/);

    // 5. 2番目の枠をクリック
    await slotButtons.nth(1).click();

    // 6. 最初の枠の selected クラスが外れることを確認
    await expect(slotButtons.first()).not.toHaveClass(/selected/);
    
    // 7. 2番目の枠が selected クラスを持つことを確認
    await expect(slotButtons.nth(1)).toHaveClass(/selected/);
  });
});

test.describe('本番環境ガード（B-4）', () => {
  test('production では fixture API が 403 を返す', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl(process.env.E2E_BASE_URL);
    
    // production 環境でのみ意味があるテスト
    if (!apiBaseUrl.includes('api.tomoniwao.jp')) {
      test.skip();
      return;
    }

    const response = await request.post(`${apiBaseUrl}/test/fixtures/open-slots`, {
      data: { invitee_name: 'test' }
    });

    expect(response.status()).toBe(403);
  });
});
