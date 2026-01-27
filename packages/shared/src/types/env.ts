/**
 * Cloudflare Workers Environment Types
 */

import type { D1Database, KVNamespace, R2Bucket, Queue } from '@cloudflare/workers-types';

export interface Env {
  // D1 Database
  DB: D1Database;
  
  // KV Namespaces
  RATE_LIMIT: KVNamespace;
  OTP_STORE: KVNamespace;
  
  // R2 Storage
  STORAGE: R2Bucket;
  
  // Queues
  EMAIL_QUEUE: Queue;
  
  // Environment Variables
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  CORS_ORIGINS: string;
  AI_FALLBACK_ENABLED?: string;
  
  // v1.2: Reminder Controls
  REMIND_DRY_RUN?: string;  // 'true' = dry-run mode (no actual email sending)
  
  // Secrets (set via wrangler secret put)
  JWT_SECRET?: string;
  ENCRYPTION_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  RESEND_API_KEY?: string;
  
  // P2-E2: Twilio SMS
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
}
