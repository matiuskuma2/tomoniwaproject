/**
 * Rate Limit Middleware (Ticket 04)
 * 
 * Applies rate limiting to API routes.
 * Returns 429 Too Many Requests if limit exceeded.
 */

import { Context, Next } from 'hono';
import { RateLimiterService, getClientIP } from '../services/rateLimiter';

type Bindings = {
  RATE_LIMIT: KVNamespace;
  DB: D1Database;
  ANALYTICS?: AnalyticsEngineDataset;
};

export interface RateLimitOptions {
  action: string;
  scope: 'ip' | 'user' | 'email';
  max: number;
  windowSeconds: number;
  identifierExtractor?: (c: Context) => string | Promise<string>;
}

/**
 * Create rate limit middleware
 * 
 * @example
 * ```ts
 * // Limit by IP
 * app.post('/api/otp/send', 
 *   rateLimit({ action: 'otp_send', scope: 'ip', max: 3, windowSeconds: 3600 }),
 *   async (c) => { ... }
 * );
 * 
 * // Limit by user
 * app.post('/api/voice/execute', 
 *   rateLimit({ 
 *     action: 'voice_execute', 
 *     scope: 'user', 
 *     max: 100, 
 *     windowSeconds: 3600,
 *     identifierExtractor: (c) => c.get('user_id')
 *   }),
 *   async (c) => { ... }
 * );
 * ```
 */
export function rateLimit(options: RateLimitOptions) {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    const { env } = c;
    const rateLimiter = new RateLimiterService(
      env.RATE_LIMIT,
      env.DB,
      env.ANALYTICS
    );

    // Extract identifier
    let identifier: string;
    if (options.identifierExtractor) {
      identifier = await options.identifierExtractor(c);
    } else if (options.scope === 'ip') {
      identifier = getClientIP(c.req.raw.headers);
    } else {
      // Default: try to get from context
      identifier = (c.get(options.scope as any) as string) || 'unknown';
    }

    // Check rate limit
    const result = await rateLimiter.checkLimit({
      action: options.action,
      scope: options.scope,
      identifier,
      max: options.max,
      windowSeconds: options.windowSeconds,
    });

    // Set rate limit headers
    c.header('X-RateLimit-Limit', options.max.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetAt.toString());

    if (!result.allowed) {
      return c.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded for ${options.action}. Try again later.`,
          reset_at: result.resetAt,
        },
        429
      );
    }

    await next();
  };
}

/**
 * Preset rate limit middleware for common actions
 * (Aligned with frozen specification docs/15)
 */
export const rateLimitPresets = {
  /**
   * OTP send rate limit (3 per 10 minutes by email)
   */
  otpSendByEmail: () =>
    rateLimit({
      action: 'otp_send',
      scope: 'email',
      max: RateLimiterService.configs.otp_send_email.max,
      windowSeconds: RateLimiterService.configs.otp_send_email.windowSeconds,
      identifierExtractor: async (c) => {
        const body = await c.req.json();
        return body.email || 'unknown';
      },
    }),

  /**
   * OTP send rate limit (10 per 10 minutes by IP)
   */
  otpSendByIP: () =>
    rateLimit({
      action: 'otp_send_ip',
      scope: 'ip',
      max: RateLimiterService.configs.otp_send_ip.max,
      windowSeconds: RateLimiterService.configs.otp_send_ip.windowSeconds,
    }),

  /**
   * OTP verification rate limit (5 per 10 minutes by email)
   */
  otpVerify: () =>
    rateLimit({
      action: 'otp_try',
      scope: 'email',
      max: RateLimiterService.configs.otp_try.max,
      windowSeconds: RateLimiterService.configs.otp_try.windowSeconds,
      identifierExtractor: async (c) => {
        const body = await c.req.json();
        return body.email || 'unknown';
      },
    }),

  /**
   * Invite creation rate limit (5 per minute by user)
   */
  inviteCreateByUser: () =>
    rateLimit({
      action: 'invite_create',
      scope: 'user',
      max: RateLimiterService.configs.invite_create_user.max,
      windowSeconds: RateLimiterService.configs.invite_create_user.windowSeconds,
      identifierExtractor: (c) => c.get('user_id') || 'unknown',
    }),

  /**
   * Invite creation rate limit (20 per minute by IP)
   */
  inviteCreateByIP: () =>
    rateLimit({
      action: 'invite_create_ip',
      scope: 'ip',
      max: RateLimiterService.configs.invite_create_ip.max,
      windowSeconds: RateLimiterService.configs.invite_create_ip.windowSeconds,
    }),

  /**
   * Voice command rate limit (20 per minute by user, standard plan)
   */
  voiceExecuteByUser: () =>
    rateLimit({
      action: 'voice_execute',
      scope: 'user',
      max: RateLimiterService.configs.voice_execute_user.max,
      windowSeconds: RateLimiterService.configs.voice_execute_user.windowSeconds,
      identifierExtractor: (c) => c.get('user_id') || 'unknown',
    }),

  /**
   * Voice command rate limit (10 per minute by user, free plan)
   */
  voiceExecuteByUserFree: () =>
    rateLimit({
      action: 'voice_execute',
      scope: 'user',
      max: RateLimiterService.configs.voice_execute_user_free.max,
      windowSeconds: RateLimiterService.configs.voice_execute_user_free.windowSeconds,
      identifierExtractor: (c) => c.get('user_id') || 'unknown',
    }),
};
