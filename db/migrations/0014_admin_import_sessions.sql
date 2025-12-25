-- ============================================================
-- Migration: 0014_admin_import_sessions.sql
-- Purpose: Create import_sessions table for bulk member import
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS import_sessions (
  id TEXT PRIMARY KEY,

  admin_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  list_id TEXT NOT NULL,

  source TEXT NOT NULL DEFAULT 'paste' CHECK (source IN ('paste','csv')),
  raw_text TEXT NOT NULL,

  preview_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed','committed','failed')),

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_admin_created
  ON import_sessions(admin_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_import_sessions_list_created
  ON import_sessions(list_id, created_at);
