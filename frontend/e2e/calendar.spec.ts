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

  // ============================================================
  // P3-INTERSECT1: 共通空き（複数参加者）テスト
  // ============================================================

  test('P3-INTERSECT1a: 全員の共通空きを確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 全員の共通空きを確認するコマンドを送信
    await sendChatMessage(page, '来週全員の空きを教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Common availability response: ${response.substring(0, 300)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に共通空き関連の内容が含まれていることを確認
    // 成功時: 「共通空き候補」「✅」「👥」
    // 失敗時: 「⚠️」「見つかりませんでした」
    const hasValidResponse =
      response.includes('共通空き') ||
      response.includes('空いている候補') ||
      response.includes('👥') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  test('P3-INTERSECT1b: みんなで空いてる時間を確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 「みんなで空いてる」パターン
    await sendChatMessage(page, '今週みんなで空いてるとこは？');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Everyone available response: ${response.substring(0, 300)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答が存在することを確認
    expect(response.length).toBeGreaterThan(0);
  });

  // ============================================================
  // P3-GEN1: スコアリングテスト（好み適用）
  // ============================================================

  test('P3-GEN1a: 共通空きがスコア順で返ってくる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 共通空きを確認（スコアリングが適用されるケース）
    await sendChatMessage(page, '来週みんなの共通空きを出して');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Scored slots response: ${response.substring(0, 400)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に関連内容が含まれていることを確認
    // 好み設定がある場合: 「スコア」「好み」
    // 好み設定がない場合: 通常の空き候補表示
    const hasValidResponse =
      response.includes('共通空き') ||
      response.includes('空いている候補') ||
      response.includes('スコア') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  test('P3-GEN1b: 午後の共通空きを確認できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // 午後の共通空きを確認
    await sendChatMessage(page, '来週の午後に全員で空いてるとこを教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] Afternoon common slots response: ${response.substring(0, 400)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答に午後の絞り込み関連の内容が含まれていることを確認
    const hasValidResponse =
      response.includes('午後') ||
      response.includes('共通空き') ||
      response.includes('空いている候補') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);
  });

  // ============================================================
  // CONV-1.0: AIフォールバック（自然文→unknown→nlRouter）
  // ============================================================

  test('CONV-1.0: 自然文→unknown→nlRouter→freebusy にフォールバックできる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // intent固定文言を避けた自然文（既存classifierで拾えない可能性が高い）
    await sendChatMessage(page, '来週の午後で空いてるところ教えて');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] CONV-1.0 fallback response: ${response.substring(0, 400)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 成功判定（どれかが出ていればOK）
    // 空きがある場合: 「来週」「空いている候補」「午後」
    // 空きがない場合: 「見つかりませんでした」
    // Google未連携: 「⚠️」「Google」
    const hasValidResponse =
      response.includes('来週') ||
      response.includes('空いている候補') ||
      response.includes('共通空き') ||
      response.includes('午後') ||
      response.includes('available') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);

    // 事故検知（unknownフォールバックが死んでいる時に出がち）
    expect(response).not.toContain('まだ実装されていません');
    expect(response).not.toContain('理解できませんでした');
  });

  test('CONV-1.0: 口語的な空き確認にも対応できる', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // より口語的な自然文
    await sendChatMessage(page, '来週の午後、空いてる枠をいくつか候補で');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] CONV-1.0 colloquial response: ${response.substring(0, 400)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 応答が存在し、エラーではないことを確認
    expect(response.length).toBeGreaterThan(0);
    expect(response).not.toContain('まだ実装されていません');
  });

  // ============================================================
  // CONV-1.1: AI Assist（params補完）テスト
  // ============================================================

  test('CONV-1.1a: 来週の午後、空いてる？→ AI Assist で午後params補完', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // AI Assist が午後 (afternoon) を補完するケース
    await sendChatMessage(page, '来週の午後、空いてる？');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] CONV-1.1a afternoon assist response: ${response.substring(0, 400)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 成功判定:
    // 午後の候補が出る: 「午後」「14時」「15時」「16時」「17時」「18時」
    // または空きがない場合: 「見つかりませんでした」
    // Google未連携: 「⚠️」「Google」
    const hasValidResponse =
      response.includes('午後') ||
      response.includes('14') ||
      response.includes('15') ||
      response.includes('16') ||
      response.includes('17') ||
      response.includes('空いている候補') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);

    // 事故検知
    expect(response).not.toContain('まだ実装されていません');
  });

  test('CONV-1.1b: 今週、夜いける？→ AI Assist で夜params補完', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // AI Assist が夜 (night=evening) を補完するケース
    await sendChatMessage(page, '今週、夜いける？');

    // アシスタントからの応答を待つ
    const response = await waitForAssistantMessage(page, 30000);
    console.log(`[E2E] CONV-1.1b night assist response: ${response.substring(0, 400)}...`);

    // 致命的なエラーがないことを確認
    await assertNoErrorEnhanced(page);

    // 成功判定:
    // 夜（18時以降）の候補が出る: 「夜」「18時」「19時」「20時」「21時」「22時」
    // または空きがない場合: 「見つかりませんでした」
    // Google未連携: 「⚠️」「Google」
    const hasValidResponse =
      response.includes('夜') ||
      response.includes('18') ||
      response.includes('19') ||
      response.includes('20') ||
      response.includes('21') ||
      response.includes('空いている候補') ||
      response.includes('見つかりませんでした') ||
      response.includes('⚠️');
    expect(hasValidResponse).toBe(true);

    // 事故検知
    expect(response).not.toContain('まだ実装されていません');
  });
});
