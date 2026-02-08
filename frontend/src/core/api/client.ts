/**
 * API Client
 * Centralized API communication with automatic token injection
 */

import { getToken } from '../auth';
import type { ApiError } from '../models';

// ============================================================
// Configuration
// ============================================================

// Use same-origin (relative paths) for production
// This allows the frontend to call APIs on the same domain (app.tomoniwao.jp)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================
// Types
// ============================================================

interface RequestConfig extends RequestInit {
  skipAuth?: boolean;
}

// ============================================================
// Core Client
// ============================================================

/**
 * Make authenticated API request
 */
async function request<T>(
  endpoint: string,
  config: RequestConfig = {}
): Promise<T> {
  const { skipAuth = false, ...fetchConfig } = config;

  // Build headers
  // PR-D-3: FormDataの場合はContent-Typeを設定しない（ブラウザがboundary付きで自動設定）
  const isFormData = fetchConfig.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(fetchConfig.headers as Record<string, string>),
  };
  // FormDataの場合はContent-Typeを削除（空文字列が設定されている可能性があるため）
  if (isFormData) {
    delete headers['Content-Type'];
  }

  // Add Bearer token if authenticated and not skipped
  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  // Make request
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchConfig,
    headers,
  });

  // Handle errors
  if (!response.ok) {
    const errorData: ApiError = await response.json().catch(() => ({
      error: 'Unknown error',
      message: response.statusText,
    }));
    // ⚠️ エラーメッセージ抽出: ネストされた error オブジェクトも処理
    // バックエンド形式: { success: false, error: { code: '...', message: '...' } }
    let errorMessage: string;
    if (errorData.message && typeof errorData.message === 'string') {
      errorMessage = errorData.message;
    } else if (errorData.error && typeof errorData.error === 'object' && 'message' in errorData.error) {
      errorMessage = (errorData.error as { message: string }).message;
    } else if (typeof errorData.error === 'string') {
      errorMessage = errorData.error;
    } else {
      errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  // Parse response
  return await response.json();
}

// ============================================================
// HTTP Methods
// ============================================================

export const api = {
  get: <T>(endpoint: string, config?: RequestConfig) =>
    request<T>(endpoint, { ...config, method: 'GET' }),

  post: <T>(endpoint: string, data?: any, config?: RequestConfig) =>
    request<T>(endpoint, {
      ...config,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: any, config?: RequestConfig) =>
    request<T>(endpoint, {
      ...config,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: any, config?: RequestConfig) =>
    request<T>(endpoint, {
      ...config,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, config?: RequestConfig) =>
    request<T>(endpoint, { ...config, method: 'DELETE' }),

  /**
   * PR-D-3: POST with FormData (multipart/form-data)
   * Content-Type はブラウザが boundary 付きで自動設定するため省略
   */
  postForm: <T>(endpoint: string, formData: FormData, config?: RequestConfig) =>
    request<T>(endpoint, {
      ...config,
      method: 'POST',
      body: formData,
    }),
};

// ============================================================
// Export API Base URL for OAuth redirects
// ============================================================
export { API_BASE_URL };

// ============================================================
// Error Utilities
// ============================================================

/**
 * Extract readable error message from any error type
 * Handles: Error, string, { message }, { error: { message } }, etc.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    // { message: string }
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    // { error: { message: string } }
    if ('error' in error) {
      const nested = (error as { error: unknown }).error;
      if (nested && typeof nested === 'object' && 'message' in nested) {
        return (nested as { message: string }).message;
      }
      if (typeof nested === 'string') {
        return nested;
      }
    }
  }
  return '不明なエラーが発生しました';
}
