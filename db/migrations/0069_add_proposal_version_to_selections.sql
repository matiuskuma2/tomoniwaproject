-- ============================================================
-- Migration: 0069_add_proposal_version_to_selections.sql
-- Phase2 Sprint 2-A: 追加候補機能の基盤 (セットA-3)
-- Purpose: thread_selections に proposal_version_at_response を追加
-- ============================================================
-- 設計根拠 (docs/PHASE2_SPRINT_PLAN.md 参照):
--   1. proposal_version_at_response: 回答時点でのスレッド世代
--   2. これにより「古い世代で回答済み」を判定可能
--   3. 再通知対象の特定に使用
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== 1. proposal_version_at_response カラム追加 ======
-- 回答時点での thread.proposal_version を記録
-- NULL = 未回答（pending 状態）
-- 数値 = 回答時点の世代番号
ALTER TABLE thread_selections ADD COLUMN proposal_version_at_response INTEGER DEFAULT NULL;

-- ====== 2. 再通知対象検索インデックス ======
-- 「回答済みだが古い世代」を効率的に検索
-- WHERE proposal_version_at_response < thread.proposal_version
CREATE INDEX IF NOT EXISTS idx_thread_selections_version_response
  ON thread_selections(thread_id, proposal_version_at_response);

-- ====== 3. 複合インデックス（再通知判定用） ======
-- status + proposal_version_at_response で再通知対象を絞り込み
CREATE INDEX IF NOT EXISTS idx_thread_selections_status_version
  ON thread_selections(thread_id, status, proposal_version_at_response);

-- ====== 設計ノート ======
-- 1. 回答時に UPDATE thread_selections SET proposal_version_at_response = ? を実行
-- 2. 再通知対象 = status IN ('pending', 'selected') AND 
--    (proposal_version_at_response IS NULL OR proposal_version_at_response < current_version)
-- 3. declined は再通知対象外（設計決定）
-- 4. 既存の回答データは NULL のまま（= v1 相当として扱う）
-- 5. 将来的に「v2 で追加された候補にのみ回答」などの分析に活用可能
