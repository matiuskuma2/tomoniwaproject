-- Migration: Add AI cost control settings
-- Date: 2025-12-26
-- Description: Configure AI provider fallback and rate limiting for free tier

-- Insert default AI settings
INSERT OR IGNORE INTO system_settings (key, value_json, updated_at)
VALUES
  -- Allow OpenAI fallback (default: false for free tier)
  ('ai.fallback.enabled', 'false', unixepoch()),
  
  -- Primary AI provider (gemini or openai)
  ('ai.provider.primary', '"gemini"', unixepoch()),
  
  -- Secondary AI provider for fallback
  ('ai.provider.fallback', '"openai"', unixepoch()),
  
  -- Max AI requests per user per day (free tier)
  ('ai.rate_limit.free.daily', '20', unixepoch()),
  
  -- Max AI requests per user per day (pro tier)
  ('ai.rate_limit.pro.daily', '500', unixepoch()),
  
  -- Enable AI usage logging
  ('ai.logging.enabled', 'true', unixepoch());
