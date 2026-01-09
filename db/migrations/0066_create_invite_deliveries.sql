-- ============================================================
-- Migration: 0066_create_invite_deliveries.sql
-- Purpose: Beta A 配信追跡（メール/in_app通知の送達状況管理）
-- Context: 送信 → 配信状況追跡 → 再送対応 → 監査
-- ============================================================
-- A-0 設計目的:
--   1. メールと in_app 通知の送達状況を一元管理
--   2. 失敗時の再送対応（キュー+DLQパターン）
--   3. 監査対応（いつ誰にどのチャネルで送ったか追跡）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== 1. invite_deliveries テーブル ======
CREATE TABLE IF NOT EXISTS invite_deliveries (
  id                TEXT PRIMARY KEY,
  
  -- Tenant isolation (P0-1必須)
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL,
  
  -- 対象スレッド・招待
  thread_id         TEXT NOT NULL,
  invite_id         TEXT,  -- thread_invites.id (NULLの場合は確定通知など)
  
  -- 配信種別
  delivery_type     TEXT NOT NULL CHECK (delivery_type IN (
    'invite_sent',        -- 招待送信
    'finalized_notice',   -- 確定通知
    'reminder'            -- リマインダー（将来用）
  )),
  
  -- 配信チャネル
  channel           TEXT NOT NULL CHECK (channel IN (
    'email',    -- メール
    'in_app'    -- Inbox通知
  )),
  
  -- 宛先情報（チャネルに応じてどちらかがNOT NULL）
  recipient_email   TEXT,
  recipient_user_id TEXT,
  
  -- ステータス管理
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',       -- キュー投入済み
    'sent',         -- 送信完了（プロバイダに渡した）
    'delivered',    -- 配達確認済み（in_appのみ意味あり）
    'failed',       -- 失敗（last_errorに詳細）
    'skipped'       -- スキップ（重複など）
  )),
  
  -- プロバイダ情報（email: Resend/SES/etc, in_app: 'inbox'）
  provider          TEXT,
  provider_message_id TEXT,  -- プロバイダの返却ID（追跡用）
  
  -- キュー追跡
  queue_job_id      TEXT,    -- EMAIL_QUEUEのjob_id
  
  -- エラー追跡
  last_error        TEXT,
  retry_count       INTEGER DEFAULT 0,
  
  -- タイムスタンプ
  queued_at         TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at           TEXT,
  delivered_at      TEXT,
  failed_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- 外部キー
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES thread_invites(id) ON DELETE SET NULL,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
  
  -- 制約: email or user_id のどちらかは必須
  CHECK (recipient_email IS NOT NULL OR recipient_user_id IS NOT NULL)
);

-- ====== 2. インデックス ======

-- スレッド別配信一覧（主催者ダッシュボード用）
CREATE INDEX IF NOT EXISTS idx_invite_deliveries_thread
  ON invite_deliveries(thread_id, delivery_type, created_at DESC);

-- 招待別配信追跡
CREATE INDEX IF NOT EXISTS idx_invite_deliveries_invite
  ON invite_deliveries(invite_id, channel)
  WHERE invite_id IS NOT NULL;

-- テナント+ステータス検索（管理画面用）
CREATE INDEX IF NOT EXISTS idx_invite_deliveries_tenant_status
  ON invite_deliveries(workspace_id, owner_user_id, status, created_at DESC);

-- 失敗リスト（再送対象抽出用）
CREATE INDEX IF NOT EXISTS idx_invite_deliveries_failed
  ON invite_deliveries(status, retry_count)
  WHERE status = 'failed';

-- キューjob_id検索（EMAIL_QUEUEコンシューマ用）
CREATE INDEX IF NOT EXISTS idx_invite_deliveries_queue_job
  ON invite_deliveries(queue_job_id)
  WHERE queue_job_id IS NOT NULL;

-- ユーザー別in_app通知（Inbox関連）
CREATE INDEX IF NOT EXISTS idx_invite_deliveries_recipient_user
  ON invite_deliveries(recipient_user_id, delivery_type, created_at DESC)
  WHERE recipient_user_id IS NOT NULL AND channel = 'in_app';

-- ====== 設計ノート ======
-- 1. channel='email' の場合は recipient_email 必須、provider は 'resend' など
-- 2. channel='in_app' の場合は recipient_user_id 必須、provider='inbox'
-- 3. アプリユーザー判定は「メール一致でis_app_user=true」（Beta A）
-- 4. 失敗時は retry_count をインクリメントし、3回まで再送（将来実装）
-- 5. provider_message_id でプロバイダ側の配達状況を紐付け可能
