-- ============================================================
-- Migration: 0088_create_pool_booking.sql
-- Purpose : G2-A Pool Booking (N→1 / assignment routing)
-- MVP     : pools created by workspace admin only (API check)
-- ============================================================

-- ============================================================
-- pools: 受付プール（担当者グループ）
-- ============================================================
CREATE TABLE IF NOT EXISTS pools (
  id                TEXT PRIMARY KEY,            -- UUID
  workspace_id       TEXT NOT NULL,
  owner_user_id      TEXT NOT NULL,              -- 作成者（MVP: workspace admin）
  name              TEXT NOT NULL,
  description       TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,

  assignment_policy TEXT NOT NULL DEFAULT 'round_robin'
    CHECK (assignment_policy IN ('round_robin')),

  slot_capacity     INTEGER NOT NULL DEFAULT 1 CHECK (slot_capacity >= 1),

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pools_workspace ON pools(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pools_owner ON pools(workspace_id, owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pools_active ON pools(workspace_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pools_workspace_name
ON pools(workspace_id, name);

-- ============================================================
-- pool_members: プールのメンバー（担当者）
-- ============================================================
CREATE TABLE IF NOT EXISTS pool_members (
  id              TEXT PRIMARY KEY,              -- UUID
  workspace_id     TEXT NOT NULL,
  pool_id          TEXT NOT NULL,
  user_id          TEXT NOT NULL,                -- 内部ユーザー（workmate想定）
  is_active       INTEGER NOT NULL DEFAULT 1,

  join_order      INTEGER NOT NULL DEFAULT 0,    -- round-robin順

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_members_pool_user
ON pool_members(pool_id, user_id);

CREATE INDEX IF NOT EXISTS idx_pool_members_pool
ON pool_members(pool_id, is_active, join_order);

CREATE INDEX IF NOT EXISTS idx_pool_members_user
ON pool_members(workspace_id, user_id, created_at DESC);

-- ============================================================
-- pool_slots: プール公開枠（時間スロット）
-- ============================================================
CREATE TABLE IF NOT EXISTS pool_slots (
  id              TEXT PRIMARY KEY,              -- UUID
  workspace_id     TEXT NOT NULL,
  pool_id          TEXT NOT NULL,

  start_at        TEXT NOT NULL,
  end_at          TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  label           TEXT,

  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reserved','booked','cancelled')),

  reserved_count  INTEGER NOT NULL DEFAULT 0,
  booked_count    INTEGER NOT NULL DEFAULT 0,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pool_slots_pool_time
ON pool_slots(pool_id, start_at);

CREATE INDEX IF NOT EXISTS idx_pool_slots_pool_status
ON pool_slots(pool_id, status, start_at);

-- ============================================================
-- pool_slot_reservations: 予約（競合防止用の一時確保）
-- Reserve → Assign の2段階
-- ============================================================
CREATE TABLE IF NOT EXISTS pool_slot_reservations (
  id              TEXT PRIMARY KEY,              -- UUID
  workspace_id     TEXT NOT NULL,
  pool_id          TEXT NOT NULL,
  slot_id          TEXT NOT NULL,

  requester_key    TEXT NOT NULL,                -- MVP: 内部ユーザーなら "u:<userId>" など
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','consumed','expired')),

  expires_at      TEXT NOT NULL,                 -- now + 5min など

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES pool_slots(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_reservation_slot_requester_active
ON pool_slot_reservations(slot_id, requester_key)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pool_reservation_expiry
ON pool_slot_reservations(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_pool_reservation_slot
ON pool_slot_reservations(slot_id, status);

-- ============================================================
-- pool_bookings: 成立した予約（割当結果）
-- ============================================================
CREATE TABLE IF NOT EXISTS pool_bookings (
  id              TEXT PRIMARY KEY,              -- UUID
  workspace_id     TEXT NOT NULL,
  pool_id          TEXT NOT NULL,
  slot_id          TEXT NOT NULL,

  assignee_user_id TEXT NOT NULL,                -- 割当先（プールメンバー）
  assignment_algo  TEXT NOT NULL DEFAULT 'round_robin'
    CHECK (assignment_algo IN ('round_robin')),

  requester_user_id TEXT NOT NULL,               -- MVP: 内部ユーザーのみ
  requester_note    TEXT,

  status          TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed','cancelled')),

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES pool_slots(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_booking_slot
ON pool_bookings(slot_id) WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_pool_booking_pool
ON pool_bookings(pool_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pool_booking_assignee
ON pool_bookings(assignee_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pool_booking_requester
ON pool_bookings(requester_user_id, created_at DESC);
