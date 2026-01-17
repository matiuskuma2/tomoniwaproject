# ToMoniWao - データベース設計

**最終更新**: 2026-01-17  
**Database**: Cloudflare D1 (SQLite)  
**Migration Count**: 73 (0001-0073)

---

## 📊 ER図（主要テーブル）

```
users (ユーザー)
  ├── google_accounts (Google連携)
  ├── sessions (セッション)
  ├── scheduling_threads (スレッド) ─┬─── thread_invites (招待)
  │                                  │     └─── invite_deliveries (配信追跡) [0066]
  │                                  ├─── thread_participants (参加者)
  │                                  ├─── scheduling_slots (候補日時)
  │                                  │     └─── proposal_version [0068]
  │                                  ├─── thread_selections (選択)
  │                                  │     └─── proposal_version [0069]
  │                                  ├─── thread_finalize (確定情報)
  │                                  ├─── thread_attendance_rules (出欠ルール) [0033]
  │                                  └─── pending_actions (送信確認) [0065]
  ├── contacts (連絡先) [0041]
  │     └─── contact_channels (連絡チャネル) [0054]
  ├── lists (リスト) [0042] ────────── list_members (メンバー) [0043,0052]
  ├── business_cards (名刺) [0045]
  │     └─── contact_touchpoints (接点履歴) [0046]
  └── inbox_items (受信トレイ) [0028]
```

---

## 🗂️ テーブル一覧

### コアテーブル

| テーブル | 説明 | 主要カラム |
|---------|------|----------|
| `users` | ユーザー情報 | id, email, name, role, created_at |
| `google_accounts` | Google連携 | id, user_id, google_sub, refresh_token_enc |
| `sessions` | セッション管理 | id, user_id, token_hash, expires_at |
| `workspaces` | ワークスペース | id, owner_id, name, slug |

### スケジュール調整テーブル

| テーブル | 説明 | 主要カラム |
|---------|------|----------|
| `scheduling_threads` | 調整スレッド | id, user_id, title, description, status, timezone, proposal_version, additional_propose_count |
| `thread_invites` | 招待リンク | id, thread_id, token, email, status, invitee_key |
| `thread_participants` | 参加者 | id, thread_id, user_id, email, role, contact_id |
| `scheduling_slots` | 候補日時 | id, thread_id, start_time, end_time, timezone, proposal_version |
| `thread_selections` | 選択結果 | id, thread_id, invite_id, slot_id, status, proposal_version |
| `thread_finalize` | 確定情報 | id, thread_id, slot_id, google_event_id, meet_link |
| `thread_attendance_rules` | 出欠ルール | id, thread_id, invitee_key, rule_json |

### Beta A / Phase 2 追加テーブル

| テーブル | 説明 | マイグレーション |
|---------|------|----------------|
| `pending_actions` | 送信確認フロー | 0065 |
| `invite_deliveries` | 配信追跡 | 0066 |

### 連絡先・リストテーブル

| テーブル | 説明 | 主要カラム |
|---------|------|----------|
| `contacts` | 連絡先 | id, user_id, name, email, phone, tags |
| `lists` | リスト | id, user_id, name, description |
| `list_members` | リストメンバー | id, list_id, contact_id, added_at |
| `business_cards` | 名刺情報 | id, user_id, contact_id, image_url, ocr_text |

### 管理・システムテーブル

| テーブル | 説明 | 主要カラム |
|---------|------|----------|
| `system_settings` | システム設定 | key, value, updated_at |
| `ai_provider_settings` | AI設定 | id, provider, model, cost_per_token |
| `ai_provider_keys` | APIキー | id, provider, key_enc, masked_preview |
| `ai_usage_logs` | AI利用ログ | id, user_id, provider, tokens_used, cost |
| `ai_budgets` | AIバジェット | id, user_id, monthly_limit, current_usage |

---

## 📋 主要テーブル詳細

### 1. users（ユーザー）

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**役割**:
- ユーザー基本情報
- 全データの親テーブル

**制約**:
- `email` - UNIQUE
- `role` - user/admin/super_admin
- `status` - active/suspended/deleted

---

### 2. google_accounts（Google連携）

```sql
CREATE TABLE google_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scope TEXT,
  is_primary INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**役割**:
- Google OAuth トークン保存
- Google Calendar API連携
- Google Meet生成

**セキュリティ**:
- `refresh_token_enc` - 暗号化して保存（現状平文、暗号化は今後実装）

**重要**:
- `scope` - `https://www.googleapis.com/auth/calendar.events` が必須

---

### 3. sessions（セッション）

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**役割**:
- Cookie/Bearer Token認証
- セッション管理

**フロー**:
1. OAuth callback後に作成
2. `token_hash` - SHA-256ハッシュ化
3. Cookie: `session=<raw_token>` をセット
4. `/auth/token` で `token_hash` 検証
5. 有効期限: 30日

---

### 4. scheduling_threads（スレッド）

```sql
CREATE TABLE scheduling_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft',      -- 作成中
    'sent',       -- 招待送信済み（回答収集中）
    'confirmed',  -- 日程確定済み
    'cancelled',  -- キャンセル
    'archived'    -- アーカイブ
  )),
  -- Phase 2: 追加候補管理 [0067]
  proposal_version INTEGER NOT NULL DEFAULT 1,
  additional_propose_count INTEGER NOT NULL DEFAULT 0,
  -- P3-TZ3: タイムゾーン [0072]
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);
```

**役割**:
- スケジュール調整の「セッション」
- 1つのThreadに複数のInviteを紐付け

**ステータス**:
- `draft` - 作成中
- `sent` - 招待送信済み（回答収集中 = collecting）
- `confirmed` - 日程確定済み
- `cancelled` - キャンセル
- `archived` - アーカイブ

**Phase 2 カラム**:
- `proposal_version` - 候補の世代管理（追加候補ごとに +1）
- `additional_propose_count` - 追加候補の実行回数（最大2回）
- `timezone` - 主催者のタイムゾーン（外部ユーザーへの表示用）

---

### 5. thread_invites（招待）

```sql
CREATE TABLE thread_invites (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  candidate_reason TEXT,
  invitee_key TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

**役割**:
- 外部招待リンク（/i/:token）
- 招待ステータス管理

**フロー**:
1. Thread作成 → Invite作成
2. `token` - ランダムな文字列（URLに使用）
3. `invitee_key` - 招待者識別キー（後から追加）
4. メール送信 → 相手が `/i/:token` にアクセス
5. 候補日時選択 → `status='accepted'`

---

### 6. scheduling_slots（候補日時）

```sql
CREATE TABLE scheduling_slots (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'selected', 'unavailable')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

**役割**:
- Thread の候補日時
- 複数の候補を登録可能

**タイムゾーン**:
- ISO 8601形式（例: `2025-01-15T10:00:00Z`）
- timezone列で明示

---

### 7. thread_selections（選択結果）

```sql
CREATE TABLE thread_selections (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  invite_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  status TEXT DEFAULT 'selected' CHECK (status IN ('selected', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES thread_invites(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES scheduling_slots(id) ON DELETE CASCADE
);
```

**役割**:
- 招待者が選択した候補日時を記録

**フロー**:
1. `/i/:token` で候補選択
2. `thread_selections` に記録
3. `invite.status='accepted'` に更新

---

### 8. thread_finalize（確定情報）

```sql
CREATE TABLE thread_finalize (
  id TEXT PRIMARY KEY,
  thread_id TEXT UNIQUE NOT NULL,
  slot_id TEXT NOT NULL,
  google_event_id TEXT,
  meet_link TEXT,
  finalized_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_by TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES scheduling_slots(id),
  FOREIGN KEY (finalized_by) REFERENCES users(id)
);
```

**役割**:
- Thread確定情報（Google Meet URL等）

**フロー**:
1. `/api/threads/:id/finalize` API呼び出し
2. Google Calendar Event作成
3. Google Meet URL生成
4. `thread_finalize` に記録

---

### 9. contacts（連絡先）

```sql
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  position TEXT,
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**役割**:
- ユーザーの連絡先管理

**検索**:
- `name`, `email`, `tags` でフルテキスト検索（将来）

---

### 10. lists（リスト）

```sql
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**役割**:
- 連絡先のセグメント管理
- 一括招待に使用

**例**:
- 「セミナー参加者」
- 「VIPクライアント」
- 「社内メンバー」

---

### 11. list_members（リストメンバー）

```sql
CREATE TABLE list_members (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_preferences TEXT DEFAULT 'email',
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  UNIQUE(list_id, contact_id)
);
```

**役割**:
- リストと連絡先の多対多関係

**制約**:
- UNIQUE(list_id, contact_id) - 重複防止

---

### 12. business_cards（名刺）

```sql
CREATE TABLE business_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  contact_id TEXT,
  image_url TEXT,
  ocr_text TEXT,
  parsed_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);
```

**役割**:
- 名刺画像管理
- OCR結果保存（将来実装）

**フロー**:
1. 名刺写真アップロード → R2保存
2. OCR実行 → `ocr_text` 保存
3. パース → `parsed_data` (JSON)
4. Contact作成 → `contact_id` 紐付け

---

## 📈 インデックス戦略

### パフォーマンス最適化

```sql
-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);

-- Scheduling Threads
CREATE INDEX idx_scheduling_threads_user_workspace ON scheduling_threads(user_id, workspace_id, status);
CREATE INDEX idx_scheduling_threads_proposal_version ON scheduling_threads(id, proposal_version);
CREATE INDEX idx_scheduling_threads_timezone ON scheduling_threads(timezone);

-- Thread Invites
CREATE INDEX idx_thread_invites_thread_id ON thread_invites(thread_id);
CREATE UNIQUE INDEX idx_thread_invites_token ON thread_invites(token);
CREATE INDEX idx_thread_invites_email ON thread_invites(email);
CREATE UNIQUE INDEX idx_thread_invites_invitee_key ON thread_invites(invitee_key);

-- Pending Actions (Beta A)
CREATE UNIQUE INDEX idx_pending_actions_confirm_token ON pending_actions(confirm_token);
CREATE INDEX idx_pending_actions_tenant_status ON pending_actions(workspace_id, owner_user_id, status, created_at DESC);
CREATE INDEX idx_pending_actions_expires ON pending_actions(expires_at) WHERE status = 'pending';

-- Invite Deliveries (Beta A)
CREATE INDEX idx_invite_deliveries_thread ON invite_deliveries(thread_id, delivery_type, created_at DESC);
CREATE INDEX idx_invite_deliveries_invite ON invite_deliveries(invite_id, channel) WHERE invite_id IS NOT NULL;
CREATE INDEX idx_invite_deliveries_failed ON invite_deliveries(status, retry_count) WHERE status = 'failed';

-- Contacts
CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_email ON contacts(email);

-- Lists
CREATE INDEX idx_lists_user_id ON lists(user_id);

-- List Members
CREATE INDEX idx_list_members_list_id ON list_members(list_id);
CREATE INDEX idx_list_members_contact_id ON list_members(contact_id);
```

---

## 🔐 セキュリティ考慮事項

### 1. データ暗号化
- **refresh_token**: 暗号化必須（現状平文、今後実装）
- **API Keys**: 暗号化済み（ai_provider_keys）

### 2. アクセス制御
- **Row Level Security**: アプリケーション層で実装
- **ユーザーは自分のデータのみアクセス可能**

### 3. 削除ポリシー
- **CASCADE**: sessions, threads, contacts等
- **SET NULL**: workspace_id等

---

## 📊 データ容量見積もり

### 1ユーザーあたり（平均）
- Threads: 10件/月 × 12ヶ月 = 120件/年
- Contacts: 100件
- Lists: 5件
- Sessions: 3件（デバイス数）

### 1000ユーザー
- Threads: 120,000件
- Contacts: 100,000件
- Sessions: 3,000件

**合計**: < 1GB（D1無料枠: 5GB）

---

## 🔄 マイグレーション管理

### マイグレーションファイル命名規則
```
XXXX_description.sql
```
- `XXXX`: 4桁の連番（0001〜）
- `description`: 簡潔な説明

### 適用コマンド
```bash
# ローカル
npm run db:migrate:local

# 本番
npm run db:migrate:prod
```

### マイグレーション履歴
詳細: [MIGRATION_HISTORY.md](./MIGRATION_HISTORY.md)

---

**次のドキュメント**: [API_SPECIFICATION.md](./API_SPECIFICATION.md)
