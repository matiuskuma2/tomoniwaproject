/**
 * threadStatusCache.ts
 * 
 * Status取得のキャッシュ層（1万人同時接続対策）
 * 
 * 設計方針:
 * - TTL (10秒): 同一threadIdへの連続リクエストを防ぐ
 * - inflight共有: 同時リクエストを1つにまとめる
 * - 強制refresh: 送信後・確定後など明示的な更新
 * - optimistic update: UI即時反映 + 後でサーバー確認
 * 
 * 使い方:
 * - getStatus(threadId): キャッシュがあればそれを返す、なければfetch
 * - refreshStatus(threadId): キャッシュを無視して強制fetch
 * - invalidate(threadId): キャッシュを削除
 * - getStatusOptimistic(threadId, updater): 楽観的更新
 */

import { threadsApi } from '../api/threads';
import type { ThreadStatus_API } from '../models';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 10_000; // 10秒
const MAX_CACHE_SIZE = 50; // メモリ制限: 最大50スレッド

// ============================================================
// Types
// ============================================================

interface CacheEntry {
  data: ThreadStatus_API;
  timestamp: number;
  ttl: number;
}

interface InflightRequest {
  promise: Promise<ThreadStatus_API>;
  timestamp: number;
}

type StatusListener = (threadId: string, status: ThreadStatus_API | null) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightRequest>();
const listeners: Set<StatusListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function evictOldest(): void {
  if (cache.size <= MAX_CACHE_SIZE) return;
  
  // Find oldest entry
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  
  for (const [key, entry] of cache.entries()) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }
  
  if (oldestKey) {
    cache.delete(oldestKey);
    console.log(`[StatusCache] Evicted oldest entry: ${oldestKey}`);
  }
}

function notifyListeners(threadId: string, status: ThreadStatus_API | null): void {
  listeners.forEach(listener => {
    try {
      listener(threadId, status);
    } catch (error) {
      console.error('[StatusCache] Listener error:', error);
    }
  });
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get status with cache (TTL: 10秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getStatus(
  threadId: string,
  options?: { ttl?: number }
): Promise<ThreadStatus_API> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  const cached = cache.get(threadId);
  if (cached && !isExpired(cached)) {
    console.log(`[StatusCache] HIT: ${threadId} (age: ${Date.now() - cached.timestamp}ms)`);
    return cached.data;
  }
  
  // 2. Check inflight (return same promise)
  const existing = inflight.get(threadId);
  if (existing) {
    console.log(`[StatusCache] INFLIGHT: ${threadId} (waiting for existing request)`);
    return existing.promise;
  }
  
  // 3. Fetch and cache
  console.log(`[StatusCache] MISS: ${threadId} (fetching from server)`);
  
  const promise = threadsApi.getStatus(threadId)
    .then(data => {
      // Store in cache
      evictOldest();
      cache.set(threadId, {
        data,
        timestamp: Date.now(),
        ttl,
      });
      
      // Clean up inflight
      inflight.delete(threadId);
      
      // Notify listeners
      notifyListeners(threadId, data);
      
      return data;
    })
    .catch(error => {
      // Clean up inflight on error
      inflight.delete(threadId);
      throw error;
    });
  
  // Store inflight
  inflight.set(threadId, { promise, timestamp: Date.now() });
  
  return promise;
}

/**
 * Force refresh (ignore cache, bypass TTL)
 * 送信後・確定後など、確実に最新を取得したい場合に使用
 */
export async function refreshStatus(threadId: string): Promise<ThreadStatus_API> {
  console.log(`[StatusCache] REFRESH: ${threadId} (forced)`);
  
  // Clear existing cache
  cache.delete(threadId);
  
  // Wait for inflight if exists (don't create duplicate)
  const existing = inflight.get(threadId);
  if (existing) {
    // Wait for existing, then re-fetch
    await existing.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const data = await threadsApi.getStatus(threadId);
  
  // Store in cache
  evictOldest();
  cache.set(threadId, {
    data,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  });
  
  // Notify listeners
  notifyListeners(threadId, data);
  
  return data;
}

/**
 * Invalidate cache (remove entry without fetching)
 * キャッシュを削除するだけで、新規fetchはしない
 */
export function invalidate(threadId: string): void {
  console.log(`[StatusCache] INVALIDATE: ${threadId}`);
  cache.delete(threadId);
}

/**
 * Invalidate all cache
 */
export function invalidateAll(): void {
  console.log('[StatusCache] INVALIDATE ALL');
  cache.clear();
}

/**
 * Get cached status (sync, no fetch)
 * キャッシュにあればすぐ返す、なければnull
 */
export function getCached(threadId: string): ThreadStatus_API | null {
  const cached = cache.get(threadId);
  if (cached && !isExpired(cached)) {
    return cached.data;
  }
  return null;
}

/**
 * Optimistic update
 * UIを即時更新し、後でサーバー確認
 * 
 * @param threadId - スレッドID
 * @param updater - 現在のstatusを受け取り、新しいstatusを返す関数
 * @returns 更新後のstatus
 */
export function updateOptimistic(
  threadId: string,
  updater: (current: ThreadStatus_API) => ThreadStatus_API
): ThreadStatus_API | null {
  const cached = cache.get(threadId);
  if (!cached) {
    console.warn(`[StatusCache] OPTIMISTIC: ${threadId} not in cache, skipping`);
    return null;
  }
  
  const updated = updater(cached.data);
  
  // Update cache (preserve TTL)
  cache.set(threadId, {
    data: updated,
    timestamp: cached.timestamp, // Keep original timestamp
    ttl: cached.ttl,
  });
  
  // Notify listeners
  notifyListeners(threadId, updated);
  
  console.log(`[StatusCache] OPTIMISTIC: ${threadId} updated`);
  return updated;
}

/**
 * Set status directly (for external updates)
 * APIレスポンスから直接キャッシュを更新する場合に使用
 */
export function setStatus(threadId: string, data: ThreadStatus_API): void {
  evictOldest();
  cache.set(threadId, {
    data,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  });
  notifyListeners(threadId, data);
  console.log(`[StatusCache] SET: ${threadId}`);
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to status updates
 * @returns unsubscribe function
 */
export function subscribe(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================
// Debug / Stats
// ============================================================

export function getCacheStats(): {
  size: number;
  maxSize: number;
  inflight: number;
  entries: Array<{ threadId: string; age: number; expired: boolean }>;
} {
  const now = Date.now();
  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
    inflight: inflight.size,
    entries: Array.from(cache.entries()).map(([threadId, entry]) => ({
      threadId,
      age: now - entry.timestamp,
      expired: isExpired(entry),
    })),
  };
}
