/**
 * CONV-CHAT E2E Tests
 * AI秘書との会話（雑談対応）の動作確認
 */

import { test, expect } from '@playwright/test';

// E2E認証トークン（環境変数から取得）
const E2E_TOKEN = process.env.E2E_AUTH_TOKEN || 'test-token';

test.describe('CONV-CHAT: AI秘書の雑談対応', () => {
  test.beforeEach(async ({ page }) => {
    // 認証トークンをセット
    await page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, E2E_TOKEN);
  });

  test('CHAT-1: 挨拶への応答', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForSelector('[data-testid="chat-input"]');

    // 入力して送信
    await page.fill('[data-testid="chat-input"]', 'こんにちは');
    await page.click('[data-testid="chat-send-button"]');

    // 応答を待つ
    await page.waitForSelector('[data-testid="chat-message"][data-message-role="assistant"]', {
      timeout: 10000,
    });

    // 応答にキーワードが含まれることを確認
    const messages = await page.locator('[data-testid="chat-message"][data-message-role="assistant"]').allTextContents();
    const lastMessage = messages[messages.length - 1];
    
    // 「こんにちは」または「お手伝い」が含まれることを確認
    const hasGreeting = lastMessage.includes('こんにちは') || 
                        lastMessage.includes('お手伝い') ||
                        lastMessage.includes('ございます');
    expect(hasGreeting).toBeTruthy();
  });

  test('CHAT-2: ヘルプへの応答', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForSelector('[data-testid="chat-input"]');

    // 入力して送信
    await page.fill('[data-testid="chat-input"]', '何ができる？');
    await page.click('[data-testid="chat-send-button"]');

    // 応答を待つ
    await page.waitForSelector('[data-testid="chat-message"][data-message-role="assistant"]', {
      timeout: 10000,
    });

    // 機能説明が含まれることを確認
    const messages = await page.locator('[data-testid="chat-message"][data-message-role="assistant"]').allTextContents();
    const lastMessage = messages[messages.length - 1];
    
    // 「予定」「空き」「日程調整」のいずれかが含まれることを確認
    const hasHelp = lastMessage.includes('予定') || 
                    lastMessage.includes('空き') ||
                    lastMessage.includes('日程調整');
    expect(hasHelp).toBeTruthy();
  });

  test('CHAT-3: 雑談から機能への切り替え', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForSelector('[data-testid="chat-input"]');

    // 1. まず雑談
    await page.fill('[data-testid="chat-input"]', 'お疲れ様');
    await page.click('[data-testid="chat-send-button"]');

    await page.waitForSelector('[data-testid="chat-message"][data-message-role="assistant"]', {
      timeout: 10000,
    });

    // 2. 次に機能呼び出し
    await page.waitForTimeout(500); // 入力フィールドがクリアされるのを待つ
    await page.fill('[data-testid="chat-input"]', '好み見せて');
    await page.click('[data-testid="chat-send-button"]');

    // 応答を待つ
    await page.waitForTimeout(3000);

    // 最新の応答を取得
    const messages = await page.locator('[data-testid="chat-message"][data-message-role="assistant"]').allTextContents();
    const lastMessage = messages[messages.length - 1];
    
    // 好み設定に関する応答が出ることを確認
    // (好みがない場合: 「設定されていません」、ある場合: 優先時間帯等)
    const isPreferenceResponse = lastMessage.includes('好み') || 
                                  lastMessage.includes('設定') ||
                                  lastMessage.includes('優先');
    expect(isPreferenceResponse).toBeTruthy();
  });

  test('CHAT-4: 感謝への応答', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForSelector('[data-testid="chat-input"]');

    // 入力して送信
    await page.fill('[data-testid="chat-input"]', 'ありがとう');
    await page.click('[data-testid="chat-send-button"]');

    // 応答を待つ
    await page.waitForSelector('[data-testid="chat-message"][data-message-role="assistant"]', {
      timeout: 10000,
    });

    // 感謝への応答が含まれることを確認
    const messages = await page.locator('[data-testid="chat-message"][data-message-role="assistant"]').allTextContents();
    const lastMessage = messages[messages.length - 1];
    
    const hasThanksResponse = lastMessage.includes('どういたしまして') || 
                              lastMessage.includes('いつでも') ||
                              lastMessage.includes('お手伝い');
    expect(hasThanksResponse).toBeTruthy();
  });
});
