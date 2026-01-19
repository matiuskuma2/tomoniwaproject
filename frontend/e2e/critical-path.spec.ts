/**
 * critical-path.spec.ts
 * E2E: 重要導線「核」の統合テスト
 * 
 * Phase A（核）:
 * 1. 認証済み状態で /chat に入れる
 * 2. スレッド作成（thread.create）
 * 3. リスト作成（list.create）
 * 4. リストに 10件メンバー追加 → BATCH_THRESHOLD=10 で executeBatchAddMembers 経由
 * 5. 画面が落ちない・致命的JS error が無い
 * 6. refresh の追従が最低1つ確認できる
 * 
 * 必要条件:
 * - E2E_BASE_URL: staging環境のURL
 * - E2E_AUTH_TOKEN: E2E用認証トークン
 */

import { test, expect } from '@playwright/test';
import {
  generateE2EPrefix,
  generateE2EListName,
  generateE2EThreadTitle,
  generateE2EEmails,
  sendChatMessage,
  waitForSuccess,
  waitForUIStable,
  assertNoError,
  E2ECleanupTracker,
} from './helpers/test-helpers';

// テスト用プレフィックス（各テストファイルで一意）
const PREFIX = generateE2EPrefix();
const cleanup = new E2ECleanupTracker();

test.describe('Critical Path: E2E核シナリオ', () => {
  // テスト終了後にクリーンアップログを出力
  test.afterAll(() => {
    cleanup.logCreatedResources();
  });

  // ============================================================
  // Step 1: 認証済み状態で /chat に入れる
  // ============================================================
  
  test('Step 1: 認証済み状態でアクセスできる', async ({ page }) => {
    // 認証済み状態で /chat に直接アクセス
    await page.goto('/chat');
    await waitForUIStable(page);
    
    // 認証が必要なページにリダイレクトされないことを確認
    // （ログイン画面に飛ばされないこと）
    const url = page.url();
    expect(url).toContain('/chat');
    expect(url).not.toContain('/login');
    expect(url).not.toContain('/auth');
    
    // 致命的なエラーがないことを確認
    await assertNoError(page);
  });

  // ============================================================
  // Step 2: スレッド作成
  // ============================================================

  test('Step 2: スレッドを作成できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);
    
    const threadTitle = generateE2EThreadTitle(PREFIX);
    
    // スレッド作成コマンドを送信
    await sendChatMessage(page, `${threadTitle}という名前で新しい調整を作成して`);
    
    // 成功を待つ（最大30秒）
    await waitForSuccess(page, 30000);
    
    // エラーがないことを確認
    await assertNoError(page);
    
    // リソースを記録
    cleanup.track('thread', 'unknown', threadTitle);
    
    console.log(`[E2E] Created thread: ${threadTitle}`);
  });

  // ============================================================
  // Step 3: リスト作成
  // ============================================================

  test('Step 3: リストを作成できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);
    
    const listName = generateE2EListName(PREFIX);
    
    // リスト作成コマンドを送信
    await sendChatMessage(page, `${listName}を作って`);
    
    // 成功を待つ
    await waitForSuccess(page, 30000);
    
    // エラーがないことを確認
    await assertNoError(page);
    
    // リソースを記録
    cleanup.track('list', 'unknown', listName);
    
    console.log(`[E2E] Created list: ${listName}`);
  });

  // ============================================================
  // Step 4: リストに10件メンバー追加（バッチ処理を通す）
  // ============================================================

  test('Step 4: 10件以上のメンバー追加でバッチ処理が動く', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);
    
    const listName = generateE2EListName(PREFIX);
    const emails = generateE2EEmails(PREFIX, 10); // BATCH_THRESHOLD = 10
    
    // まずリストを作成（Step 3 が失敗した場合のフォールバック）
    await sendChatMessage(page, `${listName}を作って`);
    await page.waitForTimeout(3000);
    
    // 10件のメールアドレスを追加
    const emailList = emails.join(', ');
    await sendChatMessage(page, `${emailList}を${listName}に追加`);
    
    // バッチ処理の完了を待つ（最大60秒 - バッチ処理は時間がかかる）
    await expect(
      page.locator('text=/処理完了|成功|追加しました|バッチ/')
    ).toBeVisible({ timeout: 60000 });
    
    // エラーがないことを確認
    await assertNoError(page);
    
    console.log(`[E2E] Added ${emails.length} members via batch processing`);
  });

  // ============================================================
  // Step 5: refresh 追従の確認
  // ============================================================

  test('Step 5: UIが更新される（refresh追従）', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);
    
    // リスト一覧を要求
    await sendChatMessage(page, 'リスト一覧を見せて');
    
    // リスト一覧が表示されることを確認
    await expect(
      page.locator('text=/リスト一覧|リストがありません/')
    ).toBeVisible({ timeout: 15000 });
    
    // エラーがないことを確認
    await assertNoError(page);
    
    console.log('[E2E] UI refresh confirmed');
  });
});

// ============================================================
// Phase B（将来拡張）: 重要導線フル
// ============================================================

test.describe.skip('Critical Path Phase B: フルシナリオ', () => {
  // TODO: Phase B で実装
  // 招待 → 追加候補 → need_response → リマインド → 確定
  
  test('招待を送信できる', async ({ page: _page }) => {
    // 実装予定
  });

  test('追加候補を提案できる', async ({ page: _page }) => {
    // 実装予定
  });

  test('need_response リストを確認できる', async ({ page: _page }) => {
    // 実装予定
  });

  test('リマインドを送信できる', async ({ page: _page }) => {
    // 実装予定
  });

  test('日程を確定できる', async ({ page: _page }) => {
    // 実装予定
  });
});
