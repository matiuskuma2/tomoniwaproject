-- Migration: 0084_add_workmate_relation_type.sql
-- Purpose: Phase D-1 - Add 'workmate' relation type and permission_preset
-- Date: 2026-01-28
--
-- Changes:
-- 1. Add 'workmate' to relationships.relation_type
-- 2. Add 'workmate' to relationship_requests.requested_type
-- 3. Add permission_preset column to relationships
--
-- D1 Compatible: No BEGIN/COMMIT, no CREATE INDEX IF NOT EXISTS alternative

-- ============================================================
-- Step 1: Migrate relationships table (add workmate + permission_preset)
-- ============================================================

PRAGMA foreign_keys = OFF;

-- Create new relationships table with updated constraints
CREATE TABLE relationships_new (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('family', 'partner', 'stranger', 'workmate')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'blocked')),
  permissions_json TEXT NOT NULL DEFAULT '{}',
  -- New: permission_preset for quick permission lookup
  -- Values: 'workmate_default', 'family_view_freebusy', 'family_can_write', NULL (custom)
  permission_preset TEXT DEFAULT NULL CHECK (permission_preset IN ('workmate_default', 'family_view_freebusy', 'family_can_write', NULL)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_a_id, user_b_id)
);

-- Migrate existing data
INSERT INTO relationships_new (id, user_a_id, user_b_id, relation_type, status, permissions_json, permission_preset, created_at, updated_at)
SELECT 
  id, 
  user_a_id, 
  user_b_id, 
  relation_type, 
  status, 
  permissions_json,
  -- Set default preset based on relation_type
  CASE 
    WHEN relation_type = 'family' THEN 'family_view_freebusy'
    ELSE NULL 
  END,
  created_at, 
  updated_at
FROM relationships;

-- Drop old table and rename
DROP TABLE relationships;
ALTER TABLE relationships_new RENAME TO relationships;

-- Recreate indexes
CREATE INDEX idx_relationships_pair ON relationships(user_a_id, user_b_id);
CREATE INDEX idx_relationships_user_a ON relationships(user_a_id, status);
CREATE INDEX idx_relationships_user_b ON relationships(user_b_id, status);
CREATE INDEX idx_relationships_type ON relationships(relation_type);

-- ============================================================
-- Step 2: Migrate relationship_requests table (add workmate)
-- ============================================================

-- Create new relationship_requests table with updated constraints
CREATE TABLE relationship_requests_new (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL,
  invitee_user_id TEXT,
  invitee_email TEXT,
  requested_type TEXT NOT NULL CHECK (requested_type IN ('family', 'partner', 'workmate')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  token TEXT NOT NULL UNIQUE,
  message TEXT,
  -- New: permission_preset for family requests
  permission_preset TEXT DEFAULT NULL CHECK (permission_preset IN ('workmate_default', 'family_view_freebusy', 'family_can_write', NULL)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migrate existing data
INSERT INTO relationship_requests_new (id, inviter_user_id, invitee_user_id, invitee_email, requested_type, status, token, message, permission_preset, expires_at, created_at, responded_at)
SELECT 
  id, 
  inviter_user_id, 
  invitee_user_id, 
  invitee_email, 
  requested_type, 
  status, 
  token, 
  message,
  -- Set default preset for existing family requests
  CASE 
    WHEN requested_type = 'family' THEN 'family_view_freebusy'
    ELSE NULL 
  END,
  expires_at, 
  created_at, 
  responded_at
FROM relationship_requests;

-- Drop old table and rename
DROP TABLE relationship_requests;
ALTER TABLE relationship_requests_new RENAME TO relationship_requests;

-- Recreate indexes
CREATE INDEX idx_relationship_requests_inviter ON relationship_requests(inviter_user_id, status, created_at);
CREATE INDEX idx_relationship_requests_invitee ON relationship_requests(invitee_user_id, status, created_at);
CREATE INDEX idx_relationship_requests_email ON relationship_requests(invitee_email, status, created_at);
CREATE INDEX idx_relationship_requests_token ON relationship_requests(token);

PRAGMA foreign_keys = ON;

-- ============================================================
-- Notes:
-- ============================================================
-- 
-- relation_type values (after migration):
--   - 'stranger': No relationship (R0)
--   - 'workmate': Work colleague (R1) - NEW
--   - 'family': Family member (R2)
--   - 'partner': Partner (legacy, may deprecate)
--
-- permission_preset values:
--   - 'workmate_default': Can see freebusy, receive notifications
--   - 'family_view_freebusy': Can see freebusy, detailed availability
--   - 'family_can_write': Can create events on behalf (future)
--   - NULL: Custom permissions (use permissions_json)
--
-- SSOT for contacts: contacts.relationship_type remains separate
--   - 'external' (default) → stranger
--   - 'coworker' → workmate (future: rename to 'workmate')
--   - 'family' → family
