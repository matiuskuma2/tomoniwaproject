/**
 * vitest.config.ts
 * Unit テスト設定（E2E は playwright.config.ts で別管理）
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E ディレクトリを除外
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/*.spec.ts', // Playwright の *.spec.ts を除外
    ],
    // インクルード（明示的に指定）
    include: [
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
  },
});
