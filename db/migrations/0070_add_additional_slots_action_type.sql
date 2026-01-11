-- ============================================================
-- Migration: 0070_add_additional_slots_action_type.sql
-- Phase2 Sprint 2-A: 追加候補機能の action_type 追加 (セットA-4)
-- Purpose: pending_actions に add_slots アクションタイプを追加
-- ============================================================
-- 設計根拠 (docs/PHASE2_SPRINT_PLAN.md 参照):
--   1. add_slots: 追加候補をスレッドに追加するアクション
--   2. 既存の send_invites / add_invites と同様の確認フロー
--   3. 3語固定（送る/キャンセル/別スレッドで）は使わず、2語（追加/キャンセル）
-- ============================================================
-- SQLite では ALTER TABLE で CHECK 制約を変更できないため、
-- アプリケーション層で action_type = 'add_slots' を許可する
-- ============================================================

-- NOTE: この migration は実際には何もしない（CHECK 制約はアプリ層で対応）
-- ただし明示的にドキュメント化するために作成

-- 以下は参考情報（実際には実行されない）
-- action_type の追加値: 'add_slots'
-- 使用箇所: POST /api/threads/:id/proposals/prepare
-- 確認フロー:
--   1. POST /api/threads/:id/proposals/prepare → pending_action 作成
--   2. POST /api/pending-actions/:token/confirm (decision: '追加' or 'キャンセル')
--   3. POST /api/pending-actions/:token/execute → スロット追加 + 通知

-- ダミーのSQLステートメント（マイグレーションツールが空ファイルを許可しない場合）
SELECT 1;
