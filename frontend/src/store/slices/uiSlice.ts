/**
 * UI Slice - UI状態管理
 * 
 * 責務:
 * - モバイルタブ状態
 * - モーダル表示状態
 * - グローバルエラー表示
 */

import type { StateCreator } from 'zustand';

// ============================================================
// Types
// ============================================================

export type MobileTab = 'threads' | 'chat' | 'cards';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

export interface UIState {
  mobileTab: MobileTab;
  isModalOpen: boolean;
  modalContent: React.ReactNode | null;
  toasts: Toast[];
}

export interface UIActions {
  setMobileTab: (tab: MobileTab) => void;
  openModal: (content: React.ReactNode) => void;
  closeModal: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export type UISlice = UIState & UIActions;

// ============================================================
// Initial State
// ============================================================

const initialState: UIState = {
  mobileTab: 'threads',
  isModalOpen: false,
  modalContent: null,
  toasts: [],
};

// ============================================================
// Slice Creator
// ============================================================

export const createUISlice: StateCreator<UISlice> = (set) => ({
  ...initialState,

  setMobileTab: (mobileTab) => set({ mobileTab }),

  openModal: (modalContent) => set({ isModalOpen: true, modalContent }),

  closeModal: () => set({ isModalOpen: false, modalContent: null }),

  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const duration = toast.duration ?? 5000;
    
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    
    // 自動削除
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearToasts: () => set({ toasts: [] }),
});
