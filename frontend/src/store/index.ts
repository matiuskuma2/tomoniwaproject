/**
 * Global Store - Zustand ストア統合
 * 
 * 全てのスライスを統合した単一ストア
 * 
 * 使用例:
 * ```tsx
 * import { useStore } from '@/store';
 * 
 * function MyComponent() {
 *   const { token, isAuthenticated, login, logout } = useStore();
 *   const messages = useStore((s) => s.messagesByThreadId[threadId]);
 *   // ...
 * }
 * ```
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Slices
import { createAuthSlice, type AuthSlice } from './slices/authSlice';
import { createChatSlice, type ChatSlice } from './slices/chatSlice';
import { createThreadsSlice, type ThreadsSlice } from './slices/threadsSlice';
import { createPendingSlice, type PendingSlice } from './slices/pendingSlice';
import { createCalendarSlice, type CalendarSlice } from './slices/calendarSlice';
import { createUISlice, type UISlice } from './slices/uiSlice';

// ============================================================
// Combined Store Type
// ============================================================

export type StoreState = AuthSlice & ChatSlice & ThreadsSlice & PendingSlice & CalendarSlice & UISlice;

// ============================================================
// Store Creation
// ============================================================

export const useStore = create<StoreState>()(
  devtools(
    (...args) => ({
      ...createAuthSlice(...args),
      ...createChatSlice(...args),
      ...createThreadsSlice(...args),
      ...createPendingSlice(...args),
      ...createCalendarSlice(...args),
      ...createUISlice(...args),
    }),
    {
      name: 'tomoniwao-store',
      enabled: import.meta.env.DEV,
    }
  )
);

// ============================================================
// Selector Hooks (Performance Optimization)
// ============================================================

/**
 * 認証状態のみを取得するセレクタ
 * 不要な再レンダリングを防ぐ
 */
export const useAuth = () => useStore((state) => ({
  token: state.token,
  user: state.user,
  isAuthenticated: state.isAuthenticated,
  isLoading: state.isLoading,
  setToken: state.setToken,
  setUser: state.setUser,
  login: state.login,
  logout: state.logout,
}));

/**
 * チャットメッセージを取得するセレクタ
 */
export const useMessages = (threadId: string | null) => {
  return useStore((state) => 
    threadId ? state.messagesByThreadId[threadId] || [] : []
  );
};

/**
 * チャット操作を取得するセレクタ
 */
export const useChatActions = () => useStore((state) => ({
  appendMessage: state.appendMessage,
  setMessages: state.setMessages,
  clearMessages: state.clearMessages,
  isProcessing: state.isProcessing,
  setProcessing: state.setProcessing,
  markThreadSeeded: state.markThreadSeeded,
  isThreadSeeded: state.isThreadSeeded,
}));

/**
 * スレッド状態を取得するセレクタ
 */
export const useThreadStatus = () => useStore((state) => ({
  currentStatus: state.currentStatus,
  isLoading: state.isLoading,
  error: state.error,
  setCurrentStatus: state.setCurrentStatus,
  setLoading: state.setLoading,
  setError: state.setError,
}));

/**
 * Beta A: 送信確認フロー状態を取得するセレクタ
 */
export const usePendingAction = () => useStore((state) => ({
  pendingAction: state.pendingAction,
  setPendingAction: state.setPendingAction,
  clearPendingAction: state.clearPendingAction,
}));

/**
 * Phase Next-5: Auto-propose 状態を取得するセレクタ
 */
export const useAutoPropose = () => useStore((state) => ({
  pendingAutoPropose: state.pendingAutoPropose,
  setPendingAutoPropose: state.setPendingAutoPropose,
  incrementAdditionalProposeCount: state.incrementAdditionalProposeCount,
  getAdditionalProposeCount: state.getAdditionalProposeCount,
}));

/**
 * UI状態を取得するセレクタ
 */
export const useUI = () => useStore((state) => ({
  mobileTab: state.mobileTab,
  setMobileTab: state.setMobileTab,
  toasts: state.toasts,
  addToast: state.addToast,
  removeToast: state.removeToast,
}));

/**
 * カレンダー状態を取得するセレクタ
 */
export const useCalendar = () => useStore((state) => ({
  today: state.today,
  week: state.week,
  freebusy: state.freebusy,
  setToday: state.setToday,
  setWeek: state.setWeek,
  setFreebusy: state.setFreebusy,
  isStale: state.isStale,
}));

// ============================================================
// Re-exports
// ============================================================

export type { User, AuthState } from './slices/authSlice';
export type { ChatMessage, ChatState } from './slices/chatSlice';
export type { ThreadsState } from './slices/threadsSlice';
export type { 
  PendingAction, 
  PendingAutoPropose, 
  PendingRemind, 
  PendingNotify, 
  PendingSplit,
  PendingState 
} from './slices/pendingSlice';
export type { CalendarState } from './slices/calendarSlice';
export type { MobileTab, Toast, UIState } from './slices/uiSlice';
