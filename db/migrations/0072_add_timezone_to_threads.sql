-- ============================================================
-- Migration: 0072_add_timezone_to_threads.sql
-- Purpose: P3-TZ3 - スレッドに基準タイムゾーンを追加
-- ============================================================

-- scheduling_threads に timezone カラムを追加
-- 主催者のタイムゾーンをスレッド作成時にコピーして固定
-- 外部ユーザーへのメール表示のフォールバックとして使用
ALTER TABLE scheduling_threads
ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo';

-- インデックス追加（将来のTZ別集計用）
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_timezone
ON scheduling_threads(timezone);
