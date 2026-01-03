-- ============================================================
-- Migration: 0061_add_workspace_id_to_scheduling_threads.sql
-- Purpose : Tenant isolation for scheduling_threads (Phase1)
-- DB      : D1 / SQLite
-- Rule    : Phase1 uses logical workspace_id = 'ws-default'
-- ============================================================

-- ⚠️ SQLiteには ADD COLUMN IF NOT EXISTS が弱い環境がある
-- このmigrationは「未適用環境でのみ」実行される前提（番号増やすだけ運用）

ALTER TABLE scheduling_threads
  ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws-default';

-- Query speed (list by owner + cursor order)
CREATE INDEX IF NOT EXISTS idx_sched_threads_ws_owner_created
  ON scheduling_threads(workspace_id, organizer_user_id, created_at DESC, id DESC);
