/**
 * Test Route for Rate Limiter (Ticket 04)
 * 
 * DELETE THIS FILE AFTER TESTING
 */

import { Hono } from 'hono';
import { rateLimit, rateLimitPresets } from '../middleware/rateLimit';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * Test endpoint: Rate limit by IP (3 requests per minute)
 * 
 * @route GET /test/rate-limit/ip
 */
app.get(
  '/ip',
  rateLimit({
    action: 'test_ip',
    scope: 'ip',
    max: 3,
    windowSeconds: 60,
  }),
  (c) => {
    return c.json({
      message: 'Request allowed',
      timestamp: Date.now(),
    });
  }
);

/**
 * Test endpoint: Rate limit by email (preset: otp_send)
 * 
 * @route POST /test/rate-limit/otp-send
 * @body { email: string }
 */
app.post('/otp-send', rateLimitPresets.otpSendByEmail(), (c) => {
  return c.json({
    message: 'OTP send allowed',
    timestamp: Date.now(),
  });
});

/**
 * Test endpoint: Rate limit by email (preset: otp_verify)
 * 
 * @route POST /test/rate-limit/otp-verify
 * @body { email: string, otp: string }
 */
app.post('/otp-verify', rateLimitPresets.otpVerify(), (c) => {
  return c.json({
    message: 'OTP verify allowed',
    timestamp: Date.now(),
  });
});

export default app;
