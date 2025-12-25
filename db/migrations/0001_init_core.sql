-- ============================================================
-- Migration: 0001_init_core.sql
-- Purpose: Core tables (User, Google, WorkItem, Scheduling, Inbox, Contacts, Policy, Audit)
-- ============================================================

-- ------------------------------------------------
-- 1) users: PWAユーザー
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    email                 TEXT UNIQUE,       -- Google OAuth で取得したメールアドレス
    display_name          TEXT,
    avatar_url            TEXT,
    suspended             INTEGER DEFAULT 0 NOT NULL,  -- 0=active, 1=suspended
    onboarding_completed  INTEGER DEFAULT 0 NOT NULL,
    locale                TEXT DEFAULT 'ja',
    timezone              TEXT DEFAULT 'Asia/Tokyo',
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_suspended ON users(suspended);

-- ------------------------------------------------
-- 2) google_accounts: Google OAuth連携情報
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS google_accounts (
    id                   TEXT PRIMARY KEY,  -- UUID v4
    user_id              TEXT NOT NULL,
    google_sub           TEXT UNIQUE NOT NULL, -- Google OAuthのsub (unique per user)
    email                TEXT NOT NULL,
    access_token_enc     TEXT,
    refresh_token_enc    TEXT,
    token_expires_at     TEXT,
    scope                TEXT,
    calendar_sync_enabled INTEGER DEFAULT 1 NOT NULL,
    last_sync_at         TEXT,
    is_primary           INTEGER DEFAULT 0 NOT NULL,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_accounts_sub ON google_accounts(google_sub);
CREATE INDEX IF NOT EXISTS idx_google_accounts_user_id ON google_accounts(user_id);

-- ------------------------------------------------
-- 3) work_items: 統合型Work Item (予定・タスク)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS work_items (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT NOT NULL,     -- オーナー
    room_id               TEXT,              -- Room共有時のみ
    type                  TEXT NOT NULL CHECK (type IN ('task', 'scheduled')),
    title                 TEXT NOT NULL,
    description           TEXT,
    start_at              TEXT,              -- scheduled時は必須
    end_at                TEXT,
    all_day               INTEGER DEFAULT 0 NOT NULL,
    recurrence_rule       TEXT,
    location              TEXT,
    visibility            TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'room')),
    status                TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    google_event_id       TEXT,
    source                TEXT DEFAULT 'user' CHECK (source IN ('user', 'google_calendar', 'scheduling_thread', 'auto_generated')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_items_user_id ON work_items(user_id);
CREATE INDEX IF NOT EXISTS idx_work_items_room_id ON work_items(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_start_at ON work_items(start_at) WHERE start_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_google_event_id ON work_items(google_event_id) WHERE google_event_id IS NOT NULL;

-- ------------------------------------------------
-- 4) work_item_dependencies: タスク間依存関係
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS work_item_dependencies (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    work_item_id          TEXT NOT NULL,
    depends_on_work_item_id TEXT NOT NULL,
    dependency_type       TEXT DEFAULT 'blocks' CHECK (dependency_type IN ('blocks', 'relates_to')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_item_deps_work_item_id ON work_item_dependencies(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_deps_depends_on ON work_item_dependencies(depends_on_work_item_id);

-- ------------------------------------------------
-- 5) relationships: ユーザー間の関係性
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS relationships (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT NOT NULL,
    related_user_id       TEXT NOT NULL,
    closeness             TEXT DEFAULT 'stranger' CHECK (closeness IN ('stranger', 'acquaintance', 'friend', 'close', 'family')),
    visibility            TEXT DEFAULT 'mutual' CHECK (visibility IN ('mutual', 'one_way', 'blocked')),
    label                 TEXT,
    notes                 TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (user_id != related_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_user_related ON relationships(user_id, related_user_id);
CREATE INDEX IF NOT EXISTS idx_relationships_related_user ON relationships(related_user_id);
CREATE INDEX IF NOT EXISTS idx_relationships_closeness ON relationships(closeness);

-- ------------------------------------------------
-- 6) scheduling_threads: 調整スレッド
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_threads (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    organizer_user_id     TEXT NOT NULL,
    title                 TEXT,
    description           TEXT,
    status                TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'cancelled')),
    mode                  TEXT DEFAULT 'one_on_one' CHECK (mode IN ('one_on_one', 'group', 'public')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (organizer_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduling_threads_organizer ON scheduling_threads(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_threads_status ON scheduling_threads(status);

-- ------------------------------------------------
-- 7) scheduling_candidates: 候補時刻
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_candidates (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    thread_id             TEXT NOT NULL,
    start_at              TEXT NOT NULL,
    end_at                TEXT NOT NULL,
    score                 REAL DEFAULT 0.0,
    is_selected           INTEGER DEFAULT 0 NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduling_candidates_thread_id ON scheduling_candidates(thread_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_candidates_score ON scheduling_candidates(thread_id, score DESC);

-- ------------------------------------------------
-- 8) external_invites: 外部招待リンク
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS external_invites (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    thread_id             TEXT NOT NULL,
    token                 TEXT UNIQUE NOT NULL,
    recipient_email       TEXT,
    recipient_name        TEXT,
    status                TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    accessed_at           TEXT,
    expires_at            TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_invites_token ON external_invites(token);
CREATE INDEX IF NOT EXISTS idx_external_invites_thread_id ON external_invites(thread_id);
CREATE INDEX IF NOT EXISTS idx_external_invites_status ON external_invites(status);

-- ------------------------------------------------
-- 9) inbox_items: 受信箱アイテム
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_items (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT NOT NULL,
    type                  TEXT NOT NULL CHECK (type IN ('scheduling_invite', 'work_item_share', 'relationship_request', 'system_message')),
    title                 TEXT NOT NULL,
    description           TEXT,
    action_url            TEXT,
    is_read               INTEGER DEFAULT 0 NOT NULL,
    dismissed_at          TEXT,
    related_entity_type   TEXT,  -- e.g., 'scheduling_thread', 'work_item'
    related_entity_id     TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_user_id ON inbox_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_items_is_read ON inbox_items(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_inbox_items_related_entity ON inbox_items(related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL;

-- ------------------------------------------------
-- 10) contacts: 連絡先
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    owner_user_id         TEXT NOT NULL,     -- この連絡先を持っているユーザー
    related_user_id       TEXT,              -- 紐付くPWAユーザー（NULLなら外部）
    email                 TEXT,
    phone                 TEXT,
    display_name          TEXT,
    company               TEXT,
    notes                 TEXT,
    last_interaction_at   TEXT,
    source                TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'google_contacts', 'scheduling_thread', 'room')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_user_id ON contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_related_user_id ON contacts(related_user_id) WHERE related_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE email IS NOT NULL;

-- ------------------------------------------------
-- 11) policies: AIがWork Itemを操作する際の判断根拠
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS policies (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT NOT NULL,
    work_item_id          TEXT,              -- NULL = 全般的なポリシー
    rule_type             TEXT NOT NULL CHECK (rule_type IN ('visibility', 'scheduling', 'notification', 'ai_behavior')),
    rule_value            TEXT NOT NULL,     -- JSON形式
    priority              INTEGER DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policies_user_id ON policies(user_id);
CREATE INDEX IF NOT EXISTS idx_policies_work_item_id ON policies(work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_policies_rule_type ON policies(rule_type);

-- ------------------------------------------------
-- 12) voice_commands: 音声コマンドログ (履歴・監査用)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_commands (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT NOT NULL,
    command_text          TEXT NOT NULL,
    intent_parsed         TEXT,              -- JSON形式
    result                TEXT,              -- JSON形式
    status                TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
    error_message         TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_commands_user_id ON voice_commands(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_commands_status ON voice_commands(status);
CREATE INDEX IF NOT EXISTS idx_voice_commands_created_at ON voice_commands(created_at);

-- ------------------------------------------------
-- 13) audit_logs: 監査ログ
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    user_id               TEXT,              -- NULL if system action
    action                TEXT NOT NULL,
    entity_type           TEXT,
    entity_id             TEXT,
    changes               TEXT,              -- JSON形式
    ip_address            TEXT,
    user_agent            TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
