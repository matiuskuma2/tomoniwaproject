-- ============================================================
-- Migration: 0082_add_slot_policy_constraints_to_threads.sql
-- Purpose: 1対1 AI秘書 Phase B-1〜B-4 対応
--          scheduling_threads に slot_policy / constraints_json を追加
-- 
-- Phase B-1: 候補3つ提示（fixed_multi）
-- Phase B-2: 主催者freebusyから候補生成（freebusy_multi）
-- Phase B-4: TimeRex型（open_slots）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ====== 1. slot_policy カラム追加 ======
-- 1対1内での候補生成ポリシーを区別
-- - fixed_single: 固定1枠（v1.0、現行）
-- - fixed_multi: 固定複数候補（B-1）
-- - freebusy_multi: 主催者freebusyから候補生成（B-2）
-- - open_slots: TimeRex型（B-4）

ALTER TABLE scheduling_threads 
  ADD COLUMN slot_policy TEXT DEFAULT 'fixed_single'
  CHECK(slot_policy IN ('fixed_single', 'fixed_multi', 'freebusy_multi', 'open_slots'));

-- ====== 2. constraints_json カラム追加 ======
-- 候補生成時の制約条件を保存
-- 例: {"prefer":"afternoon","days":["thu","fri"],"duration":60,"time_min":"...","time_max":"..."}

ALTER TABLE scheduling_threads 
  ADD COLUMN constraints_json TEXT;

-- ====== 3. インデックス追加 ======
-- slot_policy での検索用

CREATE INDEX IF NOT EXISTS idx_scheduling_threads_slot_policy
  ON scheduling_threads(slot_policy);

-- ============================================================
-- 使用例:
-- 
-- 1. 固定1枠（既存、v1.0）
--    slot_policy = 'fixed_single'
--    constraints_json = NULL
-- 
-- 2. 候補3つ提示（B-1）
--    slot_policy = 'fixed_multi'
--    constraints_json = NULL（候補は手動指定）
-- 
-- 3. 主催者freebusyから候補生成（B-2）
--    slot_policy = 'freebusy_multi'
--    constraints_json = '{"prefer":"afternoon","days":["thu","fri"],"duration":60}'
-- 
-- 4. TimeRex型（B-4）
--    slot_policy = 'open_slots'
--    constraints_json = '{"time_min":"2026-02-01","time_max":"2026-02-14","duration":60}'
-- ============================================================
