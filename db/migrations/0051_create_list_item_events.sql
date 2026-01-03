-- ============================================================
-- Migration: 0051_create_list_item_events.sql
-- Purpose: list_item_events (監査ログ / 運用事故の保険)
-- D1/SQLite compatible
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS list_item_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,           -- tenant key
  owner_user_id TEXT NOT NULL,           -- who owns the list_item
  list_item_id TEXT NOT NULL,            -- target list_item.id
  action       TEXT NOT NULL,            -- created/updated/status_changed/deleted/etc
  payload_json TEXT NOT NULL,            -- minimal diff JSON
  request_id   TEXT NOT NULL,            -- trace request
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ====== Indexes ======

-- (A) Item history: workspace + owner + item + newest first
-- 用途: 「このアイテムの履歴を見る」
CREATE INDEX IF NOT EXISTS idx_list_item_events_workspace_owner_item_created
  ON list_item_events(workspace_id, owner_user_id, list_item_id, created_at DESC);

-- (B) Request trace: request_id で追跡
-- 用途: 運用インシデント時に「このリクエストで何が起きたか」を追う
CREATE INDEX IF NOT EXISTS idx_list_item_events_request
  ON list_item_events(request_id);

-- ====== 運用ガイド ======
-- payload_json: { "old": { "status": 0 }, "new": { "status": 1 } } など最小差分
-- action: created/updated/status_changed/deleted/restored など
-- 保存期間: 90日（定期削除ジョブで古いイベントを消す）
