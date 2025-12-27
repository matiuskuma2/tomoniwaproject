-- ============================================================
-- Migration: 0043_create_list_members.sql
-- Purpose : Create list_members linking lists <-> contacts
-- ============================================================

PRAGMA foreign_keys = ON;

-- Drop existing list_members table (確定版への移行)
DROP TABLE IF EXISTS list_members;

CREATE TABLE list_members (
  id            TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  list_id       TEXT NOT NULL,
  contact_id    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- one contact belongs once per list
CREATE UNIQUE INDEX IF NOT EXISTS uq_list_members_list_contact
  ON list_members(list_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_list_members_list
  ON list_members(list_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_list_members_contact
  ON list_members(contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_list_members_workspace
  ON list_members(workspace_id, list_id);
