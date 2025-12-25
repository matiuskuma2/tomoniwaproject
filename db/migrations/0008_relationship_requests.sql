-- ============================================================
-- Migration: 0008_relationship_requests.sql
-- Purpose: Create relationship_requests table for family/partner invites
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relationship_requests (
  id TEXT PRIMARY KEY,

  inviter_user_id TEXT NOT NULL,
  invitee_user_id TEXT,
  invitee_email TEXT,

  requested_type TEXT NOT NULL CHECK (requested_type IN ('family','partner')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired')),

  token TEXT UNIQUE,
  message TEXT,
  expires_at INTEGER,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  responded_at INTEGER,

  FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_relreq_inviter_status
  ON relationship_requests(inviter_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_relreq_invitee_status
  ON relationship_requests(invitee_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_relreq_invitee_email_status
  ON relationship_requests(invitee_email, status, created_at);

CREATE INDEX IF NOT EXISTS idx_relreq_token
  ON relationship_requests(token);
