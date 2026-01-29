/**
 * useMe Hook
 * 
 * React hook for accessing current user data from meCache
 * Automatically subscribes to updates and handles loading state
 */

import { useState, useEffect, useCallback } from 'react';
import { getMe, subscribeMe, getCachedMe } from '../cache/meCache';
import type { UserProfile } from '../api';

interface UseMeResult {
  me: UserProfile | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useMe(): UseMeResult {
  const [me, setMe] = useState<UserProfile | null>(() => getCachedMe());
  const [loading, setLoading] = useState(!getCachedMe());
  const [error, setError] = useState<Error | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const user = await getMe();
      setMe(user);
    } catch (err) {
      console.error('[useMe] Failed to fetch user:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch user'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If no cached data, fetch
    if (!me) {
      fetchMe();
    }

    // Subscribe to cache updates
    const unsubscribe = subscribeMe((user) => {
      setMe(user);
    });

    return unsubscribe;
  }, [fetchMe, me]);

  return {
    me,
    loading,
    error,
    refetch: fetchMe,
  };
}
