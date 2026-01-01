-- billing_accounts テーブル（現在の課金状態）
-- ユーザーごとの最新の課金状態を保存（巻き戻り防止付き）
CREATE TABLE billing_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                  -- tomonowaのuser_id（後で紐付け）
  myasp_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  plan INTEGER NOT NULL,            -- 1=Free, 2=Pro, 3=Business
  amount INTEGER NOT NULL,           -- 980, 2980, 15000
  status INTEGER NOT NULL,           -- 1=登録, 2=停止, 3=復活, 4=解約
  last_event_id INTEGER,             -- billing_events.id への参照
  last_event_ts TEXT,                -- 最後に処理したイベントのts（巻き戻り防止の"正"）
  updated_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- インデックス（パフォーマンス＋検索用）
CREATE INDEX idx_billing_accounts_user_id ON billing_accounts(user_id);
CREATE INDEX idx_billing_accounts_myasp_user_id ON billing_accounts(myasp_user_id);
CREATE INDEX idx_billing_accounts_email ON billing_accounts(email);
CREATE INDEX idx_billing_accounts_status ON billing_accounts(status);
CREATE INDEX idx_billing_accounts_last_event_ts ON billing_accounts(last_event_ts);
