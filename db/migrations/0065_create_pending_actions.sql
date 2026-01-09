-- ============================================================
-- Migration: 0065_create_pending_actions.sql
-- Purpose: Beta A 送信確認機能（確認必須・冪等・監査対応）
-- Context: メール/リスト入力 → サマリ → 送る/キャンセル/別スレッドで
-- ============================================================
-- A-0 設計目的:
--   1. 送信確認をDBで必須化（フロント一時状態では二重送信・追跡不能のリスク）
--   2. リロード耐性（15分間有効なconfirm_token）
--   3. 監査対応（誰がいつ何を確認/実行したか追跡）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== 1. pending_actions テーブル ======
CREATE TABLE IF NOT EXISTS pending_actions (
  id                TEXT PRIMARY KEY,
  
  -- Tenant isolation (P0-1必須)
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL,
  
  -- 対象スレッド（新規作成時はNULL、追加招待時は既存thread_id）
  thread_id         TEXT,
  
  -- アクション種別
  action_type       TEXT NOT NULL CHECK (action_type IN (
    'send_invites',         -- 新規スレッド作成＋招待送信
    'add_invites',          -- 既存スレッドへの追加招待
    'send_finalize_notice'  -- 確定通知送信
  )),
  
  -- 入力ソース
  source_type       TEXT NOT NULL CHECK (source_type IN (
    'emails',     -- メール直接入力
    'list'        -- リストから
  )),
  
  -- ペイロード（PII最小化: invite_ids/list_idのみ、メール本体は別管理）
  -- サイズ制限: 8KB以下（巨大JSON防止）
  payload_json      TEXT NOT NULL,
  
  -- サマリ（UI表示用: preview最大5件 + スキップ内訳）
  summary_json      TEXT NOT NULL,
  
  -- 確認トークン（32文字以上、UNIQUE、crypto.randomUUID()ベース）
  confirm_token     TEXT UNIQUE NOT NULL,
  
  -- ステータス管理
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',              -- 確認待ち
    'confirmed_send',       -- 送信確定（executeで処理待ち）
    'confirmed_cancel',     -- キャンセル確定
    'confirmed_new_thread', -- 別スレッドで（executeで新規作成待ち）
    'executed',             -- 実行完了
    'expired'               -- 期限切れ
  )),
  
  -- 有効期限（15分）
  expires_at        TEXT NOT NULL,
  
  -- 確認/実行タイムスタンプ
  confirmed_at      TEXT,
  executed_at       TEXT,
  
  -- 冪等性担保用（同一request_idなら再送信しない）
  request_id        TEXT,
  
  -- エラー追跡
  last_error        TEXT,
  
  -- 作成日時
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- 外部キー
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE SET NULL
);

-- ====== 2. インデックス ======

-- 確認トークン検索（主要ルックアップ）
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_actions_confirm_token
  ON pending_actions(confirm_token);

-- テナント+ステータス検索（一覧取得用）
CREATE INDEX IF NOT EXISTS idx_pending_actions_tenant_status
  ON pending_actions(workspace_id, owner_user_id, status, created_at DESC);

-- 期限切れ検索（定期クリーンアップ用）
CREATE INDEX IF NOT EXISTS idx_pending_actions_expires
  ON pending_actions(expires_at)
  WHERE status = 'pending';

-- request_id検索（冪等性チェック用）
CREATE INDEX IF NOT EXISTS idx_pending_actions_request_id
  ON pending_actions(request_id)
  WHERE request_id IS NOT NULL;

-- ====== 設計ノート ======
-- 1. payload_json には invite_ids や list_id のみ格納し、メールアドレス本体は
--    thread_invites/contacts から取得する（PII肥大化防止）
-- 2. summary_json には preview (最大5件) と skipped_reasons (スキップ内訳) を含む
-- 3. confirm_token は15分で期限切れ、1回のみ使用可能
-- 4. request_id で execute の二重実行を防止（冪等性）
-- 5. 定期的に expired ステータスへ更新するCRONジョブを推奨
