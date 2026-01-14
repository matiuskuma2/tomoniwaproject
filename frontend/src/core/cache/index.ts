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
