/**
 * OTP API Routes (Ticket 05)
 * 
 * Endpoints for OTP generation and verification.
 * Rate limited by email address.
 */

import { Hono } from 'hono';
import { OTPService } from '../services/otpService';
import { rateLimitPresets } from '../middleware/rateLimit';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * Generate OTP and send via email
 * 
 * @route POST /api/otp/send
 * @body { email: string, purpose: string }
 * @ratelimit 3 per hour by email
 */
app.post('/send', rateLimitPresets.otpSend(), async (c) => {
  const { env } = c;
  
  try {
    const body = await c.req.json();
    const { email, purpose } = body;

    // Validate input
    if (!email || !purpose) {
      return c.json(
        { error: 'Missing required fields: email, purpose' },
        400
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    // Validate purpose
    const validPurposes = ['email_verify', 'password_reset', 'invite_accept', 'login'];
    if (!validPurposes.includes(purpose)) {
      return c.json({ error: 'Invalid purpose' }, 400);
    }

    // Generate OTP
    const otpService = new OTPService(env.OTP_STORE, env.ANALYTICS);
    const { code, token } = await otpService.generateWithLookup({
      email,
      purpose,
    });

    // TODO: Queue email sending job (Ticket 06)
    // For now, return code in response (DEV ONLY)
    const isDev = env.ENVIRONMENT === 'development';

    return c.json({
      message: 'OTP sent successfully',
      expires_in: 600, // 10 minutes
      ...(isDev ? { code, token } : {}), // Only in dev
    });
  } catch (error) {
    console.error('[OTP] Error generating OTP:', error);
    return c.json(
      { error: 'Failed to generate OTP' },
      500
    );
  }
});

/**
 * Verify OTP code
 * 
 * @route POST /api/otp/verify
 * @body { email: string, purpose: string, code: string }
 * @ratelimit 5 per 10 minutes by email
 */
app.post('/verify', rateLimitPresets.otpVerify(), async (c) => {
  const { env } = c;
  
  try {
    const body = await c.req.json();
    const { email, purpose, code } = body;

    // Validate input
    if (!email || !purpose || !code) {
      return c.json(
        { error: 'Missing required fields: email, purpose, code' },
        400
      );
    }

    // Verify OTP
    const otpService = new OTPService(env.OTP_STORE, env.ANALYTICS);
    const result = await otpService.verify({
      email,
      purpose,
      code,
    });

    if (!result.valid) {
      return c.json(
        {
          error: result.error,
          remaining_attempts: result.remainingAttempts,
        },
        400
      );
    }

    // Success
    return c.json({
      message: 'OTP verified successfully',
      verified: true,
    });
  } catch (error) {
    console.error('[OTP] Error verifying OTP:', error);
    return c.json(
      { error: 'Failed to verify OTP' },
      500
    );
  }
});

/**
 * Health check for OTP service
 * 
 * @route GET /api/otp/health
 */
app.get('/health', async (c) => {
  const { env } = c;
  
  try {
    // Test KV access
    await env.OTP_STORE.get('health-check');
    
    return c.json({
      status: 'ok',
      service: 'otp',
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[OTP] Health check failed:', error);
    return c.json(
      { status: 'error', service: 'otp' },
      500
    );
  }
});

export default app;
