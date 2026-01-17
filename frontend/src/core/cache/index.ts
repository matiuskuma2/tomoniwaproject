/**
 * Cache module exports
 * 
 * Performance optimization for 1万人同時接続
 */

// Thread status cache (individual functions)
export {
  getStatus,
  refreshStatus,
  invalidate,
  invalidateAll,
  getCached,
  setStatus,
  updateOptimistic,
  subscribe,
  getCacheStats,
} from './threadStatusCache';

// Thread status cache (namespace for executor usage)
export * as threadStatusCache from './threadStatusCache';

// React hook
export { useThreadStatus, prefetchThreadStatus } from './useThreadStatus';

// Threads list cache (P1-1)
export {
  getThreadsList,
  refreshThreadsList,
  invalidateThreadsList,
  getCachedThreadsList,
  subscribeThreadsList,
  getThreadsListCacheStats,
} from './threadsListCache';

export * as threadsListCache from './threadsListCache';

// Inbox cache (P1-1)
export {
  getInbox,
  refreshInbox,
  invalidateInbox,
  getCachedInbox,
  subscribeInbox,
  getInboxCacheStats,
} from './inboxCache';

export * as inboxCache from './inboxCache';

// Me cache (P1-3)
export {
  getMe,
  refreshMe,
  invalidateMe,
  getCachedMe,
  setMe,
  subscribeMe,
  getMeCacheStats,
} from './meCache';

export * as meCache from './meCache';

// Lists cache (P1-3C)
export {
  getLists,
  refreshLists,
  invalidateLists,
  getCachedLists,
  setLists,
  subscribeLists,
  getListsCacheStats,
} from './listsCache';

export * as listsCache from './listsCache';
