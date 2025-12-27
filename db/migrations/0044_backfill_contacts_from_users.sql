-- ============================================================
-- Migration: 0044_backfill_contacts_from_users.sql
-- Purpose : Backfill contacts from users as internal_user contacts
-- Strategy:
--   - Create one "self-owned" contact entry per user in a default workspace.
--   - workspace_id uses 'ws-default' until proper workspaces are introduced.
-- ============================================================

PRAGMA foreign_keys = ON;

-- Create a contact row for each user if not exists
-- contacts.id: 32-hex random id (UUID-like)
INSERT INTO contacts (
  id,
  workspace_id,
  owner_user_id,
  kind,
  user_id,
  email,
  display_name,
  relationship_type,
  tags_json,
  notes,
  summary,
  created_at,
  updated_at
)
SELECT
  lower(hex(randomblob(16))) AS id,
  'ws-default'               AS workspace_id,
  u.id                       AS owner_user_id,
  'internal_user'            AS kind,
  u.id                       AS user_id,
  lower(u.email)             AS email,
  u.display_name             AS display_name,
  'external'                 AS relationship_type,
  '[]'                       AS tags_json,
  NULL                       AS notes,
  NULL                       AS summary,
  datetime('now')            AS created_at,
  datetime('now')            AS updated_at
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM contacts c
  WHERE c.workspace_id = 'ws-default'
    AND c.owner_user_id = u.id
    AND c.user_id = u.id
);

-- If you already have a workspace model later:
-- 1) create user->workspace mapping
-- 2) update contacts.workspace_id from 'ws-default' to real workspace_id
