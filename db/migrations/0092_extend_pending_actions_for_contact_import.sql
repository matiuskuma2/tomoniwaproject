-- ============================================================
-- Migration: 0092_extend_pending_actions_for_contact_import.sql
-- PR-D-API-1: pending_actions に contact_import 対応を追加
-- 
-- 変更点:
--   1) action_type CHECK に 'contact_import' を追加
--   2) source_type CHECK に 'contacts' を追加（contact_import用）
--   3) status CHECK に 'cancelled' を追加（cancel用）
--   4) thread_id を NULLable に変更（contact_importは thread 不使用）
--
-- NOT NULL 維持方針:
--   - confirm_token: NOT NULL 維持。contact_import でも UUID を埋める
--   - source_type: NOT NULL 維持。contact_import では 'contacts' を使用
--   ※ 既存 pending_actions 消費者への影響をゼロにするため
--
-- SQLiteではCHECK制約を変更できないためテーブル再作成
-- ============================================================

PRAGMA foreign_keys = OFF;

-- 1. バックアップ
CREATE TABLE pending_actions_backup AS SELECT * FROM pending_actions;

-- 2. 元テーブル削除
DROP TABLE pending_actions;

-- 3. 新テーブル（拡張済みCHECK制約）
CREATE TABLE pending_actions (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL,
  thread_id         TEXT,
  
  action_type       TEXT NOT NULL CHECK (action_type IN (
    'send_invites',
    'add_invites',
    'send_finalize_notice',
    'add_slots',
    'contact_import'
  )),
  
  source_type       TEXT NOT NULL CHECK (source_type IN (
    'emails',
    'list',
    'contacts'
  )),
  
  payload_json      TEXT NOT NULL,
  summary_json      TEXT NOT NULL,
  
  confirm_token     TEXT NOT NULL UNIQUE,
  
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'confirmed_send',
    'confirmed_cancel',
    'confirmed_new_thread',
    'executed',
    'expired',
    'cancelled'
  )),
  
  expires_at        TEXT NOT NULL,
  confirmed_at      TEXT,
  executed_at       TEXT,
  request_id        TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE SET NULL
);

-- 4. データ復元
INSERT INTO pending_actions SELECT * FROM pending_actions_backup;

-- 5. バックアップ削除
DROP TABLE pending_actions_backup;

-- 6. インデックス再作成
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_actions_confirm_token
  ON pending_actions(confirm_token);

CREATE INDEX IF NOT EXISTS idx_pending_actions_tenant_status
  ON pending_actions(workspace_id, owner_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_actions_expires
  ON pending_actions(expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_actions_request_id
  ON pending_actions(request_id) WHERE request_id IS NOT NULL;

-- contact_import用: owner_user_id + action_type で高速検索
CREATE INDEX IF NOT EXISTS idx_pending_actions_owner_action
  ON pending_actions(owner_user_id, action_type, status);

PRAGMA foreign_keys = ON;
