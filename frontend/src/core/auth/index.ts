/**
 * Authentication Management
 * Handles token storage and retrieval
 */

import type { AuthToken, User } from '../models';

const TOKEN_KEY = 'tomoniwao_token';
const USER_KEY = 'tomoniwao_user';

// ============================================================
// Token Management
// ============================================================

/**
 * Set access token
 */
export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

/**
 * Set user info
 */
export function setUser(user: User): void {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Save auth token and user info to sessionStorage
 * Use localStorage for persistent login (future consideration)
 */
export function saveAuth(authToken: AuthToken): void {
  setToken(authToken.access_token);
  if (authToken.user) {
    setUser(authToken.user);
  }
}

/**
 * Get stored access token
 */
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

/**
 * Get stored user info
 */
export function getUser(): User | null {
  const userJson = sessionStorage.getItem(USER_KEY);
  if (!userJson) return null;
  
  try {
    return JSON.parse(userJson);
  } catch {
    return null;
  }
}

/**
 * Clear stored auth data (logout)
 */
export function clearAuth(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return getToken() !== null;
}

// ============================================================
// OAuth Flow Helpers
// ============================================================

/**
 * Redirect to Google OAuth start
 */
export function redirectToLogin(apiBaseUrl: string): void {
  window.location.href = `${apiBaseUrl}/auth/google/start`;
}

/**
 * Exchange OAuth callback for access token
 * This should be called after OAuth callback redirects back to the app
 */
export async function exchangeToken(apiBaseUrl: string): Promise<AuthToken> {
  const response = await fetch(`${apiBaseUrl}/auth/token`, {
    method: 'POST',
    credentials: 'include', // Send cookies
  });

  if (!response.ok) {
    throw new Error('Failed to exchange token');
  }

  return await response.json();
}
