/**
 * Threads Slice - スレッド状態管理
 * 
 * 責務:
 * - 現在選択中のスレッド状態
 * - スレッドステータスのキャッシュ
 * - ローディング状態
 */

import type { StateCreator } from 'zustand';
import type { ThreadStatus_API } from '../../core/models';

// ============================================================
// Types
// ============================================================

export interface ThreadsState {
  currentStatus: ThreadStatus_API | null;
  statusCache: Record<string, ThreadStatus_API>;
  isLoading: boolean;
  error: string | null;
}

export interface ThreadsActions {
  setCurrentStatus: (status: ThreadStatus_API | null) => void;
  cacheStatus: (threadId: string, status: ThreadStatus_API) => void;
  getCachedStatus: (threadId: string) => ThreadStatus_API | undefined;
  clearCache: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export type ThreadsSlice = ThreadsState & ThreadsActions;

// ============================================================
// Constants
// ============================================================

const MAX_CACHED_THREADS = 10;
const CACHE_TTL_MS = 30 * 1000; // 30秒

// キャッシュのタイムスタンプを管理
const cacheTimestamps: Record<string, number> = {};

// ============================================================
// Initial State
// ============================================================

const initialState: ThreadsState = {
  currentStatus: null,
  statusCache: {},
  isLoading: false,
  error: null,
};

// ============================================================
// Slice Creator
// ============================================================

export const createThreadsSlice: StateCreator<ThreadsSlice> = (set, get) => ({
  ...initialState,

  setCurrentStatus: (status) => set({ currentStatus: status, error: null }),

  cacheStatus: (threadId, status) => {
    cacheTimestamps[threadId] = Date.now();
    
    set((state) => {
      const newCache = { ...state.statusCache, [threadId]: status };
      
      // キャッシュサイズ制限
      const keys = Object.keys(newCache);
      if (keys.length > MAX_CACHED_THREADS) {
        const oldestKey = keys[0];
        delete newCache[oldestKey];
        delete cacheTimestamps[oldestKey];
      }
      
      return { statusCache: newCache };
    });
  },

  getCachedStatus: (threadId) => {
    const state = get();
    const cached = state.statusCache[threadId];
    
    if (!cached) return undefined;
    
    // TTLチェック
    const timestamp = cacheTimestamps[threadId];
    if (timestamp && Date.now() - timestamp > CACHE_TTL_MS) {
      // 期限切れ - キャッシュをクリアして undefined を返す
      set((state) => {
        const { [threadId]: _, ...rest } = state.statusCache;
        return { statusCache: rest };
      });
      delete cacheTimestamps[threadId];
      return undefined;
    }
    
    return cached;
  },

  clearCache: () => {
    Object.keys(cacheTimestamps).forEach(k => delete cacheTimestamps[k]);
    set({ statusCache: {} });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),
});
