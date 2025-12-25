-- ============================================================
-- Migration: 0015_system_settings.sql
-- Purpose: System-wide settings (email, OGP, legal URLs)
-- ============================================================
PRAGMA foreign_keys = ON;

-- ------------------------------------------------
-- system_settings: Key-value store for global config
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,                   -- e.g. 'email.from_address'
  value_json TEXT NOT NULL,               -- store string/number/object as json
  updated_by_admin_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (updated_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

-- Note: key is already PRIMARY KEY, no additional index needed
