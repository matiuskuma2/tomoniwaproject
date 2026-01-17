/**
 * runRefresh.ts
 * P0-2: Refresh アクションの実行器
 * 
 * 目的:
 * - RefreshAction を実際に実行
 * - キャッシュの更新を一元管理
 */

import { refreshStatus } from '../cache/threadStatusCache';
import { refreshThreadsList as refreshThreadsListCache } from '../cache/threadsListCache';
import { refreshInbox as refreshInboxCache } from '../cache/inboxCache';
import { refreshMe as refreshMeCache } from '../cache/meCache';
import { refreshLists as refreshListsCache } from '../cache/listsCache';
import type { RefreshAction } from './refreshMap';
import { describeRefreshAction } from './refreshMap';

// ============================================================
// Main Executor
// ============================================================

/**
 * RefreshAction 配列を順番に実行
 * 
 * @param actions - 実行する RefreshAction の配列
 * @param options - オプション
 */
export async function runRefresh(
  actions: RefreshAction[],
  options: {
    /** エラー時も続行するか（デフォルト: true） */
    continueOnError?: boolean;
    /** デバッグログを出力するか（デフォルト: false） */
    debug?: boolean;
  } = {}
): Promise<void> {
  const { continueOnError = true, debug = false } = options;
  
  if (debug) {
    console.log('[runRefresh] Starting:', actions.map(describeRefreshAction).join(', '));
  }
  
  for (const action of actions) {
    try {
      await executeRefreshAction(action, debug);
    } catch (error) {
      console.error(`[runRefresh] Error executing ${describeRefreshAction(action)}:`, error);
      if (!continueOnError) {
        throw error;
      }
    }
  }
  
  if (debug) {
    console.log('[runRefresh] Completed');
  }
}

/**
 * 単一の RefreshAction を実行
 */
async function executeRefreshAction(action: RefreshAction, debug: boolean): Promise<void> {
  switch (action.type) {
    case 'STATUS':
      if (debug) {
        console.log(`[runRefresh] Refreshing status for thread: ${action.threadId}`);
      }
      await refreshStatus(action.threadId);
      break;
      
    case 'THREADS_LIST':
      if (debug) {
        console.log('[runRefresh] Refreshing threads list');
      }
      await refreshThreadsListCache();
      break;
      
    case 'INBOX':
      if (debug) {
        console.log('[runRefresh] Refreshing inbox');
      }
      await refreshInboxCache();
      break;
      
    case 'ME':
      if (debug) {
        console.log('[runRefresh] Refreshing user info (ME)');
      }
      await refreshMeCache();
      break;
      
    case 'LISTS':
      if (debug) {
        console.log('[runRefresh] Refreshing lists');
      }
      await refreshListsCache();
      break;
      
    default:
      console.warn('[runRefresh] Unknown action type:', action);
  }
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * スレッドステータスのみを refresh
 */
export async function refreshThreadStatus(threadId: string): Promise<void> {
  await runRefresh([{ type: 'STATUS', threadId }]);
}

/**
 * スレッド一覧を refresh
 */
export async function refreshThreadsList(): Promise<void> {
  await runRefresh([{ type: 'THREADS_LIST' }]);
}

/**
 * 受信箱を refresh
 */
export async function refreshInbox(): Promise<void> {
  await runRefresh([{ type: 'INBOX' }]);
}
