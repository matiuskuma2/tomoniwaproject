-- ============================================================
-- Migration: 0018_ai_provider_keys_index.sql
-- Purpose: Additional indexes for ai_provider_keys queries
-- ============================================================
PRAGMA foreign_keys = ON;

-- Index for provider + is_active lookups (used by router)
CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_provider_active
  ON ai_provider_keys(provider, is_active);
