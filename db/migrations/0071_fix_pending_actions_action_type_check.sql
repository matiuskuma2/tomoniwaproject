-- ============================================================
-- Migration: 0071_fix_pending_actions_action_type_check.sql
-- Phase2 Sprint 2-A: pending_actions の action_type CHECK制約を修正
-- Purpose: add_slots を action_type に追加
-- ============================================================
-- 問題: 0065で作成されたCHECK制約に add_slots が含まれていない
-- 解決: SQLiteではCHECK制約を変更できないため、テーブル再作成
-- ============================================================

PRAGMA foreign_keys = OFF;

-- 1. 一時テーブルにデータをバックアップ
CREATE TABLE pending_actions_backup AS SELECT * FROM pending_actions;

-- 2. 元のテーブルを削除
DROP TABLE pending_actions;

-- 3. 修正されたCHECK制約で新しいテーブルを作成
CREATE TABLE pending_actions (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL,
  thread_id         TEXT,
  
  -- Phase2: add_slots を追加
  action_type       TEXT NOT NULL CHECK (action_type IN (
    'send_invites',         -- 新規スレッド作成＋招待送信
    'add_invites',          -- 既存スレッドへの追加招待
    'send_finalize_notice', -- 確定通知送信
    'add_slots'             -- Phase2: 追加候補
  )),
  
  source_type       TEXT NOT NULL CHECK (source_type IN (
    'emails',     -- メールアドレス直接入力
    'list'        -- リストから選択
  )),
  
  payload_json      TEXT NOT NULL,
  summary_json      TEXT NOT NULL,
  confirm_token     TEXT UNIQUE NOT NULL,
  
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',              -- 確認待ち
    'confirmed_send',       -- 送信確認済み
    'confirmed_cancel',     -- キャンセル確認済み
    'confirmed_new_thread', -- 別スレッド作成確認済み
    'executed',             -- 実行済み
    'expired'               -- 期限切れ
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

-- 4. バックアップからデータを復元
INSERT INTO pending_actions SELECT * FROM pending_actions_backup;

-- 5. バックアップテーブルを削除
DROP TABLE pending_actions_backup;

-- 6. インデックスを再作成
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_actions_confirm_token 
ON pending_actions(confirm_token);

CREATE INDEX IF NOT EXISTS idx_pending_actions_tenant_status 
ON pending_actions(workspace_id, owner_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_actions_expires 
ON pending_actions(expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_actions_request_id 
ON pending_actions(request_id) WHERE request_id IS NOT NULL;

PRAGMA foreign_keys = ON;
