/**
 * env.ts
 * P1-2: Environment adapter (Web/Native ready)
 *
 * RULE:
 * - Do not read import.meta.env / process.env directly in app code.
 * - Always read via this module.
 */

export type AppEnvName = 'development' | 'staging' | 'production';

export type AppEnv = {
  name: AppEnvName;
  apiBaseUrl: string;            // e.g. https://webapp.snsrilarc.workers.dev
  appBaseUrl: string;            // e.g. https://app.tomoniwao.jp
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableDebugPanel: boolean;
  cacheDebug: boolean;           // cache hit/miss logs
};

// safe boolean parser
function bool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return fallback;
  const s = v.toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function normalizeEnvName(v: string): AppEnvName {
  if (v === 'production' || v === 'staging' || v === 'development') return v;
  return 'development';
}

/**
 * Web env reader: import.meta.env が基本
 * Native化時はここを差し替え（e.g. react-native-config）
 */
function readWebEnv(): Partial<AppEnv> & { name?: string } {
  // Vite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaEnv: any = (import.meta as any)?.env || {};
  return {
    name: metaEnv.MODE,
    apiBaseUrl: metaEnv.VITE_API_BASE_URL,
    appBaseUrl: metaEnv.VITE_APP_BASE_URL,
    logLevel: metaEnv.VITE_LOG_LEVEL,
    enableDebugPanel: metaEnv.VITE_ENABLE_DEBUG_PANEL,
    cacheDebug: metaEnv.VITE_CACHE_DEBUG,
  };
}

function validateUrl(label: string, url: string): string {
  if (!url) return url; // allow empty (use defaults elsewhere)
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith('http')) throw new Error('invalid protocol');
    return url;
  } catch {
    // fail-safe (do not crash UI)
    console.warn(`[env] Invalid ${label}:`, url);
    return url;
  }
}

let cachedEnv: AppEnv | null = null;

/**
 * Get resolved app environment (memoized)
 */
export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const raw = readWebEnv();
  const name = normalizeEnvName(str(raw.name, 'development'));

  const env: AppEnv = {
    name,
    apiBaseUrl: validateUrl('apiBaseUrl', str(raw.apiBaseUrl, '')),
    appBaseUrl: validateUrl('appBaseUrl', str(raw.appBaseUrl, '')),
    logLevel: (str(raw.logLevel, name === 'production' ? 'warn' : 'debug') as AppEnv['logLevel']),
    enableDebugPanel: bool(raw.enableDebugPanel, false),
    cacheDebug: bool(raw.cacheDebug, name !== 'production'),
  };

  cachedEnv = env;
  return env;
}

/**
 * Check if current environment is production
 */
export function isProduction(): boolean {
  return getEnv().name === 'production';
}

/**
 * Check if current environment is development
 */
export function isDevelopment(): boolean {
  return getEnv().name === 'development';
}
