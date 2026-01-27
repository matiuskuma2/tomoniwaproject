/**
 * Email Queue Consumer Handler (Ticket 06)
 * 
 * Consumes email jobs from EMAIL_QUEUE and sends via Resend API.
 * Handles idempotency and delivery tracking.
 * 
 * P3-INV1 共通ソース化: テンプレートとプレビューの一体化
 * - invite / additional_slots / reminder は emailModel.ts の共通モデルを使用
 * - 「テンプレ変更 = model変更」でズレを防止
 */

import type { EmailJob } from '../services/emailQueue';
import { createLogger, type Logger } from '../utils/logger';
import {
  composeInviteEmailModel,
  composeAdditionalSlotsEmailModel,
  composeReminderEmailModel,
  composeOneOnOneEmailModel,
  renderEmailHtml,
  renderEmailText,
  APP_BASE_URL,
} from '../utils/emailModel';

/**
 * HTMLエスケープ関数
 * XSS防止のため、ユーザー入力をHTMLに挿入する前に必ず通す
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  ANALYTICS?: AnalyticsEngineDataset;
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
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
    const log = createLogger(env, { module: 'EmailConsumer', handler: 'queue' });
    log.info('Processing batch', { messageCount: batch.messages.length });

    // Process messages serially with throttling (Resend limit: 2 req/sec)
    for (const message of batch.messages) {
      try {
        await processEmailJobWithRetry(message.body, env, 3, log);
        message.ack(); // Acknowledge successful processing
        
        // Throttle: Wait 650ms between emails to respect Resend's 2 req/sec limit
        if (batch.messages.indexOf(message) < batch.messages.length - 1) {
          await sleep(650);
        }
      } catch (error) {
        log.error('Error processing message', { jobId: message.body.job_id, error });
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
  maxRetries: number,
  log: Logger
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await processEmailJob(job, env, log);
      return; // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if it's a 429 rate limit error
      if (lastError.message.includes('429') || lastError.message.includes('rate_limit')) {
        log.warn('Rate limit hit, retrying', { jobId: job.job_id, attempt, maxRetries });
        
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
async function processEmailJob(job: EmailJob, env: Env, log: Logger): Promise<void> {
  log.debug('Processing job', { jobId: job.job_id, type: job.type });

  // Check idempotency - has this job been processed?
  const alreadyProcessed = await checkIfProcessed(job, env.DB);
  if (alreadyProcessed) {
    log.debug('Job already processed, skipping', { jobId: job.job_id });
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
    env.RESEND_API_KEY,
    log
  );

  log.debug('Email sent via Resend', { jobId: job.job_id, resendId });

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
    case 'additional_slots':
      return generateAdditionalSlotsEmail(job as any);
    case 'reminder':
      return generateReminderEmail(job as any);
    case 'one_on_one':
      return generateOneOnOneEmail(job as any);
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
 * P3-INV1 共通ソース化: emailModel.ts の共通モデルを使用
 */
function generateInviteEmail(job: EmailJob & { type: 'invite' }): { html: string; text: string } {
  const { token, inviter_name, thread_title } = job.data;
  
  // P3-INV1: 共通モデルから生成（テンプレとプレビューの一体化）
  const model = composeInviteEmailModel({
    inviterName: inviter_name,
    threadTitle: thread_title || '日程調整',
    token,
  });
  
  return {
    html: renderEmailHtml(model),
    text: renderEmailText(model),
  };
}

/**
 * Generate broadcast email content
 */
function generateBroadcastEmail(job: EmailJob & { type: 'broadcast' }): { html: string; text: string } {
  const { message } = job.data;
  // XSS防止: ユーザー入力をHTMLエスケープ
  const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

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
        <div class="message">${safeMessage}</div>
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
 * Beta A: 日本語で確定通知メール
 */
function generateThreadMessageEmail(job: EmailJob & { type: 'thread_message' }): { html: string; text: string } {
  const { message, sender_name, thread_id } = job.data;
  const threadUrl = `${APP_BASE_URL}/chat/${thread_id}`;

  // メッセージ内容をHTMLエスケープしつつ改行を<br>に変換
  const htmlMessage = escapeHtml(message).replace(/\n/g, '<br>');

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Segoe UI', sans-serif; line-height: 1.8; color: #333; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 32px 24px; }
        .message { background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; white-space: pre-wrap; }
        .footer { padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ ${escapeHtml(sender_name)}からのお知らせ</h1>
        </div>
        <div class="content">
          <div class="message">${htmlMessage}</div>
        </div>
        <div class="footer">
          このメールは Tomoniwao（トモニワオ）から送信されています。
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
${sender_name}からのお知らせ

${message}

詳細はこちら: ${threadUrl}

---
Tomoniwao（トモニワオ）
  `;

  return { html, text };
}

/**
 * Phase2: 追加候補通知メール
 * P3-INV1 共通ソース化: emailModel.ts の共通モデルを使用
 */
function generateAdditionalSlotsEmail(job: EmailJob & { 
  type: 'additional_slots';
  data: {
    token: string;
    thread_title: string;
    slot_count: number;
    slot_description: string;
    invite_url: string;
    proposal_version: number;
  };
}): { html: string; text: string } {
  const { token, thread_title, slot_count, slot_description } = job.data;
  
  // slot_description を配列に変換
  const slotLabels = slot_description.split('\n').filter(s => s.trim());
  
  // P3-INV1: 共通モデルから生成（テンプレとプレビューの一体化）
  const model = composeAdditionalSlotsEmailModel({
    threadTitle: thread_title || '日程調整',
    slotCount: slot_count,
    slotLabels,
    token,
  });
  
  return {
    html: renderEmailHtml(model),
    text: renderEmailText(model),
  };
}

/**
 * Phase B / P2-B2: リマインドメール
 * P3-INV1 共通ソース化: emailModel.ts の共通モデルを使用
 */
function generateReminderEmail(job: EmailJob & { 
  type: 'reminder';
  data: {
    token: string;
    invite_url: string;
    thread_title: string;
    inviter_name: string;
    custom_message?: string | null;
    expires_at: string;
    recipient_timezone?: string;
  };
}): { html: string; text: string } {
  const { token, thread_title, inviter_name, custom_message, expires_at, recipient_timezone } = job.data;
  
  // P3-TZ2: 受信者のタイムゾーンで期限をフォーマット
  const timezone = recipient_timezone || 'Asia/Tokyo';
  const expiresDate = new Date(expires_at);
  const expiresFormatted = expiresDate.toLocaleString('ja-JP', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  // P3-INV1: 共通モデルから生成（テンプレとプレビューの一体化）
  const model = composeReminderEmailModel({
    inviterName: inviter_name,
    threadTitle: thread_title || '日程調整',
    customMessage: custom_message || undefined,
    expiresAt: expiresFormatted,
    token,
    recipientTimezone: timezone,
  });
  
  return {
    html: renderEmailHtml(model),
    text: renderEmailText(model),
  };
}

/**
 * v1.1: 1対1固定日時招待メール
 * 「この日時でOKですか？」体験を提供
 */
function generateOneOnOneEmail(job: EmailJob & {
  type: 'one_on_one';
  data: {
    token: string;
    organizer_name: string;
    invitee_name: string;
    title: string;
    slot: {
      start_at: string;
      end_at: string;
    };
    message_hint?: string;
  };
}): { html: string; text: string } {
  const { token, organizer_name, invitee_name, title, slot, message_hint } = job.data;
  
  // v1.1: 共通モデルから生成
  const model = composeOneOnOneEmailModel({
    organizerName: organizer_name,
    inviteeName: invitee_name,
    title,
    slot,
    messageHint: message_hint,
    token,
  });
  
  return {
    html: renderEmailHtml(model),
    text: renderEmailText(model),
  };
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
  apiKey: string,
  log: Logger
): Promise<string> {
  // Mock mode for testing (if API key not configured)
  if (!apiKey || apiKey === 'your_resend_api_key_here') {
    log.warn('MOCK MODE - Email would be sent', { to: email.to, subject: email.subject });
    return `mock-${crypto.randomUUID()}`;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Tomoniwao <noreply@tomoniwao.jp>', // Verified domain
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
    log.error('Resend API failed', {
      status: response.status,
      error: errorText,
      to: email.to,
      subject: email.subject,
    });
    
    throw new Error(errorMsg);
  }

  const result: ResendResponse = await response.json();
  log.debug('Email sent successfully via Resend', { resendId: result.id });
  return result.id;
}
