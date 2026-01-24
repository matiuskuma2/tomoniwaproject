-- =============================================================================
-- Migration: 0080_create_thread_failures.sql
-- Purpose: FAIL-1 失敗回数トラッキング - スレッド単位・参加者単位で失敗を記録
-- =============================================================================

-- thread_failures: 失敗イベントの累積記録
-- 同一 (workspace_id, thread_id, participant_key, failure_type) に対して count を累積
CREATE TABLE IF NOT EXISTS thread_failures (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  
  -- 参加者識別（外部招待が多いので invitee_key 推奨、内部ユーザーは user_id）
  participant_key TEXT NOT NULL DEFAULT '_thread_',  -- '_thread_' = スレッド全体の失敗
  
  -- 失敗種別
  failure_type TEXT NOT NULL CHECK (failure_type IN (
    'no_common_slot',      -- 共通空きが0件
    'proposal_rejected',   -- 提案が却下された
    'reschedule_failed',   -- 再調整でも合わなかった
    'manual_fail',         -- 主催者が「合わなかった」と報告
    'invite_expired',      -- 招待期限切れ
    'candidate_exhausted'  -- 候補枯渇
  )),
  
  -- 失敗ステージ
  failure_stage TEXT NOT NULL CHECK (failure_stage IN (
    'propose',     -- 初回提案
    'reschedule',  -- 再調整
    'finalize',    -- 確定直前
    'invite'       -- 招待段階
  )),
  
  -- 累積カウント
  count INTEGER NOT NULL DEFAULT 1,
  
  -- タイムスタンプ
  first_failed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_failed_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- メタ情報（JSON）: range, dayTimeWindow, duration, candidate_count, excluded_count など
  meta_json TEXT DEFAULT '{}',
  
  -- 外部キー
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- ユニーク制約: 同一スレッド・参加者・失敗種別は1レコードで累積
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_failures_unique 
  ON thread_failures(workspace_id, thread_id, participant_key, failure_type);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_thread_failures_thread 
  ON thread_failures(thread_id);

CREATE INDEX IF NOT EXISTS idx_thread_failures_workspace_owner 
  ON thread_failures(workspace_id, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_thread_failures_last_failed 
  ON thread_failures(last_failed_at DESC);

-- =============================================================================
-- 補足:
-- - participant_key = '_thread_' はスレッド全体の失敗（共通空き0件など）
-- - participant_key = email/invitee_key は個別参加者の失敗
-- - count は UPSERT で累積
-- - meta_json には失敗時の文脈情報を保存（デバッグ・分析用）
-- =============================================================================
