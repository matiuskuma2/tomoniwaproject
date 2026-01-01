-- billing_events テーブル（監査ログ＋冪等性）
-- MyASPからのPOSTを全て記録し、dedupe_keyで冪等性を保証
CREATE TABLE billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  myasp_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  plan INTEGER NOT NULL,           -- 1=Free, 2=Pro, 3=Business
  amount INTEGER NOT NULL,          -- 980, 2980, 15000
  status INTEGER NOT NULL,          -- 1=登録, 2=停止, 3=復活, 4=解約
  ts TEXT NOT NULL,                 -- MyASPのタイムスタンプ（ISO 8601）
  dedupe_key TEXT UNIQUE NOT NULL,  -- user_id|ts|status|plan（冪等性保証）
  raw_payload TEXT NOT NULL,        -- 元のPOSTデータ（JSON）
  source_ip TEXT,                   -- 送信元IP（監査用）
  user_agent TEXT,                  -- User-Agent（監査用）
  received_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- インデックス（パフォーマンス＋監査用）
CREATE INDEX idx_billing_events_myasp_user_id ON billing_events(myasp_user_id);
CREATE INDEX idx_billing_events_received_at ON billing_events(received_at DESC);
CREATE INDEX idx_billing_events_source_ip ON billing_events(source_ip);
CREATE INDEX idx_billing_events_ts ON billing_events(ts);
