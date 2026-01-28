-- Migration: 0083_create_open_slots
-- Description: Create open_slots and open_slot_items tables for TimeRex-style scheduling (Phase B-4)
-- Date: 2026-01-28

-- ============================================================
-- open_slots: 公開設定（主催者が作成する空き枠の公開設定）
-- ============================================================
CREATE TABLE IF NOT EXISTS open_slots (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,              -- scheduling_threads への参照
  token TEXT UNIQUE NOT NULL,           -- 公開URL用トークン (/open/:token)
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  
  -- 条件
  time_min TEXT NOT NULL,               -- ISO8601 検索開始
  time_max TEXT NOT NULL,               -- ISO8601 検索終了
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  prefer TEXT DEFAULT 'afternoon',      -- morning/afternoon/evening/any
  days_json TEXT DEFAULT '["mon","tue","wed","thu","fri"]',
  slot_interval_minutes INTEGER DEFAULT 30,
  
  -- メタ
  title TEXT,
  invitee_name TEXT,
  invitee_email TEXT,
  
  -- 状態
  status TEXT NOT NULL DEFAULT 'active',  -- active/expired/cancelled/completed
  constraints_json TEXT,                -- 将来拡張用
  
  -- タイムスタンプ
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id)
);

-- Indexes for open_slots
CREATE INDEX IF NOT EXISTS idx_open_slots_token ON open_slots(token);
CREATE INDEX IF NOT EXISTS idx_open_slots_status_expires ON open_slots(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_open_slots_owner ON open_slots(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_open_slots_thread ON open_slots(thread_id);
CREATE INDEX IF NOT EXISTS idx_open_slots_workspace ON open_slots(workspace_id);

-- ============================================================
-- open_slot_items: 公開枠の実体（実際の空き枠のリスト）
-- ============================================================
CREATE TABLE IF NOT EXISTS open_slot_items (
  id TEXT PRIMARY KEY,
  open_slots_id TEXT NOT NULL,
  
  -- 枠の時間
  start_at TEXT NOT NULL,               -- ISO8601
  end_at TEXT NOT NULL,                 -- ISO8601
  
  -- 状態
  status TEXT NOT NULL DEFAULT 'available',  -- available/selected/disabled
  selected_at TEXT,                     -- 選択された日時
  selected_by TEXT,                     -- 選択者情報（invitee_key等）
  
  created_at TEXT NOT NULL,
  
  FOREIGN KEY (open_slots_id) REFERENCES open_slots(id) ON DELETE CASCADE
);

-- Indexes for open_slot_items
CREATE INDEX IF NOT EXISTS idx_open_slot_items_open_slots_id ON open_slot_items(open_slots_id);
CREATE INDEX IF NOT EXISTS idx_open_slot_items_status ON open_slot_items(status);
CREATE INDEX IF NOT EXISTS idx_open_slot_items_start ON open_slot_items(start_at);

-- ============================================================
-- Comments
-- ============================================================
-- open_slots: 主催者がTimeRex型の公開枠を作成するための設定テーブル
--   - token: 公開URL (/open/:token) で使用
--   - status: active(公開中), expired(期限切れ), cancelled(キャンセル), completed(選択済み)
--   - expires_at: 公開期限（自動失効用）
--
-- open_slot_items: 実際の空き枠のリスト
--   - status: available(選択可能), selected(選択済み), disabled(選択不可)
--   - selected_at/selected_by: 選択時に記録
--
-- Phase B-4: 1対1（R0: 他人）TimeRex型 Open Slots
-- - 相手が空き枠から好きな時間を選べる
-- - B-3の3回目誘導先として使用
