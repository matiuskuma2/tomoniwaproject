-- ============================================================
-- Migration: 0037_backfill_invitee_keys.sql
-- Purpose : Backfill invitee_key for existing thread_invites
-- Notes   : Run AFTER 0032 is applied
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1) External emails: e:<email>
-- For now, use simple email-based key (will migrate to sha256 later via app)
UPDATE thread_invites
SET invitee_key = 'e:' || lower(email)
WHERE email IS NOT NULL
  AND invitee_key IS NULL;

-- 2) Future: SHA256-based keys will be handled by application-level backfill
-- See: apps/api/src/scripts/backfill-invitee-keys.ts
-- This will convert 'e:email@example.com' to 'e:sha256_16(email)'
