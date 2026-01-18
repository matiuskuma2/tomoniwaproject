/**
 * e2e/fixtures/test-data.ts
 * E2E テスト用のテストデータ
 */

/**
 * テスト用メールアドレス生成（10件以上でバッチ処理を通す）
 */
export function generateTestEmails(count: number, prefix = 'test'): string[] {
  return Array.from({ length: count }, (_, i) => 
    `${prefix}${i + 1}@example.com`
  );
}

/**
 * 少量テスト用（9件 = 逐次処理）
 */
export const SMALL_EMAIL_LIST = generateTestEmails(9, 'small');

/**
 * バッチテスト用（10件 = バッチ処理）
 */
export const BATCH_EMAIL_LIST = generateTestEmails(10, 'batch');

/**
 * 大量テスト用（50件 = 複数チャンク）
 */
export const LARGE_EMAIL_LIST = generateTestEmails(50, 'large');

/**
 * テスト用リスト名
 */
export const TEST_LIST_NAME = 'E2Eテストリスト';

/**
 * テスト用スレッドタイトル
 */
export const TEST_THREAD_TITLE = 'E2Eテスト調整';
