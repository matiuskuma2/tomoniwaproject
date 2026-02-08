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

import { useReducer, useCallback, useEffect, useRef } from 'react';
import type { 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse 
} from '../../core/models';
import { storage, STORAGE_KEYS, StorageError } from '../../core/platform';
// NOTE: ThreadStatus_API は削除（キャッシュが単一ソース）
import type { ExecutionResult } from '../../core/chat/apiExecutor';
import type { ChatMessage } from './ChatPane';
// P0-1: PendingState 正規化
import type { PendingState } from '../../core/chat/pendingTypes';
import { getPendingForThread } from '../../core/chat/pendingTypes';
// PR-D-FE-1: Contact Import pending builder (静的import — require()はブラウザ非互換)
import { buildPendingContactImportConfirm } from '../../core/chat/executors/contactImport';
// PR-D-FE-3.1: 次手フロー用 context 型
import type { ContactImportContext } from '../../core/chat/executors/types';

// ============================================================
// State Types
// ============================================================

/** Calendar data state (Phase Next-3 Day4) */
interface CalendarData {
  today?: CalendarTodayResponse;
  week?: CalendarWeekResponse;
  freebusy?: CalendarFreeBusyResponse;
}

// P0-1: 旧 pending 型定義は pendingTypes.ts に統合
// PendingAutoPropose, PendingActionState, PendingRemind, PendingNotify, PendingSplit, PendingRemindNeedResponse
// は全て PendingState union に統合済み

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
  
  // P0-1: Pending states 正規化 - 1つの辞書に統合
  pendingByThreadId: Record<string, PendingState | null>;
  
  // threadId未選択でも走る pending.action（prepare-send等）のみ残す
  globalPendingAction: PendingState | null;
  
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
  
  // P0-1: Pending actions 正規化
  | { type: 'SET_PENDING_FOR_THREAD'; payload: { threadId: string; pending: PendingState | null } }
  | { type: 'CLEAR_PENDING_FOR_THREAD'; payload: { threadId: string } }
  | { type: 'SET_GLOBAL_PENDING_ACTION'; payload: { pending: PendingState | null } }
  
  // Counter actions
  | { type: 'INCREMENT_ADDITIONAL_PROPOSE_COUNT'; payload: { threadId: string } }
  | { type: 'INCREMENT_REMIND_COUNT'; payload: { threadId: string } }
  
  // Persistence actions
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_FAILURE' }
  | { type: 'DISABLE_PERSISTENCE' }
  
  // PR-D-FE-1: Contact Import 曖昧一致解決（reducer内で既存pendingを安全に更新）
  | { type: 'RESOLVE_CONTACT_IMPORT_AMBIGUOUS'; payload: { threadId: string; pending_action_id: string } }
  // PR-D-FE-3.1: 名刺取り込み完了後の次手選択 pending 設定
  | { type: 'SET_POST_IMPORT_NEXT_STEP'; payload: {
      threadId: string;
      intent: 'send_invite' | 'schedule' | 'message_only' | 'unknown';
      userMessage?: string;
      importSummary: {
        created_count: number;
        updated_count: number;
        skipped_count: number;
        imported_contacts: Array<{ display_name: string; email: string }>;
      };
      source: 'text' | 'csv' | 'business_card';
    } };

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
    
    // P0-1: Pending actions 正規化
    case 'SET_PENDING_FOR_THREAD': {
      const { threadId, pending } = action.payload;
      return {
        ...state,
        pendingByThreadId: {
          ...state.pendingByThreadId,
          [threadId]: pending,
        },
      };
    }
    
    case 'CLEAR_PENDING_FOR_THREAD': {
      const { threadId } = action.payload;
      return {
        ...state,
        pendingByThreadId: {
          ...state.pendingByThreadId,
          [threadId]: null,
        },
      };
    }
    
    case 'SET_GLOBAL_PENDING_ACTION': {
      return { ...state, globalPendingAction: action.payload.pending };
    }
    
    // Counter actions
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
    
    // PR-D-FE-3.1: 名刺取り込み完了後の次手選択 pending
    case 'SET_POST_IMPORT_NEXT_STEP': {
      const { threadId, intent, userMessage, importSummary, source } = action.payload;
      return {
        ...state,
        pendingByThreadId: {
          ...state.pendingByThreadId,
          [threadId]: {
            kind: 'pending.post_import.next_step' as const,
            threadId,
            createdAt: Date.now(),
            intent,
            userMessage,
            importSummary,
            source,
          },
        },
      };
    }

    // PR-D-FE-1: Contact Import 曖昧一致全解決時の pending 更新
    // stale closure 回避: reducer内で state.pendingByThreadId を直接参照
    case 'RESOLVE_CONTACT_IMPORT_AMBIGUOUS': {
      const { threadId, pending_action_id } = action.payload;
      const existing = state.pendingByThreadId[threadId];
      if (existing && existing.kind === 'pending.contact_import.confirm') {
        return {
          ...state,
          pendingByThreadId: {
            ...state.pendingByThreadId,
            [threadId]: {
              ...existing,
              all_ambiguous_resolved: true,
              pending_action_id: pending_action_id || (existing as any).pending_action_id,
            } as any,
          },
        };
      }
      return state;
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

// Note: Initial state is created synchronously, but we load async in effect
function createInitialState(): ChatState {
  // Synchronous fallback for initial render
  // Actual messages will be loaded asynchronously via storage adapter
  let initialMessages: Record<string, ChatMessage[]> = {};
  
  // Try synchronous localStorage for immediate hydration (Web only)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MESSAGES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null) {
          initialMessages = parsed;
        }
      }
    } catch {
      // Ignore - will be handled by async load
    }
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
    
    // P0-1: Pending 正規化 - 1つの辞書に統合
    pendingByThreadId: {},
    globalPendingAction: null,
    
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
  // Persistence Effect (debounced storage save via adapter)
  // ============================================================
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    if (!state.persistEnabled) {
      console.warn('[ChatReducer] Storage persistence disabled');
      return;
    }

    // Clear previous timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        // PERF-S2: 保存前にメッセージ数を制限（各スレッド最新100件、最大20スレッド）
        const MAX_MESSAGES_PER_THREAD = 100;
        const MAX_THREADS = 20;
        
        const threadIds = Object.keys(state.messagesByThreadId);
        const recentThreadIds = threadIds.slice(-MAX_THREADS);
        
        const trimmedMessages: Record<string, ChatMessage[]> = {};
        for (const tid of recentThreadIds) {
          const msgs = state.messagesByThreadId[tid];
          if (msgs && msgs.length > 0) {
            trimmedMessages[tid] = msgs.slice(-MAX_MESSAGES_PER_THREAD);
          }
        }
        
        let dataToSave = trimmedMessages;
        let serialized = JSON.stringify(dataToSave);
        
        // Check size (5MB limit)
        if (serialized.length > 5 * 1024 * 1024) {
          console.warn('[ChatReducer] Messages still too large after trim');
          // さらに削減: 各スレッド50件、10スレッドに
          const furtherTrimmed: Record<string, ChatMessage[]> = {};
          const limitedThreadIds = recentThreadIds.slice(-10);
          for (const tid of limitedThreadIds) {
            const msgs = trimmedMessages[tid];
            if (msgs) {
              furtherTrimmed[tid] = msgs.slice(-50);
            }
          }
          dataToSave = furtherTrimmed;
          serialized = JSON.stringify(dataToSave);
        }
        
        // Use storage adapter (async)
        await storage.set(STORAGE_KEYS.MESSAGES, serialized);
        dispatch({ type: 'SAVE_SUCCESS' });
        
      } catch (error) {
        if (error instanceof StorageError) {
          console.error(`[ChatReducer] Storage ${error.operation} failed:`, error.message);
        } else {
          console.error('[ChatReducer] Storage save failed:', error);
        }
        dispatch({ type: 'SAVE_FAILURE' });
      }
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
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
  // ExecutionResult Handler (P0-1: 正規化された pending 辞書を使用)
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
    
    // Auto-propose (P0-1: pendingByThreadId に統合)
    else if (kind === 'auto_propose.generated') {
      const threadId = payload.threadId ?? currentThreadId;
      if (threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: {
            threadId,
            pending: {
              kind: 'auto_propose',
              threadId,
              createdAt: Date.now(),
              source: payload.source,
              emails: payload.emails,
              duration: payload.duration,
              range: payload.range,
              proposals: payload.proposals,
            },
          },
        });
        // Phase Next-5 Day3: Increment additional propose count
        if (payload.source === 'additional') {
          dispatch({ type: 'INCREMENT_ADDITIONAL_PROPOSE_COUNT', payload: { threadId } });
        }
      }
    } else if (kind === 'auto_propose.cancelled' || kind === 'auto_propose.created') {
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
    }
    
    // Remind (P0-1: pendingByThreadId に統合)
    else if (kind === 'remind.pending.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: {
            threadId: payload.threadId,
            pending: {
              kind: 'remind.pending',
              threadId: payload.threadId,
              createdAt: Date.now(),
              pendingInvites: payload.pendingInvites,
              count: payload.count,
            },
          },
        });
        dispatch({ type: 'INCREMENT_REMIND_COUNT', payload: { threadId: payload.threadId } });
      }
    } else if (kind === 'remind.pending.cancelled' || kind === 'remind.pending.sent') {
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
    }
    
    // Notify (P0-1: pendingByThreadId に統合)
    else if (kind === 'notify.confirmed.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: {
            threadId: payload.threadId,
            pending: {
              kind: 'notify.confirmed',
              threadId: payload.threadId,
              createdAt: Date.now(),
              invites: payload.invites,
              finalSlot: payload.finalSlot,
              meetingUrl: payload.meetingUrl,
            },
          },
        });
      }
    } else if (kind === 'notify.confirmed.cancelled' || kind === 'notify.confirmed.sent') {
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
    }
    
    // Split (P0-1: pendingByThreadId に統合)
    else if (kind === 'split.propose.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: {
            threadId: payload.threadId,
            pending: {
              kind: 'split.propose',
              threadId: payload.threadId,
              createdAt: Date.now(),
              voteSummary: payload.voteSummary,
            },
          },
        });
      }
    } else if (kind === 'split.propose.cancelled') {
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
    }
    
    // Pending action (P0-1: threadId があれば pendingByThreadId, なければ globalPendingAction)
    else if (kind === 'pending.action.created') {
      const pendingState: PendingState = {
        kind: 'pending.action',
        threadId: payload.threadId ?? 'GLOBAL',
        createdAt: Date.now(),
        confirmToken: payload.confirmToken,
        expiresAt: payload.expiresAt,
        summary: payload.summary,
        mode: payload.mode,
        threadTitle: payload.threadTitle,
        actionType: payload.actionType,
      };
      
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: { threadId: payload.threadId, pending: pendingState },
        });
      } else {
        dispatch({ type: 'SET_GLOBAL_PENDING_ACTION', payload: { pending: pendingState } });
      }
    } else if (kind === 'pending.action.cleared' || kind === 'pending.action.executed') {
      // Clear both possible locations
      dispatch({ type: 'SET_GLOBAL_PENDING_ACTION', payload: { pending: null } });
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
      if (kind === 'pending.action.executed' && payload.threadId) {
        setTimeout(() => navigate(`/chat/${payload.threadId}`), 100);
      }
    }
    
    // Remind need response (P0-1: pendingByThreadId に統合)
    else if (kind === 'remind.need_response.generated') {
      if (payload.threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: {
            threadId: payload.threadId,
            pending: {
              kind: 'remind.need_response',
              threadId: payload.threadId,
              createdAt: Date.now(),
              targetInvitees: payload.targetInvitees,
              count: payload.count,
            },
          },
        });
      }
    } else if (kind === 'remind.need_response.cancelled' || kind === 'remind.need_response.sent') {
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
    }
    
    // PR-D-FE-1: Contact Import pending設定
    else if (kind === 'contact_import.preview') {
      const threadId = currentThreadId || 'temp';
      // preview 結果から pending.contact_import.confirm を設定
      const pending = buildPendingContactImportConfirm(threadId, {
        pending_action_id: payload.pending_action_id,
        source: payload.source || 'text',
        summary: payload.summary,
        parsed_entries: payload.parsed_entries,
        next_pending_kind: payload.next_pending_kind,
      });
      // PR-D-FE-3.1: アップロード時の意図コンテキストをpendingに保存
      if (payload.contact_import_context) {
        (pending as any).contact_import_context = payload.contact_import_context;
      }
      dispatch({
        type: 'SET_PENDING_FOR_THREAD',
        payload: { threadId, pending },
      });
    }
    else if (kind === 'contact_import.person_selected') {
      const threadId = currentThreadId || 'temp';
      if (payload.all_resolved) {
        // 全解決 → reducer内で既存pendingを安全に参照して更新（stale closure回避）
        dispatch({
          type: 'RESOLVE_CONTACT_IMPORT_AMBIGUOUS' as any,
          payload: {
            threadId,
            pending_action_id: payload.pending_action_id,
          },
        });
      }
      // 未解決の場合は pending.person.select を維持（次の曖昧一致へ）
    }
    else if (kind === 'contact_import.confirmed') {
      const threadId = currentThreadId || 'temp';
      // PR-D-FE-3.1: context付きのconfirm完了→次手提示へ
      const importContext = payload.contact_import_context as ContactImportContext | undefined;
      if (importContext && importContext.intent !== 'message_only') {
        // 次手選択 pending をセット（message_onlyの場合は完了のみで次手なし）
        dispatch({
          type: 'SET_POST_IMPORT_NEXT_STEP',
          payload: {
            threadId,
            intent: importContext.intent,
            userMessage: importContext.message,
            importSummary: {
              created_count: payload.created_count,
              updated_count: payload.updated_count,
              skipped_count: payload.skipped_count,
              imported_contacts: payload.imported_contacts || [],
            },
            source: (state.pendingByThreadId[threadId] as any)?.source || 'text',
          },
        });
      } else {
        // contextなし or message_only → pendingクリア
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
      }
    }
    else if (kind === 'contact_import.cancelled') {
      // キャンセル → pending クリア
      const threadId = currentThreadId || 'temp';
      dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
    }
    // PR-D-FE-3.1: 次手選択完了 or キャンセル → pending クリア
    else if (kind === 'post_import.next_step.selected' || kind === 'post_import.next_step.cancelled') {
      const threadId = currentThreadId || 'temp';
      dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
    }
    else if (kind === 'contact_import.expired' || kind === 'contact_import.ambiguous_remaining') {
      // 期限切れ → pending クリア
      if (kind === 'contact_import.expired') {
        const threadId = currentThreadId || 'temp';
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
      }
      // ambiguous_remaining → pending保持（UIは409メッセージ表示のみ）
    }

    // P2-D3: Reschedule (reschedule.pending → 再調整確認待ち)
    else if (kind === 'reschedule.pending') {
      // 元スレッドのIDで pending を保存
      const threadId = payload.originalThreadId ?? currentThreadId;
      if (threadId) {
        dispatch({
          type: 'SET_PENDING_FOR_THREAD',
          payload: {
            threadId,
            pending: {
              kind: 'reschedule.pending',
              threadId,
              createdAt: Date.now(),
              originalThreadId: payload.originalThreadId,
              originalTitle: payload.originalThreadTitle,
              participants: payload.participants,
              suggestedTitle: payload.suggestedTitle,
            },
          },
        });
      }
    } else if (kind === 'reschedule.cancelled') {
      if (currentThreadId) {
        dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId: currentThreadId } });
      }
    }
  }, [currentThreadId, navigate]);

  // P0-1: pendingForThread ヘルパー
  const pendingForThread = currentThreadId 
    ? getPendingForThread(state.pendingByThreadId, currentThreadId)
    : null;

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
    // P0-1: 正規化された pending アクセサ
    pendingForThread,
  };
}

// Re-export types for external use
export type {
  CalendarData,
  MobileTab,
};

// P0-1: PendingState は pendingTypes.ts から re-export
export { getPendingForThread } from '../../core/chat/pendingTypes';
export type { PendingState, PendingKind } from '../../core/chat/pendingTypes';
