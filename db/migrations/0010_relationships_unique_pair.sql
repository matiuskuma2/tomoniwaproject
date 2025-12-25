-- ============================================================
-- Migration: 0010_relationships_unique_pair.sql
-- Purpose: Add UNIQUE(user_a_id, user_b_id) constraint to relationships
-- Note: D1 compatible - no BEGIN/COMMIT transactions
-- ============================================================
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS relationships_v2 (
  id TEXT PRIMARY KEY,

  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,

  relation_type TEXT NOT NULL CHECK (relation_type IN ('family','partner','stranger')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','blocked')),
  permissions_json TEXT NOT NULL DEFAULT '{}',

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE,

  UNIQUE (user_a_id, user_b_id)
);

-- Migrate existing data (normalize a/b to lexicographic order)
-- Note: Old schema uses user_id/related_user_id, map to closeness->relation_type
INSERT OR REPLACE INTO relationships_v2
(id, user_a_id, user_b_id, relation_type, status, permissions_json, created_at, updated_at)
SELECT
  r.id,
  CASE WHEN r.user_id < r.related_user_id THEN r.user_id ELSE r.related_user_id END AS user_a_id,
  CASE WHEN r.user_id < r.related_user_id THEN r.related_user_id ELSE r.user_id END AS user_b_id,
  CASE r.closeness
    WHEN 'family' THEN 'family'
    WHEN 'close' THEN 'partner'
    ELSE 'stranger'
  END AS relation_type,
  CASE r.visibility
    WHEN 'blocked' THEN 'blocked'
    WHEN 'mutual' THEN 'active'
    ELSE 'pending'
  END AS status,
  '{}' AS permissions_json,
  unixepoch() AS created_at,
  unixepoch() AS updated_at
FROM relationships r
ORDER BY
  CASE r.visibility
    WHEN 'blocked' THEN 3
    WHEN 'mutual' THEN 2
    WHEN 'one_way' THEN 1
    ELSE 0
  END ASC,
  CASE r.closeness
    WHEN 'family' THEN 5
    WHEN 'close' THEN 4
    WHEN 'friend' THEN 3
    WHEN 'acquaintance' THEN 2
    WHEN 'stranger' THEN 1
    ELSE 0
  END ASC;

-- Replace old table
ALTER TABLE relationships RENAME TO relationships_old;
ALTER TABLE relationships_v2 RENAME TO relationships;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_relationships_pair ON relationships(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_relationships_user_a ON relationships(user_a_id, status);
CREATE INDEX IF NOT EXISTS idx_relationships_user_b ON relationships(user_b_id, status);

-- Drop old table
DROP TABLE IF EXISTS relationships_old;

PRAGMA foreign_keys = ON;
