-- ============================================================
-- Migration: 0025_admin_workspace_access_v2.sql
-- Purpose: Normalize admin_workspace_access to final schema (role, is_active)
-- Legacy schema backup: admin_workspace_access_legacy
-- Note: D1 compatible - no BEGIN/COMMIT
-- ============================================================
PRAGMA foreign_keys = OFF;

-- 1) Create new admin_workspace_access table (final schema)
CREATE TABLE IF NOT EXISTS admin_workspace_access_v2 (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,

  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','read_only')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,

  UNIQUE (admin_user_id, workspace_id)
);

-- 2) Backup old admin_workspace_access table
ALTER TABLE admin_workspace_access RENAME TO admin_workspace_access_legacy;

-- 3) Migrate old data to new schema
-- Convert: access_level -> role (viewer->read_only, owner/editor->admin)
INSERT OR REPLACE INTO admin_workspace_access_v2
(id, admin_user_id, workspace_id, role, is_active, created_at, updated_at)
SELECT
  id,
  admin_user_id,
  workspace_id,
  CASE access_level
    WHEN 'viewer' THEN 'read_only'
    ELSE 'admin'
  END AS role,
  1 AS is_active,
  unixepoch() AS created_at,
  unixepoch() AS updated_at
FROM admin_workspace_access_legacy;

-- 4) Replace: admin_workspace_access_v2 -> admin_workspace_access
ALTER TABLE admin_workspace_access_v2 RENAME TO admin_workspace_access;

-- 5) Create indexes
CREATE INDEX IF NOT EXISTS idx_admin_workspace_access_admin
  ON admin_workspace_access(admin_user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_admin_workspace_access_workspace
  ON admin_workspace_access(workspace_id, is_active);

PRAGMA foreign_keys = ON;
