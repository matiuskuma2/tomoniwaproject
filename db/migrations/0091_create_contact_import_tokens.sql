-- Migration: 0091_create_contact_import_tokens
-- PR-D-1: チャット取り込みの確認トークン管理テーブル
-- 
-- 事故ゼロ設計:
-- - 取り込みは必ず確認フローを経由
-- - トークンは24時間で自動期限切れ
-- - ワークスペース・オーナー境界を強制

CREATE TABLE IF NOT EXISTS contact_import_tokens (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    candidates_json TEXT NOT NULL,  -- 解析済み候補のJSON
    source TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'email' | 'csv' | 'business_card'
    expires_at TEXT NOT NULL,  -- ISO 8601
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- 外部キー制約（参照整合性）
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

-- インデックス: 期限切れトークンのクリーンアップ用
CREATE INDEX IF NOT EXISTS idx_contact_import_tokens_expires_at 
ON contact_import_tokens(expires_at);

-- インデックス: ユーザーごとのトークン検索用
CREATE INDEX IF NOT EXISTS idx_contact_import_tokens_owner 
ON contact_import_tokens(workspace_id, owner_user_id);
