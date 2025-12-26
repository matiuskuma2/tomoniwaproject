-- Migration 0028: Create inbox table for user notifications
-- Date: 2025-12-26
-- Purpose: Unified notification system for all user alerts

CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  action_type TEXT,
  action_target_id TEXT,
  action_url TEXT,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_read INTEGER DEFAULT 0 NOT NULL,
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inbox_user_id ON inbox(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_user_read ON inbox(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_inbox_created_at ON inbox(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_priority ON inbox(user_id, priority) WHERE is_read = 0;
