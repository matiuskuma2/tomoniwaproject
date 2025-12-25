-- ============================================================
-- Seed Data: Admin Users + System Settings + AI Provider Settings
-- Purpose: Initial data for testing Tickets 1-3
-- ============================================================

-- ------------------------------------------------
-- Admin Users (for testing)
-- ------------------------------------------------
INSERT OR IGNORE INTO admin_users (id, email, display_name, role, is_active, created_at, updated_at)
VALUES
  ('admin-super-001', 'super@example.com', 'Super Admin', 'super_admin', 1, unixepoch(), unixepoch()),
  ('admin-normal-001', 'admin@example.com', 'Normal Admin', 'admin', 1, unixepoch(), unixepoch());

-- ------------------------------------------------
-- System Settings (MVP essentials)
-- ------------------------------------------------
INSERT OR IGNORE INTO system_settings (key, value_json, updated_by_admin_id, updated_at)
VALUES
  -- Email settings
  ('email.from_name', '"AI Secretary Scheduler"', 'admin-super-001', unixepoch()),
  ('email.from_address', '"noreply@example.com"', 'admin-super-001', unixepoch()),
  ('email.reply_to', '"support@example.com"', 'admin-super-001', unixepoch()),
  ('email.provider', '"resend"', 'admin-super-001', unixepoch()),
  
  -- OGP settings
  ('ogp.site_name', '"AI Secretary Scheduler"', 'admin-super-001', unixepoch()),
  ('ogp.default_title', '"Schedule with AI"', 'admin-super-001', unixepoch()),
  ('ogp.default_description', '"AI-powered scheduling assistant for busy teams"', 'admin-super-001', unixepoch()),
  ('ogp.default_image_url', '"https://example.com/og-image.png"', 'admin-super-001', unixepoch()),
  ('ogp.brand_color', '"#4F46E5"', 'admin-super-001', unixepoch()),
  
  -- Legal URLs
  ('legal.terms_url', '"https://example.com/terms"', 'admin-super-001', unixepoch()),
  ('legal.privacy_url', '"https://example.com/privacy"', 'admin-super-001', unixepoch()),
  ('legal.contact_email', '"legal@example.com"', 'admin-super-001', unixepoch()),
  
  -- App info
  ('app.name', '"AI Secretary"', 'admin-super-001', unixepoch()),
  ('app.support_url', '"https://example.com/support"', 'admin-super-001', unixepoch());

-- ------------------------------------------------
-- AI Provider Settings (Gemini-first strategy)
-- ------------------------------------------------
INSERT OR IGNORE INTO ai_provider_settings 
  (id, provider, is_enabled, default_model, fallback_provider, fallback_model, feature_routing_json, created_at, updated_at)
VALUES
  (
    'ai-provider-gemini',
    'gemini',
    1,
    'gemini-2.0-flash-exp',
    'openai',
    'gpt-4o-mini',
    '{"intent_parse":"gemini-2.0-flash-exp","candidate_gen":"gemini-2.0-flash-exp","summary":"gemini-2.0-flash-exp"}',
    unixepoch(),
    unixepoch()
  ),
  (
    'ai-provider-openai',
    'openai',
    1,
    'gpt-4o-mini',
    NULL,
    NULL,
    '{}',
    unixepoch(),
    unixepoch()
  );

-- ------------------------------------------------
-- Workspaces (for testing workspace access)
-- ------------------------------------------------
INSERT OR IGNORE INTO workspaces (id, name, status, created_at, updated_at)
VALUES
  ('workspace-001', 'Test Workspace 1', 'active', unixepoch(), unixepoch()),
  ('workspace-002', 'Test Workspace 2', 'active', unixepoch(), unixepoch());

-- ------------------------------------------------
-- Admin Workspace Access (for testing tenancy)
-- ------------------------------------------------
INSERT OR IGNORE INTO admin_workspace_access (admin_id, workspace_id, created_at)
VALUES
  ('admin-normal-001', 'workspace-001', unixepoch());
  -- Note: super admin has access to all workspaces (no need to insert)

-- ------------------------------------------------
-- Test Users (for future testing)
-- ------------------------------------------------
INSERT OR IGNORE INTO users (id, email, display_name, suspended, timezone, created_at, updated_at)
VALUES
  ('user-test-001', 'test1@example.com', 'Test User 1', 0, 'Asia/Tokyo', datetime('now'), datetime('now')),
  ('user-test-002', 'test2@example.com', 'Test User 2', 0, 'America/New_York', datetime('now'), datetime('now'));
