/**
 * meCache.ts
 * P1-3: /api/users/me のキャッシュ層
 * 
 * 設計方針:
 * - TTL (60秒): ユーザー情報は頻繁に変わらないため長めに設定
 * - inflight共有: 同時リクエストを1つにまとめる
 * - 強制refresh: タイムゾーン変更後など明示的な更新
 * - シングルトン: ユーザー情報は1つだけなのでMapではなく単一変数
 * 
 * 使い方:
 * - getMe(): キャッシュがあればそれを返す、なければfetch
 * - refreshMe(): キャッシュを無視して強制fetch
 * - invalidateMe(): キャッシュを削除
 * - getCachedMe(): 同期的にキャッシュを取得（fetchしない）
 */

import { usersMeApi, type UserProfile } from '../api';
import { log } from '../platform';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 60_000; // 60秒（ユーザー情報は頻繁に変わらない）

// ============================================================
// Types
// ============================================================

interface CacheEntry {
  data: UserProfile;
  timestamp: number;
  ttl: number;
}

interface InflightRequest {
  promise: Promise<UserProfile>;
  timestamp: number;
}

type MeListener = (user: UserProfile | null) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

let cachedMe: CacheEntry | null = null;
let inflightMe: InflightRequest | null = null;
const listeners: Set<MeListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function notifyListeners(user: UserProfile | null): void {
  listeners.forEach(listener => {
    try {
      listener(user);
    } catch (error) {
      console.error('[MeCache] Listener error:', error);
    }
  });
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get user with cache (TTL: 60秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getMe(
  options?: { ttl?: number }
): Promise<UserProfile> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  if (cachedMe && !isExpired(cachedMe)) {
    log.cacheDebug('MeCache HIT', { module: 'MeCache', age: Date.now() - cachedMe.timestamp });
    return cachedMe.data;
  }
  
  // 2. Check inflight (return same promise)
  if (inflightMe) {
    log.cacheDebug('MeCache INFLIGHT', { module: 'MeCache' });
    return inflightMe.promise;
  }
  
  // 3. Fetch and cache
  log.cacheDebug('MeCache MISS', { module: 'MeCache' });
  
  const promise = usersMeApi.getMe()
    .then(response => {
      // Store in cache
      cachedMe = {
        data: response.user,
        timestamp: Date.now(),
        ttl,
      };
      
      // Clean up inflight
      inflightMe = null;
      
      // Notify listeners
      notifyListeners(response.user);
      
      return response.user;
    })
    .catch(error => {
      // Clean up inflight on error
      inflightMe = null;
      throw error;
    });
  
  // Store inflight
  inflightMe = { promise, timestamp: Date.now() };
  
  return promise;
}

/**
 * Force refresh (ignore cache, bypass TTL)
 * タイムゾーン変更後など、確実に最新を取得したい場合に使用
 */
export async function refreshMe(): Promise<UserProfile> {
  log.cacheDebug('MeCache REFRESH', { module: 'MeCache' });
  
  // Clear existing cache
  cachedMe = null;
  
  // Wait for inflight if exists (don't create duplicate)
  if (inflightMe) {
    await inflightMe.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const response = await usersMeApi.getMe();
  
  // Store in cache
  cachedMe = {
    data: response.user,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  
  // Notify listeners
  notifyListeners(response.user);
  
  return response.user;
}

/**
 * Invalidate cache (remove entry without fetching)
 * キャッシュを削除するだけで、新規fetchはしない
 */
export function invalidateMe(): void {
  log.cacheDebug('MeCache INVALIDATE', { module: 'MeCache' });
  cachedMe = null;
}

/**
 * Get cached user (sync, no fetch)
 * キャッシュにあればすぐ返す、なければnull
 */
export function getCachedMe(): UserProfile | null {
  if (cachedMe && !isExpired(cachedMe)) {
    return cachedMe.data;
  }
  return null;
}

/**
 * Set user directly (for external updates)
 * APIレスポンスから直接キャッシュを更新する場合に使用
 * タイムゾーン更新後などに使用
 */
export function setMe(user: UserProfile): void {
  cachedMe = {
    data: user,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  notifyListeners(user);
  log.cacheDebug('MeCache SET', { module: 'MeCache' });
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to user updates
 * @returns unsubscribe function
 */
export function subscribeMe(listener: MeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ============================================================
// Debug / Stats
// ============================================================

export function getMeCacheStats(): {
  hasCached: boolean;
  inflight: boolean;
  age: number | null;
  expired: boolean;
  listenerCount: number;
} {
  const now = Date.now();
  return {
    hasCached: cachedMe !== null,
    inflight: inflightMe !== null,
    age: cachedMe ? now - cachedMe.timestamp : null,
    expired: cachedMe ? isExpired(cachedMe) : false,
    listenerCount: listeners.size,
  };
}
