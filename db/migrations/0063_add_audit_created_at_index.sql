-- ============================================================
-- Migration: 0063_add_audit_created_at_index.sql
-- Purpose : P0-2: Add index for efficient audit log pruning
-- Context : Scheduled pruning (DELETE ... WHERE created_at < ?) needs index
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== Index for Audit Log Pruning ======

-- (D) created_at 単体 index（prune 用）
-- Without this index, DELETE FROM ledger_audit_events WHERE created_at < ?
-- would cause full table scan, making cron slow as logs grow.
CREATE INDEX IF NOT EXISTS idx_ledger_audit_created_at
  ON ledger_audit_events(created_at);

CREATE INDEX IF NOT EXISTS idx_list_item_events_created_at
  ON list_item_events(created_at);

CREATE INDEX IF NOT EXISTS idx_billing_events_created_at
  ON billing_events(created_at);

-- ====== Rationale ======
-- Scheduled pruning deletes old logs daily (0 2 * * *)
-- Without created_at index, DELETE becomes O(N) scan
-- With index, DELETE is O(log N + rows_deleted)
-- Essential for long-term stability (prevents "silent slowdown")
