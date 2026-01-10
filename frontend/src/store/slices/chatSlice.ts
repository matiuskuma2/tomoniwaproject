/**
 * Chat Slice - チャットメッセージ状態管理
 * 
 * 責務:
 * - スレッド別メッセージ履歴の管理
 * - メッセージの追加/削除
 * - メモリ制限の管理 (最大20スレッド, 各100メッセージ)
 * - IndexedDB永続化 (Phase 2で実装予定、現在はlocalStorage)
 */

import type { StateCreator } from 'zustand';

// ============================================================
// Types
// ============================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date | string | number;
}

export interface ChatState {
  messagesByThreadId: Record<string, ChatMessage[]>;
  currentThreadId: string | null;
  isProcessing: boolean;
  seededThreads: Set<string>;
}

export interface ChatActions {
  appendMessage: (threadId: string, message: ChatMessage) => void;
  setMessages: (threadId: string, messages: ChatMessage[]) => void;
  clearMessages: (threadId: string) => void;
  setCurrentThread: (threadId: string | null) => void;
  setProcessing: (processing: boolean) => void;
  markThreadSeeded: (threadId: string) => void;
  isThreadSeeded: (threadId: string) => boolean;
  cleanupOldThreads: () => void;
}

export type ChatSlice = ChatState & ChatActions;

// ============================================================
// Constants
// ============================================================

const MAX_THREADS_IN_MEMORY = 20;
const MAX_MESSAGES_PER_THREAD = 100;
const STORAGE_KEY = 'tomoniwao_messages';
const MAX_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB

// ============================================================
// Helpers
// ============================================================

function loadMessages(): Record<string, ChatMessage[]> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    
    const parsed = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[chatSlice] Invalid messages format, clearing');
      localStorage.removeItem(STORAGE_KEY);
      return {};
    }
    
    return parsed;
  } catch (e) {
    console.error('[chatSlice] Failed to load messages:', e);
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function saveMessages(messages: Record<string, ChatMessage[]>): void {
  try {
    const serialized = JSON.stringify(messages);
    
    // サイズチェック
    if (serialized.length > MAX_STORAGE_SIZE) {
      console.warn('[chatSlice] Messages too large, trimming old threads');
      // 最新10スレッドのみ保持
      const threadIds = Object.keys(messages);
      const trimmed: Record<string, ChatMessage[]> = {};
      threadIds.slice(-10).forEach(id => {
        trimmed[id] = messages[id];
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (e) {
    console.error('[chatSlice] Failed to save messages:', e);
  }
}

// ============================================================
// Initial State
// ============================================================

const initialState: ChatState = {
  messagesByThreadId: loadMessages(),
  currentThreadId: null,
  isProcessing: false,
  seededThreads: new Set(),
};

// ============================================================
// Slice Creator
// ============================================================

export const createChatSlice: StateCreator<ChatSlice> = (set, get) => ({
  ...initialState,

  appendMessage: (threadId, message) => {
    set((state) => {
      const messages = state.messagesByThreadId[threadId] || [];
      
      // 最新100件のみ保持
      const newMessages = [...messages, message].slice(-MAX_MESSAGES_PER_THREAD);
      
      const newMessagesByThreadId = {
        ...state.messagesByThreadId,
        [threadId]: newMessages,
      };
      
      // 古いスレッドを削除
      const threadIds = Object.keys(newMessagesByThreadId);
      if (threadIds.length > MAX_THREADS_IN_MEMORY) {
        const oldestThreadId = threadIds[0];
        delete newMessagesByThreadId[oldestThreadId];
        console.log('[chatSlice] Removed oldest thread:', oldestThreadId);
      }
      
      // 永続化 (debounceは後でmiddlewareで実装)
      setTimeout(() => saveMessages(newMessagesByThreadId), 500);
      
      return { messagesByThreadId: newMessagesByThreadId };
    });
  },

  setMessages: (threadId, messages) => {
    set((state) => {
      const newMessagesByThreadId = {
        ...state.messagesByThreadId,
        [threadId]: messages.slice(-MAX_MESSAGES_PER_THREAD),
      };
      
      setTimeout(() => saveMessages(newMessagesByThreadId), 500);
      
      return { messagesByThreadId: newMessagesByThreadId };
    });
  },

  clearMessages: (threadId) => {
    set((state) => {
      const { [threadId]: _, ...rest } = state.messagesByThreadId;
      
      setTimeout(() => saveMessages(rest), 500);
      
      return { messagesByThreadId: rest };
    });
  },

  setCurrentThread: (threadId) => set({ currentThreadId: threadId }),

  setProcessing: (isProcessing) => set({ isProcessing }),

  markThreadSeeded: (threadId) => {
    set((state) => ({
      seededThreads: new Set(state.seededThreads).add(threadId),
    }));
  },

  isThreadSeeded: (threadId) => {
    return get().seededThreads.has(threadId);
  },

  cleanupOldThreads: () => {
    set((state) => {
      const threadIds = Object.keys(state.messagesByThreadId);
      if (threadIds.length <= MAX_THREADS_IN_MEMORY) return state;
      
      const newMessagesByThreadId: Record<string, ChatMessage[]> = {};
      threadIds.slice(-MAX_THREADS_IN_MEMORY).forEach(id => {
        newMessagesByThreadId[id] = state.messagesByThreadId[id];
      });
      
      setTimeout(() => saveMessages(newMessagesByThreadId), 500);
      
      return { messagesByThreadId: newMessagesByThreadId };
    });
  },
});
