-- Migration 0045: business_cards テーブル作成
-- 目的: 名刺画像ストックと登録イベント記録（監査・再処理の土台）

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS business_cards;

CREATE TABLE business_cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  contact_id TEXT,
  r2_object_key TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'business_card',
  extracted_json TEXT NOT NULL DEFAULT '{}',
  extraction_status TEXT NOT NULL DEFAULT 'none' CHECK (extraction_status IN ('none', 'queued', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

-- Indexes for efficient queries
CREATE INDEX idx_business_cards_workspace_owner_occurred 
  ON business_cards(workspace_id, owner_user_id, occurred_at DESC);

CREATE INDEX idx_business_cards_workspace_owner_contact 
  ON business_cards(workspace_id, owner_user_id, contact_id);

CREATE INDEX idx_business_cards_extraction_status 
  ON business_cards(extraction_status, created_at DESC);
