-- ============================================================
-- Migration: 0040_create_remind_log.sql
-- Purpose: Track reminder emails to prevent spam
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS remind_log (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  reminded_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remind_log_thread_user
  ON remind_log(thread_id, created_by_user_id, created_at DESC);
