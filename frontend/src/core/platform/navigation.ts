/**
 * Navigation Adapter
 * P1-C: Abstraction layer for React Router (Web) / React Navigation (Native)
 * 
 * Purpose:
 * - Provide a unified interface for navigation
 * - Enable seamless migration from Web to Native
 * - Centralize route management
 * 
 * Routes:
 * - /chat/:threadId? - Main chat view
 * - /settings - Settings page (timezone)
 * - /settings/billing - Billing settings
 * - /contacts - Contacts management
 * - /lists - Lists management
 * - /threads/:id - Thread detail (legacy, redirects to /chat/:id)
 */

// Route definitions
export const ROUTES = {
  HOME: '/',
  CHAT: '/chat',
  CHAT_THREAD: (threadId: string) => `/chat/${threadId}`,
  SETTINGS: '/settings',
  SETTINGS_BILLING: '/settings/billing',
  CONTACTS: '/contacts',
  LISTS: '/lists',
  THREAD_DETAIL: (threadId: string) => `/threads/${threadId}`,
  LOGIN: '/login',
} as const;

// Navigation action types
export type NavigationAction = 
  | { type: 'push'; path: string }
  | { type: 'replace'; path: string }
  | { type: 'back' }
  | { type: 'reset'; path: string };

// Navigation interface
export interface NavigationAdapter {
  navigate(path: string): void;
  replace(path: string): void;
  goBack(): void;
  reset(path: string): void;
  getCurrentPath(): string;
  getParams(): Record<string, string | undefined>;
}

/**
 * Web Navigation Adapter (React Router)
 * Uses window.location and history API
 * Note: Actual implementation uses React Router hooks in components
 */
class WebNavigationAdapter implements NavigationAdapter {
  navigate(path: string): void {
    // In actual usage, use React Router's useNavigate hook
    // This is a fallback for non-React contexts
    window.location.href = path;
  }

  replace(path: string): void {
    window.history.replaceState(null, '', path);
    // Trigger React Router to pick up the change
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  goBack(): void {
    window.history.back();
  }

  reset(path: string): void {
    // For web, reset is equivalent to replace
    this.replace(path);
  }

  getCurrentPath(): string {
    return window.location.pathname;
  }

  getParams(): Record<string, string | undefined> {
    // Parse URL params (basic implementation)
    const params: Record<string, string | undefined> = {};
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
    // Also try to extract path params (e.g., /chat/:threadId)
    const pathMatch = window.location.pathname.match(/\/chat\/([^/]+)/);
    if (pathMatch) {
      params.threadId = pathMatch[1];
    }
    return params;
  }
}

// Singleton instance
let navigationInstance: NavigationAdapter | null = null;

export function getNavigation(): NavigationAdapter {
  if (!navigationInstance) {
    // Currently only web is supported
    navigationInstance = new WebNavigationAdapter();
  }
  return navigationInstance;
}

// Convenience wrapper
export const navigation = {
  to: (path: string) => getNavigation().navigate(path),
  replace: (path: string) => getNavigation().replace(path),
  back: () => getNavigation().goBack(),
  reset: (path: string) => getNavigation().reset(path),
  path: () => getNavigation().getCurrentPath(),
  params: () => getNavigation().getParams(),
};

/**
 * Helper: Build chat route with optional thread ID
 */
export function buildChatRoute(threadId?: string): string {
  return threadId ? ROUTES.CHAT_THREAD(threadId) : ROUTES.CHAT;
}

/**
 * Helper: Check if current route is a chat route
 */
export function isChatRoute(path: string): boolean {
  return path === ROUTES.CHAT || path.startsWith('/chat/');
}

/**
 * Helper: Extract thread ID from chat route
 */
export function extractThreadIdFromPath(path: string): string | undefined {
  const match = path.match(/\/chat\/([^/?]+)/);
  return match ? match[1] : undefined;
}
