-- Migration: 0090_create_blocks_and_pool_public_links
-- Date: 2026-02-03
-- Purpose: D0 blocks table + G2-A public link support
-- D1-compatible: no BEGIN/COMMIT, single statement per batch

-- ================================================
-- 1. Create blocks table for user blocking
-- ================================================
CREATE TABLE IF NOT EXISTS blocks (
    id               TEXT PRIMARY KEY,  -- UUID v4
    workspace_id     TEXT NOT NULL,
    user_id          TEXT NOT NULL,      -- The user who blocked
    blocked_user_id  TEXT NOT NULL,      -- The user who is blocked
    reason           TEXT,               -- Optional reason
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, blocked_user_id)
);

-- Indexes for blocks
CREATE INDEX IF NOT EXISTS idx_blocks_user_id ON blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_user_id ON blocks(blocked_user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_workspace ON blocks(workspace_id);

-- ================================================
-- 2. Add public_link_token to pools table
-- ================================================
ALTER TABLE pools ADD COLUMN public_link_token TEXT;

-- Index for public link lookup
CREATE INDEX IF NOT EXISTS idx_pools_public_link_token ON pools(public_link_token);

-- ================================================
-- 3. Add cancelled status support to pool_bookings
-- ================================================
-- Note: pool_bookings already has status column with CHECK constraint
-- We need to recreate the table to add 'cancelled' status

-- Step 1: Create new table with updated CHECK constraint
CREATE TABLE IF NOT EXISTS pool_bookings_new (
    id                 TEXT PRIMARY KEY,
    workspace_id       TEXT NOT NULL,
    pool_id            TEXT NOT NULL,
    slot_id            TEXT NOT NULL,
    requester_user_id  TEXT NOT NULL,
    assignee_user_id   TEXT NOT NULL,
    assignment_algo    TEXT NOT NULL DEFAULT 'round_robin' CHECK(assignment_algo IN ('round_robin')),
    status             TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'completed', 'cancelled')),
    requester_note     TEXT,
    cancelled_at       TEXT,             -- Timestamp when cancelled
    cancelled_by       TEXT,             -- User who cancelled
    cancellation_reason TEXT,            -- Reason for cancellation
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id) REFERENCES pool_slots(id) ON DELETE CASCADE,
    FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Step 2: Migrate existing data
INSERT INTO pool_bookings_new (
    id, workspace_id, pool_id, slot_id, requester_user_id, assignee_user_id,
    assignment_algo, status, requester_note, created_at, updated_at
)
SELECT 
    id, workspace_id, pool_id, slot_id, requester_user_id, assignee_user_id,
    assignment_algo, status, requester_note, created_at, updated_at
FROM pool_bookings;

-- Step 3: Drop old table and rename new
DROP TABLE IF EXISTS pool_bookings;
ALTER TABLE pool_bookings_new RENAME TO pool_bookings;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_pool_bookings_pool_id ON pool_bookings(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_bookings_slot_id ON pool_bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_pool_bookings_assignee ON pool_bookings(assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_pool_bookings_status ON pool_bookings(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_bookings_slot_unique ON pool_bookings(slot_id) WHERE status = 'confirmed';

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;

-- ================================================
-- Post-migration notes:
-- - blocks table: for D0 blocking functionality
-- - pools.public_link_token: for shareable booking links
-- - pool_bookings: added 'cancelled' status and cancellation fields
-- ================================================
