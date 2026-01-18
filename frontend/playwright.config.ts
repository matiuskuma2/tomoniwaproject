/**
 * playwright.config.ts
 * E2E テスト設定
 * 
 * 目的:
 * - 重要導線の統合テスト
 * - CI での回帰検知
 * 
 * 注意:
 * - ユニットテスト（vitest）とは分離
 * - 実際のブラウザで動作確認
 */

import { defineConfig, devices } from '@playwright/test';

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
    // ベースURL（開発サーバー）
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    
    // スクリーンショット（失敗時のみ）
    screenshot: 'only-on-failure',
    
    // トレース（失敗時のみ）
    trace: 'on-first-retry',
    
    // ヘッドレスモード
    headless: true,
  },

  // プロジェクト設定（Chromium のみで十分）
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 開発サーバー起動（オプション）
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:5173',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120000,
  // },
});
