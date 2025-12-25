-- ============================================================
-- Migration: 0021_list_member_delivery_prefs.sql
-- Purpose: Add delivery_preferences_json to list_members
-- ============================================================
PRAGMA foreign_keys = ON;

ALTER TABLE list_members
ADD COLUMN delivery_preferences_json TEXT NOT NULL DEFAULT '{"event_invite":true,"reminder":true,"announcement":true}';
