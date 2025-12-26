-- ============================================================
-- Migration: 0034_create_scheduling_slots.sql
-- Purpose : Canonical candidate slots per thread (replaces ad-hoc candidates)
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS scheduling_slots (
  slot_id     TEXT PRIMARY KEY,  -- UUID
  thread_id   TEXT NOT NULL,
  start_at    TEXT NOT NULL,      -- ISO8601 (e.g. 2026-01-01T10:00:00+09:00 or Z)
  end_at      TEXT NOT NULL,      -- ISO8601
  timezone    TEXT NOT NULL,      -- IANA TZ (e.g. Asia/Tokyo)
  label       TEXT,               -- optional display label
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduling_slots_thread_start
  ON scheduling_slots(thread_id, start_at);

CREATE INDEX IF NOT EXISTS idx_scheduling_slots_thread_end
  ON scheduling_slots(thread_id, end_at);
