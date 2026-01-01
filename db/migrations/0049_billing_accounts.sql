-- ============================================================
-- Migration: 0049_billing_accounts.sql
-- Purpose: MyASP課金連携 - 現在の課金状態（最新イベントで上書き）
-- Phase: Next-11 Week1 Day1
-- ============================================================

-- ------------------------------------------------
-- billing_accounts: ユーザーごとの現在の課金状態
-- ------------------------------------------------
-- 目的:
--   1. 現在状態の正: 最新のplan/status/amountを保持
--   2. Gate統合: status=2/4で実行系（confirm）を止める
--   3. UI表示: /settings/billing で現在のプランを表示
-- ------------------------------------------------
-- 設計方針:
--   - billing_events が追記専用（監査ログ）
--   - billing_accounts は上書き専用（最新状態）
--   - POST /api/billing/myasp/sync/:token が来るたびにUPSERT
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,                       -- tomonowa側のuser_id（後で紐付け、NULLable）
  myasp_user_id TEXT NOT NULL,        -- MyASP側のユーザーID
  email TEXT NOT NULL,                 -- MyASP側のメールアドレス
  plan INTEGER NOT NULL,               -- 1=Free, 2=Pro, 3=Business
  amount INTEGER NOT NULL,             -- 980, 2980, 15000
  status INTEGER NOT NULL,             -- 1=登録, 2=停止, 3=復活, 4=解約
  last_event_id INTEGER,               -- billing_events.id への参照（最新イベント）
  last_event_ts TEXT NOT NULL,         -- 最新イベントの発火時刻（ts）
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),  -- 最終更新時刻
  created_at TEXT NOT NULL DEFAULT (datetime('now'))   -- 作成時刻
);

-- ------------------------------------------------
-- Indexes
-- ------------------------------------------------
-- MyASP連携の主キー: myasp_user_idでUPSERT
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_accounts_myasp_user_id
  ON billing_accounts(myasp_user_id);

-- tomonowa側との紐付け: user_idでプラン取得
CREATE INDEX IF NOT EXISTS ix_billing_accounts_user_id
  ON billing_accounts(user_id);

-- Gate統合: status検索（status=2/4で実行系を止める）
CREATE INDEX IF NOT EXISTS ix_billing_accounts_status
  ON billing_accounts(status, updated_at);

-- ------------------------------------------------
-- データ例（コメント）
-- ------------------------------------------------
-- UPSERT例（SQLiteは INSERT OR REPLACE を使用）:
-- INSERT OR REPLACE INTO billing_accounts (
--   user_id, myasp_user_id, email, plan, amount, status, last_event_id, last_event_ts
-- ) VALUES (
--   'uuid-123',
--   'user123',
--   'test@example.com',
--   2,
--   2980,
--   1,
--   1,
--   '2026-01-01T10:00:00Z'
-- );

-- ------------------------------------------------
-- Gate統合例（コメント）
-- ------------------------------------------------
-- canExecute(userId, action) の実装:
--   SELECT status FROM billing_accounts WHERE user_id = ?
--   status=2 or status=4 → confirm実行不可（403 Forbidden）
--   status=1 or status=3 → confirm実行可能（200 OK）
-- ------------------------------------------------
