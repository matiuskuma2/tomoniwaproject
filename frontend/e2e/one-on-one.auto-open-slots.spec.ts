/**
 * E2E Test: 1-on-1 自動 Open Slots 誘導フロー（Phase B-5）
 * 
 * 別日希望3回目で自動的に Open Slots を生成し誘導する
 * 
 * テストケース:
 * 1. 再提案2回後、3回目の別日希望で max_reached + open_slots_url が返る
 * 2. UI で Open Slots への誘導が表示される
 * 3. 誘導リンクから Open Slots ページにアクセスできる
 * 
 * @see docs/plans/PR-B5.md
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

test.describe('1-on-1 自動 Open Slots 誘導フロー（B-5）', () => {
  // fixture 管理用
  let fixtureToken: string | null = null;
  let apiBaseUrl: string;

  test.beforeAll(async () => {
    apiBaseUrl = getApiBaseUrl(process.env.E2E_BASE_URL);
    console.log('[B5-E2E] API Base URL:', apiBaseUrl);
  });

  test.afterEach(async ({ request }) => {
    // fixture cleanup
    if (fixtureToken) {
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/one-on-one/${fixtureToken}`);
        console.log('[B5-E2E] Cleaned up fixture:', fixtureToken);
      } catch (e) {
        console.warn('[B5-E2E] Cleanup failed:', e);
      }
      fixtureToken = null;
    }
  });

  test('API: 再提案3回目で max_reached + auto_open_slots が返る', async ({ request }) => {
    // 1. Fixture 作成（additional_propose_count = 2 に設定して既に2回再提案済みとする）
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B5自動誘導テスト',
        invitee_email: 'b5-auto@example.com',
        title: 'B5 自動 Open Slots テスト',
        slot_count: 3,
        start_offset_hours: 48,
        duration_minutes: 60,
        additional_propose_count: 2  // 既に2回再提案済み
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

    // 2. 3回目の別日希望リクエスト
    const alternateRes = await request.post(`${apiBaseUrl}/i/${fixtureToken}/request-alternate`, {
      data: {
        range: 'next_week',
        prefer: 'afternoon',
        comment: 'B5テスト: 3回目'
      }
    });

    expect(alternateRes.ok()).toBeTruthy();
    const alternateData = await alternateRes.json();

    // 3. max_reached = true, auto_open_slots = true, open_slots_url が返ることを確認
    expect(alternateData.success).toBe(true);
    expect(alternateData.max_reached).toBe(true);
    expect(alternateData.auto_open_slots).toBe(true);
    expect(alternateData.open_slots_url).toBeTruthy();
    expect(alternateData.open_slots_url).toContain('/open/');
    
    // open_slots_token も返される
    expect(alternateData.open_slots_token).toBeTruthy();
  });

  test('API: 再提案2回目までは通常の再提案が行われる', async ({ request }) => {
    // 1. Fixture 作成（additional_propose_count = 1 に設定して1回再提案済みとする）
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B5通常再提案テスト',
        invitee_email: 'b5-normal@example.com',
        title: 'B5 通常再提案テスト',
        slot_count: 3,
        start_offset_hours: 48,
        duration_minutes: 60,
        additional_propose_count: 1  // 1回再提案済み
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    expect(fixtureRes.ok()).toBeTruthy();
    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 2回目の別日希望リクエスト
    const alternateRes = await request.post(`${apiBaseUrl}/i/${fixtureToken}/request-alternate`, {
      data: {
        range: 'next_week',
        prefer: 'afternoon',
        comment: 'B5テスト: 2回目'
      }
    });

    expect(alternateRes.ok()).toBeTruthy();
    const alternateData = await alternateRes.json();

    // 3. 通常の再提案が返る（max_reached = false or undefined）
    expect(alternateData.success).toBe(true);
    expect(alternateData.max_reached).toBeFalsy();
    expect(alternateData.slots).toBeTruthy();
    expect(alternateData.new_proposal_version).toBeGreaterThan(1);
  });

  test('UI: 3回目で Open Slots 誘導が表示される', async ({ page, request }) => {
    // 1. Fixture 作成（additional_propose_count = 2）
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B5 UI誘導テスト',
        title: 'B5 UI誘導テスト',
        slot_count: 3,
        additional_propose_count: 2
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 招待ページにアクセス
    await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:3000'}/i/${fixtureToken}`);
    await expect(page.locator('label.slot-card')).toHaveCount(3);

    // 3. 別日希望モーダルを開く
    await page.getByRole('button', { name: /別日を希望する/i }).click();
    await expect(page.locator('#alternateModal')).toBeVisible();

    // 4. フォームに入力して送信
    await page.selectOption('#alternate-range', 'next_week');
    await page.selectOption('#alternate-prefer', 'afternoon');
    await page.getByRole('button', { name: /この条件で再提案/i }).click();

    // 5. Open Slots 誘導が表示されることを確認
    // API レスポンスで max_reached + auto_open_slots が返るので、
    // UI がそれを受けて Open Slots 誘導を表示するはず
    await page.waitForTimeout(2000); // APIレスポンス待ち

    // Open Slots 誘導メッセージまたは Open Slots ページへのリンクを確認
    // 実装によって異なるが、以下のいずれかを確認:
    // - 「お互いの空き時間で調整」などのメッセージ
    // - /open/ へのリンク
    const openSlotsLink = page.locator('a[href*="/open/"]');
    const openSlotsMessage = page.getByText(/空いている時間から選んでください|お互いの空き時間で調整|空き時間の一覧/i);
    
    // どちらかが表示されればOK
    const hasLink = await openSlotsLink.count() > 0;
    const hasMessage = await openSlotsMessage.isVisible().catch(() => false);
    
    // 少なくとも何らかの誘導が表示される
    // ページがリロードされて候補が再表示されるか、Open Slots への案内が表示されるか
    expect(hasLink || hasMessage).toBeTruthy();
  });

  test('Open Slots 誘導リンクから実際のページにアクセスできる', async ({ page, request }) => {
    // 1. API で直接 Open Slots URL を取得
    const fixtureRes = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: {
        invitee_name: 'B5リンクテスト',
        title: 'B5 リンク遷移テスト',
        slot_count: 3,
        additional_propose_count: 2
      }
    });

    if (fixtureRes.status() === 403) {
      test.skip();
      return;
    }

    const fixture = await fixtureRes.json();
    fixtureToken = fixture.token;

    // 2. 3回目の別日希望で Open Slots URL を取得
    const alternateRes = await request.post(`${apiBaseUrl}/i/${fixtureToken}/request-alternate`, {
      data: {
        range: 'next_week',
        prefer: 'afternoon'
      }
    });

    const alternateData = await alternateRes.json();
    expect(alternateData.open_slots_url).toBeTruthy();

    // 3. Open Slots ページにアクセス
    const openSlotsUrl = alternateData.open_slots_url.replace('http://localhost:3000', process.env.E2E_BASE_URL || 'http://localhost:3000');
    await page.goto(openSlotsUrl);

    // 4. Open Slots ページが正常に表示されることを確認
    // タイトルまたは空き枠が表示される
    await expect(page.getByText('空いている時間')).toBeVisible({ timeout: 10000 });
    
    // 枠が表示されていることを確認
    const slotButtons = page.locator('.slot-btn');
    const slotCount = await slotButtons.count();
    expect(slotCount).toBeGreaterThan(0);
  });
});

test.describe('本番環境ガード（B-5）', () => {
  test('production では fixture API が 403 を返す', async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl(process.env.E2E_BASE_URL);
    
    // production 環境でのみ意味があるテスト
    if (!apiBaseUrl.includes('api.tomoniwao.jp')) {
      test.skip();
      return;
    }

    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-on-one-candidates`, {
      data: { 
        invitee_name: 'test',
        additional_propose_count: 2
      }
    });

    expect(response.status()).toBe(403);
  });
});
