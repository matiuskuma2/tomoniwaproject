-- Phase 1: Default workspace for single-tenant mode
-- Purpose: Ensure 'ws-default' exists in workspaces table
-- This is required for tenant isolation enforcement

PRAGMA foreign_keys = OFF;  -- Temporarily disable FK for system workspace

-- Insert default workspace (idempotent)
-- owner_user_id = NULL for system-level workspace
INSERT OR IGNORE INTO workspaces (
  id,
  name,
  slug,
  owner_user_id,
  plan_type,
  max_members,
  created_at,
  updated_at
) VALUES (
  'ws-default',
  'Default Workspace',
  'default',
  (SELECT id FROM users LIMIT 1),  -- Use first user as owner, or create system user
  'free',
  10000,     -- Large limit for single-tenant mode
  datetime('now'),
  datetime('now')
);

PRAGMA foreign_keys = ON;

-- Ensure all existing data uses 'ws-default'
-- This is critical for tenant isolation enforcement
