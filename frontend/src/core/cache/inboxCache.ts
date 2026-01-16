/**
 * inboxCache.ts
 * 
 * Inbox取得のキャッシュ層（P1-1: 1万人同時接続対策）
 * 
 * 設計方針:
 * - TTL (10秒): 通知は比較的頻繁に更新される可能性があるので短め
 * - inflight共有: 同時リクエストを1つにまとめる
 * - 強制refresh: Write後など明示的な更新
 * 
 * 使い方:
 * - getInbox(): キャッシュがあればそれを返す、なければfetch
 * - refreshInbox(): キャッシュを無視して強制fetch
 * - invalidateInbox(): キャッシュを削除
 */

import { inboxApi } from '../api/inbox';
import type { InboxNotification } from '../models';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 10_000; // 10秒（通知は比較的頻繁に更新される）

// ============================================================
// Types
// ============================================================

interface CacheEntry {
  data: InboxNotification[];
  timestamp: number;
  ttl: number;
}

interface InflightRequest {
  promise: Promise<InboxNotification[]>;
  timestamp: number;
}

type InboxListener = (items: InboxNotification[]) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

let cache: CacheEntry | null = null;
let inflight: InflightRequest | null = null;
const listeners: Set<InboxListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function notifyListeners(items: InboxNotification[]): void {
  listeners.forEach(listener => {
    try {
      listener(items);
    } catch (error) {
      console.error('[InboxCache] Listener error:', error);
    }
  });
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get inbox with cache (TTL: 10秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getInbox(
  options?: { ttl?: number }
): Promise<InboxNotification[]> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  if (cache && !isExpired(cache)) {
    console.log(`[InboxCache] HIT (age: ${Date.now() - cache.timestamp}ms)`);
    return cache.data;
  }
  
  // 2. Check inflight (return same promise)
  if (inflight) {
    console.log('[InboxCache] INFLIGHT (waiting for existing request)');
    return inflight.promise;
  }
  
  // 3. Fetch and cache
  console.log('[InboxCache] MISS (fetching from server)');
  
  const promise = inboxApi.list()
    .then(response => {
      const items = response.items;
      
      // Store in cache
      cache = {
        data: items,
        timestamp: Date.now(),
        ttl,
      };
      
      // Clean up inflight
      inflight = null;
      
      // Notify listeners
      notifyListeners(items);
      
      return items;
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
export async function refreshInbox(): Promise<InboxNotification[]> {
  console.log('[InboxCache] REFRESH (forced)');
  
  // Clear existing cache
  cache = null;
  
  // Wait for inflight if exists (don't create duplicate)
  if (inflight) {
    await inflight.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const response = await inboxApi.list();
  const items = response.items;
  
  // Store in cache
  cache = {
    data: items,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  
  // Notify listeners
  notifyListeners(items);
  
  return items;
}

/**
 * Invalidate cache (remove entry without fetching)
 * キャッシュを削除するだけで、新規fetchはしない
 */
export function invalidateInbox(): void {
  console.log('[InboxCache] INVALIDATE');
  cache = null;
}

/**
 * Get cached inbox (sync, no fetch)
 * キャッシュにあればすぐ返す、なければnull
 */
export function getCachedInbox(): InboxNotification[] | null {
  if (cache && !isExpired(cache)) {
    return cache.data;
  }
  return null;
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to inbox updates
 * @returns unsubscribe function
 */
export function subscribeInbox(listener: InboxListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================
// Debug / Stats
// ============================================================

export function getInboxCacheStats(): {
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
