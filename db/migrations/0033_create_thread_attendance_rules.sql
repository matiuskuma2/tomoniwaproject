-- ============================================================
-- Migration: 0033_create_thread_attendance_rules.sql
-- Purpose : Store AttendanceRule JSON per scheduling thread
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS thread_attendance_rules (
  thread_id           TEXT PRIMARY KEY,
  version             INTEGER NOT NULL DEFAULT 1,
  -- JSON blob; validated at app-level
  rule_json           TEXT NOT NULL,
  -- e.g. 'EARLIEST_VALID', 'BEST_SCORE', 'HOST_CHOICE'
  finalize_policy     TEXT NOT NULL DEFAULT 'EARLIEST_VALID',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_attendance_rules_policy
  ON thread_attendance_rules(finalize_policy);
