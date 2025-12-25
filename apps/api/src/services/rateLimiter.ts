/**
 * Rate Limiter Service (Ticket 04)
 * 
 * Uses Cloudflare KV (RATE_LIMIT) for rate limiting.
 * Logs violations to D1 (rate_limit_logs).
 * 
 * Key Format: rl:{action}:{scope}:{id}:{bucket}
 * 
 * Actions:
 * - otp_send: Limit OTP sending per email
 * - otp_try: Limit OTP verification attempts
 * - invite_create: Limit relationship invite creation
 * - voice_execute: Limit voice command execution
 * 
 * Scopes:
 * - ip: By IP address
 * - user: By user_id
 * - email: By email address
 */

export interface RateLimitConfig {
  action: string;
  scope: 'ip' | 'user' | 'email';
  identifier: string;
  max: number;           // Max requests per window
  windowSeconds: number; // Time window in seconds
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp
}

export class RateLimiterService {
  constructor(
    private readonly kv: KVNamespace,
    private readonly db: D1Database,
    private readonly analytics?: AnalyticsEngineDataset
  ) {}

  /**
   * Check if action is allowed under rate limit
   */
  async checkLimit(config: RateLimitConfig): Promise<RateLimitResult> {
    const now = Date.now();
    const bucket = Math.floor(now / (config.windowSeconds * 1000));
    const key = this.buildKey(config, bucket);

    try {
      // Get current count from KV
      const currentValue = await this.kv.get(key);
      const current = currentValue ? parseInt(currentValue, 10) : 0;

      const remaining = Math.max(0, config.max - current);
      const resetAt = (bucket + 1) * config.windowSeconds;

      if (current >= config.max) {
        // Rate limit exceeded - log violation
        await this.logViolation(config, current);

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        };
      }

      // Increment counter
      const newCount = current + 1;
      await this.kv.put(key, newCount.toString(), {
        expirationTtl: config.windowSeconds * 2, // Keep for 2 windows for safety
      });

      // Track analytics
      if (this.analytics) {
        this.analytics.writeDataPoint({
          blobs: [config.action, config.scope, config.identifier],
          doubles: [newCount],
          indexes: [`rate_limit_${config.action}`],
        });
      }

      return {
        allowed: true,
        remaining: remaining - 1,
        resetAt,
      };
    } catch (error) {
      console.error('[RateLimiter] Error checking limit:', error);
      // Fail open (allow request) to prevent service disruption
      return {
        allowed: true,
        remaining: config.max - 1,
        resetAt: (bucket + 1) * config.windowSeconds,
      };
    }
  }

  /**
   * Log rate limit violation to D1
   * Adapts to existing rate_limit_logs schema:
   * (id, user_id, ip_address, endpoint, hit_count, window_start_at, window_end_at, is_blocked, created_at)
   */
  private async logViolation(config: RateLimitConfig, count: number): Promise<void> {
    try {
      const now = Date.now();
      const bucket = Math.floor(now / (config.windowSeconds * 1000));
      const windowStart = new Date(bucket * config.windowSeconds * 1000).toISOString();
      const windowEnd = new Date((bucket + 1) * config.windowSeconds * 1000).toISOString();

      // Map scope to user_id/ip_address
      let userId: string | null = null;
      let ipAddress: string | null = null;
      if (config.scope === 'user') {
        userId = config.identifier;
      } else if (config.scope === 'ip') {
        ipAddress = config.identifier;
      } else if (config.scope === 'email') {
        // Store email in ip_address column (flexible schema)
        ipAddress = config.identifier;
      }

      await this.db
        .prepare(
          `INSERT INTO rate_limit_logs (
            id, user_id, ip_address, endpoint,
            hit_count, window_start_at, window_end_at, is_blocked,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`
        )
        .bind(
          crypto.randomUUID(),
          userId,
          ipAddress,
          config.action, // Use action as endpoint
          count,
          windowStart,
          windowEnd
        )
        .run();
    } catch (error) {
      console.error('[RateLimiter] Error logging violation:', error);
      // Don't throw - logging failure shouldn't break the request
    }
  }

  /**
   * Build KV key for rate limiting
   */
  private buildKey(config: RateLimitConfig, bucket: number): string {
    return `rl:${config.action}:${config.scope}:${config.identifier}:${bucket}`;
  }

  /**
   * Preset configurations for common actions
   * (Aligned with frozen specification docs/15)
   */
  static configs = {
    otp_send_email: {
      max: 3,
      windowSeconds: 600, // 3 requests per 10 minutes (by email)
    },
    otp_send_ip: {
      max: 10,
      windowSeconds: 600, // 10 requests per 10 minutes (by IP)
    },
    otp_try: {
      max: 5,
      windowSeconds: 600, // 5 attempts per 10 minutes (by token/email)
    },
    invite_create_user: {
      max: 5,
      windowSeconds: 60, // 5 invites per minute (by user)
    },
    invite_create_ip: {
      max: 20,
      windowSeconds: 60, // 20 invites per minute (by IP)
    },
    voice_execute_user: {
      max: 20,
      windowSeconds: 60, // 20 commands per minute (by user, Free plan: 10/min)
    },
    voice_execute_user_free: {
      max: 10,
      windowSeconds: 60, // 10 commands per minute (by user, Free plan)
    },
  } as const;
}

/**
 * Helper to extract client IP from Hono context
 */
export function getClientIP(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}
