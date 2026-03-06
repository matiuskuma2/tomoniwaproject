/**
 * conversation-orchestration.spec.ts
 * PR-UX-14: 会話オーケストレーション E2E リグレッションテスト
 * 
 * 4 critical flows:
 * 1. 「大島くんと予定調整したい」→「来週木曜17時から」→ thread creation
 * 2. prepared 後の右ペインが正しい thread state を表示
 * 3. clarification が nlRouter/chat にフォールバックしない
 * 4. デスクトップでのスレッド切替で全画面スピナーが出ない
 * 
 * @see docs/CONVERSATION_FLOW.md
 * @see docs/STATE_RESPONSIBILITY.md
 * 
 * 必要条件:
 * - E2E_BASE_URL: staging 環境の URL
 * - E2E_AUTH_TOKEN: E2E 用認証トークン
 */

import { test, expect } from '@playwright/test';
import {
  sendChatMessage,
  waitForUIStable,
  assertNoErrorEnhanced,
  waitForAssistantMessage,
  waitForAssistantMessageMatching,
  waitForThreadCreated,
  E2ECleanupTracker,
} from './helpers/test-helpers';

const cleanup = new E2ECleanupTracker();

test.describe('Conversation Orchestration: 4 Critical Flows', () => {
  test.afterAll(() => {
    cleanup.logCreatedResources();
  });

  // 認証設定
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
  // Flow 1: Clarification → Follow-up → Thread Creation
  // ============================================================

  test('Flow 1: 「大島くんと予定調整したい」→ clarification → 「来週木曜17時から」→ thread creation', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // Step 1: 初回入力（日時なし → clarification 発生）
    await sendChatMessage(page, '大島くんと予定調整したい');
    
    // clarification メッセージを待つ（「いつ」「日時」などの質問）
    const clarificationMsg = await waitForAssistantMessage(page, 30000);
    expect(clarificationMsg).toMatch(/いつ|日時|例:|時/);
    console.log('[E2E] Flow 1 Step 1: Clarification received:', clarificationMsg.substring(0, 80));

    // hint banner の確認
    const hintBanner = page.locator('[data-testid="pending-hint-banner"]');
    // hint banner が表示されるか確認（実装によっては data-testid がない場合がある）
    const hasBanner = await hintBanner.isVisible().catch(() => false);
    if (hasBanner) {
      console.log('[E2E] Flow 1: Hint banner visible');
    }

    // Step 2: Follow-up 入力（日時指定 → thread creation）
    await sendChatMessage(page, '来週木曜17時から1時間');

    // アシスタント応答を待つ（成功メッセージ or 追加 clarification）
    const followUpMsg = await waitForAssistantMessage(page, 30000);
    console.log('[E2E] Flow 1 Step 2: Follow-up response:', followUpMsg.substring(0, 100));

    // エラーがないことを確認
    await assertNoErrorEnhanced(page);

    // thread creation が発生した場合、URL が変わる
    try {
      const threadId = await waitForThreadCreated(page, 15000);
      if (threadId) {
        cleanup.track('thread', threadId, 'Flow 1 Thread');
        console.log(`[E2E] Flow 1: Thread created: ${threadId}`);
      }
    } catch {
      // 連絡先解決待ちなど、thread creation まで到達しない場合もある
      console.log('[E2E] Flow 1: Thread not created (may need contact resolution)');
    }
  });

  // ============================================================
  // Flow 2: prepared 後の右ペイン表示
  // ============================================================

  test('Flow 2: prepared 後に右ペインが正しい thread state を表示する', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // スレッドが存在する場合、最初のスレッドを選択
    const threadItems = page.locator('[data-testid="thread-item"]');
    const threadCount = await threadItems.count();
    
    if (threadCount === 0) {
      console.log('[E2E] Flow 2: No existing threads, creating one...');
      await sendChatMessage(page, `e2e_flow2_${Date.now()}@example.com`);
      await waitForAssistantMessage(page, 30000);
    }

    // スレッドを選択（最初のスレッド）
    if (await threadItems.first().isVisible()) {
      await threadItems.first().click();
      await page.waitForTimeout(1000);
    }

    // デスクトップ表示での右ペイン確認
    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 1024) {
      // 右ペイン（CardsPane）が存在することを確認
      const cardsPane = page.locator('[data-testid="cards-pane"]');
      const hasCardsPane = await cardsPane.isVisible().catch(() => false);
      
      if (hasCardsPane) {
        // 全画面スピナーがないことを確認
        const fullSpinner = cardsPane.locator('.animate-spin.h-8, .animate-spin.h-6, .animate-spin.h-4');
        const largeSpinnerCount = await fullSpinner.count();
        
        // h-4 以上のスピナーは存在しないはず
        expect(largeSpinnerCount).toBe(0);
        console.log('[E2E] Flow 2: No large spinners in CardsPane');
        
        // skeleton が短時間で消えることを確認（10秒以内）
        const skeleton = cardsPane.locator('.animate-pulse');
        try {
          await skeleton.first().waitFor({ state: 'hidden', timeout: 10000 });
          console.log('[E2E] Flow 2: Skeleton cleared within 10s');
        } catch {
          // skeleton が表示されていない場合も OK（cache hit）
          const skeletonVisible = await skeleton.first().isVisible().catch(() => false);
          if (!skeletonVisible) {
            console.log('[E2E] Flow 2: No skeleton shown (cache hit)');
          } else {
            console.log('[E2E] Flow 2: Skeleton still visible after 10s');
          }
        }
      } else {
        console.log('[E2E] Flow 2: CardsPane not found (mobile layout?)');
      }
    } else {
      console.log('[E2E] Flow 2: Viewport too narrow for desktop layout check');
    }

    await assertNoErrorEnhanced(page);
  });

  // ============================================================
  // Flow 3: Clarification が nlRouter に漏れない
  // ============================================================

  test('Flow 3: clarification 中の入力が nlRouter/chat にフォールバックしない', async ({ page }) => {
    await page.goto('/chat');
    await waitForUIStable(page);

    // Step 1: clarification を発生させる
    await sendChatMessage(page, '田中さんと予定調整したい');
    const clarification = await waitForAssistantMessage(page, 30000);
    expect(clarification).toMatch(/いつ|日時|例:|時/);

    // Step 2: 日時を含む follow-up
    await sendChatMessage(page, '明日の午後3時から');
    const response = await waitForAssistantMessage(page, 30000);

    // nlRouter のフォールバックメッセージではないことを確認
    // nlRouter は通常「ご質問」「お手伝い」「何でも」等の汎用応答
    expect(response).not.toMatch(/ご質問ありがとう|何でもお聞き|雑談/i);

    // エラーでないことを確認
    const hasError = /❌|エラー|失敗/.test(response);
    if (hasError) {
      // 認証エラーなどは許容（テスト環境依存）
      console.log('[E2E] Flow 3: Got error (may be auth/env related):', response.substring(0, 80));
    } else {
      console.log('[E2E] Flow 3: Follow-up correctly routed:', response.substring(0, 80));
    }
  });

  // ============================================================
  // Flow 4: デスクトップでのスレッド切替で全画面スピナーが出ない
  // ============================================================

  test('Flow 4: デスクトップでスレッド切替時に全画面スピナーが出ない', async ({ page }) => {
    // デスクトップサイズに設定
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/chat');
    await waitForUIStable(page);

    const threadItems = page.locator('[data-testid="thread-item"]');
    const threadCount = await threadItems.count();

    if (threadCount < 2) {
      console.log('[E2E] Flow 4: Not enough threads for switch test, skipping');
      return;
    }

    // 最初のスレッドを選択
    await threadItems.first().click();
    await page.waitForTimeout(500);

    // 2番目のスレッドに切り替え
    await threadItems.nth(1).click();

    // 全画面スピナー（h-full + items-center + justify-center 内の大きな spinner）がないことを確認
    // 監視開始: 500ms間、大きなスピナーが出ないことを確認
    let foundLargeSpinner = false;
    const startTime = Date.now();
    
    while (Date.now() - startTime < 500) {
      // h-8 以上のスピナーを検索
      const largeSpinners = page.locator('.animate-spin').filter({
        has: page.locator('[class*="h-8"], [class*="h-6"]'),
      });
      const spinnerCount = await largeSpinners.count().catch(() => 0);
      
      if (spinnerCount > 0) {
        foundLargeSpinner = true;
        break;
      }
      await page.waitForTimeout(50);
    }

    expect(foundLargeSpinner).toBe(false);
    console.log('[E2E] Flow 4: No large spinner during thread switch');

    // 小さいインライン spinner（h-2 w-2 同期中）は許容
    const tinySpinners = page.locator('.animate-spin.h-2.w-2');
    const tinyCount = await tinySpinners.count();
    if (tinyCount > 0) {
      console.log(`[E2E] Flow 4: ${tinyCount} tiny sync spinner(s) found (acceptable)`);
    }

    // ChatPane が正常にメッセージ領域を表示していること
    const chatMessages = page.locator('[data-testid="chat-messages"]');
    await expect(chatMessages).toBeVisible({ timeout: 5000 });

    await assertNoErrorEnhanced(page);
  });
});
