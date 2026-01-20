/**
 * e2e/helpers/test-helpers.ts
 * E2E テストヘルパー - 命名ルール・後始末戦略
 * 
 * 設計方針:
 * - 全リソースに E2E_ プレフィックス
 * - 日付・ランID で一意性を担保
 * - 残骸が残っても「テストデータ」と一目でわかる
 */

import { Page, expect } from '@playwright/test';

// ============================================================
// 命名ルール
// ============================================================

/**
 * E2E用のユニークなプレフィックスを生成
 * 形式: E2E_YYYYMMDD_HHMMSS_RANDOM
 */
export function generateE2EPrefix(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 6);
  return `E2E_${date}_${time}_${random}`;
}

/**
 * E2E用のリスト名を生成
 */
export function generateE2EListName(prefix: string, suffix = 'List'): string {
  return `${prefix}_${suffix}`;
}

/**
 * E2E用のスレッドタイトルを生成
 */
export function generateE2EThreadTitle(prefix: string, suffix = 'Thread'): string {
  return `${prefix}_${suffix}`;
}

/**
 * E2E用のテストメールアドレスを生成（10件以上でバッチ処理を通す）
 */
export function generateE2EEmails(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => 
    `${prefix.toLowerCase()}_user${i + 1}@example.com`
  );
}

// ============================================================
// チャット操作ヘルパー
// ============================================================

/**
 * チャット入力欄を取得
 */
export async function getChatInput(page: Page) {
  // 複数のセレクタを試す（UIの実装に依存）
  const selectors = [
    '[data-testid="chat-input"]',
    'input[placeholder*="入力"]',
    'textarea[placeholder*="入力"]',
    'input[type="text"]',
    'textarea',
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible().catch(() => false)) {
      return element;
    }
  }

  throw new Error('Chat input not found');
}

/**
 * チャットにメッセージを送信
 */
export async function sendChatMessage(page: Page, message: string): Promise<void> {
  const chatInput = await getChatInput(page);
  await chatInput.fill(message);
  await chatInput.press('Enter');
}

/**
 * チャット応答を待つ（特定のテキストが表示されるまで）
 */
export async function waitForChatResponse(
  page: Page, 
  pattern: string | RegExp,
  timeout = 30000
): Promise<void> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  
  await expect(page.locator(`text=${regex.source}`).first())
    .toBeVisible({ timeout });
}

/**
 * 成功メッセージを待つ（文言ベース - レガシー）
 * @deprecated 新しいテストでは waitForAssistantMessage または waitForThreadCreated を使用
 */
export async function waitForSuccess(page: Page, timeout = 15000): Promise<void> {
  await expect(
    page.locator('text=/✅|成功|作成しました|追加しました|送信しました|完了/').first()
  ).toBeVisible({ timeout });
}

/**
 * アシスタントメッセージが追加されるのを待つ（状態ベース）
 * チャット入力後にアシスタントからの応答を確認
 */
export async function waitForAssistantMessage(
  page: Page, 
  timeout = 30000
): Promise<string> {
  // chat-message[data-message-role="assistant"] を待つ
  const assistantMessages = page.locator('[data-testid="chat-message"][data-message-role="assistant"]');
  
  await expect(async () => {
    const count = await assistantMessages.count();
    expect(count).toBeGreaterThan(0);
  }).toPass({ timeout });
  
  // 最新のアシスタントメッセージの内容を取得
  const lastMessage = assistantMessages.last();
  await expect(lastMessage).toBeVisible({ timeout: 5000 });
  const content = await lastMessage.textContent() || '';
  return content;
}

/**
 * 特定のパターンを含むアシスタントメッセージを待つ
 */
export async function waitForAssistantMessageMatching(
  page: Page, 
  pattern: RegExp,
  timeout = 30000
): Promise<string> {
  const assistantMessages = page.locator('[data-testid="chat-message"][data-message-role="assistant"]');
  
  let matchedContent = '';
  await expect(async () => {
    const count = await assistantMessages.count();
    for (let i = count - 1; i >= 0; i--) {
      const content = await assistantMessages.nth(i).textContent() || '';
      if (pattern.test(content)) {
        matchedContent = content;
        return;
      }
    }
    throw new Error(`No assistant message matching ${pattern}`);
  }).toPass({ timeout });
  
  return matchedContent;
}

/**
 * スレッドが作成されるのを待つ（URL変更またはスレッドリスト更新）
 */
export async function waitForThreadCreated(
  page: Page, 
  timeout = 30000
): Promise<string> {
  // 方法1: URL が /chat/<uuid> に変わるのを待つ
  await expect(async () => {
    const url = page.url();
    const match = url.match(/\/chat\/([a-f0-9-]{36})/);
    expect(match).toBeTruthy();
  }).toPass({ timeout });
  
  const url = page.url();
  const match = url.match(/\/chat\/([a-f0-9-]{36})/);
  return match ? match[1] : '';
}

/**
 * スレッドリストにアイテムが追加されるのを待つ
 */
export async function waitForThreadListUpdate(
  page: Page,
  initialCount: number,
  timeout = 15000
): Promise<void> {
  const threadItems = page.locator('[data-testid="thread-item"]');
  
  await expect(async () => {
    const currentCount = await threadItems.count();
    expect(currentCount).toBeGreaterThan(initialCount);
  }).toPass({ timeout });
}

/**
 * エラーメッセージがないことを確認（強化版）
 * チャットメッセージ内のエラーもチェック
 */
export async function assertNoErrorEnhanced(page: Page): Promise<void> {
  // 通常のエラー表示
  const errorLocator = page.locator('text=/❌|エラー|失敗しました/');
  const errorCount = await errorLocator.count();
  
  if (errorCount > 0) {
    const errorText = await errorLocator.first().textContent();
    throw new Error(`Unexpected error on page: ${errorText}`);
  }
  
  // チャットメッセージ内のエラー確認
  const assistantMessages = page.locator('[data-testid="chat-message"][data-message-role="assistant"]');
  const msgCount = await assistantMessages.count();
  
  for (let i = 0; i < msgCount; i++) {
    const content = await assistantMessages.nth(i).textContent() || '';
    if (/❌|エラー|失敗しました/.test(content)) {
      throw new Error(`Error in assistant message: ${content}`);
    }
  }
}

/**
 * エラーメッセージがないことを確認
 */
export async function assertNoError(page: Page): Promise<void> {
  const errorLocator = page.locator('text=/❌|エラー|失敗しました/');
  const errorCount = await errorLocator.count();
  
  if (errorCount > 0) {
    const errorText = await errorLocator.first().textContent();
    throw new Error(`Unexpected error on page: ${errorText}`);
  }
}

// ============================================================
// 待ち方ヘルパー（フレーク防止）
// ============================================================

/**
 * UIが安定するまで待つ（ローディング完了）
 */
export async function waitForUIStable(page: Page, timeout = 10000): Promise<void> {
  // ローディングインジケータが消えるのを待つ
  const loadingSelectors = [
    '[data-testid="loading"]',
    '.loading',
    '.spinner',
    '[aria-busy="true"]',
  ];

  for (const selector of loadingSelectors) {
    const loading = page.locator(selector);
    if (await loading.isVisible().catch(() => false)) {
      await loading.waitFor({ state: 'hidden', timeout });
    }
  }

  // ネットワークが落ち着くのを待つ
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {
    // networkidle がタイムアウトしても続行
  });
}

/**
 * 要素の数が変わるまで待つ（リスト更新の検知）
 */
export async function waitForListChange(
  page: Page,
  selector: string,
  expectedChange: 'increase' | 'decrease' | 'any',
  timeout = 15000
): Promise<void> {
  const initialCount = await page.locator(selector).count();
  
  await expect(async () => {
    const currentCount = await page.locator(selector).count();
    
    switch (expectedChange) {
      case 'increase':
        expect(currentCount).toBeGreaterThan(initialCount);
        break;
      case 'decrease':
        expect(currentCount).toBeLessThan(initialCount);
        break;
      case 'any':
        expect(currentCount).not.toBe(initialCount);
        break;
    }
  }).toPass({ timeout });
}

// ============================================================
// P2-B1: 世代表示関連ヘルパー
// ============================================================

/**
 * 提案バージョンバッジの表示を確認
 */
export async function assertProposalVersionBadgeVisible(
  page: Page,
  expectedVersion?: number
): Promise<void> {
  const badge = page.locator('[data-testid="proposal-version-badge"]');
  await expect(badge).toBeVisible();
  
  if (expectedVersion !== undefined) {
    await expect(badge).toContainText(`v${expectedVersion}`);
  }
}

/**
 * 「最新候補のみ表示」トグルの状態を確認・操作
 */
export async function toggleLatestSlotsOnly(
  page: Page,
  enable: boolean
): Promise<void> {
  const toggle = page.locator('[data-testid="slots-latest-only-toggle"]');
  const isCurrentlyEnabled = await toggle.evaluate(el => 
    el.classList.contains('bg-blue-600')
  );
  
  if (isCurrentlyEnabled !== enable) {
    await toggle.click();
  }
}

/**
 * 再回答必要セクションの表示を確認
 */
export async function assertNeedResponseAlertVisible(
  page: Page,
  expectedCount?: number
): Promise<void> {
  const alert = page.locator('[data-testid="need-response-alert"]');
  await expect(alert).toBeVisible();
  
  if (expectedCount !== undefined) {
    await expect(alert).toContainText(`${expectedCount}名`);
  }
}

/**
 * 再回答必要者リストの詳細を展開・確認
 */
export async function expandAndCheckNeedResponseList(
  page: Page
): Promise<string[]> {
  const toggleBtn = page.locator('[data-testid="need-response-toggle"]');
  
  // 詳細を展開
  if (await toggleBtn.isVisible()) {
    await toggleBtn.click();
  }
  
  const list = page.locator('[data-testid="need-response-list"]');
  await expect(list).toBeVisible();
  
  // 名前一覧を取得
  const items = list.locator('li');
  const names: string[] = [];
  const count = await items.count();
  
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).textContent();
    if (text) names.push(text.trim());
  }
  
  return names;
}

// ============================================================
// 後始末（クリーンアップ）
// ============================================================

/**
 * E2Eで作成したリソースを記録（後で削除可能に）
 */
export class E2ECleanupTracker {
  private resources: Array<{
    type: 'list' | 'thread' | 'contact';
    id: string;
    name: string;
  }> = [];

  track(type: 'list' | 'thread' | 'contact', id: string, name: string) {
    this.resources.push({ type, id, name });
  }

  getResources() {
    return [...this.resources];
  }

  /**
   * 作成したリソースをログ出力（削除APIがない場合の代替）
   */
  logCreatedResources() {
    if (this.resources.length === 0) return;
    
    console.log('\n[E2E Cleanup] Created resources:');
    this.resources.forEach(r => {
      console.log(`  - ${r.type}: ${r.name} (id: ${r.id})`);
    });
    console.log('[E2E Cleanup] These can be manually deleted if needed.\n');
  }
}
