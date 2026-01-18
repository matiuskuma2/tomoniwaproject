/**
 * playwright.config.ts
 * E2E テスト設定
 * 
 * プロジェクト構成:
 * - smoke: 認証なし、基本動作確認（CI で常時実行）
 * - authenticated: 認証必須、重要導線テスト（CI で [e2e] タグ時のみ）
 * 
 * 環境変数:
 * - E2E_BASE_URL: テスト対象のURL（default: http://localhost:5173）
 * - E2E_AUTH_TOKEN: E2E用認証トークン
 * - E2E_AUTH_COOKIE: 認証Cookie（開発用）
 */

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

// 認証状態の保存先
const AUTH_STATE_PATH = path.join(__dirname, '.auth/user.json');

export default defineConfig({
  // テストディレクトリ
  testDir: './e2e',
  
  // テストファイルパターン
  testMatch: '**/*.spec.ts',
  
  // 並列実行（CIでは1、ローカルでは複数可）
  fullyParallel: false,
  workers: 1,
  
  // リトライ（CI では1回、ローカルでは0）
  retries: process.env.CI ? 1 : 0,
  
  // タイムアウト
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  
  // レポーター
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e-report' }],
  ],
  
  // グローバル設定
  use: {
    // ベースURL（環境変数で上書き可能）
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    
    // スクリーンショット（失敗時のみ - CIで容量節約）
    screenshot: 'only-on-failure',
    
    // トレース（失敗時のみ - ファイルサイズ節約）
    trace: 'on-first-retry',
    
    // 動画（失敗時のみ）
    video: 'on-first-retry',
    
    // ヘッドレスモード
    headless: true,
    
    // ビューポート
    viewport: { width: 1280, height: 720 },
  },

  // プロジェクト設定
  projects: [
    // ============================================================
    // Smoke Test: 認証なし、基本動作確認
    // ============================================================
    {
      name: 'smoke',
      testMatch: '**/*.smoke.spec.ts',
      use: { 
        ...devices['Desktop Chrome'],
        storageState: undefined, // 認証状態を使わない
      },
    },

    // ============================================================
    // Authenticated Test: 認証必須、重要導線テスト
    // ============================================================
    // セットアップ（認証状態を生成）
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    // 認証済みテスト
    {
      name: 'authenticated',
      testMatch: '**/*.spec.ts',
      testIgnore: ['**/*.smoke.spec.ts', '**/auth.setup.ts'],
      dependencies: ['setup'], // setup が完了してから実行
      use: { 
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE_PATH,
      },
    },
  ],

  // 出力ディレクトリ
  outputDir: 'test-results',

  // CI では webServer を起動
  webServer: process.env.CI ? {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  } : undefined,
});
