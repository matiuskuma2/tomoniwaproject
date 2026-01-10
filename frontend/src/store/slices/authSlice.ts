/**
 * Auth Slice - 認証状態管理
 * 
 * 責務:
 * - ログイン状態の管理
 * - トークンの保存/取得
 * - ユーザー情報の管理
 */

import type { StateCreator } from 'zustand';

// ============================================================
// Types
// ============================================================

export interface User {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface AuthActions {
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  login: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export type AuthSlice = AuthState & AuthActions;

// ============================================================
// Storage Keys (sessionStorage)
// ============================================================

const TOKEN_KEY = 'tomoniwao_token';
const USER_KEY = 'tomoniwao_user';

// ============================================================
// Helpers
// ============================================================

function loadToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function loadUser(): User | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch (e) {
    console.error('[authSlice] Failed to save token:', e);
  }
}

function saveUser(user: User): void {
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {
    console.error('[authSlice] Failed to save user:', e);
  }
}

function clearStorage(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch (e) {
    console.error('[authSlice] Failed to clear storage:', e);
  }
}

// ============================================================
// Initial State
// ============================================================

const initialToken = loadToken();
const initialUser = loadUser();

const initialState: AuthState = {
  token: initialToken,
  user: initialUser,
  isAuthenticated: !!initialToken,
  isLoading: false,
};

// ============================================================
// Slice Creator
// ============================================================

export const createAuthSlice: StateCreator<AuthSlice> = (set) => ({
  ...initialState,

  setToken: (token) => {
    saveToken(token);
    set({ token, isAuthenticated: true });
  },

  setUser: (user) => {
    saveUser(user);
    set({ user });
  },

  login: (token, user) => {
    saveToken(token);
    saveUser(user);
    set({ token, user, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    clearStorage();
    set({ token: null, user: null, isAuthenticated: false });
  },

  setLoading: (isLoading) => set({ isLoading }),
});
