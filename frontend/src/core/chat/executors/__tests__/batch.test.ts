/**
 * batch.test.ts
 * P2-B1: 一括招待バッチ処理最適化テスト
 * 
 * テスト内容:
 * - chunkArray: 配列分割
 * - formatBatchProgress: 進捗表示
 * - formatBatchResult: 結果表示
 * - BATCH_CHUNK_SIZE: 設定値確認
 */

import { describe, it, expect } from 'vitest';
import {
  chunkArray,
  formatBatchProgress,
  formatBatchResult,
  BATCH_CHUNK_SIZE,
  type BatchProgress,
  type BatchResult,
} from '../batch';

// ============================================================
// Tests: chunkArray
// ============================================================

describe('chunkArray', () => {
  it('空配列を渡すと空配列を返す', () => {
    expect(chunkArray([], 50)).toEqual([]);
  });

  it('配列をチャンクサイズで分割する', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const chunks = chunkArray(arr, 3);
    
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toEqual([1, 2, 3]);
    expect(chunks[1]).toEqual([4, 5, 6]);
    expect(chunks[2]).toEqual([7, 8, 9]);
    expect(chunks[3]).toEqual([10]);
  });

  it('配列がチャンクサイズより小さい場合は1チャンク', () => {
    const arr = [1, 2, 3];
    const chunks = chunkArray(arr, 50);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([1, 2, 3]);
  });

  it('配列がチャンクサイズと同じ場合は1チャンク', () => {
    const arr = [1, 2, 3, 4, 5];
    const chunks = chunkArray(arr, 5);
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([1, 2, 3, 4, 5]);
  });

  it('50件ずつ分割（デフォルトサイズ）', () => {
    const arr = Array.from({ length: 120 }, (_, i) => i);
    const chunks = chunkArray(arr, BATCH_CHUNK_SIZE);
    
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[1]).toHaveLength(50);
    expect(chunks[2]).toHaveLength(20);
  });
});

// ============================================================
// Tests: formatBatchProgress
// ============================================================

describe('formatBatchProgress', () => {
  it('処理中の進捗を表示', () => {
    const progress: BatchProgress = {
      total: 100,
      processed: 50,
      succeeded: 45,
      failed: 3,
      skipped: 2,
      currentChunk: 1,
      totalChunks: 2,
      isComplete: false,
    };

    const message = formatBatchProgress(progress);

    expect(message).toContain('処理中');
    expect(message).toContain('50/100件');
    expect(message).toContain('チャンク: 1/2');
    expect(message).toContain('成功: 45件');
    expect(message).toContain('失敗: 3件');
    expect(message).toContain('スキップ: 2件');
  });

  it('完了時の進捗を表示', () => {
    const progress: BatchProgress = {
      total: 100,
      processed: 100,
      succeeded: 95,
      failed: 3,
      skipped: 2,
      currentChunk: 2,
      totalChunks: 2,
      isComplete: true,
    };

    const message = formatBatchProgress(progress);

    expect(message).toContain('処理完了');
    expect(message).toContain('95件 成功');
    expect(message).toContain('3件 失敗');
    expect(message).toContain('2件 スキップ');
    expect(message).toContain('全100件');
  });

  it('エラーなしの場合は失敗を表示しない', () => {
    const progress: BatchProgress = {
      total: 50,
      processed: 50,
      succeeded: 50,
      failed: 0,
      skipped: 0,
      currentChunk: 1,
      totalChunks: 1,
      isComplete: true,
    };

    const message = formatBatchProgress(progress);

    expect(message).toContain('50件 成功');
    expect(message).not.toContain('失敗');
    expect(message).not.toContain('スキップ');
  });
});

// ============================================================
// Tests: formatBatchResult
// ============================================================

describe('formatBatchResult', () => {
  it('基本的な結果を表示', () => {
    const result: BatchResult = {
      success: true,
      total: 100,
      succeeded: 95,
      failed: 3,
      skipped: 2,
      errors: [
        { email: 'a@example.com', error: 'invalid email' },
        { email: 'b@example.com', error: 'duplicate' },
      ],
      duration: 5000,
    };

    const message = formatBatchResult(result);

    expect(message).toContain('バッチ処理完了');
    expect(message).toContain('成功: 95件');
    expect(message).toContain('失敗: 3件');
    expect(message).toContain('スキップ: 2件');
    expect(message).toContain('合計: 100件');
    expect(message).toContain('5.0秒');
    expect(message).toContain('エラー詳細');
    expect(message).toContain('a@example.com');
    expect(message).toContain('invalid email');
  });

  it('リスト名を表示', () => {
    const result: BatchResult = {
      success: true,
      total: 10,
      succeeded: 10,
      failed: 0,
      skipped: 0,
      errors: [],
      duration: 1000,
    };

    const message = formatBatchResult(result, { listName: '営業部' });

    expect(message).toContain('リスト: 営業部');
  });

  it('エラーが5件を超える場合は省略', () => {
    const errors = Array.from({ length: 10 }, (_, i) => ({
      email: `error${i}@example.com`,
      error: 'failed',
    }));

    const result: BatchResult = {
      success: false,
      total: 20,
      succeeded: 10,
      failed: 10,
      skipped: 0,
      errors,
      duration: 2000,
    };

    const message = formatBatchResult(result);

    expect(message).toContain('error0@example.com');
    expect(message).toContain('error4@example.com');
    expect(message).not.toContain('error5@example.com');
    expect(message).toContain('他5件のエラー');
  });
});

// ============================================================
// Tests: Configuration
// ============================================================

describe('BATCH_CHUNK_SIZE', () => {
  it('デフォルト値は50', () => {
    expect(BATCH_CHUNK_SIZE).toBe(50);
  });
});
