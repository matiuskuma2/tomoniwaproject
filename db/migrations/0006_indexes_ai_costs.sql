-- ============================================================
-- Migration: 0006_indexes_ai_costs.sql
-- Purpose: Additional indexes for AI cost queries
-- ============================================================
PRAGMA foreign_keys = ON;

-- ------------------------------------------------
-- ai_usage_logs: Advanced query indexes
-- ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_room_feature
  ON ai_usage_logs(room_id, feature, created_at) WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_workspace_feature
  ON ai_usage_logs(workspace_id, feature, created_at) WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider_model
  ON ai_usage_logs(provider, model, created_at);

-- ------------------------------------------------
-- ai_budgets: Scope-specific lookup
-- ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_budgets_period
  ON ai_budgets(period, is_active);
