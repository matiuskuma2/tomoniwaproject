/**
 * Pending Slice - 保留アクション状態管理
 * 
 * 責務:
 * - Beta A: 送信確認フロー (pendingAction)
 * - Phase Next-5: Auto-propose フロー
 * - Phase Next-6: Remind/Notify/Split フロー
 */

import type { StateCreator } from 'zustand';

// ============================================================
// Types
// ============================================================

/** Beta A: 送信確認用 */
export interface PendingAction {
  confirmToken: string;
  expiresAt: string;
  summary: {
    total_count: number;
    valid_count: number;
    preview: Array<{
      email: string;
      display_name?: string;
      is_app_user: boolean;
    }>;
    skipped: {
      invalid_email: number;
      duplicate_input: number;
      missing_email: number;
      already_invited: number;
    };
  };
  mode: 'new_thread' | 'add_to_thread';
  threadId?: string;
  threadTitle?: string;
}

/** Phase Next-5: Auto-propose */
export interface PendingAutoPropose {
  emails: string[];
  duration: number;
  range: string;
  proposals: Array<{ start_at: string; end_at: string; label: string }>;
}

/** Phase Next-6: Remind */
export interface PendingRemind {
  threadId: string;
  pendingInvites: Array<{ email: string; name?: string }>;
  count: number;
}

/** Phase Next-6: Notify */
export interface PendingNotify {
  threadId: string;
  invites: Array<{ email: string; name?: string }>;
  finalSlot: { start_at: string; end_at: string; label?: string };
  meetingUrl?: string;
}

/** Phase Next-6: Split */
export interface PendingSplit {
  threadId: string;
}

// ============================================================
// State & Actions
// ============================================================

export interface PendingState {
  // Beta A
  pendingAction: PendingAction | null;
  
  // Phase Next-5
  pendingAutoPropose: PendingAutoPropose | null;
  additionalProposeCountByThreadId: Record<string, number>;
  
  // Phase Next-6
  pendingRemindByThreadId: Record<string, PendingRemind | null>;
  remindCountByThreadId: Record<string, number>;
  pendingNotifyByThreadId: Record<string, PendingNotify | null>;
  pendingSplitByThreadId: Record<string, PendingSplit | null>;
}

export interface PendingActions {
  // Beta A
  setPendingAction: (action: PendingAction | null) => void;
  clearPendingAction: () => void;
  
  // Phase Next-5
  setPendingAutoPropose: (propose: PendingAutoPropose | null) => void;
  incrementAdditionalProposeCount: (threadId: string) => void;
  getAdditionalProposeCount: (threadId: string) => number;
  
  // Phase Next-6
  setPendingRemind: (threadId: string, remind: PendingRemind | null) => void;
  incrementRemindCount: (threadId: string) => void;
  getRemindCount: (threadId: string) => number;
  setPendingNotify: (threadId: string, notify: PendingNotify | null) => void;
  setPendingSplit: (threadId: string, split: PendingSplit | null) => void;
  
  // Utility
  clearAllPending: () => void;
}

export type PendingSlice = PendingState & PendingActions;

// ============================================================
// Initial State
// ============================================================

const initialState: PendingState = {
  pendingAction: null,
  pendingAutoPropose: null,
  additionalProposeCountByThreadId: {},
  pendingRemindByThreadId: {},
  remindCountByThreadId: {},
  pendingNotifyByThreadId: {},
  pendingSplitByThreadId: {},
};

// ============================================================
// Slice Creator
// ============================================================

export const createPendingSlice: StateCreator<PendingSlice> = (set, get) => ({
  ...initialState,

  // Beta A
  setPendingAction: (pendingAction) => set({ pendingAction }),
  clearPendingAction: () => set({ pendingAction: null }),

  // Phase Next-5
  setPendingAutoPropose: (pendingAutoPropose) => set({ pendingAutoPropose }),
  
  incrementAdditionalProposeCount: (threadId) => {
    set((state) => ({
      additionalProposeCountByThreadId: {
        ...state.additionalProposeCountByThreadId,
        [threadId]: (state.additionalProposeCountByThreadId[threadId] || 0) + 1,
      },
    }));
  },
  
  getAdditionalProposeCount: (threadId) => {
    return get().additionalProposeCountByThreadId[threadId] || 0;
  },

  // Phase Next-6
  setPendingRemind: (threadId, remind) => {
    set((state) => ({
      pendingRemindByThreadId: {
        ...state.pendingRemindByThreadId,
        [threadId]: remind,
      },
    }));
  },
  
  incrementRemindCount: (threadId) => {
    set((state) => ({
      remindCountByThreadId: {
        ...state.remindCountByThreadId,
        [threadId]: (state.remindCountByThreadId[threadId] || 0) + 1,
      },
    }));
  },
  
  getRemindCount: (threadId) => {
    return get().remindCountByThreadId[threadId] || 0;
  },
  
  setPendingNotify: (threadId, notify) => {
    set((state) => ({
      pendingNotifyByThreadId: {
        ...state.pendingNotifyByThreadId,
        [threadId]: notify,
      },
    }));
  },
  
  setPendingSplit: (threadId, split) => {
    set((state) => ({
      pendingSplitByThreadId: {
        ...state.pendingSplitByThreadId,
        [threadId]: split,
      },
    }));
  },

  // Utility
  clearAllPending: () => set(initialState),
});
