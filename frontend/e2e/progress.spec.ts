/**
 * progress.spec.ts
 * PROG-1: 進捗要約E2Eテスト
 * 
 * テスト対象:
 * 1. 「今どうなってる？」で進捗要約が返る
 * 2. 「返事きた？」で進捗要約が返る
 * 3. スレッド未選択時は全体一覧または案内が返る
 */

import { test, expect } from '@playwright/test';
import {
  sendChatMessage,
  waitForUIStable,
  waitForAssistantMessage,
  assertNoErrorEnhanced,
} from './helpers/test-helpers';

test.describe('PROG-1: 進捗要約', () => {
  // 各テストの前に認証を設定
  test.beforeEach(async ({ page }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (authToken) {
      await page.goto('/');
      await page.evaluate((token) => {
        sessionStorage.setItem('tomoniwao_token', token);
        sessionStorage.setItem('tomoniwao_user', JSON.stringify({
          id: 'e2e-test-user',
          email: 'e2e@example.com',
          name: 'E2E Test User',
        }));
      }, authToken);
    }
  });

  // ============================================================
  // PROG-1a: スレッド未選択時の進捗質問
  // ============================================================

  test('PROG-1a: 「今どうなってる？」→ スレッド選択案内または一覧', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // スレッド未選択の状態で進捗質問
    await sendChatMessage(page, '今どうなってる？');

    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Progress query (no thread): ${response.substring(0, 400)}...`);

    await assertNoErrorEnhanced(page);

    // スレッド選択案内 または 一覧が返る
    const isValidResponse =
      response.includes('スレッド一覧から選択') ||
      response.includes('募集中の調整') ||
      response.includes('現在、募集中') ||
      response.includes('どのスレッド');
    expect(isValidResponse).toBe(true);
  });

  // ============================================================
  // PROG-1b: 「返事きた？」で要約
  // ============================================================

  test('PROG-1b: 「返事きた？」→ スレッド選択案内または要約', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    await sendChatMessage(page, '返事きた？');

    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Response check query: ${response.substring(0, 400)}...`);

    await assertNoErrorEnhanced(page);

    // スレッド選択案内 または 要約キーワード
    const isValidResponse =
      response.includes('スレッド') ||
      response.includes('未回答') ||
      response.includes('回答済み') ||
      response.includes('招待者') ||
      response.includes('どのスレッド') ||
      response.includes('募集中');
    expect(isValidResponse).toBe(true);
  });

  // ============================================================
  // PROG-1c: 状況確認で要約形式
  // ============================================================

  test('PROG-1c: 「状況確認」→ 要約形式または一覧', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    await sendChatMessage(page, '状況確認');

    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Status check query: ${response.substring(0, 400)}...`);

    await assertNoErrorEnhanced(page);

    // 要約または一覧
    const isValidResponse =
      response.includes('進捗') ||
      response.includes('状態') ||
      response.includes('招待') ||
      response.includes('スレッド') ||
      response.includes('募集中') ||
      response.includes('調整');
    expect(isValidResponse).toBe(true);
  });

  // ============================================================
  // PROG-1d: 募集中の予定一覧
  // ============================================================

  test('PROG-1d: 「募集中の予定」→ 一覧表示', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    await sendChatMessage(page, '募集中の予定');

    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Active threads query: ${response.substring(0, 400)}...`);

    await assertNoErrorEnhanced(page);

    // 一覧または「ありません」
    const isValidResponse =
      response.includes('募集中の調整') ||
      response.includes('現在、募集中') ||
      response.includes('ありません') ||
      response.includes('件');
    expect(isValidResponse).toBe(true);
  });

  // ============================================================
  // PROG-1e: 次のアクション推奨の表示
  // ============================================================

  test('PROG-1e: 「次どうすればいい？」→ アクション推奨', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    await sendChatMessage(page, '次どうすればいい？');

    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Next action query: ${response.substring(0, 400)}...`);

    await assertNoErrorEnhanced(page);

    // アクション推奨または案内
    const isValidResponse =
      response.includes('次') ||
      response.includes('おすすめ') ||
      response.includes('リマインド') ||
      response.includes('確定') ||
      response.includes('スレッド') ||
      response.includes('どの');
    expect(isValidResponse).toBe(true);
  });
});
