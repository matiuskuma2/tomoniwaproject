-- ============================================================
-- Migration: 0047_add_meeting_to_thread_finalize.sql
-- Purpose: Add Google Meet integration fields to thread_finalize
-- ============================================================

-- Add meeting information columns to thread_finalize
ALTER TABLE thread_finalize ADD COLUMN meeting_provider TEXT;
ALTER TABLE thread_finalize ADD COLUMN meeting_url TEXT;
ALTER TABLE thread_finalize ADD COLUMN calendar_event_id TEXT;

-- Create index for quick meeting lookup
CREATE INDEX IF NOT EXISTS idx_thread_finalize_meeting 
  ON thread_finalize(calendar_event_id) 
  WHERE calendar_event_id IS NOT NULL;

-- meeting_provider: 'google_meet' | 'zoom' | 'teams' (extensible)
-- meeting_url: The actual meeting URL (e.g., Google Meet link)
-- calendar_event_id: Google Calendar Event ID (for updates/cancellations)
