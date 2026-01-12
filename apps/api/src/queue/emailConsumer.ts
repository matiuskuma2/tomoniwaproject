/**
 * Email Queue Consumer Handler (Ticket 06)
 * 
 * Consumes email jobs from EMAIL_QUEUE and sends via Resend API.
 * Handles idempotency and delivery tracking.
 */

import type { EmailJob } from '../services/emailQueue';

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
    case 'additional_slots':
      return generateAdditionalSlotsEmail(job as any);
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
 * Production base URL for email links
 */
const APP_BASE_URL = 'https://app.tomoniwao.jp';

/**
 * Generate invite email content
 * Beta A: 日程調整招待メール（日本語・丁寧な文面）
 */
function generateInviteEmail(job: EmailJob & { type: 'invite' }): { html: string; text: string } {
  const { token, inviter_name, thread_title } = job.data;
  const acceptUrl = `${APP_BASE_URL}/i/${token}`;
  // XSS防止: ユーザー入力をHTMLエスケープ
  const safeInviterName = escapeHtml(inviter_name);
  const displayTitle = escapeHtml(thread_title || '日程調整');

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Segoe UI', sans-serif; line-height: 1.8; color: #333; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 30px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 32px 24px; }
        .message { background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
        .button-container { text-align: center; margin: 32px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white !important; padding: 16px 48px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); }
        .button:hover { background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%); }
        .link-fallback { margin-top: 24px; padding: 16px; background: #f1f5f9; border-radius: 8px; font-size: 13px; color: #64748b; word-break: break-all; }
        .footer { padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📅 日程調整のご依頼</h1>
        </div>
        <div class="content">
          <p>こんにちは。</p>
          <div class="message">
            <strong>${safeInviterName}</strong> さんより、<br>
            「<strong>${displayTitle}</strong>」の日程調整依頼が届きました。
          </div>
          <p>下のボタンから、ご都合の良い日時をお選びください。<br>回答は数分で完了します。</p>
          <div class="button-container">
            <a href="${acceptUrl}" class="button">日程を回答する</a>
          </div>
          <div class="link-fallback">
            ボタンが表示されない場合は、以下のURLをコピーしてブラウザに貼り付けてください：<br>
            <a href="${acceptUrl}" style="color: #2563eb;">${acceptUrl}</a>
          </div>
        </div>
        <div class="footer">
          このメールは Tomoniwao（トモニワオ）から送信されています。<br>
          ご不明な点がございましたら、${safeInviterName} さんに直接お問い合わせください.
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
【日程調整のご依頼】

こんにちは。

${inviter_name} さんより、「${displayTitle}」の日程調整依頼が届きました。

以下のリンクから、ご都合の良い日時をお選びください：
${acceptUrl}

回答は数分で完了します。

---
このメールは Tomoniwao（トモニワオ）から送信されています。
ご不明な点がございましたら、${inviter_name} さんに直接お問い合わせください。
  `;

  return { html, text };
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
 * 既存の回答は保持されていることを明記
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
  const { token, thread_title, slot_count, slot_description, invite_url, proposal_version } = job.data;
  const displayTitle = escapeHtml(thread_title || '日程調整');
  const safeSlotDescription = escapeHtml(slot_description).replace(/\n/g, '<br>');

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Segoe UI', sans-serif; line-height: 1.8; color: #333; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 30px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 32px 24px; }
        .highlight { background: #ecfdf5; border-left: 4px solid #059669; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
        .highlight h3 { margin: 0 0 8px 0; color: #059669; }
        .info-box { background: #f0f9ff; border: 1px solid #bae6fd; padding: 16px 20px; margin: 20px 0; border-radius: 8px; }
        .info-box p { margin: 0; color: #0369a1; }
        .button-container { text-align: center; margin: 32px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white !important; padding: 16px 48px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3); }
        .button:hover { transform: translateY(-2px); }
        .footer { padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📅 追加候補のお知らせ</h1>
        </div>
        <div class="content">
          <p>「<strong>${displayTitle}</strong>」の日程調整に、新しい候補日が追加されました。</p>
          
          <div class="highlight">
            <h3>追加された候補（${slot_count}件）</h3>
            <p>${safeSlotDescription}</p>
          </div>
          
          <div class="info-box">
            <p>💡 <strong>ご安心ください</strong>：既にご回答いただいた内容はそのまま保持されています。<br>
            追加された候補についてのみ、ご都合をお知らせいただければ幸いです。</p>
          </div>
          
          <div class="button-container">
            <a href="${invite_url}" class="button">追加候補を確認する</a>
          </div>
          
          <p style="color: #64748b; font-size: 14px; text-align: center;">
            このリンクは72時間有効です。
          </p>
        </div>
        <div class="footer">
          このメールは Tomoniwao（トモニワオ）から自動送信されています。
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
📅 追加候補のお知らせ

「${displayTitle}」の日程調整に、新しい候補日が追加されました。

【追加された候補（${slot_count}件）】
${slot_description}

💡 ご安心ください：既にご回答いただいた内容はそのまま保持されています。
追加された候補についてのみ、ご都合をお知らせいただければ幸いです。

▼ 追加候補を確認する
${invite_url}

このリンクは72時間有効です。

---
Tomoniwao（トモニワオ）
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
