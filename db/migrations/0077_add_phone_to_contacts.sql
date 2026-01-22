-- ============================================================
-- Migration: 0077_add_phone_to_contacts.sql
-- Purpose: Add phone column to contacts for SMS notifications
-- P2-E2: SMS通知（Twilio）対応
-- ============================================================

-- phone カラムを追加（E.164形式推奨: +81...）
ALTER TABLE contacts
ADD COLUMN phone TEXT;

-- インデックス追加（電話番号での検索用）
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_phone
  ON contacts(workspace_id, phone);

-- ============================================================
-- Note:
-- - phone は E.164 形式を推奨（+81901234567）
-- - 招待時に contacts から phone を取得してSMS送信
-- - 既存データは NULL のまま（backfill不要）
-- ============================================================
