/**
 * Email Queue Consumer Handler (Ticket 06)
 * 
 * Consumes email jobs from EMAIL_QUEUE and sends via Resend API.
 * Handles idempotency and delivery tracking.
 */

import type { EmailJob } from '../services/emailQueue';

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  ANALYTICS?: AnalyticsEngineDataset;
}

/**
 * Resend API Response
 */
interface ResendResponse {
  id: string;
  from: string;
  to: string[];
  created_at: string;
}

/**
 * Email Queue Consumer
 * 
 * This is called by Cloudflare Workers when messages arrive in email-queue.
 * Configured in wrangler.jsonc as queue consumer.
 */
export default {
  async queue(
    batch: MessageBatch<EmailJob>,
    env: Env
  ): Promise<void> {
    console.log(`[EmailConsumer] Processing ${batch.messages.length} messages`);

    // Process messages serially with throttling (Resend limit: 2 req/sec)
    for (const message of batch.messages) {
      try {
        await processEmailJobWithRetry(message.body, env, 3);
        message.ack(); // Acknowledge successful processing
        
        // Throttle: Wait 650ms between emails to respect Resend's 2 req/sec limit
        if (batch.messages.indexOf(message) < batch.messages.length - 1) {
          await sleep(650);
        }
      } catch (error) {
        console.error('[EmailConsumer] Error processing message:', error);
        message.retry(); // Retry on failure (will go to DLQ after max_retries)
      }
    }
  },
};

/**
 * Sleep helper for throttling
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process email job with retry logic for 429 errors
 */
async function processEmailJobWithRetry(
  job: EmailJob,
  env: Env,
  maxRetries: number
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await processEmailJob(job, env);
      return; // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if it's a 429 rate limit error
      if (lastError.message.includes('429') || lastError.message.includes('rate_limit')) {
        console.warn(`[EmailConsumer] Rate limit hit (attempt ${attempt}/${maxRetries}), waiting 1s...`);
        
        if (attempt < maxRetries) {
          await sleep(1000); // Wait 1 second before retry
          continue;
        }
      }
      
      // For non-429 errors, throw immediately
      throw lastError;
    }
  }
  
  // All retries exhausted
  throw lastError || new Error('Failed after retries');
}

/**
 * Process individual email job
 */
async function processEmailJob(job: EmailJob, env: Env): Promise<void> {
  console.log(`[EmailConsumer] Processing job ${job.job_id} (type: ${job.type})`);

  // Check idempotency - has this job been processed?
  const alreadyProcessed = await checkIfProcessed(job, env.DB);
  if (alreadyProcessed) {
    console.log(`[EmailConsumer] Job ${job.job_id} already processed, skipping`);
    return;
  }

  // Generate email content
  const emailContent = generateEmailContent(job);

  // Send email via Resend
  const resendId = await sendViaResend(
    {
      to: job.to,
      subject: job.subject,
      html: emailContent.html,
      text: emailContent.text,
    },
    env.RESEND_API_KEY
  );

  console.log(`[EmailConsumer] Email sent via Resend: ${resendId}`);

  // Update delivery status in database
  await updateDeliveryStatus(job, resendId, env.DB);

  // Track analytics
  if (env.ANALYTICS) {
    env.ANALYTICS.writeDataPoint({
      blobs: ['email_sent', job.type, job.to],
      doubles: [Date.now()],
      indexes: ['email_delivery'],
    });
  }
}

/**
 * Check if job has already been processed (idempotency)
 */
async function checkIfProcessed(job: EmailJob, db: D1Database): Promise<boolean> {
  if (job.type === 'broadcast') {
    const result = await db
      .prepare('SELECT status FROM broadcast_deliveries WHERE id = ?')
      .bind(job.data.delivery_id)
      .first<{ status: string }>();
    
    return result?.status === 'sent';
  }

  if (job.type === 'thread_message') {
    const result = await db
      .prepare('SELECT status FROM thread_message_deliveries WHERE id = ?')
      .bind(job.data.delivery_id)
      .first<{ status: string }>();
    
    return result?.status === 'sent';
  }

  // OTP and invite emails don't have delivery tracking (fire-and-forget)
  return false;
}

/**
 * Update delivery status in database
 */
async function updateDeliveryStatus(
  job: EmailJob,
  resendId: string,
  db: D1Database
): Promise<void> {
  if (job.type === 'broadcast') {
    await db
      .prepare(
        `UPDATE broadcast_deliveries 
         SET status = 'sent', 
             sent_at = unixepoch(),
             provider_id = ?,
             updated_at = unixepoch()
         WHERE id = ?`
      )
      .bind(resendId, job.data.delivery_id)
      .run();
  }

  if (job.type === 'thread_message') {
    await db
      .prepare(
        `UPDATE thread_message_deliveries 
         SET status = 'sent', 
             sent_at = unixepoch(),
             provider_id = ?,
             updated_at = unixepoch()
         WHERE id = ?`
      )
      .bind(resendId, job.data.delivery_id)
      .run();
  }
}

/**
 * Generate email content based on job type
 */
function generateEmailContent(job: EmailJob): { html: string; text: string } {
  switch (job.type) {
    case 'otp':
      return generateOTPEmail(job);
    case 'invite':
      return generateInviteEmail(job);
    case 'broadcast':
      return generateBroadcastEmail(job);
    case 'thread_message':
      return generateThreadMessageEmail(job);
    default:
      throw new Error(`Unknown email type: ${(job as any).type}`);
  }
}

/**
 * Generate OTP email content
 */
function generateOTPEmail(job: EmailJob & { type: 'otp' }): { html: string; text: string } {
  const { code, purpose, expires_in } = job.data;
  const expiryMinutes = Math.floor(expires_in / 60);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; margin: 20px 0; }
        .footer { margin-top: 40px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Your verification code</h1>
        <p>Use this code to ${purpose.replace('_', ' ')}:</p>
        <div class="code">${code}</div>
        <p>This code will expire in ${expiryMinutes} minutes.</p>
        <p>If you didn't request this code, you can safely ignore this email.</p>
        <div class="footer">
          <p>AI Secretary Scheduler</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Your verification code: ${code}

Use this code to ${purpose.replace('_', ' ')}.
This code will expire in ${expiryMinutes} minutes.

If you didn't request this code, you can safely ignore this email.

AI Secretary Scheduler
  `;

  return { html, text };
}

/**
 * Generate invite email content
 */
function generateInviteEmail(job: EmailJob & { type: 'invite' }): { html: string; text: string } {
  const { token, inviter_name, relation_type } = job.data;
  const acceptUrl = `https://app.example.com/i/${token}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${inviter_name} wants to connect with you</h1>
        <p>${inviter_name} has invited you to connect as ${relation_type}.</p>
        <a href="${acceptUrl}" class="button">Accept Invitation</a>
        <p>Or copy this link: ${acceptUrl}</p>
      </div>
    </body>
    </html>
  `;

  const text = `
${inviter_name} wants to connect with you

${inviter_name} has invited you to connect as ${relation_type}.

Accept invitation: ${acceptUrl}

AI Secretary Scheduler
  `;

  return { html, text };
}

/**
 * Generate broadcast email content
 */
function generateBroadcastEmail(job: EmailJob & { type: 'broadcast' }): { html: string; text: string } {
  const { message } = job.data;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .message { background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>New broadcast message</h1>
        <div class="message">${message}</div>
      </div>
    </body>
    </html>
  `;

  const text = `
New broadcast message

${message}

AI Secretary Scheduler
  `;

  return { html, text };
}

/**
 * Generate thread message email content
 */
function generateThreadMessageEmail(job: EmailJob & { type: 'thread_message' }): { html: string; text: string } {
  const { message, sender_name, thread_id } = job.data;
  const threadUrl = `https://app.example.com/scheduling/${thread_id}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .message { background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>New message from ${sender_name}</h1>
        <div class="message">${message}</div>
        <a href="${threadUrl}" class="button">View Conversation</a>
      </div>
    </body>
    </html>
  `;

  const text = `
New message from ${sender_name}

${message}

View conversation: ${threadUrl}

AI Secretary Scheduler
  `;

  return { html, text };
}

/**
 * Send email via Resend API
 */
async function sendViaResend(
  email: {
    to: string;
    subject: string;
    html: string;
    text: string;
  },
  apiKey: string
): Promise<string> {
  // Mock mode for testing (if API key not configured)
  if (!apiKey || apiKey === 'your_resend_api_key_here') {
    console.log('[EmailConsumer] MOCK MODE - Email would be sent:');
    console.log(`  To: ${email.to}`);
    console.log(`  Subject: ${email.subject}`);
    console.log(`  Text: ${email.text.substring(0, 100)}...`);
    return `mock-${crypto.randomUUID()}`;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Tomoniva <onboarding@resend.dev>', // Resend default verified address
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errorMsg = `Resend API error (${response.status}): ${errorText}`;
    
    // Log detailed error for debugging
    console.error('[EmailConsumer] Resend API failed:', {
      status: response.status,
      error: errorText,
      to: email.to,
      subject: email.subject,
    });
    
    throw new Error(errorMsg);
  }

  const result: ResendResponse = await response.json();
  console.log(`[EmailConsumer] Email sent successfully via Resend: ${result.id}`);
  return result.id;
}
