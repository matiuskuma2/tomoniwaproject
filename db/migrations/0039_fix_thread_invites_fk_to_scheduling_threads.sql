-- ============================================================
-- Migration: 0039_fix_thread_invites_fk_to_scheduling_threads.sql
-- Purpose: Fix thread_invites FK to reference scheduling_threads instead of threads
-- ============================================================

PRAGMA foreign_keys = OFF;

-- Create new thread_invites table with correct FK
CREATE TABLE thread_invites_new (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  candidate_reason TEXT,
  invitee_key TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

-- Copy data from old table
INSERT INTO thread_invites_new 
SELECT id, thread_id, token, email, candidate_name, candidate_reason, invitee_key, status, expires_at, accepted_at, created_at
FROM thread_invites;

-- Drop old table
DROP TABLE thread_invites;

-- Rename new table
ALTER TABLE thread_invites_new RENAME TO thread_invites;

-- Recreate indexes
CREATE INDEX idx_thread_invites_token ON thread_invites(token);
CREATE INDEX idx_thread_invites_thread ON thread_invites(thread_id);

PRAGMA foreign_keys = ON;
