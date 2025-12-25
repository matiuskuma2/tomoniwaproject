-- ============================================================
-- Migration: 0002_team_lists_events.sql
-- Purpose: Team/Workspace, Room, Quest, Lists, Event Delivery
-- ============================================================

-- ------------------------------------------------
-- 1) workspaces: ワークスペース（テナント境界）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    name                  TEXT NOT NULL,
    slug                  TEXT UNIQUE NOT NULL,
    owner_user_id         TEXT NOT NULL,
    plan_type             TEXT DEFAULT 'free' CHECK (plan_type IN ('free', 'pro', 'enterprise')),
    max_members           INTEGER DEFAULT 10,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id);

-- ------------------------------------------------
-- 2) rooms: Room（グループ共有スペース）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    workspace_id          TEXT,              -- NULL = personal room
    name                  TEXT NOT NULL,
    description           TEXT,
    owner_user_id         TEXT NOT NULL,
    visibility            TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'workspace', 'public')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rooms_workspace_id ON rooms(workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_owner_user_id ON rooms(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_visibility ON rooms(visibility);

-- ------------------------------------------------
-- 3) room_members: Roomメンバー
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS room_members (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    room_id               TEXT NOT NULL,
    user_id               TEXT NOT NULL,
    role                  TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'readonly')),
    joined_at             TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_members_room_user ON room_members(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user_id ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_role ON room_members(room_id, role);

-- ------------------------------------------------
-- 4) quests: Quest（目標・プロジェクト）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS quests (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    room_id               TEXT NOT NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    status                TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    start_date            TEXT,
    target_date           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quests_room_id ON quests(room_id);
CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);

-- ------------------------------------------------
-- 5) squads: Squad（チーム単位）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS squads (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    room_id               TEXT NOT NULL,
    name                  TEXT NOT NULL,
    description           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_squads_room_id ON squads(room_id);

-- ------------------------------------------------
-- 6) squad_members: Squadメンバー
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS squad_members (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    squad_id              TEXT NOT NULL,
    user_id               TEXT NOT NULL,
    role                  TEXT DEFAULT 'member' CHECK (role IN ('leader', 'member')),
    joined_at             TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_squad_members_squad_user ON squad_members(squad_id, user_id);
CREATE INDEX IF NOT EXISTS idx_squad_members_user_id ON squad_members(user_id);

-- ------------------------------------------------
-- 7) room_charters: Room宣言・合意事項
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS room_charters (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    room_id               TEXT NOT NULL,
    charter_type          TEXT NOT NULL CHECK (charter_type IN ('rule', 'guideline', 'policy')),
    title                 TEXT NOT NULL,
    content               TEXT NOT NULL,
    version               INTEGER DEFAULT 1,
    approved_by_user_id   TEXT,
    approved_at           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_room_charters_room_id ON room_charters(room_id);
CREATE INDEX IF NOT EXISTS idx_room_charters_type ON room_charters(charter_type);

-- ------------------------------------------------
-- 8) lists: リスト（共有可能なリスト）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS lists (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    owner_user_id         TEXT NOT NULL,
    room_id               TEXT,              -- NULL = personal list
    title                 TEXT NOT NULL,
    description           TEXT,
    list_type             TEXT DEFAULT 'todo' CHECK (list_type IN ('todo', 'shopping', 'notes', 'contacts')),
    visibility            TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'room', 'public')),
    is_template           INTEGER DEFAULT 0 NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lists_owner_user_id ON lists(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lists_room_id ON lists(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lists_list_type ON lists(list_type);

-- ------------------------------------------------
-- 9) list_members: リストメンバー（共同編集権限）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS list_members (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    list_id               TEXT NOT NULL,
    user_id               TEXT NOT NULL,
    permission            TEXT DEFAULT 'view' CHECK (permission IN ('owner', 'edit', 'view')),
    joined_at             TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_list_members_list_user ON list_members(list_id, user_id);
CREATE INDEX IF NOT EXISTS idx_list_members_user_id ON list_members(user_id);

-- ------------------------------------------------
-- 10) hosted_events: イベント配信（1対N）
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS hosted_events (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    host_user_id          TEXT NOT NULL,
    room_id               TEXT,              -- イベント所属Room
    title                 TEXT NOT NULL,
    description           TEXT,
    start_at              TEXT NOT NULL,
    end_at                TEXT,
    location              TEXT,
    event_type            TEXT DEFAULT 'meeting' CHECK (event_type IN ('meeting', 'webinar', 'social', 'other')),
    max_attendees         INTEGER,
    rsvp_enabled          INTEGER DEFAULT 1 NOT NULL,
    public_token          TEXT UNIQUE,       -- Public event link token
    status                TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_hosted_events_host_user_id ON hosted_events(host_user_id);
CREATE INDEX IF NOT EXISTS idx_hosted_events_room_id ON hosted_events(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hosted_events_status ON hosted_events(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hosted_events_public_token ON hosted_events(public_token) WHERE public_token IS NOT NULL;

-- ------------------------------------------------
-- 11) event_rsvps: イベント出欠回答
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS event_rsvps (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    event_id              TEXT NOT NULL,
    user_id               TEXT,              -- NULL if external guest
    guest_email           TEXT,              -- External guest email
    guest_name            TEXT,              -- External guest name
    response              TEXT DEFAULT 'pending' CHECK (response IN ('pending', 'yes', 'no', 'maybe')),
    notes                 TEXT,
    responded_at          TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES hosted_events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_id ON event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user_id ON event_rsvps(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_rsvps_response ON event_rsvps(event_id, response);

-- ------------------------------------------------
-- 12) broadcasts: イベント配信通知
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS broadcasts (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    event_id              TEXT NOT NULL,
    sent_by_user_id       TEXT NOT NULL,
    subject               TEXT NOT NULL,
    body                  TEXT NOT NULL,
    send_status           TEXT DEFAULT 'scheduled' CHECK (send_status IN ('scheduled', 'sending', 'sent', 'failed')),
    scheduled_at          TEXT,
    sent_at               TEXT,
    recipient_count       INTEGER DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (event_id) REFERENCES hosted_events(id) ON DELETE CASCADE,
    FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_event_id ON broadcasts(event_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_send_status ON broadcasts(send_status);

-- ------------------------------------------------
-- 13) broadcast_deliveries: 配信配送ログ
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS broadcast_deliveries (
    id                    TEXT PRIMARY KEY,  -- UUID v4
    broadcast_id          TEXT NOT NULL,
    recipient_email       TEXT NOT NULL,
    delivery_status       TEXT DEFAULT 'queued' CHECK (delivery_status IN ('queued', 'sent', 'failed', 'bounced')),
    delivered_at          TEXT,
    error_message         TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_broadcast_id ON broadcast_deliveries(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_status ON broadcast_deliveries(delivery_status);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_email ON broadcast_deliveries(recipient_email);
