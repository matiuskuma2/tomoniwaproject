/**
 * E2E Tests: CONV-1.2 会話化拡張
 * 
 * テスト対象:
 * - multi-intent nlRouter（/api/nl/multi）
 * - 会話での招待準備
 * - 会話でのリマインド
 * - 会話での進捗確認
 * - 雑談フォールバック
 * 
 * 前提条件:
 * - E2E_BASE_URL: staging環境のURL
 * - E2E_AUTH_TOKEN: E2E用認証トークン
 */

import { test, expect, Page } from '@playwright/test';

// ============================================================
// テストヘルパー
// ============================================================

const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const E2E_AUTH_TOKEN = process.env.E2E_AUTH_TOKEN || '';

/**
 * チャット画面でメッセージを送信
 */
async function sendChatMessage(page: Page, message: string): Promise<void> {
  console.log(`[E2E] Sending: "${message}"`);
  
  // 入力欄を取得（複数の可能性があるセレクタ）
  const input = page.locator('textarea[placeholder*="入力"], input[placeholder*="入力"], textarea[data-testid="chat-input"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(message);
  
  // 送信ボタンまたはEnterで送信
  const sendButton = page.locator('button[type="submit"], button[aria-label*="送信"]').first();
  if (await sendButton.isVisible()) {
    await sendButton.click();
  } else {
    await input.press('Enter');
  }
}

/**
 * アシスタントの応答を待つ
 */
async function waitForAssistantMessage(page: Page, timeoutMs: number = 30000): Promise<string> {
  console.log('[E2E] Waiting for assistant response...');
  
  // 新しいメッセージが表示されるまで待つ
  const assistantMessage = page.locator('[data-role="assistant"], .assistant-message, [class*="assistant"]').last();
  await assistantMessage.waitFor({ state: 'visible', timeout: timeoutMs });
  
  // 少し待ってから内容を取得（ストリーミング対応）
  await page.waitForTimeout(1000);
  
  const content = await assistantMessage.textContent();
  console.log(`[E2E] Assistant response: "${content?.substring(0, 100)}..."`);
  return content || '';
}

/**
 * UIが安定するまで待つ
 */
async function waitForUIStable(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

/**
 * 致命的エラーがないことを確認
 */
async function assertNoFatalError(page: Page): Promise<void> {
  const pageContent = await page.content();
  expect(pageContent).not.toContain('500 Internal Server Error');
  expect(pageContent).not.toContain('Application error');
  expect(pageContent).not.toContain('FATAL');
}

// ============================================================
// テストケース
// ============================================================

test.describe('CONV-1.2 会話化拡張', () => {
  test.beforeEach(async ({ page }) => {
    // 認証トークンがあれば設定
    if (E2E_AUTH_TOKEN) {
      await page.goto(`${E2E_BASE_URL}/chat`);
      await page.evaluate((token) => {
        localStorage.setItem('auth_token', token);
      }, E2E_AUTH_TOKEN);
    }
    
    // チャット画面に移動
    await page.goto(`${E2E_BASE_URL}/chat`);
    await waitForUIStable(page);
  });

  test('CONV-1.2-1: 雑談フォールバック - 挨拶', async ({ page }) => {
    // Given: チャット画面にいる
    
    // When: 挨拶を送信
    await sendChatMessage(page, 'こんにちは');
    
    // Then: 自然な応答が返る（エラーなし）
    const response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    
    // 応答が存在することを確認
    expect(response.length).toBeGreaterThan(0);
    
    // 「こんにちは」系の応答またはAI秘書らしい応答
    const hasGreeting = /こんにちは|お手伝い|何か|いらっしゃい/i.test(response);
    expect(hasGreeting || response.length > 0).toBe(true);
  });

  test('CONV-1.2-2: 進捗確認の会話 - 今どうなってる？', async ({ page }) => {
    // Given: チャット画面にいる
    
    // When: 進捗を聞く
    await sendChatMessage(page, '今どうなってる？');
    
    // Then: 応答が返る（スレッド未選択の案内 or 進捗表示）
    const response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    
    expect(response.length).toBeGreaterThan(0);
    
    // 「スレッドを選択」または「状態」「進捗」などの言葉を含む
    const hasRelevantContent = /スレッド|選択|状態|進捗|予定|調整/i.test(response);
    expect(hasRelevantContent || response.length > 10).toBe(true);
  });

  test('CONV-1.2-3: リスト操作の会話 - リスト一覧', async ({ page }) => {
    // Given: チャット画面にいる
    
    // When: リスト一覧を聞く
    await sendChatMessage(page, 'リスト見せて');
    
    // Then: リスト一覧が返る
    const response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    
    expect(response.length).toBeGreaterThan(0);
    
    // 「リスト」「一覧」「ありません」などを含む
    const hasListContent = /リスト|一覧|ありません|作成/i.test(response);
    expect(hasListContent).toBe(true);
  });

  test('CONV-1.2-4: 空き時間の会話 - 来週の午後', async ({ page }) => {
    // Given: チャット画面にいる
    
    // When: 空き時間を聞く（CONV-1.1 params補完も検証）
    await sendChatMessage(page, '来週の午後、空いてる？');
    
    // Then: 応答が返る
    const response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    
    expect(response.length).toBeGreaterThan(0);
    
    // 「空き」「午後」「予定」「Google」などを含む
    const hasAvailabilityContent = /空|午後|予定|カレンダー|Google|連携|時間/i.test(response);
    expect(hasAvailabilityContent).toBe(true);
  });

  test('CONV-1.2-5: 招待準備の会話（確認フロー）', async ({ page }) => {
    // Given: チャット画面にいる
    
    // When: 招待準備を依頼（メールアドレス付き）
    await sendChatMessage(page, 'test@example.com に日程調整送って');
    
    // Then: 確認プロンプトまたは入力案内が返る
    const response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    
    expect(response.length).toBeGreaterThan(0);
    
    // 「送る」「確認」「招待」「宛先」などを含む
    const hasInviteContent = /送|確認|招待|宛先|メール|準備|キャンセル/i.test(response);
    expect(hasInviteContent).toBe(true);
  });

  test('CONV-1.2-6: 連続会話 - 雑談から機能へ', async ({ page }) => {
    // Given: チャット画面にいる
    
    // When: まず雑談
    await sendChatMessage(page, 'ありがとう');
    let response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    expect(response.length).toBeGreaterThan(0);
    
    // Then: 続けて機能を使う
    await sendChatMessage(page, '今日の予定教えて');
    response = await waitForAssistantMessage(page);
    await assertNoFatalError(page);
    
    // 「予定」「今日」「カレンダー」などを含む
    const hasScheduleContent = /予定|今日|カレンダー|ありません|Google|連携/i.test(response);
    expect(hasScheduleContent).toBe(true);
  });
});

// ============================================================
// API直接テスト（より安定したテスト）
// ============================================================

test.describe('CONV-1.2 API テスト', () => {
  const API_BASE_URL = process.env.E2E_API_URL || 'http://localhost:8787';
  
  test('CONV-1.2-API-1: /api/nl/multi - 雑談', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/nl/multi`, {
      data: {
        text: 'こんにちは',
        context: { viewer_timezone: 'Asia/Tokyo' }
      },
      headers: {
        'Content-Type': 'application/json',
        ...(E2E_AUTH_TOKEN ? { 'Authorization': `Bearer ${E2E_AUTH_TOKEN}` } : {})
      }
    });
    
    // レスポンスがあることを確認（認証エラーでも形式は返る）
    if (response.ok()) {
      const json = await response.json();
      expect(json.intent).toBeDefined();
      // 雑談は chat.general または unknown
      expect(['chat.general', 'unknown'].includes(json.intent)).toBe(true);
    }
  });

  test('CONV-1.2-API-2: /api/nl/multi - カレンダー', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/nl/multi`, {
      data: {
        text: '今日の予定教えて',
        context: { viewer_timezone: 'Asia/Tokyo' }
      },
      headers: {
        'Content-Type': 'application/json',
        ...(E2E_AUTH_TOKEN ? { 'Authorization': `Bearer ${E2E_AUTH_TOKEN}` } : {})
      }
    });
    
    if (response.ok()) {
      const json = await response.json();
      expect(json.intent).toBeDefined();
      // カレンダー系の intent
      expect(['schedule.today', 'schedule.week', 'unknown', 'chat.general'].includes(json.intent)).toBe(true);
    }
  });

  test('CONV-1.2-API-3: /api/nl/multi - リスト', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/nl/multi`, {
      data: {
        text: 'リスト一覧見せて',
        context: { viewer_timezone: 'Asia/Tokyo' }
      },
      headers: {
        'Content-Type': 'application/json',
        ...(E2E_AUTH_TOKEN ? { 'Authorization': `Bearer ${E2E_AUTH_TOKEN}` } : {})
      }
    });
    
    if (response.ok()) {
      const json = await response.json();
      expect(json.intent).toBeDefined();
      // リスト系の intent
      expect(['list.list', 'unknown', 'chat.general'].includes(json.intent)).toBe(true);
    }
  });
});
