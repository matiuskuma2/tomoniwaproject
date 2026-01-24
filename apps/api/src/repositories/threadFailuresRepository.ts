/**
 * Thread Failures Repository
 * FAIL-1: 失敗回数トラッキング
 * 
 * スレッド単位・参加者単位で失敗を記録し、エスカレーション判定に使用
 */

import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Types
// ============================================================

export type FailureType =
  | 'no_common_slot'      // 共通空きが0件
  | 'proposal_rejected'   // 提案が却下された
  | 'reschedule_failed'   // 再調整でも合わなかった
  | 'manual_fail'         // 主催者が「合わなかった」と報告
  | 'invite_expired'      // 招待期限切れ
  | 'candidate_exhausted'; // 候補枯渇

export type FailureStage =
  | 'propose'     // 初回提案
  | 'reschedule'  // 再調整
  | 'finalize'    // 確定直前
  | 'invite';     // 招待段階

export interface ThreadFailure {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  thread_id: string;
  participant_key: string;  // '_thread_' = スレッド全体
  failure_type: FailureType;
  failure_stage: FailureStage;
  count: number;
  first_failed_at: string;
  last_failed_at: string;
  meta_json: string;
}

export interface FailureMeta {
  range?: string;
  dayTimeWindow?: string;
  duration?: number;
  candidate_count?: number;
  excluded_count?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface FailureSummary {
  total_failures: number;
  unique_failure_types: number;
  by_type: Record<FailureType, number>;
  by_participant: Array<{ participant_key: string; count: number }>;
  last_failed_at: string | null;
  escalation_level: 0 | 1 | 2;  // 0: 問題なし, 1: 注意, 2: 要対応
}

export interface IncrementFailureParams {
  workspaceId: string;
  ownerUserId: string;
  threadId: string;
  participantKey?: string;  // デフォルト: '_thread_'
  type: FailureType;
  stage: FailureStage;
  meta?: FailureMeta;
}

// ============================================================
// Repository
// ============================================================

export class ThreadFailuresRepository {
  constructor(private db: D1Database) {}

  /**
   * 失敗を記録（UPSERT: 既存レコードがあればcount++）
   */
  async incrementFailure(params: IncrementFailureParams): Promise<ThreadFailure> {
    const {
      workspaceId,
      ownerUserId,
      threadId,
      participantKey = '_thread_',
      type,
      stage,
      meta = {},
    } = params;

    const now = new Date().toISOString();
    const metaJson = JSON.stringify(meta);

    // UPSERT: SQLite の INSERT ... ON CONFLICT
    const result = await this.db
      .prepare(`
        INSERT INTO thread_failures (
          id, workspace_id, owner_user_id, thread_id, participant_key,
          failure_type, failure_stage, count, first_failed_at, last_failed_at, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT (workspace_id, thread_id, participant_key, failure_type)
        DO UPDATE SET
          count = count + 1,
          last_failed_at = excluded.last_failed_at,
          meta_json = excluded.meta_json,
          failure_stage = excluded.failure_stage
        RETURNING *
      `)
      .bind(
        uuidv4(),
        workspaceId,
        ownerUserId,
        threadId,
        participantKey,
        type,
        stage,
        now,
        now,
        metaJson
      )
      .first<ThreadFailure>();

    if (!result) {
      throw new Error('Failed to increment failure count');
    }

    return result;
  }

  /**
   * スレッドの失敗サマリーを取得
   */
  async getFailureSummaryByThread(threadId: string): Promise<FailureSummary> {
    // 全失敗レコードを取得
    const failures = await this.db
      .prepare(`
        SELECT * FROM thread_failures
        WHERE thread_id = ?
        ORDER BY last_failed_at DESC
      `)
      .bind(threadId)
      .all<ThreadFailure>();

    const records = failures.results || [];

    if (records.length === 0) {
      return {
        total_failures: 0,
        unique_failure_types: 0,
        by_type: {} as Record<FailureType, number>,
        by_participant: [],
        last_failed_at: null,
        escalation_level: 0,
      };
    }

    // 集計
    let totalFailures = 0;
    const byType: Record<string, number> = {};
    const byParticipant: Record<string, number> = {};
    let lastFailedAt: string | null = null;

    for (const record of records) {
      totalFailures += record.count;
      
      byType[record.failure_type] = (byType[record.failure_type] || 0) + record.count;
      
      if (record.participant_key !== '_thread_') {
        byParticipant[record.participant_key] = 
          (byParticipant[record.participant_key] || 0) + record.count;
      }
      
      if (!lastFailedAt || record.last_failed_at > lastFailedAt) {
        lastFailedAt = record.last_failed_at;
      }
    }

    // 参加者別（上位3名）
    const byParticipantArray = Object.entries(byParticipant)
      .map(([participant_key, count]) => ({ participant_key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // エスカレーションレベル判定
    // 0: 問題なし（失敗0回）
    // 1: 注意（失敗1回）
    // 2: 要対応（失敗2回以上）
    const escalationLevel: 0 | 1 | 2 = 
      totalFailures === 0 ? 0 :
      totalFailures === 1 ? 1 : 2;

    return {
      total_failures: totalFailures,
      unique_failure_types: Object.keys(byType).length,
      by_type: byType as Record<FailureType, number>,
      by_participant: byParticipantArray,
      last_failed_at: lastFailedAt,
      escalation_level: escalationLevel,
    };
  }

  /**
   * スレッドの失敗をリセット（再調整成功後など）
   */
  async resetFailuresByThread(threadId: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM thread_failures WHERE thread_id = ?')
      .bind(threadId)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * 特定の失敗タイプをリセット
   */
  async resetFailureByType(
    threadId: string,
    failureType: FailureType
  ): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM thread_failures WHERE thread_id = ? AND failure_type = ?')
      .bind(threadId, failureType)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * 特定参加者の失敗をリセット
   */
  async resetFailuresByParticipant(
    threadId: string,
    participantKey: string
  ): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM thread_failures WHERE thread_id = ? AND participant_key = ?')
      .bind(threadId, participantKey)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * ワークスペース全体の失敗統計（管理画面用）
   */
  async getWorkspaceFailureStats(
    workspaceId: string,
    days: number = 30
  ): Promise<{
    total_failures: number;
    threads_with_failures: number;
    by_type: Record<FailureType, number>;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceIso = since.toISOString();

    const result = await this.db
      .prepare(`
        SELECT 
          SUM(count) as total_failures,
          COUNT(DISTINCT thread_id) as threads_with_failures,
          failure_type,
          SUM(count) as type_count
        FROM thread_failures
        WHERE workspace_id = ? AND last_failed_at >= ?
        GROUP BY failure_type
      `)
      .bind(workspaceId, sinceIso)
      .all<{
        total_failures: number;
        threads_with_failures: number;
        failure_type: FailureType;
        type_count: number;
      }>();

    const records = result.results || [];
    
    let totalFailures = 0;
    let threadsWithFailures = 0;
    const byType: Record<string, number> = {};

    for (const record of records) {
      totalFailures = record.total_failures || 0;
      threadsWithFailures = record.threads_with_failures || 0;
      byType[record.failure_type] = record.type_count;
    }

    return {
      total_failures: totalFailures,
      threads_with_failures: threadsWithFailures,
      by_type: byType as Record<FailureType, number>,
    };
  }
}

// ============================================================
// Factory function
// ============================================================

export function createThreadFailuresRepository(db: D1Database): ThreadFailuresRepository {
  return new ThreadFailuresRepository(db);
}
