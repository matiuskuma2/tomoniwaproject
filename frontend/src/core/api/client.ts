/**
 * API Client
 * Centralized API communication with automatic token injection
 */

import { getToken } from '../auth';
import type { ApiError } from '../models';

// ============================================================
// Configuration
// ============================================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://webapp.snsrilarc.workers.dev';

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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchConfig.headers as Record<string, string>),
  };

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
    throw new Error(errorData.message || errorData.error);
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
};

// ============================================================
// Export API Base URL for OAuth redirects
// ============================================================
export { API_BASE_URL };
