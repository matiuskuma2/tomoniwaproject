-- ============================================================
-- Migration 0027: Sessions Table for Authentication
-- ============================================================
-- Purpose: Store user sessions for secure authentication
-- Created: 2025-12-25
-- Dependencies: users table (0001_init_core.sql)
-- 
-- Features:
-- - Session token storage (hashed for security)
-- - Automatic expiration (expires_at)
-- - Last activity tracking (last_seen_at)
-- - Session revocation support
-- ============================================================

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash of session token
  expires_at TEXT NOT NULL,          -- ISO 8601 datetime
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,                   -- Browser/device info
  ip_address TEXT                    -- Client IP (optional)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Comments
-- token_hash: Store SHA-256 hash instead of raw token for security
-- expires_at: Automatically expired sessions should be cleaned by cron job
-- last_seen_at: Update on every authenticated request for activity tracking
