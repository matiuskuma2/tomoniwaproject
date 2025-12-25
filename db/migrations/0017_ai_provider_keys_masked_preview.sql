-- ============================================================
-- Migration: 0017_ai_provider_keys_masked_preview.sql
-- Purpose: Add masked_preview column to ai_provider_keys
-- ============================================================
PRAGMA foreign_keys = ON;

-- Add masked_preview column (e.g., "sk-****...****abcd")
-- This is stored on INSERT/UPDATE, NOT decrypted from api_key_enc
ALTER TABLE ai_provider_keys ADD COLUMN masked_preview TEXT;
