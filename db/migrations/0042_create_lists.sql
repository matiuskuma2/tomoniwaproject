-- ============================================================
-- Migration: 0042_create_lists.sql
-- Purpose : Create lists for segmentation (メルマガ/一括招待対象)
-- ============================================================

PRAGMA foreign_keys = ON;

-- Drop existing lists table (確定版への移行)
DROP TABLE IF EXISTS lists;

CREATE TABLE lists (
  id            TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  owner_user_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lists_workspace_owner
  ON lists(workspace_id, owner_user_id, created_at DESC);

-- Optional: prevent same name duplicates per owner
CREATE UNIQUE INDEX IF NOT EXISTS uq_lists_owner_name
  ON lists(workspace_id, owner_user_id, name);
