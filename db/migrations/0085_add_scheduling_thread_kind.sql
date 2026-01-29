-- ============================================================
-- Migration: 0085_add_scheduling_thread_kind.sql
-- Purpose: R1 (workmate internal 1on1) support
-- 
-- Adds 'kind' column to scheduling_threads to distinguish:
-- - 'external': R0 flow (/i/:token external invite)
-- - 'internal': R1 flow (workmate app-internal scheduling)
-- ============================================================

-- Add kind column with CHECK constraint
-- Default 'external' ensures all existing records remain R0
ALTER TABLE scheduling_threads
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'external'
  CHECK (kind IN ('external', 'internal'));

-- Index for filtering/analytics
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_kind
  ON scheduling_threads(kind);

-- ============================================================
-- Notes:
-- - Existing threads: all 'external' (R0 behavior unchanged)
-- - New R1 threads: 'internal' (set by /api/scheduling/internal)
-- - No UI/API behavior change in this migration
-- ============================================================
