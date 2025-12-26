-- Migration: Deprecate inbox_items table
-- Date: 2025-12-26
-- Description: inbox_items is deprecated in favor of inbox table

-- Add deprecation comment
-- inbox_items table is kept for backward compatibility but should not be used
-- All new code should use inbox table instead

-- No structural changes needed, just documentation
-- This migration serves as a marker for the deprecation
