-- ============================================================
-- Migration: 0005_ai_costs.sql
-- Purpose: AI Cost Management Tables
-- ============================================================
PRAGMA foreign_keys = ON;

-- ------------------------------------------------
-- ai_provider_settings: AI Provider Configuration
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id TEXT PRIMARY KEY,                    -- UUID v4
  provider TEXT NOT NULL CHECK (provider IN ('gemini','openai')),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  
  default_model TEXT NOT NULL,
  fallback_provider TEXT CHECK (fallback_provider IN ('gemini','openai')),
  fallback_model TEXT,
  feature_routing_json TEXT NOT NULL DEFAULT '{}',
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_settings_provider
  ON ai_provider_settings(provider, is_enabled);

-- ------------------------------------------------
-- ai_provider_keys: API Keys (encrypted storage)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_keys (
  id TEXT PRIMARY KEY,                    -- UUID v4
  provider TEXT NOT NULL CHECK (provider IN ('gemini','openai')),
  key_name TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,              -- Encrypted API key
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_provider
  ON ai_provider_keys(provider, is_active);

-- ------------------------------------------------
-- ai_usage_logs: All AI API calls logging (CRITICAL)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id TEXT PRIMARY KEY,                    -- UUID v4
  user_id TEXT,
  room_id TEXT,
  workspace_id TEXT,
  
  provider TEXT NOT NULL CHECK (provider IN ('gemini','openai')),
  model TEXT NOT NULL,
  feature TEXT NOT NULL,                  -- 'intent_parse', 'candidate_gen', 'summary', etc.
  
  status TEXT NOT NULL CHECK (status IN ('success','error')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  audio_seconds INTEGER,
  
  estimated_cost_usd REAL,
  request_metadata_json TEXT,
  error_message TEXT,
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_id
  ON ai_usage_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider
  ON ai_usage_logs(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature
  ON ai_usage_logs(feature, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_status
  ON ai_usage_logs(status, created_at);

-- ------------------------------------------------
-- ai_budgets: Budget control with degradation
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_budgets (
  id TEXT PRIMARY KEY,                    -- UUID v4
  scope TEXT NOT NULL CHECK (scope IN ('global','per_user','per_room','per_plan')),
  scope_id TEXT,
  
  period TEXT NOT NULL CHECK (period IN ('daily','monthly')),
  limit_usd REAL NOT NULL,
  action_on_exceed TEXT NOT NULL CHECK (action_on_exceed IN ('block','degrade','disable_voice','disable_broadcasts')),
  degrade_policy_json TEXT NOT NULL DEFAULT '{}',
  
  alert_50 INTEGER NOT NULL DEFAULT 1 CHECK (alert_50 IN (0,1)),
  alert_80 INTEGER NOT NULL DEFAULT 1 CHECK (alert_80 IN (0,1)),
  alert_100 INTEGER NOT NULL DEFAULT 1 CHECK (alert_100 IN (0,1)),
  
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_budgets_scope
  ON ai_budgets(scope, scope_id, is_active);

-- ------------------------------------------------
-- ai_budget_alert_events: Alert history
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_budget_alert_events (
  id TEXT PRIMARY KEY,                    -- UUID v4
  budget_id TEXT NOT NULL,
  threshold_percent INTEGER NOT NULL,     -- 50, 80, 100
  current_usage_usd REAL NOT NULL,
  limit_usd REAL NOT NULL,
  notified_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  FOREIGN KEY (budget_id) REFERENCES ai_budgets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_budget_alert_events_budget_id
  ON ai_budget_alert_events(budget_id, notified_at);
