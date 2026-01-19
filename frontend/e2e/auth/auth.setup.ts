/**
 * e2e/auth/auth.setup.ts
 * E2E 認証セットアップ - storageState を生成
 * 
 * Playwright の setup project として実行され、
 * 認証済みの状態を .auth/user.json に保存する
 * 
 * 必要な環境変数:
 * - E2E_AUTH_TOKEN: E2E用認証トークン
 * または
 * - E2E_AUTH_COOKIE: 認証Cookie（name=value形式）
 */

import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Module で __dirname を再現
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 認証状態の保存先（playwright.config.ts と同じパス）
const AUTH_STATE_PATH = path.join(__dirname, '../../.auth/user.json');

setup('authenticate', async ({ page, context }) => {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
  const authToken = process.env.E2E_AUTH_TOKEN;
  const authCookie = process.env.E2E_AUTH_COOKIE;

  // 認証ディレクトリを作成
  const authDir = path.dirname(AUTH_STATE_PATH);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // 認証情報がない場合は空の状態を作成（Smoke Test のみ実行可能）
  if (!authToken && !authCookie) {
    console.log('[Auth Setup] No credentials provided. Creating empty auth state.');
    console.log('[Auth Setup] Set E2E_AUTH_TOKEN or E2E_AUTH_COOKIE for authenticated tests.');
    
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({
      cookies: [],
      origins: [],
    }));
    return;
  }

  console.log(`[Auth Setup] Setting up authentication for ${baseURL}`);

  // まずページにアクセス（sessionStorage を設定するため）
  await page.goto(baseURL);
  await page.waitForTimeout(500);

  // 方式1: 認証トークンを使用（sessionStorage に保存）
  if (authToken) {
    console.log('[Auth Setup] Using E2E_AUTH_TOKEN (setting in sessionStorage)');
    
    // フロントエンドと同じキーで sessionStorage に保存
    await page.evaluate((token) => {
      sessionStorage.setItem('tomoniwao_token', token);
      // ダミーユーザー情報も設定
      sessionStorage.setItem('tomoniwao_user', JSON.stringify({
        id: 'e2e-test-user',
        email: 'e2e@example.com',
        name: 'E2E Test User',
      }));
    }, authToken);
  }

  // 方式2: Cookie を直接設定（バックエンド認証用）
  if (authCookie) {
    console.log('[Auth Setup] Using E2E_AUTH_COOKIE');
    
    // Cookie文字列をパース（name=value形式）
    const [name, value] = authCookie.split('=');
    await context.addCookies([{
      name: name || 'session',
      value: value || authCookie,
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: true,
      secure: baseURL.startsWith('https'),
      sameSite: 'Lax',
    }]);
  }

  // /chat にアクセスして認証を確認
  await page.goto(`${baseURL}/chat`);
  await page.waitForTimeout(1000);

  // 認証が成功したか確認（/chat に留まっていること）
  const url = page.url();
  console.log(`[Auth Setup] Current URL: ${url}`);
  expect(url).toContain('/chat');
  expect(url).not.toContain('/login');
  expect(url).not.toContain('/auth');

  // 認証状態を保存
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`[Auth Setup] Authentication state saved to ${AUTH_STATE_PATH}`);
});
