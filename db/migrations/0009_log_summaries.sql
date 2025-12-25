-- ============================================================
-- Migration: 0009_log_summaries.sql
-- Purpose: Create daily summary tables for AI usage, invites, broadcasts, retention jobs
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_daily_summary (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,

  provider TEXT NOT NULL CHECK (provider IN ('gemini','openai')),
  feature TEXT NOT NULL,
  model TEXT NOT NULL,

  calls INTEGER NOT NULL DEFAULT 0,
  success_calls INTEGER NOT NULL DEFAULT 0,
  error_calls INTEGER NOT NULL DEFAULT 0,

  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  audio_seconds INTEGER NOT NULL DEFAULT 0,

  estimated_cost_usd REAL NOT NULL DEFAULT 0.0,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE (day, provider, feature, model)
);

CREATE INDEX IF NOT EXISTS idx_ai_daily_summary_day
  ON ai_daily_summary(day);

CREATE TABLE IF NOT EXISTS invite_daily_summary (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,

  invites_created INTEGER NOT NULL DEFAULT 0,
  invites_viewed INTEGER NOT NULL DEFAULT 0,
  invites_responded INTEGER NOT NULL DEFAULT 0,
  invites_expired INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE (day)
);

CREATE INDEX IF NOT EXISTS idx_invite_daily_summary_day
  ON invite_daily_summary(day);

CREATE TABLE IF NOT EXISTS broadcast_daily_summary (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,

  room_id TEXT,
  broadcast_count INTEGER NOT NULL DEFAULT 0,

  deliveries_total INTEGER NOT NULL DEFAULT 0,
  deliveries_sent INTEGER NOT NULL DEFAULT 0,
  deliveries_opened INTEGER NOT NULL DEFAULT 0,
  deliveries_clicked INTEGER NOT NULL DEFAULT 0,
  deliveries_bounced INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE (day, room_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_daily_summary_day
  ON broadcast_daily_summary(day);

CREATE INDEX IF NOT EXISTS idx_broadcast_daily_summary_room_day
  ON broadcast_daily_summary(room_id, day);

CREATE TABLE IF NOT EXISTS retention_jobs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','failed')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (job_name, day)
);

CREATE INDEX IF NOT EXISTS idx_retention_jobs_job_day
  ON retention_jobs(job_name, day);
