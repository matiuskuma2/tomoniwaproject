/**
 * relationshipsCache.ts
 * Phase D-1: Relationships キャッシュ層
 * 
 * 設計方針:
 * - TTL (120秒): 関係性は頻繁に変わらないため長めに設定
 * - inflight共有: 同時リクエストを1つにまとめる
 * - Map形式: user_id -> RelationType のマッピングで高速lookup
 * - 全件取得: 初回で全relationships を取得してMapに保存
 * 
 * 使い方:
 * - getRelationshipMap(): キャッシュがあればそれを返す、なければfetch
 * - getRelationTypeForUser(userId): 特定ユーザーの関係タイプを取得
 * - refreshRelationships(): キャッシュを無視して強制fetch
 * - invalidateRelationships(): キャッシュを削除
 */

import { relationshipsApi, type Relationship, type RelationType } from '../api/relationships';
import { log } from '../platform';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 120_000; // 120秒（関係性は頻繁に変わらない）

// ============================================================
// Types
// ============================================================

interface RelationshipCacheEntry {
  map: Map<string, RelationshipInfo>;
  list: Relationship[];
  timestamp: number;
  ttl: number;
}

interface RelationshipInfo {
  relation_type: RelationType;
  permission_preset: string | null;
  relationship_id: string;
  display_name: string;
  email: string;
}

interface InflightRequest {
  promise: Promise<Map<string, RelationshipInfo>>;
  timestamp: number;
}

type RelationshipsListener = (map: Map<string, RelationshipInfo> | null) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

let cachedRelationships: RelationshipCacheEntry | null = null;
let inflightRelationships: InflightRequest | null = null;
const listeners: Set<RelationshipsListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: RelationshipCacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function notifyListeners(map: Map<string, RelationshipInfo> | null): void {
  listeners.forEach(listener => {
    try {
      listener(map);
    } catch (error) {
      console.error('[RelationshipsCache] Listener error:', error);
    }
  });
}

function buildMap(relationships: Relationship[]): Map<string, RelationshipInfo> {
  const map = new Map<string, RelationshipInfo>();
  
  for (const r of relationships) {
    map.set(r.other_user.id, {
      relation_type: r.relation_type,
      permission_preset: r.permission_preset,
      relationship_id: r.id,
      display_name: r.other_user.display_name,
      email: r.other_user.email,
    });
  }
  
  return map;
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get relationships map with cache (TTL: 120秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getRelationshipMap(
  options?: { ttl?: number }
): Promise<Map<string, RelationshipInfo>> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  if (cachedRelationships && !isExpired(cachedRelationships)) {
    log.cacheDebug('RelationshipsCache HIT', { module: 'RelationshipsCache', age: Date.now() - cachedRelationships.timestamp });
    return cachedRelationships.map;
  }
  
  // 2. Check inflight (return same promise)
  if (inflightRelationships) {
    log.cacheDebug('RelationshipsCache INFLIGHT', { module: 'RelationshipsCache' });
    return inflightRelationships.promise;
  }
  
  // 3. Fetch and cache
  log.cacheDebug('RelationshipsCache MISS', { module: 'RelationshipsCache' });
  
  const promise = relationshipsApi.listAll()
    .then(relationships => {
      const map = buildMap(relationships);
      
      // Store in cache
      cachedRelationships = {
        map,
        list: relationships,
        timestamp: Date.now(),
        ttl,
      };
      
      // Clean up inflight
      inflightRelationships = null;
      
      // Notify listeners
      notifyListeners(map);
      
      return map;
    })
    .catch(error => {
      // Clean up inflight on error
      inflightRelationships = null;
      throw error;
    });
  
  // Store inflight
  inflightRelationships = { promise, timestamp: Date.now() };
  
  return promise;
}

/**
 * Get relation type for a specific user (sync if cached, async if not)
 * Returns 'stranger' if no relationship exists
 */
export function getRelationTypeForUserSync(userId: string): RelationType {
  if (!cachedRelationships || isExpired(cachedRelationships)) {
    return 'stranger';
  }
  
  const info = cachedRelationships.map.get(userId);
  return info?.relation_type || 'stranger';
}

/**
 * Get relation type for a specific user (async)
 * Returns 'stranger' if no relationship exists
 */
export async function getRelationTypeForUser(userId: string): Promise<RelationType> {
  const map = await getRelationshipMap();
  const info = map.get(userId);
  return info?.relation_type || 'stranger';
}

/**
 * Get full relationship info for a user (sync)
 */
export function getRelationshipInfoSync(userId: string): RelationshipInfo | null {
  if (!cachedRelationships || isExpired(cachedRelationships)) {
    return null;
  }
  return cachedRelationships.map.get(userId) || null;
}

/**
 * Get all cached relationships as list
 */
export function getCachedRelationshipsList(): Relationship[] | null {
  if (cachedRelationships && !isExpired(cachedRelationships)) {
    return cachedRelationships.list;
  }
  return null;
}

/**
 * Force refresh (ignore cache, bypass TTL)
 * 関係性作成後・変更後など、確実に最新を取得したい場合に使用
 */
export async function refreshRelationships(): Promise<Map<string, RelationshipInfo>> {
  log.cacheDebug('RelationshipsCache REFRESH', { module: 'RelationshipsCache' });
  
  // Clear existing cache
  cachedRelationships = null;
  
  // Wait for inflight if exists (don't create duplicate)
  if (inflightRelationships) {
    await inflightRelationships.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const relationships = await relationshipsApi.listAll();
  const map = buildMap(relationships);
  
  // Store in cache
  cachedRelationships = {
    map,
    list: relationships,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  
  // Notify listeners
  notifyListeners(map);
  
  return map;
}

/**
 * Invalidate cache (remove entry without fetching)
 */
export function invalidateRelationships(): void {
  log.cacheDebug('RelationshipsCache INVALIDATE', { module: 'RelationshipsCache' });
  cachedRelationships = null;
  notifyListeners(null);
}

/**
 * Check if cache is ready (has valid data)
 */
export function isRelationshipsCacheReady(): boolean {
  return cachedRelationships !== null && !isExpired(cachedRelationships);
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to relationships updates
 * @returns unsubscribe function
 */
export function subscribeRelationships(listener: RelationshipsListener): () => void {
  listeners.add(listener);
  log.cacheDebug('RelationshipsCache SUBSCRIBE', { module: 'RelationshipsCache', listenerCount: listeners.size });
  return () => {
    listeners.delete(listener);
    log.cacheDebug('RelationshipsCache UNSUBSCRIBE', { module: 'RelationshipsCache', listenerCount: listeners.size });
  };
}

// ============================================================
// Debug / Stats
// ============================================================

export function getRelationshipsCacheStats(): {
  hasCached: boolean;
  inflight: boolean;
  age: number | null;
  expired: boolean;
  listenerCount: number;
  relationshipCount: number | null;
} {
  const now = Date.now();
  return {
    hasCached: cachedRelationships !== null,
    inflight: inflightRelationships !== null,
    age: cachedRelationships ? now - cachedRelationships.timestamp : null,
    expired: cachedRelationships ? isExpired(cachedRelationships) : false,
    listenerCount: listeners.size,
    relationshipCount: cachedRelationships?.list.length ?? null,
  };
}

// ============================================================
// Export Types
// ============================================================

export type { RelationshipInfo };
