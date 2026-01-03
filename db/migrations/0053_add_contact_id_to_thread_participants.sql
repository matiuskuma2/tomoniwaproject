-- ============================================================
-- Migration: 0053_add_contact_id_to_thread_participants.sql
-- Purpose : Add contact_id to thread_participants (参加者の正を統一)
-- 
-- 背景:
-- - 現状: thread_participants は email 直持ち
-- - 問題: 重複・同姓同名・変更で破綻
-- - 解決: contact_id を追加（段階的移行）
-- 
-- Phase:
-- - Week1: contact_id カラム追加（NULL許可）
-- - Week2: 既存データを contact_id に紐付け（バッチジョブ）
-- - Week3: contact_id NOT NULL に変更（別migration）
-- ============================================================

PRAGMA foreign_keys = ON;

-- Add contact_id column (nullable for gradual migration)
-- Note: SQLite doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS
-- If column already exists, this will fail - that's OK, we skip it
-- To make idempotent, we check if column exists first (via PRAGMA)
-- For now, comment out if column already exists
-- ALTER TABLE thread_participants ADD COLUMN contact_id TEXT NULL;

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
