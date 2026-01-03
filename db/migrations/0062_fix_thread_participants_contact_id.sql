-- ============================================================
-- Migration: 0062_fix_thread_participants_contact_id.sql
-- Purpose : Fix 0053 (add contact_id column to thread_participants)
-- 
-- Background:
-- - 0053 was commented out due to missing contact_id column
-- - This migration properly adds the column and index
-- - P0: NOT idempotent (will fail if column exists - this is INTENTIONAL)
-- 
-- Why NOT idempotent?
-- - SQLite doesn't support IF NOT EXISTS for ADD COLUMN
-- - Trying to make it "safe" leads to complex workarounds
-- - Migration number ensures it runs ONCE per environment
-- - If this fails, it means the migration was already applied
-- 
-- Phase:
-- - Week1: contact_id column addition (NULL allowed)
-- - Week2: backfill contact_id (batch job)
-- - Week3: contact_id NOT NULL constraint (separate migration)
-- ============================================================

PRAGMA foreign_keys = ON;

-- Add contact_id column (nullable for gradual migration)
-- Note: This will FAIL if column already exists
-- That's OK - migration tracking ensures this runs only once
ALTER TABLE thread_participants ADD COLUMN contact_id TEXT NULL;

-- Add index for fast lookup by contact_id
-- CREATE INDEX IF NOT EXISTS is safe for re-application
CREATE INDEX IF NOT EXISTS idx_thread_participants_contact_id
  ON thread_participants(contact_id);

-- Add unique constraint for thread_id + contact_id (future)
-- Note: SQLiteでは既存UNIQUEに追加不可のため、Week3で再作成予定
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_participants_thread_contact
--   ON thread_participants(thread_id, contact_id)
--   WHERE contact_id IS NOT NULL;
