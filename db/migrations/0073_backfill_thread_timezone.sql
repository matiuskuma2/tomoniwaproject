-- ============================================================
-- Migration: 0073_backfill_thread_timezone.sql
-- Purpose: P3-TZ3 - 既存スレッドの timezone を organizer TZ で補完
-- ============================================================

-- 既存スレッドの timezone を organizer の timezone で補完
-- organizer が見つからない場合は Asia/Tokyo をフォールバック
UPDATE scheduling_threads
SET timezone = COALESCE(
  (SELECT timezone FROM users WHERE users.id = scheduling_threads.organizer_user_id),
  'Asia/Tokyo'
)
WHERE timezone = 'Asia/Tokyo';
-- 注: DEFAULT 'Asia/Tokyo' で作られた既存スレッドを organizer TZ に更新
