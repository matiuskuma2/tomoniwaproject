-- ============================================================
-- Migration: 0089_add_last_assigned_member_id_to_pools.sql
-- Purpose : G2-A Pool Booking - round-robin assignment state
-- ============================================================

-- Add last_assigned_member_id to pools
-- NULL means "no assignment has happened yet"
ALTER TABLE pools
ADD COLUMN last_assigned_member_id TEXT NULL;

-- Optional index (helps debugging / filtering, cheap)
CREATE INDEX IF NOT EXISTS idx_pools_last_assigned_member_id
ON pools(last_assigned_member_id);
