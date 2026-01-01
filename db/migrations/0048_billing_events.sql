-- ============================================================
-- Migration: 0048_billing_events.sql
-- Purpose: MyASP課金連携 - 監査ログ + 冪等性（dedupe_key）
-- Phase: Next-11 Week1 Day1
-- ============================================================

-- ------------------------------------------------
-- billing_events: MyASPからのPOST全イベントを監査ログとして保存
-- ------------------------------------------------
-- 目的:
--   1. 監査ログ: 全イベント（登録/停止/復活/解約）を永続化
--   2. 冪等性: dedupe_key（user_id|ts|status|plan）で重複POST防止
--   3. 調査: raw_payload（JSON文字列）で元データを保持
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  myasp_user_id TEXT NOT NULL,      -- MyASP側のユーザーID
  email TEXT NOT NULL,                -- MyASP側のメールアドレス
  plan INTEGER NOT NULL,              -- 1=Free, 2=Pro, 3=Business
  amount INTEGER NOT NULL,            -- 980, 2980, 15000
  status INTEGER NOT NULL,            -- 1=登録, 2=停止, 3=復活, 4=解約
  ts TEXT NOT NULL,                   -- MyASP側の発火時刻（ISO 8601形式）
  dedupe_key TEXT NOT NULL,           -- 冪等性キー: user_id|ts|status|plan
  raw_payload TEXT NOT NULL,          -- JSON文字列で元のPOSTデータを保存
  received_at TEXT NOT NULL DEFAULT (datetime('now'))  -- 受信時刻
);

-- ------------------------------------------------
-- Indexes
-- ------------------------------------------------
-- 冪等性保証: 同じdedupe_keyは1回のみ
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_events_dedupe_key
  ON billing_events(dedupe_key);

-- 監査検索: myasp_user_idでイベント履歴を追跡
CREATE INDEX IF NOT EXISTS ix_billing_events_myasp_user_id
  ON billing_events(myasp_user_id);

-- 時系列検索: received_atで新しい順に取得
CREATE INDEX IF NOT EXISTS ix_billing_events_received_at
  ON billing_events(received_at DESC);

-- ------------------------------------------------
-- データ例（コメント）
-- ------------------------------------------------
-- INSERT INTO billing_events (
--   myasp_user_id, email, plan, amount, status, ts, dedupe_key, raw_payload
-- ) VALUES (
--   'user123',
--   'test@example.com',
--   2,
--   2980,
--   1,
--   '2026-01-01T10:00:00Z',
--   'user123|2026-01-01T10:00:00Z|1|2',
--   '{"data":{"User":{"user_id":"user123","mail":"test@example.com"}}}'
-- );
