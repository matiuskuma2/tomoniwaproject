-- ============================================================
-- Migration: 0035_create_thread_selections.sql
-- Purpose : Record each invitee's selection/decline per thread
-- Status  : pending | selected | declined | expired
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS thread_selections (
  selection_id      TEXT PRIMARY KEY, -- UUID
  thread_id         TEXT NOT NULL,
  invite_id         TEXT,             -- references thread_invites.id (nullable for internal-only future)
  invitee_key       TEXT NOT NULL,    -- u:/e:/lm:
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','selected','declined','expired')),
  selected_slot_id  TEXT,             -- scheduling_slots.slot_id when selected
  responded_at      TEXT,             -- datetime('now') when responded
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES thread_invites(id) ON DELETE SET NULL,
  FOREIGN KEY (selected_slot_id) REFERENCES scheduling_slots(slot_id) ON DELETE SET NULL
);

-- One selection per invitee per thread
CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_selections_thread_invitee
  ON thread_selections(thread_id, invitee_key);

CREATE INDEX IF NOT EXISTS idx_thread_selections_thread_status
  ON thread_selections(thread_id, status);

CREATE INDEX IF NOT EXISTS idx_thread_selections_thread_slot
  ON thread_selections(thread_id, selected_slot_id);

CREATE INDEX IF NOT EXISTS idx_thread_selections_invite_id
  ON thread_selections(invite_id);
