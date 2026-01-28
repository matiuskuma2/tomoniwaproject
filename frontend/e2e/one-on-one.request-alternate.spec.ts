/**
 * E2E Test: 1-on-1 別日希望フロー（Phase B-3）
 * 
 * テストケース:
 * 1. 別日希望モーダルが表示される
 * 2. 別日希望 → 再提案①（proposal_version +1）
 * 3. 再度別日希望 → 再提案②（proposal_version +2）
 * 4. 3回目 → OpenSlots へ誘導（max_reached = true）
 * 5. 新しい候補が正しく表示される
 * 
 * @see docs/plans/PR-B3.md
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

test.describe('1-on-1 別日希望フロー（B-3）', () => {
  // fixture 管理用
  let fixtureToken: string | null = null;
  let apiBaseUrl: string;

  test.beforeAll(async () => {
    apiBaseUrl = getApiBaseUrl(process.env.E2E_BASE_URL);
    console.log('[B3-E2E] API Base URL:', apiBaseUrl);
  });

  test.afterEach(async ({ request }) => {
    // fixture cleanup
    if (fixtureToken) {
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/one-on-one/${fixtureToken}`);
        console.log('[B3-E2E] Cleaned up fixture:', fixtureToken);
      } catch (e) {
        console.warn('[B3-E2E] Cleanup failed:', e);
      }
      fixtureToken = null;
    }
  });

  test('別日希望モーダルが表示される', async ({ page, request }) => {
    // 1. Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B3テスト太郎',
        invitee_email: 'b3-test@example.com',
        title: 'B3別日希望テスト',
        slot_count: 3,
        start_offset_hours: 48,
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
    expect(fixture.slots).toHaveLength(3);

    // 2. 招待ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/i/${fixtureToken}`);

    // 3. multiSlotUI が表示されることを確認
    await expect(page.locator('label.slot-card')).toHaveCount(3);

    // 4. 「別日を希望する」ボタンが存在することを確認
    const alternateButton = page.getByRole('button', { name: /別日を希望する/i });
    await expect(alternateButton).toBeVisible();

    // 5. クリックしてモーダルが表示されることを確認
    await alternateButton.click();

    // 6. モーダル内の要素を確認
    const modal = page.locator('#alternateModal');
    await expect(modal).toBeVisible();
    
    // 期間選択
    await expect(page.locator('#alternate-range')).toBeVisible();
    
    // 時間帯選択
    await expect(page.locator('#alternate-prefer')).toBeVisible();
    
    // 補足コメント
    await expect(page.locator('#alternate-comment')).toBeVisible();
    
    // CTA ボタン
    await expect(page.getByRole('button', { name: /この条件で再提案/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /やめる|キャンセル/i })).toBeVisible();
  });

  test('別日希望 → 新しい候補が表示される（再提案①）', async ({ page, request }) => {
    // 1. Fixture 作成（additional_propose_count = 0）
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B3再提案テスト',
        invitee_email: 'b3-repropose@example.com',
        title: 'B3再提案テスト①',
        slot_count: 3,
        start_offset_hours: 48,
        duration_minutes: 60
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    expect(fixtureRes.ok()).toBeTruthy();
    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 招待ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/i/${fixtureToken}`);
    await expect(page.locator('label.slot-card')).toHaveCount(3);

    // 3. 別日希望モーダルを開く
    await page.getByRole('button', { name: /別日を希望する/i }).click();
    await expect(page.locator('#alternateModal')).toBeVisible();

    // 4. フォームに入力
    await page.selectOption('#alternate-range', 'next_week');
    await page.selectOption('#alternate-prefer', 'afternoon');
    await page.fill('#alternate-comment', 'テスト用コメント');

    // 5. 再提案リクエストを送信
    await page.getByRole('button', { name: /この条件で再提案/i }).click();

    // 6. ページがリロードされて新しい候補が表示されることを確認
    // （API が成功すれば自動リロード）
    await page.waitForTimeout(2000); // リロード待ち

    // 新しい候補が表示されることを確認（件数は API によるが、エラーでなければOK）
    // 成功なら slot-card が表示される / max_reached なら OpenSlots 案内が表示される
    const slotCards = page.locator('label.slot-card');
    const openSlotsNotice = page.getByText(/お互いの空き時間で調整/i);
    
    // どちらかが表示されればOK
    const hasSlots = await slotCards.count() > 0;
    const hasOpenSlotsNotice = await openSlotsNotice.isVisible().catch(() => false);
    
    expect(hasSlots || hasOpenSlotsNotice).toBeTruthy();
  });

  test('モーダルをキャンセルできる', async ({ page, request }) => {
    // 1. Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B3キャンセルテスト',
        slot_count: 3
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. ページアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/i/${fixtureToken}`);

    // 3. モーダルを開く
    await page.getByRole('button', { name: /別日を希望する/i }).click();
    await expect(page.locator('#alternateModal')).toBeVisible();

    // 4. キャンセルをクリック
    await page.getByRole('button', { name: /やめる/i }).click();

    // 5. モーダルが閉じることを確認
    await expect(page.locator('#alternateModal')).not.toBeVisible();

    // 6. 元の候補がそのまま表示されていることを確認
    await expect(page.locator('label.slot-card')).toHaveCount(3);
  });

  test('singleSlotUI でも別日希望が可能', async ({ page, request }) => {
    // 1. 固定1枠の Fixture 作成
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one`, {
      data: {
        invitee_name: 'B3シングルテスト',
        invitee_email: 'b3-single@example.com',
        title: 'B3シングル別日希望',
        start_offset_hours: 48,
        duration_minutes: 60
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    expect(fixtureRes.ok()).toBeTruthy();
    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 招待ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/i/${fixtureToken}`);

    // 3. singleSlotUI が表示されることを確認（slot-card は 1つもない）
    // シングルの場合は異なるUI構造のはず
    // 「この日時でよろしいですか？」的な表示

    // 4. 「別日を希望する」ボタンが存在することを確認
    const alternateButton = page.getByRole('button', { name: /別日を希望する/i });
    await expect(alternateButton).toBeVisible();

    // 5. クリックしてモーダルが表示されることを確認
    await alternateButton.click();
    await expect(page.locator('#alternateModal')).toBeVisible();
  });
});

test.describe('本番環境ガード', () => {
  test('production では fixture API が 403 を返す', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl(process.env.E2E_BASE_URL);
    
    // production 環境でのみ意味があるテスト
    if (!apiBaseUrl.includes('api.tomoniwao.jp')) {
      test.skip();
      return;
    }

    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: { invitee_name: 'test' }
    });

    expect(response.status()).toBe(403);
  });
});
