/**
 * useThreadStatus.ts
 * 
 * React Hook for cached thread status
 * SWR-like interface with automatic revalidation
 * 
 * PR-UX-2: loading を initialLoading / refreshing に分離
 * - initialLoading: 初回ロード（キャッシュなし、status=null）→ skeleton表示用
 * - refreshing: バックグラウンド再取得（既にデータあり）→ tiny indicator用
 * - loading: 後方互換（initialLoading || refreshing）
 * 
 * PR-UX-5: スレッド切り替え時のスピナー抑制
 * - 別スレッドへ切り替え時は常に refreshing（バックグラウンド）扱い
 * - initialLoading はフック初回マウント（hasLoadedOnce=false）のみ
 * - refreshing の安全タイムアウト（8秒）で永続スピナーを防止
 * 
 * 根本原因:
 *   旧実装では fetchStatus() のたびに setLoading(true) → ChatPane if(loading) return spinner
 *   → メッセージが全部消えて白画面+くるくる
 *   送信成功 → onThreadUpdate → refresh → fetchStatus(true) → loading=true → 全画面スピナー
 * 
 * 修正:
 *   loading を initialLoading（初回のみ skeleton OK）と refreshing（バックグラウンド）に分離
 *   refresh() は常に isBackground=true → refreshing のみ変化 → ChatPane はメッセージを保持
 *   スレッド切り替え時: hasLoadedOnce=true なら常に refreshing 扱い
 * 
 * 使い方:
 * const { status, initialLoading, refreshing, loading, error, refresh, mutate } = useThreadStatus(threadId);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getStatus,
  refreshStatus,
  getCached,
  invalidate,
  subscribe,
  updateOptimistic,
} from './threadStatusCache';
import type { ThreadStatus_API } from '../models';

// ============================================================
// Types
// ============================================================

interface UseThreadStatusResult {
  /** Current status (null if not loaded) */
  status: ThreadStatus_API | null;
  /** PR-UX-2: Initial loading (no cached data yet, status=null) — use for full-screen skeleton */
  initialLoading: boolean;
  /** PR-UX-2: Background refreshing (already have data) — use for tiny sync indicator */
  refreshing: boolean;
  /** Loading state (backward compat: initialLoading || refreshing) */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Force refresh (bypass cache) */
  refresh: () => Promise<void>;
  /** Optimistic update */
  mutate: (updater: (current: ThreadStatus_API) => ThreadStatus_API) => void;
  /** Invalidate cache (for cleanup) */
  invalidateCache: () => void;
}

interface UseThreadStatusOptions {
  /** Disable automatic fetch on mount */
  skip?: boolean;
  /** Custom TTL in ms (default: 10000) */
  ttl?: number;
  /** Callback when status changes */
  onStatusChange?: (status: ThreadStatus_API | null) => void;
}

// ============================================================
// Hook
// ============================================================

export function useThreadStatus(
  threadId: string | null | undefined,
  options?: UseThreadStatusOptions
): UseThreadStatusResult {
  const { skip = false, ttl, onStatusChange } = options ?? {};
  
  // State
  const [status, setStatus] = useState<ThreadStatus_API | null>(() => {
    // Initialize with cached value if available
    return threadId ? getCached(threadId) : null;
  });
  // PR-UX-2: loading を2種類に分離
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Refs for cleanup
  const mountedRef = useRef(true);
  const threadIdRef = useRef(threadId);
  // PR-UX-5: 一度でもロードに成功したかを追跡
  // true になった後のスレッド切り替えでは initialLoading=true を使わない
  const hasLoadedOnceRef = useRef(false);
  // PR-UX-5: refreshing 安全タイムアウト
  const refreshingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Update ref when threadId changes
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);
  
  // Subscribe to cache updates
  useEffect(() => {
    if (!threadId) return;
    
    const unsubscribe = subscribe((updatedThreadId, updatedStatus) => {
      // Only update if this is our thread
      if (updatedThreadId === threadIdRef.current && mountedRef.current) {
        setStatus(updatedStatus);
        onStatusChange?.(updatedStatus);
      }
    });
    
    return unsubscribe;
  }, [threadId, onStatusChange]);
  
  // PR-UX-5: refreshing 安全タイムアウトクリア
  const clearRefreshingTimeout = useCallback(() => {
    if (refreshingTimeoutRef.current) {
      clearTimeout(refreshingTimeoutRef.current);
      refreshingTimeoutRef.current = null;
    }
  }, []);

  // Fetch status
  // PR-UX-2: isBackground パラメータで initialLoading/refreshing を使い分け
  // PR-UX-5: hasLoadedOnce=true なら常に isBackground=true 扱い（スレッド切替スピナー防止）
  const fetchStatus = useCallback(async (force: boolean = false, isBackground: boolean = false) => {
    if (!threadId) {
      setStatus(null);
      return;
    }
    
    // PR-UX-5: 一度でもロード成功していれば、initialLoading は使わない
    // スレッド切り替え時にも全画面スピナーを出さない
    const effectiveIsBackground = isBackground || hasLoadedOnceRef.current;
    
    // PR-UX-2: 初回ロード vs バックグラウンド再取得を分離
    if (effectiveIsBackground) {
      setRefreshing(true);
      // PR-UX-5: refreshing 安全タイムアウト（8秒で自動解除、永続スピナー防止）
      clearRefreshingTimeout();
      refreshingTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          console.warn(`[useThreadStatus] Refreshing timeout (8s) for ${threadId}, force-clearing`);
          setRefreshing(false);
        }
      }, 8000);
    } else {
      setInitialLoading(true);
    }
    setError(null);
    
    try {
      const data = force 
        ? await refreshStatus(threadId)
        : await getStatus(threadId, { ttl });
      
      if (mountedRef.current && threadIdRef.current === threadId) {
        setStatus(data);
        hasLoadedOnceRef.current = true; // PR-UX-5: ロード成功を記録
        onStatusChange?.(data);
      }
    } catch (err) {
      console.error(`[useThreadStatus] Error fetching ${threadId}:`, err);
      if (mountedRef.current && threadIdRef.current === threadId) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      if (mountedRef.current) {
        clearRefreshingTimeout();
        if (effectiveIsBackground) {
          setRefreshing(false);
        } else {
          setInitialLoading(false);
          hasLoadedOnceRef.current = true; // PR-UX-5: 初回ロード完了
        }
      }
    }
  }, [threadId, ttl, onStatusChange, clearRefreshingTimeout]);
  
  // Initial fetch and threadId change
  useEffect(() => {
    mountedRef.current = true;
    
    if (skip || !threadId) {
      setStatus(null);
      setInitialLoading(false);
      setRefreshing(false);
      clearRefreshingTimeout();
      return;
    }
    
    // Check cache first
    const cached = getCached(threadId);
    if (cached) {
      setStatus(cached);
      // PR-UX-2: キャッシュあり → バックグラウンドで再検証（UIは残す）
      fetchStatus(false, /* isBackground */ true);
    } else {
      // PR-UX-5: hasLoadedOnce=true なら fetchStatus 内部で effectiveIsBackground=true に昇格
      // → スレッド切り替え時は全画面スピナーを出さない
      fetchStatus(false, /* isBackground */ false);
    }
    
    return () => {
      mountedRef.current = false;
      clearRefreshingTimeout();
    };
  }, [threadId, skip, fetchStatus, clearRefreshingTimeout]);
  
  // Refresh function (force fetch)
  // PR-UX-2: refresh は常にバックグラウンド（既にデータがある前提）
  const refresh = useCallback(async () => {
    await fetchStatus(true, /* isBackground */ true);
  }, [fetchStatus]);
  
  // Optimistic update
  const mutate = useCallback((updater: (current: ThreadStatus_API) => ThreadStatus_API) => {
    if (!threadId) return;
    
    const updated = updateOptimistic(threadId, updater);
    if (updated && mountedRef.current) {
      setStatus(updated);
      onStatusChange?.(updated);
    }
  }, [threadId, onStatusChange]);
  
  // Invalidate cache
  const invalidateCache = useCallback(() => {
    if (threadId) {
      invalidate(threadId);
    }
  }, [threadId]);
  
  // PR-UX-2: 後方互換の loading（どちらかが true なら true）
  const loading = initialLoading || refreshing;

  // PR-UX-5: unmount 時に安全タイムアウトをクリア
  useEffect(() => {
    return () => {
      clearRefreshingTimeout();
    };
  }, [clearRefreshingTimeout]);

  return {
    status,
    initialLoading,
    refreshing,
    loading,
    error,
    refresh,
    mutate,
    invalidateCache,
  };
}

// ============================================================
// Prefetch utility (for navigation)
// ============================================================

/**
 * Prefetch thread status (for navigation)
 * Call this when user hovers over a thread link
 */
export function prefetchThreadStatus(threadId: string): void {
  // Check if already cached
  if (getCached(threadId)) return;
  
  // Fetch in background (fire-and-forget)
  getStatus(threadId).catch(err => {
    console.warn(`[prefetch] Failed to prefetch ${threadId}:`, err);
  });
}
