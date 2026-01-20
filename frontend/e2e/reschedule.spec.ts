/**
 * reschedule.spec.ts
 * E2E: P2-D3 確定後やり直し（再調整）フロー
 * 
 * 検証ポイント:
 * 1. 「再調整」入力 → reschedule.pending メッセージ
 * 2. 「はい」入力 → pending.action.created に合流
 *    - 「送る/キャンセル/別スレッドで」文言が表示される
 * 
 * 目的:
 * - P2-D3 の "合流導線" が壊れたら即検知
 * - 独自フローではなく既存 pending.action フローに乗ることを確認
 */

import { test, expect } from '@playwright/test';
import {
  generateE2EPrefix,
  sendChatMessage,
  waitForUIStable,
  waitForAssistantMessage,
  assertNoErrorEnhanced,
  waitForThreadCreated,
} from './helpers/test-helpers';

// テスト用プレフィックス
const PREFIX = generateE2EPrefix();

test.describe('P2-D3 Reschedule', () => {
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

  /**
   * P2-D3: reschedule -> confirm -> pending.action.created
   * 
   * フロー:
   * 1. スレッド作成（メールアドレス入力で新規作成）
   * 2. 「再調整」入力 → reschedule.pending
   * 3. 「はい」入力 → pending.action.created（既存フロー合流）
   */
  test('reschedule -> confirm -> pending.action.created 合流', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // ============================================================
    // Step 1: スレッド作成（メールアドレス入力）
    // ============================================================
    const testEmail = `${PREFIX.toLowerCase()}_reschedule@example.com`;
    
    console.log(`[P2-D3 E2E] Step 1: Creating thread with email: ${testEmail}`);
    await sendChatMessage(page, testEmail);
    
    // 招待準備のレスポンスを待つ
    const _prepareMsg = await waitForAssistantMessage(page, 30000);
    console.log(`[P2-D3 E2E] Prepare response received: ${_prepareMsg.slice(0, 50)}...`);
    
    // 「送る」で送信
    await sendChatMessage(page, '送る');
    await waitForAssistantMessage(page, 30000);
    
    // スレッドが作成されるのを待つ（URL変更）
    const threadId = await waitForThreadCreated(page, 30000);
    console.log(`[P2-D3 E2E] Thread created: ${threadId}`);
    await assertNoErrorEnhanced(page);

    // ============================================================
    // Step 2: 「再調整」入力 → reschedule.pending
    // ============================================================
    console.log(`[P2-D3 E2E] Step 2: Sending '再調整'`);
    await sendChatMessage(page, '再調整');
    
    const rescheduleMsg = await waitForAssistantMessage(page, 30000);
    console.log(`[P2-D3 E2E] Reschedule response: ${rescheduleMsg.slice(0, 100)}...`);
    await assertNoErrorEnhanced(page);

    // 「はい/いいえ」誘導があることを確認（reschedule.pending の証拠）
    expect(rescheduleMsg).toMatch(/はい|いいえ/);
    // 参加者情報があることを確認
    expect(rescheduleMsg).toMatch(/再調整|参加者/);

    // ============================================================
    // Step 3: 「はい」入力 → pending.action.created 合流
    // ============================================================
    console.log(`[P2-D3 E2E] Step 3: Sending 'はい' to confirm`);
    await sendChatMessage(page, 'はい');
    
    const confirmMsg = await waitForAssistantMessage(page, 30000);
    console.log(`[P2-D3 E2E] Confirm response: ${confirmMsg.slice(0, 100)}...`);
    await assertNoErrorEnhanced(page);

    // ★ 核心: pending.action.created に合流した証拠
    // 既存フローの「送る/キャンセル/別スレッドで」が出ることを確認
    expect(confirmMsg).toMatch(/送る|キャンセル|別スレッドで/);
    
    // 再調整の準備完了メッセージ
    expect(confirmMsg).toMatch(/再調整.*準備|準備.*できました/);

    console.log(`[P2-D3 E2E] ✅ Test passed: reschedule -> confirm -> pending.action.created`);
  });

  /**
   * P2-D3: reschedule -> cancel
   * キャンセルフローの確認
   */
  test('reschedule -> cancel', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // スレッド作成
    const testEmail = `${PREFIX.toLowerCase()}_cancel@example.com`;
    await sendChatMessage(page, testEmail);
    await waitForAssistantMessage(page, 30000);
    await sendChatMessage(page, '送る');
    await waitForAssistantMessage(page, 30000);
    await waitForThreadCreated(page, 30000);

    // 再調整
    await sendChatMessage(page, '再調整');
    const rescheduleMsg = await waitForAssistantMessage(page, 30000);
    expect(rescheduleMsg).toMatch(/はい|いいえ/);

    // キャンセル
    await sendChatMessage(page, 'いいえ');
    const cancelMsg = await waitForAssistantMessage(page, 30000);
    await assertNoErrorEnhanced(page);

    // キャンセルメッセージを確認
    expect(cancelMsg).toMatch(/キャンセル/);

    console.log(`[P2-D3 E2E] ✅ Test passed: reschedule -> cancel`);
  });
});
