/**
 * Shared Cache Helper - Phase 1-3a
 * 
 * apiExecutor.ts と executors/* で共通利用する cache ヘルパー
 * 二重管理を避けるため、ここに一元化
 */

import { threadsApi } from '../../../api/threads';
import { setStatus as setCacheStatus } from '../../../cache';
import type { ThreadStatus_API } from '../../../models';

/**
 * getStatus を呼んでキャッシュも更新する
 * executor 内では常に最新データを使用しつつ、キャッシュも更新
 */
export async function getStatusWithCache(threadId: string): Promise<ThreadStatus_API> {
  const status = await threadsApi.getStatus(threadId);
  // キャッシュを更新（他の画面でも最新に）
  setCacheStatus(threadId, status);
  return status;
}
