/**
 * threadsListCache.ts
 * 
 * ThreadsList取得のキャッシュ層（P1-1: 1万人同時接続対策）
 * 
 * 設計方針:
 * - TTL (30秒): スレッド一覧は頻繁に変わらないので長め
 * - inflight共有: 同時リクエストを1つにまとめる
 * - 強制refresh: Write後など明示的な更新
 * 
 * 使い方:
 * - getThreadsList(): キャッシュがあればそれを返す、なければfetch
 * - refreshThreadsList(): キャッシュを無視して強制fetch
 * - invalidateThreadsList(): キャッシュを削除
 */

import { threadsApi } from '../api/threads';
import type { Thread } from '../models';
// P1-2: Structured logger
import { log } from '../platform';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 30_000; // 30秒（スレッド一覧は頻繁に変わらない）

// ============================================================
// Types
// ============================================================

interface CacheEntry {
  data: Thread[];
  timestamp: number;
  ttl: number;
}

interface InflightRequest {
  promise: Promise<Thread[]>;
  timestamp: number;
}

type ThreadsListListener = (threads: Thread[]) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

let cache: CacheEntry | null = null;
let inflight: InflightRequest | null = null;
const listeners: Set<ThreadsListListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function notifyListeners(threads: Thread[]): void {
  listeners.forEach(listener => {
    try {
      listener(threads);
    } catch (error) {
      console.error('[ThreadsListCache] Listener error:', error);
    }
  });
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get threads list with cache (TTL: 30秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getThreadsList(
  options?: { ttl?: number }
): Promise<Thread[]> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  if (cache && !isExpired(cache)) {
    log.cacheDebug('ThreadsListCache HIT', { module: 'ThreadsListCache', age: Date.now() - cache.timestamp });
    return cache.data;
  }
  
  // 2. Check inflight (return same promise)
  if (inflight) {
    log.cacheDebug('ThreadsListCache INFLIGHT', { module: 'ThreadsListCache' });
    return inflight.promise;
  }
  
  // 3. Fetch and cache
  log.cacheDebug('ThreadsListCache MISS', { module: 'ThreadsListCache' });
  
  const promise = threadsApi.list()
    .then(response => {
      const threads = response.threads;
      
      // Store in cache
      cache = {
        data: threads,
        timestamp: Date.now(),
        ttl,
      };
      
      // Clean up inflight
      inflight = null;
      
      // Notify listeners
      notifyListeners(threads);
      
      return threads;
    })
    .catch(error => {
      // Clean up inflight on error
      inflight = null;
      throw error;
    });
  
  // Store inflight
  inflight = { promise, timestamp: Date.now() };
  
  return promise;
}

/**
 * Force refresh (ignore cache, bypass TTL)
 * Write後など、確実に最新を取得したい場合に使用
 */
export async function refreshThreadsList(): Promise<Thread[]> {
  log.cacheDebug('ThreadsListCache REFRESH', { module: 'ThreadsListCache' });
  
  // Clear existing cache
  cache = null;
  
  // Wait for inflight if exists (don't create duplicate)
  if (inflight) {
    await inflight.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const response = await threadsApi.list();
  const threads = response.threads;
  
  // Store in cache
  cache = {
    data: threads,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  
  // Notify listeners
  notifyListeners(threads);
  
  return threads;
}

/**
 * Invalidate cache (remove entry without fetching)
 * キャッシュを削除するだけで、新規fetchはしない
 */
export function invalidateThreadsList(): void {
  log.cacheDebug('ThreadsListCache INVALIDATE', { module: 'ThreadsListCache' });
  cache = null;
}

/**
 * Get cached threads list (sync, no fetch)
 * キャッシュにあればすぐ返す、なければnull
 */
export function getCachedThreadsList(): Thread[] | null {
  if (cache && !isExpired(cache)) {
    return cache.data;
  }
  return null;
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to threads list updates
 * @returns unsubscribe function
 */
export function subscribeThreadsList(listener: ThreadsListListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================
// Debug / Stats
// ============================================================

export function getThreadsListCacheStats(): {
  hasCache: boolean;
  age: number | null;
  expired: boolean;
  inflight: boolean;
  count: number | null;
} {
  const now = Date.now();
  return {
    hasCache: cache !== null,
    age: cache ? now - cache.timestamp : null,
    expired: cache ? isExpired(cache) : false,
    inflight: inflight !== null,
    count: cache?.data.length ?? null,
  };
}
