-- Migration 0026: Threads and Invites (Ticket 10)
-- Purpose: Create threads, thread_invites, thread_participants tables

-- Threads table
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_workspace_id ON threads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);

-- Thread invites table (for /i/:token)
CREATE TABLE IF NOT EXISTS thread_invites (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  candidate_reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thread_invites_thread_id ON thread_invites(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_invites_token ON thread_invites(token);
CREATE INDEX IF NOT EXISTS idx_thread_invites_email ON thread_invites(email);
CREATE INDEX IF NOT EXISTS idx_thread_invites_status ON thread_invites(status);

-- Thread participants table
CREATE TABLE IF NOT EXISTS thread_participants (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(thread_id, user_id),
  UNIQUE(thread_id, email)
);

CREATE INDEX IF NOT EXISTS idx_thread_participants_thread_id ON thread_participants(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_participants_user_id ON thread_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_participants_email ON thread_participants(email);
