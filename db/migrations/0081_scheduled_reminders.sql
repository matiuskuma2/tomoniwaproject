-- ============================================================
-- Migration 0081: scheduled_reminders テーブル
-- 
-- 前日リマインド機能用
-- 承諾された予定に対して、前日に自動でリマインドメールを送る
-- ============================================================

-- scheduled_reminders テーブル
CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id TEXT PRIMARY KEY,
  
  -- 関連エンティティ
  thread_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  token TEXT NOT NULL,  -- 招待URL再構築用 (/i/:token)
  
  -- 送信先情報
  to_email TEXT NOT NULL,
  to_name TEXT,  -- 受信者名（メール本文用）
  
  -- スケジュール情報
  remind_at TEXT NOT NULL,  -- ISO8601: リマインド送信予定時刻
  remind_type TEXT NOT NULL DEFAULT 'day_before',  -- day_before / hour_before / custom
  
  -- ステータス管理
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled / queued / sent / cancelled / failed
  queued_at TEXT,  -- キュー投入時刻
  sent_at TEXT,  -- 送信完了時刻
  
  -- 冪等性保証
  dedupe_key TEXT NOT NULL UNIQUE,  -- 例: thread_id:invite_id:remind_at
  
  -- メタデータ（メール生成用）
  metadata TEXT,  -- JSON: { title, slot_start_at, slot_end_at, organizer_name }
  
  -- 監査
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- 外部キー
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES thread_invites(id) ON DELETE CASCADE
);

-- インデックス: cron で status + remind_at で拾う
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_status_remind_at 
  ON scheduled_reminders(status, remind_at);

-- インデックス: thread_id で検索
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_thread_id 
  ON scheduled_reminders(thread_id);

-- インデックス: invite_id で検索
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_invite_id 
  ON scheduled_reminders(invite_id);

-- インデックス: dedupe_key のユニーク制約（CREATE TABLE の UNIQUE で暗黙的に作成されるが明示）
-- dedupe_key は UNIQUE 制約で既にインデックスあり
