/**
 * log.ts
 * P1-2: Structured logger (Web/Native ready)
 *
 * RULE:
 * - Avoid console.log directly in app code.
 * - Use this logger with context.
 * 
 * Usage:
 * import { log } from '../platform';
 * log.debug('Cache hit', { module: 'StatusCache', threadId });
 * log.warn('Refresh failed', { module: 'refreshAfterWrite', writeOp, err });
 */

import { getEnv } from './env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  module?: string;
  threadId?: string;
  intent?: string;
  writeOp?: string;
  userId?: string;
  age?: number;
  [k: string]: unknown;
};

function levelRank(level: LogLevel): number {
  return { debug: 10, info: 20, warn: 30, error: 40 }[level];
}

function shouldLog(level: LogLevel): boolean {
  const env = getEnv();
  return levelRank(level) >= levelRank(env.logLevel);
}

function basePayload(level: LogLevel, message: string, ctx?: LogContext) {
  const env = getEnv();
  return {
    ts: new Date().toISOString(),
    level,
    env: env.name,
    message,
    ...ctx,
  };
}

export const log = {
  /**
   * Debug level - development only by default
   * For cache HIT/MISS, detailed flow tracing
   */
  debug(message: string, ctx?: LogContext) {
    if (!shouldLog('debug')) return;
    console.debug(basePayload('debug', message, ctx));
  },

  /**
   * Info level - general information
   * For operation completion, state changes
   */
  info(message: string, ctx?: LogContext) {
    if (!shouldLog('info')) return;
    console.info(basePayload('info', message, ctx));
  },

  /**
   * Warn level - non-fatal issues
   * For refresh failures, validation warnings
   * UIは壊さないが運用で追跡が必要なもの
   */
  warn(message: string, ctx?: LogContext) {
    if (!shouldLog('warn')) return;
    console.warn(basePayload('warn', message, ctx));
  },

  /**
   * Error level - serious issues
   * For API failures, persistence errors
   * 将来 Sentry 等に送る候補
   */
  error(message: string, ctx?: LogContext & { err?: unknown }) {
    if (!shouldLog('error')) return;
    const payload = basePayload('error', message, ctx);
    // attach error in a safe way
    const err = ctx?.err;
    if (err instanceof Error) {
      (payload as Record<string, unknown>).errMessage = err.message;
      (payload as Record<string, unknown>).errStack = err.stack?.split('\n').slice(0, 8).join('\n');
    } else if (err) {
      (payload as Record<string, unknown>).err = err;
    }
    console.error(payload);
  },

  /**
   * Cache-specific debug (only when cacheDebug is enabled)
   */
  cacheDebug(message: string, ctx?: LogContext) {
    const env = getEnv();
    if (!env.cacheDebug) return;
    this.debug(message, ctx);
  },
};
