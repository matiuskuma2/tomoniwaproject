/**
 * smoke.smoke.spec.ts
 * E2E Smoke Test - 認証なしで実行可能
 * 
 * 目的:
 * - アプリケーションが起動することを確認
 * - 致命的なJSエラーがないことを確認
 * - CIで最低限の健全性チェック
 */

import { test, expect } from '@playwright/test';

test.describe('Smoke Test: 基本動作確認', () => {
  test('ページが読み込める', async ({ page }) => {
    const response = await page.goto('/');
    
    // 200 または 304 で成功、リダイレクト(3xx)もOK
    expect(response?.status()).toBeLessThan(400);
  });

  test('JavaScript エラーがない', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    
    await page.goto('/');
    await page.waitForTimeout(2000);
    
    // 致命的なエラーがないことを確認
    const criticalErrors = errors.filter(e => 
      !e.includes('ResizeObserver') && // ResizeObserver は無視
      !e.includes('Non-Error') // 非エラーオブジェクトは無視
    );
    
    expect(criticalErrors).toHaveLength(0);
  });

  test('基本的なUIが表示される', async ({ page }) => {
    await page.goto('/');
    
    // 何らかのコンテンツが表示されることを確認
    await expect(page.locator('body')).not.toBeEmpty();
    
    // ページタイトルが設定されていることを確認
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
