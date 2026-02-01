-- 0087_add_failed_status_to_threads.sql
-- PR-G1-DEADLINE: Add 'failed' status for deadline expiration
--
-- SQLite does not support ALTER TABLE to modify CHECK constraints directly.
-- We need to:
-- 1. Create a new table with the updated CHECK constraint
-- 2. Copy data from the old table
-- 3. Drop the old table
-- 4. Rename the new table
--
-- Note: This migration requires careful handling of foreign keys.

-- Step 1: Disable foreign keys temporarily
PRAGMA foreign_keys = OFF;

-- Step 2: Create new table with updated CHECK constraint
CREATE TABLE scheduling_threads_new (
    id                      TEXT PRIMARY KEY,
    organizer_user_id       TEXT NOT NULL,
    title                   TEXT,
    description             TEXT,
    status                  TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'cancelled', 'failed')),
    mode                    TEXT DEFAULT 'one_on_one' CHECK (mode IN ('one_on_one', 'group', 'public')),
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
    workspace_id            TEXT DEFAULT 'ws-default',
    proposal_version        INTEGER DEFAULT 0,
    additional_propose_count INTEGER DEFAULT 0,
    timezone                TEXT DEFAULT 'Asia/Tokyo',
    slot_policy             TEXT,
    constraints_json        TEXT,
    kind                    TEXT DEFAULT 'external' CHECK (kind IN ('external', 'internal')),
    topology                TEXT DEFAULT 'one_on_one' CHECK (topology IN ('one_on_one', 'one_to_many')),
    group_policy_json       TEXT,
    FOREIGN KEY (organizer_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Step 3: Copy existing data
INSERT INTO scheduling_threads_new (
    id, organizer_user_id, title, description, status, mode, created_at, updated_at,
    workspace_id, proposal_version, additional_propose_count, timezone, slot_policy,
    constraints_json, kind, topology, group_policy_json
)
SELECT 
    id, organizer_user_id, title, description, status, mode, created_at, updated_at,
    COALESCE(workspace_id, 'ws-default'),
    COALESCE(proposal_version, 0),
    COALESCE(additional_propose_count, 0),
    COALESCE(timezone, 'Asia/Tokyo'),
    slot_policy,
    constraints_json,
    COALESCE(kind, 'external'),
    COALESCE(topology, 'one_on_one'),
    group_policy_json
FROM scheduling_threads;

-- Step 4: Drop old table
DROP TABLE scheduling_threads;

-- Step 5: Rename new table
ALTER TABLE scheduling_threads_new RENAME TO scheduling_threads;

-- Step 6: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_organizer ON scheduling_threads(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_status ON scheduling_threads(status);
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_active ON scheduling_threads(organizer_user_id, status, created_at) WHERE status IN ('draft', 'sent');
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_workspace ON scheduling_threads(workspace_id, status);

-- Step 7: Re-enable foreign keys
PRAGMA foreign_keys = ON;
