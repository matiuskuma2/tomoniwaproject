/**
 * useThreadStatus.ts
 * 
 * React Hook for cached thread status
 * SWR-like interface with automatic revalidation
 * 
 * 使い方:
 * const { status, loading, error, refresh, mutate } = useThreadStatus(threadId);
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
  /** Loading state */
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
  const [loading, setLoading] = useState(false);
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
  const fetchStatus = useCallback(async (force: boolean = false) => {
    if (!threadId) {
      setStatus(null);
      return;
    }
    
    setLoading(true);
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
        setLoading(false);
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
      // Still fetch in background to revalidate
      fetchStatus(false);
    } else {
      fetchStatus(false);
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [threadId, skip, fetchStatus]);
  
  // Refresh function (force fetch)
  const refresh = useCallback(async () => {
    await fetchStatus(true);
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
  
  return {
    status,
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
