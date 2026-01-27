/**
 * processReminders.ts
 * 
 * 前日リマインダーの cron 処理（毎時実行）
 * 
 * v1.2: 最小・安全・dry-run対応
 * 
 * 処理フロー:
 * 1. scheduled_reminders から status='scheduled' かつ remind_at <= now を取得
 * 2. EMAIL_QUEUE に job を積む
 * 3. status を 'queued' に更新
 * 
 * dry-run モード:
 * - env.REMIND_DRY_RUN === 'true' の場合、キュー投入せずログのみ
 */

import type { D1Database, Queue } from '@cloudflare/workers-types';
import { createLogger } from '../utils/logger';
import type { ReminderEmailJob, EmailJob } from '../services/emailQueue';

// Env の最小定義（processReminders で必要な部分のみ）
interface ProcessReminderEnv {
  DB: D1Database;
  EMAIL_QUEUE: Queue<EmailJob>;
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
  REMIND_DRY_RUN?: string;
}

interface ScheduledReminder {
  id: string;
  thread_id: string;
  invite_id: string;
  token: string;
  to_email: string;
  to_name: string | null;
  remind_at: string;
  remind_type: string;
  metadata: string | null;
}

interface ReminderMetadata {
  title?: string;
  slot_start_at?: string;
  slot_end_at?: string;
  organizer_name?: string;
}

/**
 * 前日リマインダー処理
 * 
 * @returns 処理結果（件数、成功/失敗）
 */
export async function processReminders(
  env: ProcessReminderEnv,
  maxBatchSize = 100
): Promise<{
  processed: number;
  queued: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
}> {
  const log = createLogger(env, { module: 'ReminderProcessor' });
  const dryRun = env.REMIND_DRY_RUN === 'true';
  
  const result = {
    processed: 0,
    queued: 0,
    skipped: 0,
    errors: 0,
    dryRun,
  };
  
  try {
    const now = new Date().toISOString();
    
    // 1. 対象リマインダーを取得
    const reminders = await env.DB.prepare(`
      SELECT id, thread_id, invite_id, token, to_email, to_name, remind_at, remind_type, metadata
      FROM scheduled_reminders
      WHERE status = 'scheduled' AND remind_at <= ?
      ORDER BY remind_at ASC
      LIMIT ?
    `).bind(now, maxBatchSize).all<ScheduledReminder>();
    
    if (!reminders.results || reminders.results.length === 0) {
      log.debug('No reminders to process');
      return result;
    }
    
    // dry-run 時は warn で出力（LOG_LEVEL=warn でも観測可能にする）
    if (dryRun) {
      log.warn('[DRY-RUN] Processing reminders', { 
        count: reminders.results.length, 
        dryRun 
      });
    } else {
      log.info('Processing reminders', { 
        count: reminders.results.length, 
        dryRun 
      });
    }
    
    result.processed = reminders.results.length;
    
    // 2. 各リマインダーを処理
    for (const reminder of reminders.results) {
      try {
        // metadata をパース
        let metadata: ReminderMetadata = {};
        if (reminder.metadata) {
          try {
            metadata = JSON.parse(reminder.metadata);
          } catch {
            log.warn('Failed to parse reminder metadata', { id: reminder.id });
          }
        }
        
        // invite の有効性を確認（キャンセルされていないか）
        const invite = await env.DB.prepare(`
          SELECT status FROM thread_invites WHERE id = ?
        `).bind(reminder.invite_id).first<{ status: string }>();
        
        if (!invite || invite.status !== 'accepted') {
          // 招待がキャンセルまたは未承諾の場合はスキップ
          await env.DB.prepare(`
            UPDATE scheduled_reminders 
            SET status = 'cancelled', updated_at = datetime('now')
            WHERE id = ?
          `).bind(reminder.id).run();
          
          log.debug('Reminder skipped (invite not accepted)', { 
            id: reminder.id, 
            inviteStatus: invite?.status 
          });
          result.skipped++;
          continue;
        }
        
        if (dryRun) {
          // dry-run モード: ログのみ（warn で出力して観測可能に）
          log.warn('[DRY-RUN] Would queue reminder', {
            id: reminder.id,
            to: reminder.to_email,
            title: metadata.title,
            slotStartAt: metadata.slot_start_at,
          });
          result.queued++;
          continue;
        }
        
        // 3. EMAIL_QUEUE に投入（既存の reminder タイプを使用）
        // 期限を計算（slot_start_at から）
        const expiresAt = metadata.slot_start_at || new Date().toISOString();
        
        // 既存の sendReminderEmail を使うか、直接 queue に積む
        // ここでは既存の ReminderEmailJob 形式に合わせる
        const jobId = crypto.randomUUID();
        const inviteUrl = `https://app.tomoniwao.jp/i/${reminder.token}`;
        
        const job: ReminderEmailJob = {
          job_id: jobId,
          type: 'reminder',
          to: reminder.to_email,
          subject: `【リマインド】明日「${metadata.title || '打ち合わせ'}」があります`,
          created_at: Date.now(),
          data: {
            token: reminder.token,
            invite_url: inviteUrl,
            thread_title: metadata.title || '打ち合わせ',
            inviter_name: metadata.organizer_name || 'ユーザー',
            custom_message: `明日の予定をお知らせします。`,
            expires_at: expiresAt,
            scheduled_reminder_id: reminder.id,  // PR-REMIND-4: 送信完了時に更新するためのID
          },
        };
        
        await env.EMAIL_QUEUE.send(job);
        
        // 4. status を queued に更新
        await env.DB.prepare(`
          UPDATE scheduled_reminders 
          SET status = 'queued', queued_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).bind(reminder.id).run();
        
        log.debug('Reminder queued', { 
          id: reminder.id, 
          to: reminder.to_email,
          jobId 
        });
        result.queued++;
        
      } catch (error) {
        log.error('Failed to process reminder', {
          id: reminder.id,
          error: error instanceof Error ? error.message : String(error),
        });
        result.errors++;
      }
    }
    
    log.info('Reminder processing completed', result);
    return result;
    
  } catch (error) {
    log.error('Reminder processor failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
