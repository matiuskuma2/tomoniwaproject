/**
 * listsCache.ts
 * P1-3(C): /api/lists のキャッシュ層
 * 
 * 設計方針:
 * - TTL (60秒): リスト一覧は頻繁に変わらないため長めに設定
 * - inflight共有: 同時リクエストを1つにまとめる
 * - 強制refresh: リスト作成・メンバー追加後など明示的な更新
 * - シングルトン: リスト一覧は1つだけなのでMapではなく単一変数
 * 
 * 使い方:
 * - getLists(): キャッシュがあればそれを返す、なければfetch
 * - refreshLists(): キャッシュを無視して強制fetch
 * - invalidateLists(): キャッシュを削除
 * - getCachedLists(): 同期的にキャッシュを取得（fetchしない）
 */

import { listsApi } from '../api';
import type { List } from '../models';
import { log } from '../platform';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 60_000; // 60秒（リスト一覧は頻繁に変わらない）

// ============================================================
// Types
// ============================================================

interface CacheEntry {
  data: List[];
  timestamp: number;
  ttl: number;
}

interface InflightRequest {
  promise: Promise<List[]>;
  timestamp: number;
}

type ListsListener = (lists: List[] | null) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

let cachedLists: CacheEntry | null = null;
let inflightLists: InflightRequest | null = null;
const listeners: Set<ListsListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function notifyListeners(lists: List[] | null): void {
  listeners.forEach(listener => {
    try {
      listener(lists);
    } catch (error) {
      console.error('[ListsCache] Listener error:', error);
    }
  });
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get lists with cache (TTL: 60秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getLists(
  options?: { ttl?: number }
): Promise<List[]> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  if (cachedLists && !isExpired(cachedLists)) {
    log.cacheDebug('ListsCache HIT', { module: 'ListsCache', age: Date.now() - cachedLists.timestamp });
    return cachedLists.data;
  }
  
  // 2. Check inflight (return same promise)
  if (inflightLists) {
    log.cacheDebug('ListsCache INFLIGHT', { module: 'ListsCache' });
    return inflightLists.promise;
  }
  
  // 3. Fetch and cache
  log.cacheDebug('ListsCache MISS', { module: 'ListsCache' });
  
  const promise = listsApi.list()
    .then(response => {
      const lists = response.items || [];
      
      // Store in cache
      cachedLists = {
        data: lists,
        timestamp: Date.now(),
        ttl,
      };
      
      // Clean up inflight
      inflightLists = null;
      
      // Notify listeners
      notifyListeners(lists);
      
      return lists;
    })
    .catch(error => {
      // Clean up inflight on error
      inflightLists = null;
      throw error;
    });
  
  // Store inflight
  inflightLists = { promise, timestamp: Date.now() };
  
  return promise;
}

/**
 * Force refresh (ignore cache, bypass TTL)
 * リスト作成後・メンバー追加後など、確実に最新を取得したい場合に使用
 */
export async function refreshLists(): Promise<List[]> {
  log.cacheDebug('ListsCache REFRESH', { module: 'ListsCache' });
  
  // Clear existing cache
  cachedLists = null;
  
  // Wait for inflight if exists (don't create duplicate)
  if (inflightLists) {
    await inflightLists.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const response = await listsApi.list();
  const lists = response.items || [];
  
  // Store in cache
  cachedLists = {
    data: lists,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  
  // Notify listeners
  notifyListeners(lists);
  
  return lists;
}

/**
 * Invalidate cache (remove entry without fetching)
 * キャッシュを削除するだけで、新規fetchはしない
 */
export function invalidateLists(): void {
  log.cacheDebug('ListsCache INVALIDATE', { module: 'ListsCache' });
  cachedLists = null;
}

/**
 * Get cached lists (sync, no fetch)
 * キャッシュにあればすぐ返す、なければnull
 */
export function getCachedLists(): List[] | null {
  if (cachedLists && !isExpired(cachedLists)) {
    return cachedLists.data;
  }
  return null;
}

/**
 * Set lists directly (for external updates)
 * APIレスポンスから直接キャッシュを更新する場合に使用
 */
export function setLists(lists: List[]): void {
  cachedLists = {
    data: lists,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  notifyListeners(lists);
  log.cacheDebug('ListsCache SET', { module: 'ListsCache' });
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to lists updates
 * @returns unsubscribe function
 */
export function subscribeLists(listener: ListsListener): () => void {
  listeners.add(listener);
  log.cacheDebug('ListsCache SUBSCRIBE', { module: 'ListsCache', listenerCount: listeners.size });
  return () => {
    listeners.delete(listener);
    log.cacheDebug('ListsCache UNSUBSCRIBE', { module: 'ListsCache', listenerCount: listeners.size });
  };
}

// ============================================================
// Debug / Stats
// ============================================================

export function getListsCacheStats(): {
  hasCached: boolean;
  inflight: boolean;
  age: number | null;
  expired: boolean;
  listenerCount: number;
  listCount: number | null;
} {
  const now = Date.now();
  return {
    hasCached: cachedLists !== null,
    inflight: inflightLists !== null,
    age: cachedLists ? now - cachedLists.timestamp : null,
    expired: cachedLists ? isExpired(cachedLists) : false,
    listenerCount: listeners.size,
    listCount: cachedLists?.data.length ?? null,
  };
}
