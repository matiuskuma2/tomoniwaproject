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
 * 成功メッセージを待つ
 */
export async function waitForSuccess(page: Page, timeout = 15000): Promise<void> {
  await expect(
    page.locator('text=/✅|成功|作成しました|追加しました|送信しました|完了/').first()
  ).toBeVisible({ timeout });
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
