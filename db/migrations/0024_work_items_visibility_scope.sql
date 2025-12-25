-- ============================================================
-- Migration: 0024_work_items_visibility_scope.sql
-- Purpose: Add visibility_scope column for future expansion (quest/squad)
-- Legacy: visibility(private/room) kept for backward compatibility
-- New: visibility_scope(private/room/quest/squad) is the source of truth
-- ============================================================
PRAGMA foreign_keys = ON;

-- Add new visibility_scope column with extended enum
ALTER TABLE work_items
ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility_scope IN ('private','room','quest','squad'));

-- Migrate existing data: visibility -> visibility_scope
UPDATE work_items
SET visibility_scope = CASE visibility
  WHEN 'room' THEN 'room'
  ELSE 'private'
END
WHERE visibility_scope = 'private';

-- Create indexes for new column
CREATE INDEX IF NOT EXISTS idx_work_items_scope_room_start
  ON work_items(visibility_scope, room_id, start_at);

CREATE INDEX IF NOT EXISTS idx_work_items_user_scope_start
  ON work_items(user_id, visibility_scope, start_at);
