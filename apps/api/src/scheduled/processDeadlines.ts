/**
 * processDeadlines.ts
 * 
 * PR-G1-DEADLINE: 1対N スレッドの deadline 到達時の自動処理
 * 
 * 処理フロー:
 * 1. deadline_at <= now の one_to_many スレッドを取得
 * 2. 各スレッドに対して成立条件を判定
 *    - 成立 → status='confirmed' + 最適 slot を選択
 *    - 不成立 → status='failed'
 * 3. organizer に inbox 通知
 * 
 * Cron: hourly (0 * * * *)
 */

import type { D1Database } from '@cloudflare/workers-types';
import { OneToManyRepository, type GroupPolicy, type OneToManyMode } from '../repositories/oneToManyRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { createLogger } from '../utils/logger';

// Env の最小定義
interface ProcessDeadlineEnv {
  DB: D1Database;
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
}

interface ProcessResult {
  processed: number;
  confirmed: number;
  failed: number;
  skipped: number;
  errors: number;
  errorDetails?: string[];  // PR-G1-DEADLINE: デバッグ用
}

/**
 * deadline 到達処理
 */
export async function processDeadlines(
  env: ProcessDeadlineEnv,
  maxBatchSize = 50
): Promise<ProcessResult> {
  const log = createLogger(env, { module: 'DeadlineProcessor' });
  
  const result: ProcessResult = {
    processed: 0,
    confirmed: 0,
    failed: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  try {
    const now = new Date().toISOString();
    const repo = new OneToManyRepository(env.DB);
    const inboxRepo = new InboxRepository(env.DB);

    // 1. deadline 到達スレッドを取得
    const dueThreads = await repo.listDeadlineDueThreads(now, maxBatchSize);

    if (dueThreads.length === 0) {
      log.debug('No deadline-due threads to process');
      return result;
    }

    log.info('Processing deadline-due threads', { count: dueThreads.length });
    result.processed = dueThreads.length;

    // 2. 各スレッドを処理
    for (const thread of dueThreads) {
      try {
        if (!thread.group_policy_json) {
          result.skipped++;
          continue;
        }

        const policy: GroupPolicy = JSON.parse(thread.group_policy_json);
        const mode = policy.mode;
        const finalizePolicy = policy.finalize_policy;

        // ============================================================
        // 成立判定
        // ============================================================
        // organizer_decides: 自動確定しない → failed（organizer が選ぶべき）
        // quorum / required_people / all_required: 条件を確認
        // ============================================================

        let shouldConfirm = false;
        let selectedSlotId: string | null = null;
        let reason = '';

        if (finalizePolicy === 'organizer_decides') {
          // organizer_decides は deadline で自動確定しない
          // → failed にして再提案を促す
          shouldConfirm = false;
          reason = 'organizer_decides: deadline expired without manual finalization';
        } else {
          // checkFinalizationCondition で成立判定
          const finalizationCheck = await repo.checkFinalizationCondition(thread.id);
          
          if (finalizationCheck.met) {
            shouldConfirm = true;
            
            // 最適スロットを計算
            const bestSlot = await repo.computeBestSlotForDeadline(thread.id, mode as OneToManyMode);
            selectedSlotId = bestSlot.slotId;
            reason = `finalization condition met: ${finalizationCheck.reason}, slot: ${bestSlot.reason}`;
          } else {
            shouldConfirm = false;
            reason = `finalization condition not met: ${finalizationCheck.reason}`;
          }
        }

        // ============================================================
        // 状態更新
        // ============================================================

        if (shouldConfirm && selectedSlotId) {
          // confirmed に更新
          const confirmResult = await repo.tryConfirmWithSlot(thread.id, selectedSlotId);
          
          if (confirmResult.success) {
            result.confirmed++;
            log.info('Thread confirmed on deadline', { 
              threadId: thread.id, 
              slotId: selectedSlotId,
              reason 
            });

            // organizer に確定通知
            try {
              await sendDeadlineNotification(inboxRepo, thread, 'confirmed', selectedSlotId, reason);
            } catch (notifyError) {
              log.warn('Failed to send deadline notification', {
                threadId: thread.id,
                error: notifyError instanceof Error ? notifyError.message : String(notifyError),
              });
            }
          } else {
            result.skipped++;
            log.debug('Thread already processed', { threadId: thread.id });
          }
        } else {
          // failed に更新
          const failResult = await repo.tryMarkFailed(thread.id, reason);
          
          if (failResult.success) {
            result.failed++;
            log.info('Thread marked failed on deadline', { 
              threadId: thread.id, 
              reason 
            });

            // organizer に不成立通知
            try {
              await sendDeadlineNotification(inboxRepo, thread, 'failed', null, reason);
            } catch (notifyError) {
              log.warn('Failed to send deadline notification', {
                threadId: thread.id,
                error: notifyError instanceof Error ? notifyError.message : String(notifyError),
              });
            }
          } else {
            result.skipped++;
            log.debug('Thread already processed', { threadId: thread.id });
          }
        }

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error('Failed to process thread deadline', {
          threadId: thread.id,
          error: errMsg,
          stack: error instanceof Error ? error.stack : undefined,
        });
        result.errors++;
        result.errorDetails?.push(`${thread.id}: ${errMsg}`);
      }
    }

    log.info('Deadline processing completed', result);
    return result;

  } catch (error) {
    log.error('Deadline processor failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * organizer に deadline 通知を送信
 */
async function sendDeadlineNotification(
  inboxRepo: InboxRepository,
  thread: { id: string; organizer_user_id: string; title: string | null },
  status: 'confirmed' | 'failed',
  selectedSlotId: string | null,
  reason: string
): Promise<void> {
  const title = thread.title || '予定調整';

  if (status === 'confirmed') {
    await inboxRepo.create({
      user_id: thread.organizer_user_id,
      type: 'scheduling_deadline_confirmed',
      title: `締切により日程が確定しました`,
      message: `「${title}」は締切到達により、最も票が多い候補で確定しました。`,
      action_type: 'view_thread',
      action_target_id: thread.id,
      action_url: `/one-to-many/${thread.id}`,
      priority: 'high',
    });
  } else {
    await inboxRepo.create({
      user_id: thread.organizer_user_id,
      type: 'scheduling_deadline_failed',
      title: `締切を過ぎたため不成立になりました`,
      message: `「${title}」は締切までに成立条件を満たせませんでした。再提案をご検討ください。`,
      action_type: 'view_thread',
      action_target_id: thread.id,
      action_url: `/one-to-many/${thread.id}`,
      priority: 'high',
    });
  }
}
