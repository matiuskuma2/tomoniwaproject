/**
 * playwright.config.ts
 * E2E テスト設定
 * 
 * プロジェクト構成:
 * - smoke: 認証なし、ローカルビルドの基本動作確認（CI で常時実行）
 * - authenticated: 認証必須、本番サーバーの重要導線テスト（CI で [e2e] タグ時のみ）
 * 
 * 環境変数:
 * - E2E_BASE_URL: テスト対象のURL（default: http://localhost:4173）
 * - E2E_AUTH_TOKEN: E2E用認証トークン
 */

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ES Module で __dirname を再現
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 認証状態の保存先
const AUTH_STATE_PATH = join(__dirname, '.auth/user.json');

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
    // ベースURL（環境変数で上書き可能、Smoke は 127.0.0.1 固定）
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    
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
    // Smoke Test: 認証なし、ローカルビルドの基本動作確認
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
    // Authenticated Test: 認証必須、本番サーバーの重要導線テスト
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

  // Smoke Test 用: ローカルサーバーを起動
  // NOTE: E2E_BASE_URL が設定されている場合は外部サーバーを使うため webServer を無効化
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false, // CI では常に新規起動
    timeout: 180000, // 初回は長めに待つ
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
