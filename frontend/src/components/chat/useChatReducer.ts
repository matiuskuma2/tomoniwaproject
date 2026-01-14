/**
 * useChatReducer.ts
 * ChatLayout の状態管理を useReducer で一元化
 * 
 * P1-B: 状態爆発の根治（運用インシデント直結対策）
 * 
 * 設計方針:
 * - 全ての状態を1つのオブジェクトに集約
 * - アクションは handleExecutionResult のイベントに対応
 * - 現在の辞書構造（byThreadId）はそのまま維持（まずは移設だけ）
 * - ロジックは変えない（状態の置き場所だけ変える）
 */

import { useReducer, useCallback, useEffect } from 'react';
import type { 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse 
} from '../../core/models';
// NOTE: ThreadStatus_API は削除（キャッシュが単一ソース）
import type { ExecutionResult } from '../../core/chat/apiExecutor';
import type { ChatMessage } from './ChatPane';

// ============================================================
// State Types
// ============================================================

/** Calendar data state (Phase Next-3 Day4) */
interface CalendarData {
  today?: CalendarTodayResponse;
  week?: CalendarWeekResponse;
  freebusy?: CalendarFreeBusyResponse;
}

/** Auto-propose pending state (Phase Next-5 Day2) */
interface PendingAutoPropose {
  emails: string[];
  duration: number;
  range: string;
  proposals: Array<{ start_at: string; end_at: string; label: string }>;
}

/** Pending action state (Beta A / Phase2) */
interface PendingActionState {
  confirmToken: string;
  expiresAt: string;
  summary: any;
  mode: 'new_thread' | 'add_to_thread' | 'add_slots';
  threadId?: string;
  threadTitle?: string;
  actionType?: 'send_invites' | 'add_invites' | 'add_slots';
}

/** Pending remind state (Phase Next-6 Day1) */
interface PendingRemind {
  threadId: string;
  pendingInvites: Array<{ email: string; name?: string }>;
  count: number;
}

/** Pending notify state (Phase Next-6 Day3) */
interface PendingNotify {
  threadId: string;
  invites: Array<{ email: string; name?: string }>;
  finalSlot: { start_at: string; end_at: string; label?: string };
  meetingUrl?: string;
}

/** Pending split state (Phase Next-6 Day2) */
interface PendingSplit {
  threadId: string;
}

/** Pending remind need response state (Phase2 P2-D1) */
interface PendingRemindNeedResponse {
  threadId: string;
  targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
  count: number;
}

type MobileTab = 'threads' | 'chat' | 'cards';

// ============================================================
// Main State
// ============================================================

export interface ChatState {
  // NOTE: status/loading はキャッシュ(useThreadStatus)が単一ソース
  // reducerには持たせない（二重管理防止）
  
  // UI state
  mobileTab: MobileTab;
  isSettingsOpen: boolean;
  
  // Message history (per thread)
  messagesByThreadId: Record<string, ChatMessage[]>;
  seededThreads: Set<string>;
  
  // Calendar data
  calendarData: CalendarData;
  
  // Pending states (global)
  pendingAutoPropose: PendingAutoPropose | null;
  pendingAction: PendingActionState | null;
  
  // Pending states (per thread)
  pendingRemindByThreadId: Record<string, PendingRemind | null>;
  pendingNotifyByThreadId: Record<string, PendingNotify | null>;
  pendingSplitByThreadId: Record<string, PendingSplit | null>;
  pendingRemindNeedResponseByThreadId: Record<string, PendingRemindNeedResponse | null>;
  
  // Counters (per thread)
  additionalProposeCountByThreadId: Record<string, number>;
  remindCountByThreadId: Record<string, number>;
  
  // localStorage persistence state
  saveFailCount: number;
  persistEnabled: boolean;
}

// ============================================================
// Actions
// ============================================================

export type ChatAction =
  // NOTE: SET_STATUS/SET_LOADING は削除（キャッシュが単一ソース）
  // UI actions
  | { type: 'SET_MOBILE_TAB'; payload: MobileTab }
  | { type: 'SET_SETTINGS_OPEN'; payload: boolean }
  
  // Message actions
  | { type: 'APPEND_MESSAGE'; payload: { threadId: string; message: ChatMessage } }
  | { type: 'SEED_MESSAGES'; payload: { threadId: string; messages: ChatMessage[] } }
  | { type: 'SET_MESSAGES'; payload: Record<string, ChatMessage[]> }
  | { type: 'TRIM_MESSAGES'; payload: { threadIds: string[] } }
  
  // Calendar actions
  | { type: 'SET_CALENDAR_TODAY'; payload: CalendarTodayResponse }
  | { type: 'SET_CALENDAR_WEEK'; payload: CalendarWeekResponse }
  | { type: 'SET_CALENDAR_FREEBUSY'; payload: CalendarFreeBusyResponse }
  
  // Auto-propose actions
  | { type: 'SET_PENDING_AUTO_PROPOSE'; payload: PendingAutoPropose | null }
  | { type: 'INCREMENT_ADDITIONAL_PROPOSE_COUNT'; payload: { threadId: string } }
  
  // Remind actions
  | { type: 'SET_PENDING_REMIND'; payload: { threadId: string; data: PendingRemind | null } }
  | { type: 'INCREMENT_REMIND_COUNT'; payload: { threadId: string } }
  
  // Notify actions
  | { type: 'SET_PENDING_NOTIFY'; payload: { threadId: string; data: PendingNotify | null } }
  
  // Split actions
  | { type: 'SET_PENDING_SPLIT'; payload: { threadId: string; data: PendingSplit | null } }
  
  // Pending action (Beta A)
  | { type: 'SET_PENDING_ACTION'; payload: PendingActionState | null }
  
  // Remind need response (Phase2)
  | { type: 'SET_PENDING_REMIND_NEED_RESPONSE'; payload: { threadId: string; data: PendingRemindNeedResponse | null } }
  
  // Persistence actions
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_FAILURE' }
  | { type: 'DISABLE_PERSISTENCE' };

// ============================================================
// Reducer
// ============================================================

const MAX_FAIL_COUNT = 3;

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    // NOTE: SET_STATUS/SET_LOADING は削除（キャッシュが単一ソース）
    
    case 'SET_MOBILE_TAB':
      return { ...state, mobileTab: action.payload };
    
    case 'SET_SETTINGS_OPEN':
      return { ...state, isSettingsOpen: action.payload };
    
    // Message actions
    case 'APPEND_MESSAGE': {
      const { threadId, message } = action.payload;
      const existing = state.messagesByThreadId[threadId] || [];
      return {
        ...state,
        messagesByThreadId: {
          ...state.messagesByThreadId,
          [threadId]: [...existing, message],
        },
      };
    }
    
    case 'SEED_MESSAGES': {
      const { threadId, messages } = action.payload;
      // Prevent double-seeding
      if (state.seededThreads.has(threadId)) {
        return state;
      }
      // Don't overwrite if thread already has messages
      if (state.messagesByThreadId[threadId]?.length > 0) {
        return state;
      }
      return {
        ...state,
        messagesByThreadId: {
          ...state.messagesByThreadId,
          [threadId]: messages,
        },
        seededThreads: new Set(state.seededThreads).add(threadId),
      };
    }
    
    case 'SET_MESSAGES':
      return { ...state, messagesByThreadId: action.payload };
    
    case 'TRIM_MESSAGES': {
      const { threadIds } = action.payload;
      const trimmed: Record<string, ChatMessage[]> = {};
      threadIds.forEach(tid => {
        if (state.messagesByThreadId[tid]) {
          trimmed[tid] = state.messagesByThreadId[tid];
        }
      });
      return { ...state, messagesByThreadId: trimmed };
    }
    
    // Calendar actions
    case 'SET_CALENDAR_TODAY':
      return { ...state, calendarData: { ...state.calendarData, today: action.payload } };
    
    case 'SET_CALENDAR_WEEK':
      return { ...state, calendarData: { ...state.calendarData, week: action.payload } };
    
    case 'SET_CALENDAR_FREEBUSY':
      return { ...state, calendarData: { ...state.calendarData, freebusy: action.payload } };
    
    // Auto-propose actions
    case 'SET_PENDING_AUTO_PROPOSE':
      return { ...state, pendingAutoPropose: action.payload };
    
    case 'INCREMENT_ADDITIONAL_PROPOSE_COUNT': {
      const { threadId } = action.payload;
      return {
        ...state,
        additionalProposeCountByThreadId: {
          ...state.additionalProposeCountByThreadId,
          [threadId]: (state.additionalProposeCountByThreadId[threadId] || 0) + 1,
        },
      };
    }
    
    // Remind actions
    case 'SET_PENDING_REMIND': {
      const { threadId, data } = action.payload;
      return {
        ...state,
        pendingRemindByThreadId: {
          ...state.pendingRemindByThreadId,
          [threadId]: data,
        },
      };
    }
    
    case 'INCREMENT_REMIND_COUNT': {
      const { threadId } = action.payload;
      return {
        ...state,
        remindCountByThreadId: {
          ...state.remindCountByThreadId,
          [threadId]: (state.remindCountByThreadId[threadId] || 0) + 1,
        },
      };
    }
    
    // Notify actions
    case 'SET_PENDING_NOTIFY': {
      const { threadId, data } = action.payload;
      return {
        ...state,
        pendingNotifyByThreadId: {
          ...state.pendingNotifyByThreadId,
          [threadId]: data,
        },
      };
    }
    
    // Split actions
    case 'SET_PENDING_SPLIT': {
      const { threadId, data } = action.payload;
      return {
        ...state,
        pendingSplitByThreadId: {
          ...state.pendingSplitByThreadId,
          [threadId]: data,
        },
      };
    }
    
    // Pending action (Beta A)
    case 'SET_PENDING_ACTION':
      return { ...state, pendingAction: action.payload };
    
    // Remind need response (Phase2)
    case 'SET_PENDING_REMIND_NEED_RESPONSE': {
      const { threadId, data } = action.payload;
      return {
        ...state,
        pendingRemindNeedResponseByThreadId: {
          ...state.pendingRemindNeedResponseByThreadId,
          [threadId]: data,
        },
      };
    }
    
    // Persistence actions
    case 'SAVE_SUCCESS':
      return state.saveFailCount > 0 ? { ...state, saveFailCount: 0 } : state;
    
    case 'SAVE_FAILURE': {
      const newFailCount = state.saveFailCount + 1;
      if (newFailCount >= MAX_FAIL_COUNT) {
        console.error(`[ChatReducer] localStorage failed ${MAX_FAIL_COUNT} times, disabling persistence`);
        return { ...state, saveFailCount: newFailCount, persistEnabled: false };
      }
      return { ...state, saveFailCount: newFailCount };
    }
    
    case 'DISABLE_PERSISTENCE':
      return { ...state, persistEnabled: false };
    
    default:
      return state;
  }
}

// ============================================================
// Initial State Factory
// ============================================================

function createInitialState(): ChatState {
  // Load messages from localStorage
  let initialMessages: Record<string, ChatMessage[]> = {};
  try {
    const saved = localStorage.getItem('tomoniwao_messages');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed === 'object' && parsed !== null) {
        initialMessages = parsed;
      } else {
        console.warn('[ChatReducer] Invalid messages format in localStorage, clearing');
        localStorage.removeItem('tomoniwao_messages');
      }
    }
  } catch (error) {
    console.error('[ChatReducer] Failed to load messages from localStorage:', error);
    localStorage.removeItem('tomoniwao_messages');
  }

  return {
    // NOTE: status/loading はキャッシュが単一ソース
    
    // UI
    mobileTab: 'threads',
    isSettingsOpen: false,
    
    // Messages
    messagesByThreadId: initialMessages,
    seededThreads: new Set(),
    
    // Calendar
    calendarData: {},
    
    // Pending (global)
    pendingAutoPropose: null,
    pendingAction: null,
    
    // Pending (per thread)
    pendingRemindByThreadId: {},
    pendingNotifyByThreadId: {},
    pendingSplitByThreadId: {},
    pendingRemindNeedResponseByThreadId: {},
    
    // Counters
    additionalProposeCountByThreadId: {},
    remindCountByThreadId: {},
    
    // Persistence
    saveFailCount: 0,
    persistEnabled: true,
  };
}

// ============================================================
// Hook
// ============================================================

export function useChatReducer(currentThreadId: string | undefined, navigate: (path: string) => void) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);

  // ============================================================
  // Persistence Effect (debounced localStorage save)
  // ============================================================
  useEffect(() => {
    if (!state.persistEnabled) {
      console.warn('[ChatReducer] localStorage persistence disabled');
      return;
    }
    if (typeof window === 'undefined') return;

    const timer = setTimeout(() => {
      try {
        const serialized = JSON.stringify(state.messagesByThreadId);
        
        // Check size (5MB limit)
        if (serialized.length > 5 * 1024 * 1024) {
          console.warn('[ChatReducer] Messages too large, trimming to last 10 threads');
          const threadIds = Object.keys(state.messagesByThreadId);
          if (threadIds.length > 10) {
            dispatch({ type: 'TRIM_MESSAGES', payload: { threadIds: threadIds.slice(-10) } });
            return;
          }
        }
        
        localStorage.setItem('tomoniwao_messages', serialized);
        dispatch({ type: 'SAVE_SUCCESS' });
      } catch (error) {
        console.error('[ChatReducer] localStorage save failed:', error);
        dispatch({ type: 'SAVE_FAILURE' });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [state.messagesByThreadId, state.persistEnabled]);

  // ============================================================
  // Action Helpers
  // ============================================================

  const appendMessage = useCallback((threadId: string, message: ChatMessage) => {
    dispatch({ type: 'APPEND_MESSAGE', payload: { threadId, message } });
  }, []);

  const seedIfEmpty = useCallback((threadId: string, messages: ChatMessage[]) => {
    dispatch({ type: 'SEED_MESSAGES', payload: { threadId, messages } });
  }, []);

  // NOTE: setStatus/setLoading は削除（キャッシュが単一ソース）

  const setMobileTab = useCallback((tab: MobileTab) => {
    dispatch({ type: 'SET_MOBILE_TAB', payload: tab });
  }, []);

  const setSettingsOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_SETTINGS_OPEN', payload: open });
  }, []);

  // ============================================================
  // ExecutionResult Handler (type-safe, dispatch-based)
  // ============================================================
  const handleExecutionResult = useCallback((result: ExecutionResult) => {
    if (!result.data) return;
    
    const { kind, payload } = result.data;
    
    // Calendar
    if (kind === 'calendar.today') {
      dispatch({ type: 'SET_CALENDAR_TODAY', payload });
    } else if (kind === 'calendar.week') {
      dispatch({ type: 'SET_CALENDAR_WEEK', payload });
    } else if (kind === 'calendar.freebusy') {
      dispatch({ type: 'SET_CALENDAR_FREEBUSY', payload });
    }
    
    // Auto-propose
    else if (kind === 'auto_propose.generated') {
      dispatch({ type: 'SET_PENDING_AUTO_PROPOSE', payload });
      // Phase Next-5 Day3: Increment additional propose count
      if (payload.source === 'additional' && payload.threadId) {
        dispatch({ type: 'INCREMENT_ADDITIONAL_PROPOSE_COUNT', payload: { threadId: payload.threadId } });
      }
    } else if (kind === 'auto_propose.cancelled' || kind === 'auto_propose.created') {
      dispatch({ type: 'SET_PENDING_AUTO_PROPOSE', payload: null });
    }
    
    // Remind (Phase Next-6 Day1)
    else if (kind === 'remind.pending.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_REMIND',
          payload: {
            threadId: payload.threadId,
            data: {
              threadId: payload.threadId,
              pendingInvites: payload.pendingInvites,
              count: payload.count,
            },
          },
        });
        dispatch({ type: 'INCREMENT_REMIND_COUNT', payload: { threadId: payload.threadId } });
      }
    } else if (kind === 'remind.pending.cancelled' || kind === 'remind.pending.sent') {
      if (currentThreadId) {
        dispatch({ type: 'SET_PENDING_REMIND', payload: { threadId: currentThreadId, data: null } });
      }
    }
    
    // Notify (Phase Next-6 Day3)
    else if (kind === 'notify.confirmed.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_NOTIFY',
          payload: {
            threadId: payload.threadId,
            data: {
              threadId: payload.threadId,
              invites: payload.invites,
              finalSlot: payload.finalSlot,
              meetingUrl: payload.meetingUrl,
            },
          },
        });
      }
    } else if (kind === 'notify.confirmed.cancelled' || kind === 'notify.confirmed.sent') {
      if (currentThreadId) {
        dispatch({ type: 'SET_PENDING_NOTIFY', payload: { threadId: currentThreadId, data: null } });
      }
    }
    
    // Split (Phase Next-6 Day2)
    else if (kind === 'split.propose.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_SPLIT',
          payload: { threadId: payload.threadId, data: { threadId: payload.threadId } },
        });
      }
    } else if (kind === 'split.propose.cancelled') {
      if (currentThreadId) {
        dispatch({ type: 'SET_PENDING_SPLIT', payload: { threadId: currentThreadId, data: null } });
      }
    }
    
    // Clear split when moving to additional propose (Phase Next-6 Day2)
    if (kind === 'auto_propose.generated' && currentThreadId) {
      dispatch({ type: 'SET_PENDING_SPLIT', payload: { threadId: currentThreadId, data: null } });
    }
    
    // Pending action (Beta A)
    else if (kind === 'pending.action.created') {
      dispatch({
        type: 'SET_PENDING_ACTION',
        payload: {
          confirmToken: payload.confirmToken,
          expiresAt: payload.expiresAt,
          summary: payload.summary,
          mode: payload.mode,
          threadId: payload.threadId,
          threadTitle: payload.threadTitle,
        },
      });
    } else if (kind === 'pending.action.cleared' || kind === 'pending.action.executed') {
      dispatch({ type: 'SET_PENDING_ACTION', payload: null });
      if (kind === 'pending.action.executed' && payload.threadId) {
        setTimeout(() => navigate(`/chat/${payload.threadId}`), 100);
      }
    }
    
    // Remind need response (Phase2 P2-D1)
    else if (kind === 'remind.need_response.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_REMIND_NEED_RESPONSE',
          payload: {
            threadId: payload.threadId,
            data: {
              threadId: payload.threadId,
              targetInvitees: payload.targetInvitees,
              count: payload.count,
            },
          },
        });
      }
    } else if (kind === 'remind.need_response.cancelled' || kind === 'remind.need_response.sent') {
      if (currentThreadId) {
        dispatch({
          type: 'SET_PENDING_REMIND_NEED_RESPONSE',
          payload: { threadId: currentThreadId, data: null },
        });
      }
    }
  }, [currentThreadId, navigate]);

  return {
    state,
    dispatch,
    // Actions
    appendMessage,
    seedIfEmpty,
    // NOTE: setStatus/setLoading は削除（キャッシュが単一ソース）
    setMobileTab,
    setSettingsOpen,
    handleExecutionResult,
  };
}

// Re-export types for external use
export type {
  CalendarData,
  PendingAutoPropose,
  PendingActionState,
  PendingRemind,
  PendingNotify,
  PendingSplit,
  PendingRemindNeedResponse,
  MobileTab,
};
