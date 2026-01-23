/**
 * calendar.spec.ts
 * E2E: Phase Next-3 カレンダー閲覧テスト
 * 
 * テスト対象:
 * 1. 今日の予定を確認（schedule.today）
 * 2. 今週の予定を確認（schedule.week）
 * 3. 空き時間を確認（schedule.freebusy）
 * 
 * 必要条件:
 * - E2E_BASE_URL: staging環境のURL
 * - E2E_AUTH_TOKEN: E2E用認証トークン（Googleカレンダー連携済みユーザー）
 */

import { test, expect } from '@playwright/test';
import {
  sendChatMessage,
  waitForUIStable,
  assertNoError,
  waitForAssistantMessage,
  assertNoErrorEnhanced,
} from './helpers/test-helpers';

test.describe('Phase Next-3: カレンダー閲覧', () => {
  // 各テストの前に認証を設定
  test.beforeEach(async ({ page }) => {
    const authToken = process.env.E2E_AUTH_TOKEN;
    if (authToken) {
      // まずベースURLにアクセス（sessionStorage を設定するため）
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
  // P1-1: schedule.today - 今日の予定
  // ============================================================

  test('P1-1: 今日の予定を確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 今日の予定を確認するコマンドを送信
    await sendChatMessage(page, '今日の予定を教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Today response: ${response.substring(0, 200)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に予定関連の内容が含まれていることを確認
    // （予定がある場合: 「📅 今日の予定」、ない場合: 「今日の予定はありません」、権限がない場合: 「⚠️」）
    const hasValidResponse =
      response.includes('今日の予定') ||
      response.includes('予定はありません') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  // ============================================================
  // P1-2: schedule.week - 今週の予定
  // ============================================================

  test('P1-2: 今週の予定を確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 今週の予定を確認するコマンドを送信
    await sendChatMessage(page, '今週の予定を教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Week response: ${response.substring(0, 200)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に予定関連の内容が含まれていることを確認
    const hasValidResponse =
      response.includes('今週の予定') ||
      response.includes('予定はありません') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  // ============================================================
  // P1-3: schedule.freebusy - 空き時間
  // ============================================================

  test('P1-3a: 今日の空き時間を確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 今日の空きを確認するコマンドを送信
    await sendChatMessage(page, '今日の空きを教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] FreeBusy today response: ${response.substring(0, 200)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に空き関連の内容が含まれていることを確認
    // （空きがある場合: 「終日空いています」、埋まっている場合: 「予定が入っている時間」、権限がない場合: 「⚠️」）
    const hasValidResponse =
      response.includes('空いています') ||
      response.includes('予定が入っている') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  test('P1-3b: 今週の空き時間を確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 今週の空きを確認するコマンドを送信
    await sendChatMessage(page, '今週の空きを教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] FreeBusy week response: ${response.substring(0, 200)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に空き関連の内容が含まれていることを確認
    const hasValidResponse =
      response.includes('空いています') ||
      response.includes('予定が入っている') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  // ============================================================
  // Edge Case: 曖昧な入力への対応
  // ============================================================

  test('曖昧な空き時間の問い合わせに対応できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 「空いてる？」と曖昧な質問（時間範囲なし）
    await sendChatMessage(page, '空いてる？');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Ambiguous freebusy response: ${response.substring(0, 200)}...`);

    // 致命的なエラーがないことを確認
    await assertNoError(page);

    // 応答が存在することを確認（曖昧な場合はデフォルトでweekが使われるか、確認質問が来る）
    expect(response.length).toBeGreaterThan(0);
  });

  // ============================================================
  // P3-SLOTGEN1: 空き枠候補生成テスト
  // ============================================================

  test('P3-SLOTGEN1a: 来週の午後の空き枠を確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 来週の午後の空きを確認するコマンドを送信
    await sendChatMessage(page, '来週の午後の空きを教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Next week afternoon response: ${response.substring(0, 300)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に空き候補関連の内容が含まれていることを確認
    // 空き枠がある場合: 「✅」「空いている候補」「午後」
    // 空き枠がない場合: 「⚠️」「見つかりませんでした」
    // 権限がない場合: 「⚠️」「Google」
    const hasValidResponse =
      response.includes('空いている候補') ||
      response.includes('午後') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  test('P3-SLOTGEN1b: 今週の空き候補が表示される', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 今週の空き候補を確認
    await sendChatMessage(page, '今週の空き候補を出して');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Week available slots response: ${response.substring(0, 300)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に空き候補関連の内容が含まれていることを確認
    // 成功時: 「✅」「空いている候補」「1.」（番号付き列挙）
    // 失敗時: 「⚠️」
    const hasValidResponse =
      response.includes('空いている候補') ||
      response.includes('1.') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  test('P3-SLOTGEN1c: 午前の空き時間を絞り込める', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 午前の空きを確認
    await sendChatMessage(page, '今週の午前の空きは？');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Morning freebusy response: ${response.substring(0, 300)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に午前関連の内容が含まれていることを確認
    const hasValidResponse =
      response.includes('午前') ||
      response.includes('空いている候補') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });
});
