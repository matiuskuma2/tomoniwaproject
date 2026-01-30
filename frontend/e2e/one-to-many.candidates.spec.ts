/**
 * one-to-many.candidates.spec.ts
 * E2E Authenticated Test for 1-to-N Candidates Schedule Flow (G1-PLAN)
 * 
 * テスト対象:
 * 1. fixture 作成（候補3つ × 参加者3人）→ token 取得
 * 2. /g/:token を開く → グループ回答UIが表示される
 * 3. 参加者2人が回答 → summary APIで集計確認
 * 4. 主催者が finalize → confirmed 表示
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

interface FixtureData {
  thread_id: string;
  organizer_user_id: string;
  invites: Array<{ token: string; email: string; name: string; invite_id: string }>;
  slots: Array<{ slot_id: string; start_at: string; end_at: string; label: string }>;
  group_policy: { mode: string; deadline_at: string; finalize_policy: string };
}

test.describe('1-to-N Candidates Schedule Flow (G1-PLAN)', () => {
  let fixtureData: FixtureData | null = null;
  
  // テスト前に fixture を作成
  test.beforeAll(async ({ request }) => {
    const apiBaseUrl = getApiBaseUrl();
    
    console.log(`[E2E-G1] Creating 1-to-N candidates fixture on ${apiBaseUrl}`);
    
    // fixture 作成（development/staging 環境でのみ動作）
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 3,
        title: 'E2E G1 チームMTG テスト',
        slot_count: 3,
        start_offset_hours: 48,
        duration_minutes: 60,
        deadline_hours: 72
      }
    });
    
    // production では 403 が返る → テストスキップ
    if (response.status() === 403) {
      console.log('[E2E-G1] Test fixtures not available (production environment) - tests will skip');
      fixtureData = null;
      return;
    }
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.thread_id).toBeTruthy();
    expect(data.invites).toHaveLength(3);
    expect(data.slots).toHaveLength(3);
    
    fixtureData = data;
    
    console.log(`[E2E-G1] Created 1-to-N fixture: thread=${data.thread_id}, invites=${data.invites.length}, slots=${data.slots.length}`);
  });
  
  // テスト後に fixture をクリーンアップ
  test.afterAll(async ({ request }) => {
    if (!fixtureData) return;
    
    const apiBaseUrl = getApiBaseUrl();
    
    try {
      await request.delete(`${apiBaseUrl}/test/fixtures/one-to-many/${fixtureData.thread_id}`);
      console.log(`[E2E-G1] Cleaned up 1-to-N fixture: ${fixtureData.thread_id}`);
    } catch {
      console.log(`[E2E-G1] Cleanup failed (may already be deleted): ${fixtureData.thread_id}`);
    }
  });
  
  test('グループ招待ページが表示される（/g/:token）', async ({ page }) => {
    test.skip(!fixtureData, 'Fixture not available (production environment)');
    
    const inviteToken = fixtureData!.invites[0].token;
    const apiBaseUrl = getApiBaseUrl();
    
    // 招待ページに遷移
    await page.goto(`${apiBaseUrl}/g/${inviteToken}`);
    await page.waitForLoadState('networkidle');
    
    // 日程調整ページが表示されることを確認
    await expect(page.locator('h1')).toContainText('日程調整');
    
    // スレッドタイトルが表示されることを確認
    await expect(page.locator('body')).toContainText('E2E G1 チームMTG テスト');
    
    // スロットカードが3つ表示されることを確認
    const slotCards = page.locator('label.slot-card');
    await expect(slotCards).toHaveCount(3);
    
    // 回答ボタンが表示されることを確認
    const okButton = page.locator('button:has-text("参加可能")');
    await expect(okButton).toBeVisible();
    
    const noButton = page.locator('button:has-text("参加不可")');
    await expect(noButton).toBeVisible();
  });
  
  test('参加者が「参加可能」で回答できる', async ({ page, request }) => {
    test.skip(!fixtureData, 'Fixture not available (production environment)');
    
    // 新しい fixture を作成（状態リセット）
    const apiBaseUrl = getApiBaseUrl();
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 3,
        title: 'E2E G1 回答テスト',
        slot_count: 3,
        start_offset_hours: 72,
        duration_minutes: 60,
        deadline_hours: 72
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for respond test');
      return;
    }
    
    const fixture = await response.json() as FixtureData;
    const inviteToken = fixture.invites[0].token;
    
    try {
      // 招待ページに遷移
      await page.goto(`${apiBaseUrl}/g/${inviteToken}`);
      await page.waitForLoadState('networkidle');
      
      // スロットカードを確認
      const slotCards = page.locator('label.slot-card');
      await expect(slotCards).toHaveCount(3);
      
      // 2番目のスロットを選択
      const secondSlot = slotCards.nth(1);
      await secondSlot.click();
      
      // 「参加可能」ボタンをクリック
      const okButton = page.locator('button:has-text("参加可能")');
      await expect(okButton).toBeVisible();
      await okButton.click();
      
      // 回答完了ページに遷移
      await page.waitForTimeout(2000);
      
      // 回答完了メッセージが表示されることを確認
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
    } finally {
      // クリーンアップ
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/one-to-many/${fixture.thread_id}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('参加者が「参加不可」で回答できる', async ({ page, request }) => {
    test.skip(!fixtureData, 'Fixture not available (production environment)');
    
    const apiBaseUrl = getApiBaseUrl();
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 3,
        title: 'E2E G1 辞退テスト',
        slot_count: 3,
        start_offset_hours: 96,
        duration_minutes: 60,
        deadline_hours: 72
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for decline test');
      return;
    }
    
    const fixture = await response.json() as FixtureData;
    const inviteToken = fixture.invites[0].token;
    
    try {
      // 招待ページに遷移
      await page.goto(`${apiBaseUrl}/g/${inviteToken}`);
      await page.waitForLoadState('networkidle');
      
      // 「参加不可」ボタンをクリック
      const noButton = page.locator('button:has-text("参加不可")');
      await expect(noButton).toBeVisible();
      await noButton.click();
      
      // 回答完了ページに遷移
      await page.waitForTimeout(2000);
      
      // 回答完了メッセージが表示されることを確認
      await expect(page.locator('body')).toContainText('参加不可と回答しました');
      
    } finally {
      // クリーンアップ
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/one-to-many/${fixture.thread_id}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('回答後に再度アクセスすると「回答済み」表示', async ({ page, request }) => {
    test.skip(!fixtureData, 'Fixture not available (production environment)');
    
    const apiBaseUrl = getApiBaseUrl();
    const response = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 2,
        title: 'E2E G1 重複回答テスト',
        slot_count: 3,
        start_offset_hours: 120,
        duration_minutes: 60,
        deadline_hours: 72
      }
    });
    
    if (!response.ok()) {
      test.skip(true, 'Could not create fixture for duplicate test');
      return;
    }
    
    const fixture = await response.json() as FixtureData;
    const inviteToken = fixture.invites[0].token;
    
    try {
      // 1回目: 回答する
      await page.goto(`${apiBaseUrl}/g/${inviteToken}`);
      await page.waitForLoadState('networkidle');
      
      const okButton = page.locator('button:has-text("参加可能")');
      await okButton.click();
      await page.waitForTimeout(2000);
      
      // 2回目: 同じURLにアクセス
      await page.goto(`${apiBaseUrl}/g/${inviteToken}`);
      await page.waitForLoadState('networkidle');
      
      // 「回答済み」メッセージが表示されることを確認
      await expect(page.locator('body')).toContainText('すでに回答済みです');
      
    } finally {
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/one-to-many/${fixture.thread_id}`);
      } catch {
        // ignore
      }
    }
  });
  
  test('E2E: 複数人回答 → summary API で集計確認 → finalize', async ({ page, request }) => {
    test.skip(!fixtureData, 'Fixture not available (production environment)');
    
    const apiBaseUrl = getApiBaseUrl();
    
    // 新しい fixture を作成
    const createResponse = await request.post(`${apiBaseUrl}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 3,
        title: 'E2E G1 完全フローテスト',
        slot_count: 3,
        start_offset_hours: 144,
        duration_minutes: 60,
        deadline_hours: 72
      }
    });
    
    if (!createResponse.ok()) {
      test.skip(true, 'Could not create fixture for full flow test');
      return;
    }
    
    const fixture = await createResponse.json() as FixtureData;
    
    try {
      // ========================================
      // Step 1: 参加者1が回答（OK）
      // ========================================
      await page.goto(`${apiBaseUrl}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      
      const slot1 = page.locator('label.slot-card').first();
      await slot1.click();
      
      await page.locator('button:has-text("参加可能")').click();
      await page.waitForTimeout(2000);
      
      // ========================================
      // Step 2: 参加者2が回答（OK、同じスロット）
      // ========================================
      await page.goto(`${apiBaseUrl}/g/${fixture.invites[1].token}`);
      await page.waitForLoadState('networkidle');
      
      const slot2 = page.locator('label.slot-card').first();
      await slot2.click();
      
      await page.locator('button:has-text("参加可能")').click();
      await page.waitForTimeout(2000);
      
      // ========================================
      // Step 3: Summary API で集計確認
      // ========================================
      const summaryResponse = await request.get(
        `${apiBaseUrl}/api/one-to-many/${fixture.thread_id}/summary`,
        {
          headers: {
            'x-user-id': fixture.organizer_user_id
          }
        }
      );
      
      expect(summaryResponse.ok()).toBeTruthy();
      const summary = await summaryResponse.json();
      
      // 2人が回答していることを確認
      expect(summary.summary.responded).toBe(2);
      expect(summary.summary.ok_count).toBe(2);
      expect(summary.summary.pending_count).toBe(1);
      
      // ========================================
      // Step 4: Finalize API で確定
      // ========================================
      const selectedSlotId = fixture.slots[0].slot_id;
      
      const finalizeResponse = await request.post(
        `${apiBaseUrl}/api/one-to-many/${fixture.thread_id}/finalize`,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': fixture.organizer_user_id
          },
          data: {
            selected_slot_id: selectedSlotId
          }
        }
      );
      
      expect(finalizeResponse.ok()).toBeTruthy();
      const finalizeResult = await finalizeResponse.json();
      expect(finalizeResult.success).toBe(true);
      expect(finalizeResult.status).toBe('confirmed');
      
      // ========================================
      // Step 5: 確定後に招待ページが「確定済み」表示
      // ========================================
      await page.goto(`${apiBaseUrl}/g/${fixture.invites[2].token}`);
      await page.waitForLoadState('networkidle');
      
      // 確定済みメッセージが表示されることを確認
      await expect(page.locator('body')).toContainText('確定済み');
      
    } finally {
      try {
        await request.delete(`${apiBaseUrl}/test/fixtures/one-to-many/${fixture.thread_id}`);
      } catch {
        // ignore
      }
    }
  });
});
