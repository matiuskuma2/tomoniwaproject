/**
 * useViewerTimezone
 * P1-3: Viewer timezone resolver
 * 
 * Prefer users/me.timezone if available
 * Fallback to browser timezone
 * Subscribes to meCache so Settings changes reflect immediately
 */

import { useEffect, useState } from 'react';
import { getCachedMe, getMe, subscribeMe } from '../cache';
import { getBrowserTimeZone } from '../../utils/datetime';

/**
 * Get the viewer's timezone from user settings or browser
 * @returns timezone string (e.g., 'Asia/Tokyo')
 */
export function useViewerTimezone(): string {
  const [tz, setTz] = useState<string>(() => {
    // Try to get from cache first (sync, no fetch)
    const cached = getCachedMe();
    return cached?.timezone || getBrowserTimeZone();
  });

  useEffect(() => {
    // Fetch user info (TTL + inflight shared)
    getMe()
      .then((me) => setTz(me?.timezone || getBrowserTimeZone()))
      .catch(() => setTz(getBrowserTimeZone()));

    // Subscribe to updates (e.g., Settings timezone change)
    const unsub = subscribeMe((me) => {
      setTz(me?.timezone || getBrowserTimeZone());
    });
    return unsub;
  }, []);

  return tz;
}
