-- ============================================================
-- Migration: 0022_thread_messages.sql
-- Purpose: Create thread_messages and deliveries for scheduling communication
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS thread_messages (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL,

  thread_id TEXT,
  hosted_event_id TEXT,

  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','inbox')),

  subject TEXT,
  body TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','queued','sent','failed','cancelled')),

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (hosted_event_id) REFERENCES hosted_events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_created
  ON thread_messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_thread_messages_event_created
  ON thread_messages(hosted_event_id, created_at);

CREATE TABLE IF NOT EXISTS thread_message_deliveries (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,

  recipient_user_id TEXT,
  recipient_email TEXT,
  recipient_display_name TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','bounced','failed')),

  delivered_at INTEGER,
  error_message TEXT,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),

  FOREIGN KEY (message_id) REFERENCES thread_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_message_deliveries_message
  ON thread_message_deliveries(message_id, status);
