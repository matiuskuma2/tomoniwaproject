-- Migration 0046: contact_touchpoints テーブル作成
-- 目的: 「いつ誰と会った」「どこ経由で登録」の履歴（将来の関係性分析に効く）

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS contact_touchpoints;

CREATE TABLE contact_touchpoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'business_card' CHECK (channel IN ('business_card', 'manual', 'import', 'scheduling_thread', 'room', 'referral')),
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

-- Indexes for timeline queries
CREATE INDEX idx_contact_touchpoints_workspace_owner_occurred 
  ON contact_touchpoints(workspace_id, owner_user_id, occurred_at DESC);

CREATE INDEX idx_contact_touchpoints_contact_occurred 
  ON contact_touchpoints(contact_id, occurred_at DESC);

CREATE INDEX idx_contact_touchpoints_channel 
  ON contact_touchpoints(channel, occurred_at DESC);
