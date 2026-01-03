-- ============================================================
-- Migration: 0055_create_ledger_audit_events.sql
-- Purpose : Ledger audit events (contacts/channels/list_members 変更追跡)
-- Tenant  : workspace_id + owner_user_id
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ledger_audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,            -- 誰が操作したか
  target_type   TEXT NOT NULL CHECK (target_type IN ('contact', 'channel', 'list_member', 'relationship')),
  target_id     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  payload_json  TEXT NOT NULL,            -- minimal diff JSON
  request_id    TEXT NOT NULL,
  source_ip     TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ====== Indexes ======

-- (A) Tenant + 時系列検索（運用インシデント調査）
CREATE INDEX IF NOT EXISTS idx_ledger_audit_tenant_created
  ON ledger_audit_events(workspace_id, owner_user_id, created_at DESC);

-- (B) request_id で追跡（障害時の特定）
CREATE INDEX IF NOT EXISTS idx_ledger_audit_request
  ON ledger_audit_events(request_id);

-- (C) target_id で追跡（特定リソースの変更履歴）
CREATE INDEX IF NOT EXISTS idx_ledger_audit_target
  ON ledger_audit_events(target_type, target_id, created_at DESC);

-- ====== 運用インシデント防止 ======
-- 全ての台帳系変更は必ず audit に記録
-- request_id で 5分以内に追跡可能
-- payload_json は minimal diff（全データは入れない）
