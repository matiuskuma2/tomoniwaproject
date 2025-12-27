-- ============================================================
-- Phase 0B Verification SQL
-- ============================================================
-- Purpose: Verify that Google Meet integration is working correctly
-- Usage: 
--   Local:  npx wrangler d1 execute webapp-production --local --file=scripts/verify-phase0b.sql
--   Remote: npx wrangler d1 execute webapp-production --file=scripts/verify-phase0b.sql
-- ============================================================

-- 1. Check thread_finalize table for the specific thread
SELECT 
  thread_id,
  meeting_provider,
  meeting_url,
  calendar_event_id,
  final_slot_id,
  finalized_by_user_id,
  finalized_at,
  final_participants_json
FROM thread_finalize
WHERE thread_id = 'ffaf1c4-2320-4eb0-85ba-a372e32ec8dd';

-- 2. Check if meeting_provider uses correct format (should be 'google_meet' not 'google meet')
SELECT 
  meeting_provider,
  COUNT(*) as count
FROM thread_finalize
WHERE meeting_provider IS NOT NULL
GROUP BY meeting_provider;

-- 3. Check all finalized threads with Google Meet
SELECT 
  tf.thread_id,
  st.title,
  tf.meeting_provider,
  tf.meeting_url,
  tf.calendar_event_id,
  tf.finalized_at
FROM thread_finalize tf
JOIN scheduling_threads st ON tf.thread_id = st.id
WHERE tf.meeting_provider = 'google_meet'
ORDER BY tf.finalized_at DESC
LIMIT 10;

-- 4. Check organizer's Google account status
SELECT 
  ga.user_id,
  u.email as user_email,
  ga.email as google_email,
  ga.calendar_sync_enabled,
  ga.scope,
  CASE 
    WHEN ga.token_expires_at > datetime('now') THEN 'Valid'
    ELSE 'Expired'
  END as token_status,
  ga.token_expires_at,
  ga.updated_at
FROM google_accounts ga
JOIN users u ON ga.user_id = u.id
WHERE ga.user_id IN (
  SELECT organizer_user_id 
  FROM scheduling_threads 
  WHERE id = 'ffaf1c4-2320-4eb0-85ba-a372e32ec8dd'
);

-- 5. Check inbox notification for the finalized thread
SELECT 
  id,
  user_id,
  type,
  title,
  message,
  priority,
  is_read,
  created_at
FROM inbox
WHERE message LIKE '%ffaf1c4-2320-4eb0-85ba-a372e32ec8dd%'
   OR message LIKE '%https://meet.google.com%'
ORDER BY created_at DESC
LIMIT 5;
