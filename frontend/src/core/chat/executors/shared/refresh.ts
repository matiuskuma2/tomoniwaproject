/**
 * Shared Refresh Helper - Phase 1-2
 * 
 * apiExecutor.ts と executors/* で共通利用する refresh ヘルパー
 * 二重管理を避けるため、ここに一元化
 */

import { getRefreshActions, type WriteOp } from '../../../refresh/refreshMap';
import { runRefresh } from '../../../refresh/runRefresh';
import { log } from '../../../platform';

/**
 * P0-2: Write 操作後に必須の refresh を実行
 * refresh 失敗で Write を失敗扱いにしない（運用インシデント回避）
 */
export async function refreshAfterWrite(op: WriteOp, threadId?: string): Promise<void> {
  try {
    const actions = getRefreshActions(op, threadId ? { threadId } : undefined);
    await runRefresh(actions);
  } catch (e) {
    log.warn('refreshAfterWrite failed', { module: 'shared', writeOp: op, threadId, err: e });
  }
}

// Re-export WriteOp for convenience
export type { WriteOp } from '../../../refresh/refreshMap';
