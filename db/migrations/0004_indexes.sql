-- ============================================================
-- Migration: 0004_indexes.sql
-- Purpose: Additional performance indexes for existing tables
-- ============================================================

-- ------------------------------------------------
-- Composite indexes for frequent query patterns
-- ------------------------------------------------

-- users: active user lookups
CREATE INDEX IF NOT EXISTS idx_users_active_lookup ON users(suspended, created_at) WHERE suspended = 0;

-- work_items: user's active items
CREATE INDEX IF NOT EXISTS idx_work_items_user_status ON work_items(user_id, status, start_at);

-- work_items: room visibility queries
CREATE INDEX IF NOT EXISTS idx_work_items_room_visibility ON work_items(room_id, visibility) WHERE room_id IS NOT NULL;

-- relationships: mutual relationship queries
CREATE INDEX IF NOT EXISTS idx_relationships_mutual ON relationships(user_id, related_user_id, closeness) WHERE visibility = 'mutual';

-- scheduling_threads: active threads
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_active ON scheduling_threads(organizer_user_id, status, created_at) WHERE status IN ('draft', 'sent');

-- external_invites: active invites
CREATE INDEX IF NOT EXISTS idx_external_invites_active ON external_invites(thread_id, status, expires_at) WHERE status = 'pending';

-- inbox_items: unread items
CREATE INDEX IF NOT EXISTS idx_inbox_items_unread ON inbox_items(user_id, is_read, created_at) WHERE is_read = 0 AND dismissed_at IS NULL;

-- contacts: active contacts with interactions
CREATE INDEX IF NOT EXISTS idx_contacts_active ON contacts(owner_user_id, last_interaction_at) WHERE last_interaction_at IS NOT NULL;

-- room_members: room membership lookups
CREATE INDEX IF NOT EXISTS idx_room_members_active ON room_members(room_id, role, joined_at);

-- lists: active lists by type
CREATE INDEX IF NOT EXISTS idx_lists_active ON lists(owner_user_id, list_type, visibility);

-- hosted_events: upcoming events
CREATE INDEX IF NOT EXISTS idx_hosted_events_upcoming ON hosted_events(status, start_at) WHERE status = 'published';

-- event_rsvps: confirmed attendees
CREATE INDEX IF NOT EXISTS idx_event_rsvps_confirmed ON event_rsvps(event_id, response) WHERE response = 'yes';

-- broadcasts: pending/sending broadcasts
CREATE INDEX IF NOT EXISTS idx_broadcasts_pending ON broadcasts(send_status, scheduled_at) WHERE send_status IN ('scheduled', 'sending');

-- broadcast_deliveries: failed deliveries
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_failed ON broadcast_deliveries(delivery_status, created_at) WHERE delivery_status IN ('failed', 'bounced');

-- voice_commands: recent commands per user
CREATE INDEX IF NOT EXISTS idx_voice_commands_recent ON voice_commands(user_id, created_at DESC);

-- audit_logs: recent activity
CREATE INDEX IF NOT EXISTS idx_audit_logs_recent ON audit_logs(created_at DESC, user_id);

-- admin_users: active admins
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(role, last_login_at);

-- user_subscriptions: active subscriptions
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_active ON user_subscriptions(status, expires_at) WHERE status = 'active';

-- rate_limit_logs: recent blocks
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_blocked ON rate_limit_logs(is_blocked, window_end_at) WHERE is_blocked = 1;
