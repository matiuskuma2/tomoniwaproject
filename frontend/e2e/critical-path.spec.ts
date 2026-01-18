/**
 * critical-path.spec.ts
 * E2E: 重要導線1本の統合テスト
 * 
 * 導線:
 * 作成 → 招待 → 追加候補 → need_response → リマインド → 確定
 * ＋ list.add_member(10件) でバッチ処理を通す
 * 
 * 注意:
 * - 実際のバックエンドAPIが必要
 * - CI では E2E_BASE_URL を本番/ステージング環境に向ける
 * - 認証が必要な場合は beforeAll でログイン
 */

import { test, expect } from '@playwright/test';
import { 
  BATCH_EMAIL_LIST, 
  TEST_LIST_NAME,
  TEST_THREAD_TITLE,
} from './fixtures/test-data';

// ============================================================
// テスト設定
// ============================================================

test.describe('Critical Path: スケジュール調整フロー', () => {
  // テストごとに新しいコンテキスト
  test.beforeEach(async ({ page }) => {
    // 認証が必要な場合はここでログイン
    // await page.goto('/login');
    // await page.fill('[data-testid="email"]', 'test@example.com');
    // ...
  });

  // ============================================================
  // Step 1: アプリケーション起動確認
  // ============================================================
  
  test('Step 0: アプリケーションが起動する', async ({ page }) => {
    await page.goto('/');
    
    // ページが読み込まれることを確認
    await expect(page).toHaveTitle(/tomoniwao|Tomoniwao|日程調整/i);
  });

  // ============================================================
  // Step 2: チャット画面の基本動作
  // ============================================================

  test('Step 1: チャット画面が表示される', async ({ page }) => {
    await page.goto('/');
    
    // チャット入力欄が存在することを確認
    const chatInput = page.locator('input[placeholder*="入力"], textarea[placeholder*="入力"], [data-testid="chat-input"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });
  });

  // ============================================================
  // Step 3: リスト作成（バッチ処理の前提）
  // ============================================================

  test.skip('Step 2: リストを作成できる', async ({ page }) => {
    // 実際のAPIが必要なためスキップ
    // CI環境でバックエンドが起動している場合のみ実行
    
    await page.goto('/');
    
    const chatInput = page.locator('[data-testid="chat-input"]');
    await chatInput.fill(`${TEST_LIST_NAME}を作って`);
    await chatInput.press('Enter');
    
    // 成功メッセージを待つ
    await expect(page.locator('text=作成しました')).toBeVisible({ timeout: 15000 });
  });

  // ============================================================
  // Step 4: バッチ処理（10件以上のメンバー追加）
  // ============================================================

  test.skip('Step 3: 10件以上のメンバー追加でバッチ処理が動く', async ({ page }) => {
    // 実際のAPIが必要なためスキップ
    
    await page.goto('/');
    
    const chatInput = page.locator('[data-testid="chat-input"]');
    const emailList = BATCH_EMAIL_LIST.join(', ');
    
    await chatInput.fill(`${emailList}を${TEST_LIST_NAME}に追加`);
    await chatInput.press('Enter');
    
    // バッチ処理の完了を待つ
    // バッチ処理は "処理完了" または "成功: XX件" のようなメッセージを出す
    await expect(
      page.locator('text=/処理完了|成功.*件|追加しました/')
    ).toBeVisible({ timeout: 30000 });
  });

  // ============================================================
  // Step 5: スレッド作成
  // ============================================================

  test.skip('Step 4: 新規スレッドを作成できる', async ({ page }) => {
    // 実際のAPIが必要なためスキップ
    
    await page.goto('/');
    
    const chatInput = page.locator('[data-testid="chat-input"]');
    await chatInput.fill('新しい調整を作成して');
    await chatInput.press('Enter');
    
    // スレッド作成成功を待つ
    await expect(page.locator('text=作成しました')).toBeVisible({ timeout: 15000 });
  });

  // ============================================================
  // Step 6: 招待送信
  // ============================================================

  test.skip('Step 5: リストメンバーに招待を送信できる', async ({ page }) => {
    // 実際のAPIが必要なためスキップ
    
    await page.goto('/');
    
    const chatInput = page.locator('[data-testid="chat-input"]');
    await chatInput.fill(`${TEST_LIST_NAME}に招待を送って`);
    await chatInput.press('Enter');
    
    // 招待送信成功を待つ
    await expect(page.locator('text=送信しました')).toBeVisible({ timeout: 15000 });
  });

  // ============================================================
  // Step 7: リマインド
  // ============================================================

  test.skip('Step 6: 未返信者にリマインドを送信できる', async ({ page }) => {
    // 実際のAPIが必要なためスキップ
    
    await page.goto('/');
    
    const chatInput = page.locator('[data-testid="chat-input"]');
    await chatInput.fill('リマインド送って');
    await chatInput.press('Enter');
    
    // リマインド確認画面を待つ
    await expect(page.locator('text=リマインド')).toBeVisible({ timeout: 15000 });
    
    // 確認（はい）
    await chatInput.fill('はい');
    await chatInput.press('Enter');
    
    // リマインド送信成功を待つ
    await expect(page.locator('text=送信完了')).toBeVisible({ timeout: 15000 });
  });

  // ============================================================
  // Step 8: 確定
  // ============================================================

  test.skip('Step 7: 日程を確定できる', async ({ page }) => {
    // 実際のAPIが必要なためスキップ
    
    await page.goto('/');
    
    const chatInput = page.locator('[data-testid="chat-input"]');
    await chatInput.fill('1番で確定');
    await chatInput.press('Enter');
    
    // 確定成功を待つ
    await expect(page.locator('text=確定しました')).toBeVisible({ timeout: 15000 });
  });
});

// ============================================================
// Smoke Test: CI で最低限動くことを確認
// ============================================================

test.describe('Smoke Test: 基本動作確認', () => {
  test('ページが読み込める', async ({ page }) => {
    const response = await page.goto('/');
    
    // 200 または 304 で成功
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
});
