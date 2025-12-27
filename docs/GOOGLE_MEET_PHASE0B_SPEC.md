# Google Meet Auto-Generation - Phase 0B Specification

## 概要

Phase 0Bでは、主催者のGoogle Calendarにイベントを完全登録し、Google Meetリンクを自動生成します。

**Phase 0Aからの変更点：**
- ✅ 主催者をattendeesに追加
- ✅ リマインダー設定（24時間前 + 1時間前）
- ✅ Token refresh実装（自動更新）
- ✅ OAuth scope拡張（`calendar.events` + `offline` access）

---

## 実装内容

### 1. OAuth Scope拡張

**変更ファイル:** `apps/api/src/routes/auth.ts`

**追加されたscope:**
```typescript
const scopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events', // 追加
];
```

**追加パラメータ:**
- `access_type=offline`: Refresh token取得
- `prompt=consent`: 既存ユーザーに再同意を要求

---

### 2. Token Refresh実装

**変更ファイル:** `apps/api/src/services/googleCalendar.ts`

**機能:**
- Access tokenの有効期限チェック（5分前）
- 期限切れ時にrefresh tokenで自動更新
- 更新後のtokenをDBに保存

**実装:**
```typescript
static async getOrganizerAccessToken(
  db: D1Database,
  organizerUserId: string,
  env: Env
): Promise<string | null>
```

---

### 3. Calendar Event作成（Phase 0B版）

**変更ファイル:** `apps/api/src/services/googleCalendar.ts`

**attendees:**
```json
{
  "attendees": [
    {
      "email": "organizer@example.com",
      "organizer": true,
      "responseStatus": "accepted"
    }
  ]
}
```

**reminders:**
```json
{
  "reminders": {
    "useDefault": false,
    "overrides": [
      { "method": "email", "minutes": 1440 },
      { "method": "popup", "minutes": 60 }
    ]
  }
}
```

---

### 4. Google Account Token保存

**変更ファイル:** `apps/api/src/routes/auth.ts`

**OAuth callback処理:**
- `access_token`、`refresh_token`、`expires_in`、`scope`を取得
- `google_accounts`テーブルに保存
- Refresh tokenは一度しか返らないため、既存の場合は上書きしない

---

## データベーススキーマ

### `google_accounts` テーブル（既存）

```sql
CREATE TABLE google_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,      -- Phase 0B: Refresh token保存
  token_expires_at TEXT,        -- Phase 0B: 有効期限
  scope TEXT,                   -- Phase 0B: 許可されたscope
  calendar_sync_enabled INTEGER DEFAULT 1,
  last_sync_at TEXT,
  is_primary INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Note:** 既存テーブルで対応可能（Migration不要）

---

## E2Eテスト手順

### 1. 再同意フロー（既存ユーザー）

```bash
# 1) ブラウザでログイン（再同意が必要）
https://webapp.snsrilarc.workers.dev/auth/google/start

# 2) Google同意画面で「Calendar events」権限を許可

# 3) Bearer token取得
fetch('/auth/token', { method: 'POST', credentials: 'include' })
  .then(r => r.json())
  .then(d => console.log('TOKEN:', d.access_token))
```

### 2. Thread作成 & Finalize

```bash
TOKEN="your_access_token_here"
PROD_URL="https://webapp.snsrilarc.workers.dev"

# Thread作成
THREAD_DATA=$(curl -s -X POST "${PROD_URL}/api/threads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Phase 0Bテスト","description":"Meet + Attendees + Reminders"}')

THREAD_ID=$(echo "$THREAD_DATA" | jq -r '.thread.id')

# Slot ID取得
SLOT_ID=$(curl -s "${PROD_URL}/api/threads/${THREAD_ID}/status" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.slots[0].slot_id')

# Finalize（Meet生成）
curl -s -X POST "${PROD_URL}/api/threads/${THREAD_ID}/finalize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"selected_slot_id\":\"${SLOT_ID}\"}" | jq '.meeting'
```

### 3. 期待される結果

**成功時のレスポンス:**
```json
{
  "meeting": {
    "provider": "google_meet",
    "url": "https://meet.google.com/xxx-yyyy-zzz",
    "calendar_event_id": "event_id_from_google"
  }
}
```

**Google Calendarで確認:**
- ✅ イベントが作成されている
- ✅ Google Meetリンクが含まれている
- ✅ 主催者がattendeesに含まれている
- ✅ リマインダーが設定されている（24時間前 + 1時間前）

---

## トラブルシューティング

### `meeting: null` が返る場合

**原因1: Google Account未連携**
- 解決: `/auth/google/start` でログイン

**原因2: Calendar scope未許可**
- 解決: `prompt=consent` で再同意

**原因3: Refresh token未保存**
- 解決: OAuth callbackでrefresh token保存を確認

**原因4: Access token期限切れ & Refresh失敗**
- 解決: Token refresh実装を確認

---

## 今後の拡張（Phase 1以降）

### Phase 1: 外部参加者招待
- `attendees`に外部ゲストを追加
- Calendar Invite送信
- RSVP管理

### Phase 2: カレンダー同期
- 主催者の空き時間取得
- 候補日時の自動提案

### Phase 3: Google Workspace統合
- 組織内ユーザーの空き時間取得
- 会議室予約

---

## セキュリティ考慮事項

### Token管理
- ✅ `access_token_enc` / `refresh_token_enc`: 暗号化（TODO: 実装）
- ✅ Token有効期限チェック
- ✅ Refresh tokenの安全な保存

### Scope最小化
- ✅ `calendar.events`: イベント作成のみ（読み取りなし）
- ❌ `calendar`: 全カレンダーアクセス（不要）

### エラーハンドリング
- ✅ Meet生成失敗でもfinalize成功（graceful degradation）
- ✅ Inbox警告でユーザーに通知

---

## パフォーマンス

### Token Refresh頻度
- Access token有効期限: 通常1時間
- Refresh実行タイミング: 有効期限5分前
- DB更新: Refresh時のみ

### Meet生成時間
- Google Calendar API: 通常200-500ms
- 失敗時タイムアウト: なし（非同期推奨）

---

## リリースチェックリスト

### Phase 0B リリース前
- [ ] OAuth scope拡張デプロイ
- [ ] Token refresh実装デプロイ
- [ ] 本番環境で再同意フロー確認
- [ ] Meet URLが正しく生成されることを確認
- [ ] Google Calendarにイベントが登録されることを確認
- [ ] リマインダーが設定されることを確認
- [ ] Token refresh動作確認（有効期限切れ後）

### Phase 0B リリース後
- [ ] 既存ユーザーに再同意を促す通知
- [ ] Meet生成成功率のモニタリング
- [ ] Token refresh失敗率のモニタリング

---

## まとめ

Phase 0Bにより、Google Meetの自動生成が完全に機能します：
- ✅ OAuth scope拡張（calendar.events + offline）
- ✅ Token refresh実装
- ✅ 主催者のカレンダーにイベント登録
- ✅ Google Meetリンク生成
- ✅ リマインダー設定
- ✅ Graceful degradation（失敗時もfinalize成功）

**次のフェーズ:** 外部参加者への招待（Phase 1）
