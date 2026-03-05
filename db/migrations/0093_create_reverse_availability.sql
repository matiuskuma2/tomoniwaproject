-- ============================================================
-- Migration: 0093_create_reverse_availability.sql
-- Purpose: PR-B6 逆アベイラビリティ（ご都合伺い）
--
-- 目上の相手に候補日時を出してもらい、主催者が合わせるフロー。
-- Phase 1: 手動候補選択（ゲストOAuthなし）
--
-- テーブル:
-- 1. reverse_availability: ご都合伺いの設定・状態管理
-- 2. reverse_availability_responses: 相手が選んだ候補日時
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. reverse_availability: ご都合伺い設定
-- ============================================================
CREATE TABLE IF NOT EXISTS reverse_availability (
  id TEXT PRIMARY KEY,                       -- UUID
  thread_id TEXT NOT NULL,                   -- FK: scheduling_threads.id
  token TEXT UNIQUE NOT NULL,                -- 公開URL用トークン (/ra/:token)
  workspace_id TEXT NOT NULL,

  -- 主催者（依頼する側 = 目下）
  requester_user_id TEXT NOT NULL,

  -- 相手（都合を聞かれる側 = 目上）
  target_email TEXT NOT NULL,
  target_name TEXT,

  -- 条件
  time_min TEXT NOT NULL,                    -- ISO8601: 選択範囲の開始
  time_max TEXT NOT NULL,                    -- ISO8601: 選択範囲の終了
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  preferred_slots_count INTEGER NOT NULL DEFAULT 3,  -- 何候補選んでもらうか
  slot_interval_minutes INTEGER NOT NULL DEFAULT 60,  -- 枠の刻み幅（60分刻み）

  -- メタ
  title TEXT DEFAULT '打ち合わせ',

  -- 状態: pending → responded → finalized → expired
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'responded', 'finalized', 'expired', 'cancelled')),

  responded_at TEXT,                         -- 相手が候補送信した日時
  finalized_at TEXT,                         -- 主催者が確定した日時

  expires_at TEXT NOT NULL,                  -- 72時間後（自動失効用）

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

-- Indexes for reverse_availability
CREATE INDEX IF NOT EXISTS idx_ra_token ON reverse_availability(token);
CREATE INDEX IF NOT EXISTS idx_ra_status_expires ON reverse_availability(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ra_thread ON reverse_availability(thread_id);
CREATE INDEX IF NOT EXISTS idx_ra_requester ON reverse_availability(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_ra_workspace ON reverse_availability(workspace_id);

-- ============================================================
-- 2. reverse_availability_responses: 相手が選んだ候補日時
-- ============================================================
CREATE TABLE IF NOT EXISTS reverse_availability_responses (
  id TEXT PRIMARY KEY,                       -- UUID
  reverse_availability_id TEXT NOT NULL,     -- FK: reverse_availability.id

  slot_start TEXT NOT NULL,                  -- ISO8601
  slot_end TEXT NOT NULL,                    -- ISO8601
  label TEXT,                                -- 表示用ラベル ("3/10(月) 10:00〜11:00")
  rank INTEGER,                              -- 希望順位 (1 = 最希望)

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (reverse_availability_id) REFERENCES reverse_availability(id) ON DELETE CASCADE
);

-- Indexes for reverse_availability_responses
CREATE INDEX IF NOT EXISTS idx_ra_responses_ra_id
  ON reverse_availability_responses(reverse_availability_id);
CREATE INDEX IF NOT EXISTS idx_ra_responses_rank
  ON reverse_availability_responses(reverse_availability_id, rank);

-- ============================================================
-- Comments
-- ============================================================
-- reverse_availability: ご都合伺い（Reverse Availability）の設定テーブル
--   - token: 公開URL (/ra/:token) で使用
--   - status: pending(待機中), responded(回答済み), finalized(確定済み),
--             expired(期限切れ), cancelled(キャンセル)
--   - requester_user_id: 主催者（依頼する側、目下）
--   - target_email: 相手（都合を聞かれる側、目上）
--   - preferred_slots_count: 相手に選んでもらう候補数（デフォルト3）
--   - slot_interval_minutes: 時間枠の刻み幅（デフォルト60分）
--   - expires_at: 72時間で自動失効
--
-- reverse_availability_responses: 相手が選んだ候補日時
--   - rank: 1が最希望、2が次善、3がその次
--   - label: UI表示用（"3/10(月) 10:00〜11:00" 等）
--
-- フロー:
-- 1. 主催者がチャットで「佐藤部長にご都合を伺って」
-- 2. POST /api/reverse-availability/prepare → RA作成 + メール送信
-- 3. 相手が /ra/:token で候補を選択
-- 4. POST /ra/:token/respond → responses INSERT + status='responded'
-- 5. 主催者に通知 → 番号選択で確定
-- 6. POST /api/reverse-availability/:id/finalize → Meet + Calendar 生成
--
-- PR-B6: Phase 1 (手動候補選択、ゲストOAuth なし)
-- ============================================================
