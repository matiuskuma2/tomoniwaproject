-- ============================================================
-- Migration: 0003_admin.sql
-- Purpose: Admin Users, Subscription, Rate Limiting
-- ============================================================

-- ------------------------------------------------
-- 1) admin_users: 管理者ユーザー
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT UNIQUE,       -- 紐付くPWA user (NULL = admin only account)
    email                 TEXT UNIQUE NOT NULL,
    password_hash         TEXT,
    role                  TEXT DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
    permissions           TEXT,              -- JSON形式の権限リスト
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at         TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

-- ------------------------------------------------
-- 2) admin_workspace_access: Admin→Workspace権限境界
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_workspace_access (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    admin_user_id         TEXT NOT NULL,
    workspace_id          TEXT NOT NULL,
    access_level          TEXT DEFAULT 'viewer' CHECK (access_level IN ('owner', 'editor', 'viewer')),
    granted_at            TEXT NOT NULL DEFAULT (datetime('now')),
    granted_by_admin_id   TEXT,
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_workspace_access_unique ON admin_workspace_access(admin_user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_admin_workspace_access_admin_id ON admin_workspace_access(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_workspace_access_workspace_id ON admin_workspace_access(workspace_id);

-- ------------------------------------------------
-- 3) user_subscriptions: ユーザーのサブスクリプション
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT UNIQUE NOT NULL,
    plan_type             TEXT DEFAULT 'free' CHECK (plan_type IN ('free', 'pro', 'enterprise')),
    status                TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'suspended')),
    started_at            TEXT NOT NULL,
    expires_at            TEXT,
    cancelled_at          TEXT,
    billing_provider      TEXT,              -- e.g., 'stripe'
    billing_customer_id   TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan_type ON user_subscriptions(plan_type);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);

-- ------------------------------------------------
-- 4) rate_limit_logs: レート制限ログ
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_logs (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT,              -- NULL if IP-based
    ip_address            TEXT,
    endpoint              TEXT NOT NULL,     -- e.g., '/api/voice/execute', '/api/otp/send'
    hit_count             INTEGER DEFAULT 1,
    window_start_at       TEXT NOT NULL,
    window_end_at         TEXT NOT NULL,
    is_blocked            INTEGER DEFAULT 0 NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_user_id ON rate_limit_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_ip ON rate_limit_logs(ip_address) WHERE ip_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_endpoint ON rate_limit_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_rate_limit_logs_window ON rate_limit_logs(window_start_at, window_end_at);
