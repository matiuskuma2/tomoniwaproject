-- P2-E1: Slack/Chatwork送達
-- workspace単位で通知チャネル設定を保存

CREATE TABLE IF NOT EXISTS workspace_notification_settings (
  workspace_id TEXT PRIMARY KEY,
  
  -- Slack設定
  slack_enabled INTEGER NOT NULL DEFAULT 0,
  slack_webhook_url TEXT NULL,
  
  -- Chatwork設定（将来用）
  chatwork_enabled INTEGER NOT NULL DEFAULT 0,
  chatwork_api_token TEXT NULL,
  chatwork_room_id TEXT NULL,
  
  -- メタ情報
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  -- 外部キー
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- インデックス（有効なSlack設定を持つworkspaceを高速に取得）
CREATE INDEX IF NOT EXISTS idx_workspace_notification_slack_enabled 
ON workspace_notification_settings(slack_enabled) WHERE slack_enabled = 1;

-- インデックス（有効なChatwork設定を持つworkspaceを高速に取得）
CREATE INDEX IF NOT EXISTS idx_workspace_notification_chatwork_enabled 
ON workspace_notification_settings(chatwork_enabled) WHERE chatwork_enabled = 1;
