-- ============================================================
-- Migration: 0032_add_invitee_key_to_thread_invites.sql
-- Purpose : Add invitee_key to thread_invites for unified invite identity
-- Notes   : invitee_key format (v1)
--          - u:<user_id>                     (registered user)
--          - e:<sha256_16(email_lowercase)>  (external email)
--          - lm:<list_member_id>             (list member)
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1) Add invitee_key (nullable for now; backfill later)
ALTER TABLE thread_invites
ADD COLUMN invitee_key TEXT;

-- 2) Index for lookups by invitee identity
CREATE INDEX IF NOT EXISTS idx_thread_invites_invitee_key
  ON thread_invites(invitee_key);

-- 3) Helpful composite index for thread-level queries
CREATE INDEX IF NOT EXISTS idx_thread_invites_thread_invitee
  ON thread_invites(thread_id, invitee_key);

-- 4) Optional: prevent duplicate invites per thread per invitee (nullable-safe)
-- SQLite allows multiple NULLs; after backfill you get true uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_invites_thread_invitee
  ON thread_invites(thread_id, invitee_key);
