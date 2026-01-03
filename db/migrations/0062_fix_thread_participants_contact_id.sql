-- ============================================================
-- Migration: 0062_fix_thread_participants_contact_id.sql
-- Purpose : Fix 0053 (add contact_id column to thread_participants)
-- 
-- Background:
-- - 0053 was commented out due to missing contact_id column
-- - This migration properly adds the column and index
-- 
-- Phase:
-- - Week1: contact_id column addition (NULL allowed)
-- - Week2: backfill contact_id (batch job)
-- - Week3: contact_id NOT NULL constraint (separate migration)
-- ============================================================

PRAGMA foreign_keys = ON;

-- Add contact_id column (nullable for gradual migration)
-- Note: SQLite doesn't support IF NOT EXISTS for ADD COLUMN
-- If this fails (column already exists), it's safe to skip
ALTER TABLE thread_participants ADD COLUMN contact_id TEXT NULL;

-- Add foreign key constraint (SQLiteでは後付け不可のため、アプリ層で保証)
-- FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL

-- Add index for fast lookup by contact_id
CREATE INDEX IF NOT EXISTS idx_thread_participants_contact_id
  ON thread_participants(contact_id);

-- Add unique constraint for thread_id + contact_id (future)
-- Note: SQLiteでは既存UNIQUEに追加不可のため、Week3で再作成予定
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_participants_thread_contact
--   ON thread_participants(thread_id, contact_id)
--   WHERE contact_id IS NOT NULL;
