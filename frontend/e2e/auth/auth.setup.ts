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

  // 方式1: 認証トークンを使用
  if (authToken) {
    console.log('[Auth Setup] Using E2E_AUTH_TOKEN');
    
    // トークンを Cookie として設定
    await context.addCookies([{
      name: 'auth_token',
      value: authToken,
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: true,
      secure: baseURL.startsWith('https'),
      sameSite: 'Lax',
    }]);
  }

  // 方式2: Cookie を直接設定
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

  // ページにアクセスして認証を確認
  await page.goto(baseURL);
  await page.waitForTimeout(1000);

  // 認証が成功したか確認（ログイン画面にリダイレクトされないこと）
  const url = page.url();
  expect(url).not.toContain('/login');
  expect(url).not.toContain('/auth');

  // 認証状態を保存
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`[Auth Setup] Authentication state saved to ${AUTH_STATE_PATH}`);
});
