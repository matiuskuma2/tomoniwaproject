-- ============================================================
-- Migration: 0086_add_one_to_many_support.sql
-- Purpose: G1-PLAN - 1対N（Broadcast Scheduling）サポート
-- 
-- 追加内容:
-- 1. scheduling_threads.topology: one_on_one | one_to_many
-- 2. scheduling_threads.group_policy_json: 成立条件・締切等
-- 3. thread_responses: 参加者の回答記録
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. scheduling_threads に topology カラム追加
-- ============================================================

-- topology: 調整の形態
-- - one_on_one: 1対1（既存）
-- - one_to_many: 1対N（新規）
ALTER TABLE scheduling_threads
  ADD COLUMN topology TEXT NOT NULL DEFAULT 'one_on_one'
  CHECK (topology IN ('one_on_one', 'one_to_many'));

-- Index for filtering
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_topology
  ON scheduling_threads(topology);

-- ============================================================
-- 2. scheduling_threads に group_policy_json カラム追加
-- ============================================================

-- group_policy_json: 1対Nの成立条件（JSON）
-- {
--   "mode": "fixed|candidates|open_slots|range_auto",
--   "deadline_at": "2026-02-03T16:00:00+09:00",
--   "finalize_policy": "organizer_decides|quorum|required_people|all_required",
--   "quorum_count": 3,
--   "required_invitee_keys": ["e:abc123", "e:def456"],
--   "auto_finalize": false,
--   "max_reproposals": 2,
--   "reproposal_count": 0,
--   "participant_limit": 30
-- }
ALTER TABLE scheduling_threads
  ADD COLUMN group_policy_json TEXT NULL;

-- ============================================================
-- 3. thread_responses テーブル作成
-- ============================================================

-- 参加者の回答を記録
-- - 1対N での投票/出欠回答
-- - invitee_key で内部/外部を統一的に扱う
CREATE TABLE IF NOT EXISTS thread_responses (
  id TEXT PRIMARY KEY,                    -- UUID
  thread_id TEXT NOT NULL,                -- FK: scheduling_threads.id
  invitee_key TEXT NOT NULL,              -- u:<user_id> or e:<hash>
  response TEXT NOT NULL CHECK (response IN ('ok', 'no', 'maybe')),
  selected_slot_id TEXT NULL,             -- candidates/open_slots 用
  comment TEXT NULL,                      -- オプショナル: コメント
  responded_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

-- Unique: 同一スレッドで同一招待者は1回答のみ
CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_responses_thread_invitee
  ON thread_responses(thread_id, invitee_key);

-- Index: スレッドごとの回答一覧
CREATE INDEX IF NOT EXISTS idx_thread_responses_thread
  ON thread_responses(thread_id, responded_at DESC);

-- Index: 回答タイプごとの集計
CREATE INDEX IF NOT EXISTS idx_thread_responses_response
  ON thread_responses(thread_id, response);

-- ============================================================
-- 4. thread_invites に channel 情報を追加
-- ============================================================

-- Phase 3 で「何で送ったか」を記録する
-- (既存の thread_invites テーブルに追加)
ALTER TABLE thread_invites
  ADD COLUMN channel_type TEXT NULL CHECK (channel_type IN ('email', 'slack', 'chatwork', 'line', 'phone'));

ALTER TABLE thread_invites
  ADD COLUMN channel_value TEXT NULL;

-- ============================================================
-- Notes:
-- - 既存の1対1スレッドは topology = 'one_on_one'（デフォルト）
-- - group_policy_json は1対N専用、1対1では NULL
-- - thread_responses は1対Nでの回答記録用
-- - invitee_key は ContactsRepository.generateInviteeKey() と同じ形式
-- ============================================================
