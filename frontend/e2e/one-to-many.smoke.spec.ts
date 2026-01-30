/**
 * one-to-many.smoke.spec.ts
 * E2E Smoke Test for 1-to-N Candidates Schedule Flow (G1-PLAN)
 * 
 * 認証なしで実行可能なスモークテスト
 * - fixture作成 → 招待ページ表示 → 回答 → 集計 → 確定
 * 
 * 実行: npx playwright test one-to-many.smoke.spec.ts --project=smoke
 */

import { test, expect } from '@playwright/test';

// API Base URL
const API_BASE_URL = process.env.E2E_API_URL || 'http://localhost:3000';

interface FixtureData {
  thread_id: string;
  organizer_user_id: string;
  invites: Array<{ token: string; email: string; name: string; invite_id: string }>;
  slots: Array<{ slot_id: string; start_at: string; end_at: string; label: string }>;
  group_policy: { mode: string; deadline_at: string; finalize_policy: string };
}

test.describe('1-to-N Smoke Tests (G1-PLAN)', () => {
  
  test('fixture作成 → 招待ページ表示', async ({ page, request }) => {
    // Fixture作成
    const createResponse = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 2,
        title: 'Smoke Test MTG',
        slot_count: 3,
        start_offset_hours: 48,
        duration_minutes: 60
      }
    });
    
    // 本番環境では403でスキップ
    if (createResponse.status() === 403) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    expect(createResponse.ok()).toBeTruthy();
    const fixture = await createResponse.json() as FixtureData;
    
    try {
      // 招待ページにアクセス
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      
      // 基本要素の確認
      await expect(page.locator('body')).toContainText('日程調整');
      await expect(page.locator('body')).toContainText('Smoke Test MTG');
      
      // スロットが表示されていることを確認
      const slotCards = page.locator('label.slot-card');
      const count = await slotCards.count();
      expect(count).toBe(3);
      
    } finally {
      await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${fixture.thread_id}`);
    }
  });
  
  test('参加者が回答（OK）→ 回答完了表示', async ({ page, request }) => {
    const createResponse = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 2,
        title: 'Respond OK Test',
        slot_count: 2
      }
    });
    
    if (createResponse.status() === 403) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const fixture = await createResponse.json() as FixtureData;
    
    try {
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      
      // スロットを選択
      await page.locator('label.slot-card').first().click();
      
      // 「参加可能」ボタンをクリック
      await page.locator('button[data-response="ok"]').click();
      
      // 回答完了を確認
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toContainText('参加可能と回答しました');
      
    } finally {
      await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${fixture.thread_id}`);
    }
  });
  
  test('参加者が回答（NO）→ 回答完了表示', async ({ page, request }) => {
    const createResponse = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 2,
        title: 'Respond NO Test',
        slot_count: 2
      }
    });
    
    if (createResponse.status() === 403) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const fixture = await createResponse.json() as FixtureData;
    
    try {
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      
      // 「参加不可」ボタンをクリック
      await page.locator('button[data-response="no"]').click();
      
      // 回答完了を確認
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toContainText('参加不可と回答しました');
      
    } finally {
      await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${fixture.thread_id}`);
    }
  });
  
  test('回答済みで再アクセス → 回答済み表示', async ({ page, request }) => {
    const createResponse = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 2,
        title: 'Already Responded Test',
        slot_count: 2
      }
    });
    
    if (createResponse.status() === 403) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const fixture = await createResponse.json() as FixtureData;
    
    try {
      // 1回目: 回答
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      await page.locator('button:has-text("参加可能")').click();
      await page.waitForTimeout(2000);
      
      // 2回目: 同じURLにアクセス
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      
      await expect(page.locator('body')).toContainText('回答済み');
      
    } finally {
      await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${fixture.thread_id}`);
    }
  });
  
  test('E2E完全フロー: 回答 → 集計 → 確定 → 確定済み表示', async ({ page, request }) => {
    const createResponse = await request.post(`${API_BASE_URL}/test/fixtures/one-to-many-candidates`, {
      data: {
        invitee_count: 3,
        title: 'Full Flow Test',
        slot_count: 3
      }
    });
    
    if (createResponse.status() === 403) {
      test.skip(true, 'Fixtures not available in production');
      return;
    }
    
    const fixture = await createResponse.json() as FixtureData;
    
    try {
      // Step 1: 参加者1が回答（OK）
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[0].token}`);
      await page.waitForLoadState('networkidle');
      await page.locator('label.slot-card').first().click();
      await page.locator('button:has-text("参加可能")').click();
      await page.waitForTimeout(1500);
      
      // Step 2: 参加者2が回答（OK）
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[1].token}`);
      await page.waitForLoadState('networkidle');
      await page.locator('label.slot-card').first().click();
      await page.locator('button:has-text("参加可能")').click();
      await page.waitForTimeout(1500);
      
      // Step 3: Summary API確認
      const summaryResponse = await request.get(
        `${API_BASE_URL}/api/one-to-many/${fixture.thread_id}/summary`,
        { headers: { 'x-user-id': fixture.organizer_user_id } }
      );
      expect(summaryResponse.ok()).toBeTruthy();
      const summary = await summaryResponse.json();
      expect(summary.summary.responded).toBe(2);
      expect(summary.summary.ok_count).toBe(2);
      
      // Step 4: Finalize
      const finalizeResponse = await request.post(
        `${API_BASE_URL}/api/one-to-many/${fixture.thread_id}/finalize`,
        {
          headers: { 
            'Content-Type': 'application/json',
            'x-user-id': fixture.organizer_user_id 
          },
          data: { selected_slot_id: fixture.slots[0].slot_id }
        }
      );
      expect(finalizeResponse.ok()).toBeTruthy();
      const finalizeResult = await finalizeResponse.json();
      expect(finalizeResult.status).toBe('confirmed');
      
      // Step 5: 確定後に招待ページが「確定済み」表示
      await page.goto(`${API_BASE_URL}/g/${fixture.invites[2].token}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toContainText('確定');
      
    } finally {
      await request.delete(`${API_BASE_URL}/test/fixtures/one-to-many/${fixture.thread_id}`);
    }
  });
  
  test('無効なトークン → エラー表示', async ({ page }) => {
    await page.goto(`${API_BASE_URL}/g/invalid-token-12345`);
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('body')).toContainText('無効');
  });
  
  test('認証なしでAPI → 401', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/api/one-to-many`);
    expect(response.status()).toBe(401);
  });
});
