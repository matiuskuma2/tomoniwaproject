-- ============================================================
-- Migration: 0054_create_contact_channels.sql
-- Purpose : Contact channels (email/slack/chatwork) for ledger OS
-- Tenant  : workspace_id + owner_user_id
-- Scale   : 1億行前提（1人あたり複数チャネル）
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contact_channels (
  id            TEXT PRIMARY KEY,        -- UUID
  workspace_id  TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  contact_id    TEXT NOT NULL,            -- contacts.id
  channel_type  TEXT NOT NULL CHECK (channel_type IN ('email', 'slack', 'chatwork', 'line', 'phone')),
  channel_value TEXT NOT NULL,            -- normalized value (trim + lower for email)
  is_primary    INTEGER NOT NULL DEFAULT 0,
  verified      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  
  -- Note: Foreign key constraint commented out for SQLite compatibility
  -- Application layer must ensure referential integrity
  -- FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- ====== Uniqueness (運用インシデント防止) ======
-- 同一テナント内で同じチャネル値を重複させない
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_channels_tenant_type_value
  ON contact_channels(workspace_id, owner_user_id, channel_type, channel_value);

-- ====== Indexes ======

-- (A) Fast lookup per contact
CREATE INDEX IF NOT EXISTS idx_contact_channels_contact
  ON contact_channels(contact_id, created_at DESC);

-- (B) Fast search by channel value (email/slack/chatwork検索)
CREATE INDEX IF NOT EXISTS idx_contact_channels_tenant_type_value
  ON contact_channels(workspace_id, owner_user_id, channel_type, channel_value);

-- ====== 運用インシデント防止 ======
-- email正規化: trim + lower（アプリ層で保証）
-- slack/chatwork: trim（アプリ層で保証）
-- 重複防止: UNIQUE index で保証
