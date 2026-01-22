-- ============================================================
-- Migration: 0076_add_sms_to_workspace_notification_settings.sql
-- Purpose: Add SMS notification settings to workspace_notification_settings
-- P2-E2: SMS通知（Twilio）対応
-- ============================================================

-- SMS有効/無効フラグ
ALTER TABLE workspace_notification_settings
ADD COLUMN sms_enabled INTEGER NOT NULL DEFAULT 0;

-- SMS送信元番号（Twilio購入番号、E.164形式）
-- Workers Secretに保存するのでここでは保存しない場合もある
ALTER TABLE workspace_notification_settings
ADD COLUMN sms_from_number TEXT;

-- ============================================================
-- Note:
-- - Twilio Account SID / Auth Token は Workers Secret に保存
--   (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
-- - sms_from_number は Twilio で購入した電話番号（E.164形式）
-- - sms_enabled = 1 かつ phone がある招待者にのみSMS送信
-- ============================================================
