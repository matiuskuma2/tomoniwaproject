/**
 * Test Route for Email Consumer (Ticket 06)
 * 
 * Manual trigger for email consumer testing in development.
 * DELETE THIS FILE AFTER TESTING
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { EmailJob } from '../services/emailQueue';

const app = new Hono<{ Bindings: Env }>();

/**
 * Manually trigger email consumer for one message
 * 
 * @route POST /test/email-consumer/run-once
 * @body { email: string, code: string, purpose: string }
 */
app.post('/run-once', async (c) => {
  const { env } = c;

  // Only allow in development
  if (env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Only available in development' }, 403);
  }

  try {
    const body = await c.req.json();
    const { email, code, purpose } = body;

    if (!email || !code || !purpose) {
      return c.json(
        { error: 'Missing required fields: email, code, purpose' },
        400
      );
    }

    // Create mock OTP email job
    const mockJob: EmailJob = {
      job_id: crypto.randomUUID(),
      type: 'otp',
      to: email,
      subject: 'Test OTP Email',
      created_at: Date.now(),
      data: {
        code,
        purpose,
        expires_in: 600,
      },
    };

    // Manually import and run consumer logic
    const { default: emailConsumer } = await import('../queue/emailConsumer');
    
    // Create mock message batch
    const mockBatch = {
      queue: 'email-queue',
      messages: [
        {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          body: mockJob,
          ack: () => console.log('[Test] Message acknowledged'),
          retry: () => console.log('[Test] Message retry requested'),
        },
      ],
    };

    // Run consumer
    await emailConsumer.queue(mockBatch as any, env);

    return c.json({
      message: 'Email consumer executed',
      job_id: mockJob.job_id,
      to: email,
    });
  } catch (error) {
    console.error('[TestEmailConsumer] Error:', error);
    return c.json(
      {
        error: 'Failed to run email consumer',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
