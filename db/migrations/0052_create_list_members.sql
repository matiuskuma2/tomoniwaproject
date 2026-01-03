-- ============================================================
-- Migration: 0052_create_list_members.sql (修正版)
-- Purpose : list_members に owner_user_id を追加（tenant isolation強化）
-- Tenant  : workspace_id + owner_user_id
-- Scale   : 1億行前提（10万ユーザー × 1000リスト × 平均100人）
-- ============================================================

-- Add owner_user_id column (if not exists)
-- Note: SQLiteはALTER TABLE ADD COLUMN IF NOT EXISTSをサポートしないため、
-- 既に存在する場合はエラーを無視する必要がある
ALTER TABLE list_members ADD COLUMN owner_user_id TEXT;

-- Update existing rows to have owner_user_id from lists table
UPDATE list_members
SET owner_user_id = (
  SELECT owner_user_id
  FROM lists
  WHERE lists.id = list_members.list_id
)
WHERE owner_user_id IS NULL;

-- Add added_at column (if not exists)
ALTER TABLE list_members ADD COLUMN added_at TEXT DEFAULT (datetime('now'));

-- Add added_by column (if not exists)
ALTER TABLE list_members ADD COLUMN added_by TEXT;

-- ====== Uniqueness (運用インシデント防止) ======
-- 既存のuq_list_members_list_contactを削除して再作成
DROP INDEX IF EXISTS uq_list_members_list_contact;

-- 新しいUNIQUE INDEX（owner_user_id追加）
CREATE UNIQUE INDEX IF NOT EXISTS uq_list_members_tenant_list_contact
  ON list_members(workspace_id, owner_user_id, list_id, contact_id);

-- ====== Indexes (1億行対応) ======

-- (A) List view: リスト内のメンバー一覧（cursor pagination）
-- 用途: GET /api/lists/:id/members?cursor=...
DROP INDEX IF EXISTS idx_list_members_list;
CREATE INDEX IF NOT EXISTS idx_list_members_tenant_list_added
  ON list_members(workspace_id, owner_user_id, list_id, added_at DESC, id DESC);

-- (B) Contact view: このContactがどのリストに所属しているか
-- 用途: GET /api/contacts/:id/lists
DROP INDEX IF EXISTS idx_list_members_contact;
CREATE INDEX IF NOT EXISTS idx_list_members_tenant_contact_added
  ON list_members(workspace_id, owner_user_id, contact_id, added_at DESC, id DESC);

-- ====== 運用インシデント防止 ======
-- 重複防止: UNIQUE index で保証
-- Bulk追加: INSERT OR IGNORE（冪等性）
-- 削除: 物理削除（soft deleteは不要）
-- 外部キー: アプリケーション層で整合性保証（D1のFKは制約が厳しい）
