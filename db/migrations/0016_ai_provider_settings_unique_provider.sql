-- ============================================================
-- Migration: 0016_ai_provider_settings_unique_provider.sql
-- Purpose: Add UNIQUE(provider) constraint to ai_provider_settings
-- SQLite ALTER TABLE limitation workaround: v2 table migration
-- Note: Cloudflare D1 does not support explicit BEGIN/COMMIT
-- ============================================================
PRAGMA foreign_keys = OFF;

-- 1) Create new table with UNIQUE(provider) constraint
CREATE TABLE IF NOT EXISTS ai_provider_settings_v2 (
  id TEXT PRIMARY KEY,                    -- uuid
  
  provider TEXT NOT NULL CHECK (provider IN ('gemini','openai')),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  
  default_model TEXT NOT NULL,
  fallback_provider TEXT CHECK (fallback_provider IN ('gemini','openai')),
  fallback_model TEXT,
  feature_routing_json TEXT NOT NULL DEFAULT '{}',
  
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  
  UNIQUE(provider)
);

-- 2) Migrate existing data (de-duplicate by provider, keep latest)
--    If multiple rows exist for same provider, keep the one with latest updated_at
INSERT OR REPLACE INTO ai_provider_settings_v2
(id, provider, is_enabled, default_model, fallback_provider, fallback_model, feature_routing_json, created_at, updated_at)
SELECT
  s.id,
  s.provider,
  COALESCE(s.is_enabled, 1),
  s.default_model,
  s.fallback_provider,
  s.fallback_model,
  COALESCE(s.feature_routing_json, '{}'),
  COALESCE(s.created_at, unixepoch()),
  COALESCE(s.updated_at, unixepoch())
FROM ai_provider_settings s
ORDER BY COALESCE(s.updated_at, 0) ASC;

-- 3) Replace old table
DROP TABLE IF EXISTS ai_provider_settings;
ALTER TABLE ai_provider_settings_v2 RENAME TO ai_provider_settings;

-- 4) Recreate indexes
CREATE INDEX IF NOT EXISTS idx_ai_provider_settings_provider
  ON ai_provider_settings(provider, is_enabled);

PRAGMA foreign_keys = ON;
