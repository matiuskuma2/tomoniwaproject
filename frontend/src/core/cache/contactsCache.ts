/**
 * contactsCache.ts
 * P1-4: /api/contacts のキャッシュ層
 * 
 * 設計方針:
 * - TTL (60秒): 連絡先一覧は頻繁に変わらないため長めに設定
 * - inflight共有: 同時リクエストを1つにまとめる
 * - 強制refresh: 連絡先作成・更新後など明示的な更新
 * - シングルトン: 連絡先一覧は1つだけなのでMapではなく単一変数
 * 
 * 重要: 連絡先は招待・リスト・メール送信に波及するため運用事故リスク最高
 * 
 * 使い方:
 * - getContacts(): キャッシュがあればそれを返す、なければfetch
 * - refreshContacts(): キャッシュを無視して強制fetch
 * - invalidateContacts(): キャッシュを削除
 * - getCachedContacts(): 同期的にキャッシュを取得（fetchしない）
 */

import { contactsApi } from '../api';
import type { Contact } from '../models';
import { log } from '../platform';

// ============================================================
// Configuration
// ============================================================

const DEFAULT_TTL_MS = 60_000; // 60秒（連絡先一覧は頻繁に変わらない）

// ============================================================
// Types
// ============================================================

interface CacheEntry {
  data: Contact[];
  timestamp: number;
  ttl: number;
}

interface InflightRequest {
  promise: Promise<Contact[]>;
  timestamp: number;
}

type ContactsListener = (contacts: Contact[] | null) => void;

// ============================================================
// Cache State (Module-level singleton)
// ============================================================

let cachedContacts: CacheEntry | null = null;
let inflightContacts: InflightRequest | null = null;
const listeners: Set<ContactsListener> = new Set();

// ============================================================
// Helper Functions
// ============================================================

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > entry.ttl;
}

function notifyListeners(contacts: Contact[] | null): void {
  listeners.forEach(listener => {
    try {
      listener(contacts);
    } catch (error) {
      console.error('[ContactsCache] Listener error:', error);
    }
  });
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get contacts with cache (TTL: 60秒)
 * - キャッシュがあり、TTL内ならそれを返す
 * - inflight中なら同じPromiseを返す（重複リクエスト防止）
 * - なければfetchしてキャッシュに保存
 */
export async function getContacts(
  options?: { ttl?: number }
): Promise<Contact[]> {
  const ttl = options?.ttl ?? DEFAULT_TTL_MS;
  
  // 1. Check cache (TTL valid)
  if (cachedContacts && !isExpired(cachedContacts)) {
    log.cacheDebug('ContactsCache HIT', { module: 'ContactsCache', age: Date.now() - cachedContacts.timestamp });
    return cachedContacts.data;
  }
  
  // 2. Check inflight (return same promise)
  if (inflightContacts) {
    log.cacheDebug('ContactsCache INFLIGHT', { module: 'ContactsCache' });
    return inflightContacts.promise;
  }
  
  // 3. Fetch and cache
  log.cacheDebug('ContactsCache MISS', { module: 'ContactsCache' });
  
  const promise = contactsApi.list()
    .then(response => {
      const contacts = response.items || [];
      
      // Store in cache
      cachedContacts = {
        data: contacts,
        timestamp: Date.now(),
        ttl,
      };
      
      // Clean up inflight
      inflightContacts = null;
      
      // Notify listeners
      notifyListeners(contacts);
      
      return contacts;
    })
    .catch(error => {
      // Clean up inflight on error
      inflightContacts = null;
      throw error;
    });
  
  // Store inflight
  inflightContacts = { promise, timestamp: Date.now() };
  
  return promise;
}

/**
 * Force refresh (ignore cache, bypass TTL)
 * 連絡先作成後・更新後など、確実に最新を取得したい場合に使用
 */
export async function refreshContacts(): Promise<Contact[]> {
  log.cacheDebug('ContactsCache REFRESH', { module: 'ContactsCache' });
  
  // Clear existing cache
  cachedContacts = null;
  
  // Wait for inflight if exists (don't create duplicate)
  if (inflightContacts) {
    await inflightContacts.promise.catch(() => {});
  }
  
  // Fetch fresh data
  const response = await contactsApi.list();
  const contacts = response.items || [];
  
  // Store in cache
  cachedContacts = {
    data: contacts,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  
  // Notify listeners
  notifyListeners(contacts);
  
  return contacts;
}

/**
 * Invalidate cache (remove entry without fetching)
 * キャッシュを削除するだけで、新規fetchはしない
 */
export function invalidateContacts(): void {
  log.cacheDebug('ContactsCache INVALIDATE', { module: 'ContactsCache' });
  cachedContacts = null;
}

/**
 * Get cached contacts (sync, no fetch)
 * キャッシュにあればすぐ返す、なければnull
 */
export function getCachedContacts(): Contact[] | null {
  if (cachedContacts && !isExpired(cachedContacts)) {
    return cachedContacts.data;
  }
  return null;
}

/**
 * Set contacts directly (for external updates)
 * APIレスポンスから直接キャッシュを更新する場合に使用
 */
export function setContacts(contacts: Contact[]): void {
  cachedContacts = {
    data: contacts,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL_MS,
  };
  notifyListeners(contacts);
  log.cacheDebug('ContactsCache SET', { module: 'ContactsCache' });
}

// ============================================================
// Subscription (for React hooks)
// ============================================================

/**
 * Subscribe to contacts updates
 * @returns unsubscribe function
 */
export function subscribeContacts(listener: ContactsListener): () => void {
  listeners.add(listener);
  log.cacheDebug('ContactsCache SUBSCRIBE', { module: 'ContactsCache', listenerCount: listeners.size });
  return () => {
    listeners.delete(listener);
    log.cacheDebug('ContactsCache UNSUBSCRIBE', { module: 'ContactsCache', listenerCount: listeners.size });
  };
}

// ============================================================
// Debug / Stats
// ============================================================

export function getContactsCacheStats(): {
  hasCached: boolean;
  inflight: boolean;
  age: number | null;
  expired: boolean;
  listenerCount: number;
  contactCount: number | null;
} {
  const now = Date.now();
  return {
    hasCached: cachedContacts !== null,
    inflight: inflightContacts !== null,
    age: cachedContacts ? now - cachedContacts.timestamp : null,
    expired: cachedContacts ? isExpired(cachedContacts) : false,
    listenerCount: listeners.size,
    contactCount: cachedContacts?.data.length ?? null,
  };
}
