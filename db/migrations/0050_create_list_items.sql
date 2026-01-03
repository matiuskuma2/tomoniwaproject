-- ============================================================
-- Migration: 0050_create_list_items.sql
-- Purpose: list_items (タスク/TODO/リストアイテム管理)
-- Scale: 1億行前提の設計
-- D1/SQLite compatible
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS list_items (
  id          TEXT PRIMARY KEY,           -- UUID
  workspace_id TEXT NOT NULL,             -- tenant key
  owner_user_id TEXT NOT NULL,            -- owner
  list_id     TEXT NOT NULL,              -- parent list
  contact_id  TEXT,                       -- optional: contacts.id
  title       TEXT NOT NULL,              -- short display (max 200 chars)
  note        TEXT,                       -- short note (long text → R2 later)
  status      INTEGER NOT NULL DEFAULT 0, -- 0=open, 1=done, 2=archived
  priority    INTEGER NOT NULL DEFAULT 0, -- 0..3
  due_at      TEXT,                       -- ISO8601 or NULL
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,                       -- soft delete
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

-- ====== Indexes (1億行対応) ======

-- (A) List view: workspace + owner + list + newest first
-- 用途: GET /api/lists/:id/items (cursor pagination)
CREATE INDEX IF NOT EXISTS idx_list_items_workspace_owner_list_created
  ON list_items(workspace_id, owner_user_id, list_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- (B) Status view: workspace + owner + status + recent updates
-- 用途: 「今日やるタスク」「完了済み」などのフィルタ
CREATE INDEX IF NOT EXISTS idx_list_items_workspace_owner_status_updated
  ON list_items(workspace_id, owner_user_id, status, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- (C) Due view: workspace + owner + due_at
-- 用途: 期限順ソート
CREATE INDEX IF NOT EXISTS idx_list_items_workspace_owner_due
  ON list_items(workspace_id, owner_user_id, due_at, id DESC)
  WHERE deleted_at IS NULL AND due_at IS NOT NULL;

-- (D) Contact view: workspace + owner + contact + newest
-- 用途: 「この人に関するタスク」
CREATE INDEX IF NOT EXISTS idx_list_items_workspace_owner_contact_created
  ON list_items(workspace_id, owner_user_id, contact_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND contact_id IS NOT NULL;

-- ====== 運用インシデント防止 ======
-- title長制限: アプリケーション層で200文字まで
-- note長制限: アプリケーション層で10KB程度、超えたらR2へ
-- soft delete: deleted_at IS NULL で絞る（物理削除は別ジョブで）
