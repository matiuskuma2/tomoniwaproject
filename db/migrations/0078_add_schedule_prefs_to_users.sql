-- ============================================================
-- Migration: 0078_add_schedule_prefs_to_users.sql
-- Purpose: P3-PREF1 - ユーザーのスケジュール好み設定を保存
-- ============================================================

-- schedule_prefs_json: JSON形式でスケジュールの好みを保存
-- 例:
-- {
--   "windows": [
--     { "dow": [1,2,3,4,5], "start": "14:00", "end": "18:00", "weight": 10, "label": "平日午後" }
--   ],
--   "avoid": [
--     { "dow": [1,2,3,4,5], "start": "12:00", "end": "13:00", "weight": -8, "label": "昼休み" }
--   ],
--   "min_notice_hours": 24,
--   "meeting_length_min": 60,
--   "max_end_time": "21:00"
-- }

ALTER TABLE users ADD COLUMN schedule_prefs_json TEXT DEFAULT NULL;

-- インデックス: 好み設定があるユーザーを効率的に検索
CREATE INDEX IF NOT EXISTS idx_users_has_schedule_prefs 
ON users(id) WHERE schedule_prefs_json IS NOT NULL;
