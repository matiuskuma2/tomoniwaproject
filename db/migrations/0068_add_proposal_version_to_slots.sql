-- ============================================================
-- Migration: 0068_add_proposal_version_to_slots.sql
-- Phase2 Sprint 2-A: 追加候補機能の基盤 (セットA-2)
-- Purpose: scheduling_slots に proposal_version / location_id を追加
-- ============================================================
-- 設計根拠 (docs/PHASE2_SPRINT_PLAN.md 参照):
--   1. proposal_version: このスロットがどの世代で追加されたか
--   2. location_id: Phase3 以降の場所管理用（現時点では NULL）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== 1. proposal_version カラム追加 ======
-- 初期値: 1（最初の候補世代で作成されたスロット）
-- 追加候補で新規作成されたスロットは thread.proposal_version を参照
ALTER TABLE scheduling_slots ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

-- ====== 2. location_id カラム追加（Phase3 準備） ======
-- 現時点では NULL、将来の場所管理用
-- Phase3: locations テーブルへの FK を追加予定
ALTER TABLE scheduling_slots ADD COLUMN location_id TEXT DEFAULT NULL;

-- ====== 3. 重複防止インデックス ======
-- 同一スレッド・同一時刻・同一世代のスロットは作成不可
-- これにより「追加候補で同じ時刻を再提案」を防止
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_slots_thread_time_version
  ON scheduling_slots(thread_id, start_at, end_at, proposal_version);

-- ====== 4. 世代別検索インデックス ======
-- v1/v2/v3 混在表示時の効率的な検索用
CREATE INDEX IF NOT EXISTS idx_scheduling_slots_version
  ON scheduling_slots(thread_id, proposal_version);

-- ====== 設計ノート ======
-- 1. 既存スロット（v1）は proposal_version = 1
-- 2. 追加候補で作成されるスロットは thread.current_proposal_version を継承
-- 3. 同一 (thread_id, start_at, end_at, proposal_version) の重複は UNIQUE 制約で防止
-- 4. 異なる世代で同じ時刻を提案することは可能（ただしアプリ層で除外推奨）
-- 5. location_id は Phase3 で活用（Google Meet / Zoom / 場所など）
