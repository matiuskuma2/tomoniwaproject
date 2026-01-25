/**
 * Workers-friendly Logger with LOG_LEVEL support
 * 
 * Purpose: Reduce log volume in production for 1000+ concurrent connections
 * 
 * Usage:
 *   import { createLogger } from './utils/logger';
 *   const log = createLogger(env, { module: 'MyModule' });
 *   log.debug('detailed info', { data });  // Only in development
 *   log.info('normal operation');          // Development + staging
 *   log.warn('warning condition');         // Always (except silent)
 *   log.error('error occurred', error);    // Always (except silent)
 * 
 * LOG_LEVEL values (from most verbose to least):
 *   - debug: All logs (development)
 *   - info: info, warn, error (default for non-production)
 *   - warn: warn, error only (recommended for production)
 *   - error: error only
 *   - silent: No logs (testing)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

/**
 * Normalize LOG_LEVEL string to valid LogLevel
 */
function normalizeLevel(level?: string | null): LogLevel {
  const v = (level || '').toLowerCase().trim();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error' || v === 'silent') {
    return v;
  }
  return 'info'; // Default fallback
}

/**
 * Check if a log level should be output given the configured level
 */
function shouldLog(configured: LogLevel, level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configured];
}

/**
 * Resolve the effective log level from environment
 * Production defaults to 'warn' to prevent log flooding
 */
export function resolveLogLevel(env: { ENVIRONMENT?: string; LOG_LEVEL?: string }): LogLevel {
  // If LOG_LEVEL is explicitly set, use it
  if (env.LOG_LEVEL) {
    return normalizeLevel(env.LOG_LEVEL);
  }
  
  // Default: production → warn, others → info
  const isProduction = (env.ENVIRONMENT || '').toLowerCase() === 'production';
  return isProduction ? 'warn' : 'info';
}

export interface Logger {
  level: LogLevel;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface LoggerOptions {
  module?: string;
}

/**
 * Create a logger instance bound to the current environment
 * 
 * @param env - Workers environment (must contain ENVIRONMENT and optionally LOG_LEVEL)
 * @param opts - Optional configuration (module name for prefix)
 */
export function createLogger(
  env: { ENVIRONMENT?: string; LOG_LEVEL?: string },
  opts?: LoggerOptions
): Logger {
  const configured = resolveLogLevel(env);
  const module = opts?.module;

  const prefix = (level: string) => {
    const timestamp = new Date().toISOString();
    return module 
      ? `[${timestamp}] [${level}] [${module}]`
      : `[${timestamp}] [${level}]`;
  };

  return {
    level: configured,

    debug(message: string, meta?: unknown) {
      if (!shouldLog(configured, 'debug')) return;
      if (meta === undefined) {
        console.log(prefix('DEBUG'), message);
      } else {
        console.log(prefix('DEBUG'), message, meta);
      }
    },

    info(message: string, meta?: unknown) {
      if (!shouldLog(configured, 'info')) return;
      if (meta === undefined) {
        console.log(prefix('INFO'), message);
      } else {
        console.log(prefix('INFO'), message, meta);
      }
    },

    warn(message: string, meta?: unknown) {
      if (!shouldLog(configured, 'warn')) return;
      if (meta === undefined) {
        console.warn(prefix('WARN'), message);
      } else {
        console.warn(prefix('WARN'), message, meta);
      }
    },

    error(message: string, meta?: unknown) {
      // error is always logged (except when silent)
      if (!shouldLog(configured, 'error')) return;
      if (meta === undefined) {
        console.error(prefix('ERROR'), message);
      } else {
        console.error(prefix('ERROR'), message, meta);
      }
    },
  };
}

/**
 * Quick check if debug logging is enabled
 * Useful for avoiding expensive string operations when debug is off
 */
export function isDebugEnabled(env: { ENVIRONMENT?: string; LOG_LEVEL?: string }): boolean {
  return resolveLogLevel(env) === 'debug';
}
