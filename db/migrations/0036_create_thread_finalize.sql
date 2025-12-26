-- ============================================================
-- Migration: 0036_create_thread_finalize.sql
-- Purpose : Store final decision for a thread (final slot + participants snapshot)
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS thread_finalize (
  thread_id                TEXT PRIMARY KEY,
  final_slot_id            TEXT,       -- scheduling_slots.slot_id
  finalize_policy          TEXT NOT NULL DEFAULT 'EARLIEST_VALID',
  finalized_by_user_id     TEXT,       -- host/admin user_id (optional)
  finalized_at             TEXT,       -- datetime('now')
  -- JSON array of invitee_keys that became participants (snapshot for audit)
  final_participants_json  TEXT NOT NULL DEFAULT '[]',
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (final_slot_id) REFERENCES scheduling_slots(slot_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_finalize_finalized_at
  ON thread_finalize(finalized_at);

CREATE INDEX IF NOT EXISTS idx_thread_finalize_policy
  ON thread_finalize(finalize_policy);
