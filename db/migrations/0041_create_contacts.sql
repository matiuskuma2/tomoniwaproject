-- ============================================================
-- Migration: 0041_create_contacts.sql
-- Purpose : Create contacts as the single source of truth (台帳)
-- Notes   : workspace_id is required. If workspaces are not yet modeled,
--           use 'ws-default' as a temporary workspace_id.
-- ============================================================

PRAGMA foreign_keys = ON;

-- Drop existing contacts table (確定版への移行)
DROP TABLE IF EXISTS contacts;

CREATE TABLE contacts (
  id               TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL, -- who owns/manages this contact book
  kind             TEXT NOT NULL CHECK (kind IN ('internal_user','external_person','list_member')),
  user_id          TEXT NULL,      -- internal link to users.id when kind=internal_user
  email            TEXT NULL,      -- lower-cased by application
  display_name     TEXT NULL,

  relationship_type TEXT NOT NULL DEFAULT 'external'
    CHECK (relationship_type IN ('family','coworker','external')),

  tags_json        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  notes            TEXT NULL,                  -- free text
  summary          TEXT NULL,                  -- future: AI-generated summary

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_owner
  ON contacts(workspace_id, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_email
  ON contacts(workspace_id, email);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_user
  ON contacts(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_relationship
  ON contacts(workspace_id, relationship_type);

-- Uniqueness (recommended)
-- one internal_user per workspace per owner
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_owner_user_id
  ON contacts(workspace_id, owner_user_id, user_id)
  WHERE user_id IS NOT NULL;

-- one email per workspace per owner (for external contacts)
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_owner_email
  ON contacts(workspace_id, owner_user_id, email)
  WHERE email IS NOT NULL;
