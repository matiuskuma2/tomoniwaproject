-- ============================================================
-- Migration: 0038_backfill_default_attendance_rules.sql
-- Purpose : Backfill default AttendanceRule for existing threads
-- Notes   : Run AFTER 0033 is applied
-- ============================================================

PRAGMA foreign_keys = ON;

-- Insert default ANY rule for existing threads
-- (Assumes existing threads were "accept = participate" which is closest to ANY)
INSERT OR IGNORE INTO thread_attendance_rules (thread_id, version, rule_json, finalize_policy)
SELECT 
  id,
  1,
  json_object(
    'version', 1,
    'type', 'ANY',
    'participants', json_array()
  ),
  'EARLIEST_VALID'
FROM scheduling_threads
WHERE id NOT IN (SELECT thread_id FROM thread_attendance_rules);
