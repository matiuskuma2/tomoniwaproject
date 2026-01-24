-- CONV-CHAT: AI秘書との会話履歴テーブル
-- 雑談を含む全ての会話を記録し、コンテキストとして活用

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  thread_id TEXT,  -- スレッドに紐づく場合（任意）
  intent TEXT,     -- 検出された意図（任意）
  metadata TEXT,   -- JSON形式の追加データ（将来の拡張用）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ユーザーごとの最新会話を高速取得
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_recent 
  ON chat_messages(user_id, created_at DESC);

-- ワークスペースごとの最新会話を高速取得
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace_recent 
  ON chat_messages(workspace_id, created_at DESC);

-- スレッドに紐づく会話を取得
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON chat_messages(thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;
