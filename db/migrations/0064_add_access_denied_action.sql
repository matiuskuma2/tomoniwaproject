-- ============================================================
-- Migration: 0064_add_access_denied_action.sql
-- Purpose : P0-2: Add 'access_denied' action to ledger_audit_events
-- Context : Security incident logging (cross-tenant access attempts)
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== Add 'access_denied' to CHECK constraint ======

-- SQLite does not support ALTER TABLE ... MODIFY COLUMN with CHECK
-- We need to recreate the table (v2 migration pattern)

-- Step 1: Create new table with updated CHECK constraint
CREATE TABLE IF NOT EXISTS ledger_audit_events_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  target_type   TEXT NOT NULL CHECK (target_type IN ('contact', 'channel', 'list_member', 'relationship')),
  target_id     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'access_denied')),
  payload_json  TEXT NOT NULL,
  request_id    TEXT NOT NULL,
  source_ip     TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data
INSERT INTO ledger_audit_events_new
SELECT * FROM ledger_audit_events;

-- Step 3: Drop old table
DROP TABLE ledger_audit_events;

-- Step 4: Rename new table
ALTER TABLE ledger_audit_events_new RENAME TO ledger_audit_events;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_ledger_audit_tenant_created
  ON ledger_audit_events(workspace_id, owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_audit_request
  ON ledger_audit_events(request_id);

CREATE INDEX IF NOT EXISTS idx_ledger_audit_target
  ON ledger_audit_events(target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_audit_created_at
  ON ledger_audit_events(created_at);

-- ====== Rationale ======
-- access_denied logs track security incidents (cross-tenant access attempts)
-- Essential for incident response and threat detection
-- Retention: 30 days (shorter than other logs due to high volume)
