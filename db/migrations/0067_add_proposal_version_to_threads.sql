-- ============================================================
-- Migration: 0067_add_proposal_version_to_threads.sql
-- Phase2 Sprint 2-A: 追加候補機能の基盤 (セットA-1)
-- Purpose: scheduling_threads に proposal_version / additional_propose_count を追加
-- ============================================================
-- 設計根拠 (docs/PHASE2_SPRINT_PLAN.md 参照):
--   1. proposal_version: 候補の世代管理（追加候補ごとに +1）
--   2. additional_propose_count: 追加候補の実行回数（最大2回制限）
--   3. collecting 状態のみ追加候補可能
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== 1. proposal_version カラム追加 ======
-- 初期値: 1（最初の候補世代）
-- 追加候補実行時: +1
ALTER TABLE scheduling_threads ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

-- ====== 2. additional_propose_count カラム追加 ======
-- 初期値: 0（追加候補未実行）
-- 追加候補実行時: +1
-- 制限: 最大2回（アプリケーション層でチェック）
ALTER TABLE scheduling_threads ADD COLUMN additional_propose_count INTEGER NOT NULL DEFAULT 0;

-- ====== 3. インデックス ======
-- proposal_version での検索用（将来の世代別集計用）
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_proposal_version
  ON scheduling_threads(id, proposal_version);

-- ====== 設計ノート ======
-- 1. status が 'sent' (= collecting) のときのみ追加候補を許可
-- 2. proposal_version は Thread 作成時に 1、追加候補実行ごとに +1
-- 3. additional_propose_count >= 2 の場合は追加候補を拒否
-- 4. finalize 後は追加候補不可（status = 'confirmed'）
