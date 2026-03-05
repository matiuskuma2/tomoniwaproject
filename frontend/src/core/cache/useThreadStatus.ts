/**
 * useThreadStatus.ts
 * 
 * React Hook for cached thread status
 * SWR-like interface with automatic revalidation
 * 
 * PR-UX-2: loading を initialLoading / refreshing に分離
 * - initialLoading: 初回ロード（キャッシュなし、status=null）→ 全画面スピナー用
 * - refreshing: バックグラウンド再取得（既にデータあり）→ tiny indicator用
 * - loading: 後方互換（initialLoading || refreshing）
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
  
  // Fetch status
  // PR-UX-2: isBackground パラメータで initialLoading/refreshing を使い分け
  const fetchStatus = useCallback(async (force: boolean = false, isBackground: boolean = false) => {
    if (!threadId) {
      setStatus(null);
      return;
    }
    
    // PR-UX-2: 初回ロード vs バックグラウンド再取得を分離
    if (isBackground) {
      setRefreshing(true);
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
        onStatusChange?.(data);
      }
    } catch (err) {
      console.error(`[useThreadStatus] Error fetching ${threadId}:`, err);
      if (mountedRef.current && threadIdRef.current === threadId) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    } finally {
      if (mountedRef.current) {
        if (isBackground) {
          setRefreshing(false);
        } else {
          setInitialLoading(false);
        }
      }
    }
  }, [threadId, ttl, onStatusChange]);
  
  // Initial fetch and threadId change
  useEffect(() => {
    mountedRef.current = true;
    
    if (skip || !threadId) {
      setStatus(null);
      setLoading(false);
      return;
    }
    
    // Check cache first
    const cached = getCached(threadId);
    if (cached) {
      setStatus(cached);
      // PR-UX-2: キャッシュあり → バックグラウンドで再検証（UIは残す）
      fetchStatus(false, /* isBackground */ true);
    } else {
      // PR-UX-2: キャッシュなし → 初回ロード（スピナー表示OK）
      fetchStatus(false, /* isBackground */ false);
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [threadId, skip, fetchStatus]);
  
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
