-- ============================================================
-- Migration: 0075_add_phone_to_thread_invites.sql
-- Purpose: Add phone column to thread_invites for SMS notifications
-- P2-E2: SMS通知（Twilio）対応
-- ============================================================

-- phone カラムを追加（E.164形式推奨: +81...）
-- NULL許容（電話番号がない招待も許可）
ALTER TABLE thread_invites
ADD COLUMN phone TEXT;

-- インデックス追加（電話番号での検索用）
CREATE INDEX IF NOT EXISTS idx_thread_invites_phone 
  ON thread_invites(phone);

-- ============================================================
-- Note:
-- - phone は E.164 形式を推奨（+81901234567）
-- - NULL の場合はSMS送信しない
-- - 既存データは NULL のまま（backfill不要）
-- ============================================================
