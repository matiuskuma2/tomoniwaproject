# SYNC_API_SPEC.md
Calendar Sync API Specification (Draft)

**Phase**: Next-7 Day0 (Design Only)  
**Status**: Draft（審査完了後に実装）

---

## POST /api/threads/:id/calendar/sync

### 概要
確定済みスレッドを外部カレンダーに同期する。
※ 実装は OAuth 審査完了後

---

### リクエスト

**HTTP Method**: `POST`  
**Path**: `/api/threads/:id/calendar/sync`  
**Authorization**: `Bearer <token>`

#### Body
```json
{
  "final_slot_id": "slot_xxx"
}
```

#### パラメータ
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `final_slot_id` | string | ✅ | 確定した候補日のID |

---

### レスポンス（成功 - 新規作成）

**HTTP Status**: `201 Created`

```json
{
  "status": "created",
  "calendar_event_id": "evt_123",
  "meet_url": "https://meet.google.com/xxx-xxxx-xxx",
  "synced_at": "2026-01-01T12:00:00Z"
}
```

---

### レスポンス（成功 - 既に同期済み・冪等）

**HTTP Status**: `200 OK`

```json
{
  "status": "already_synced",
  "calendar_event_id": "evt_123",
  "meet_url": "https://meet.google.com/xxx-xxxx-xxx",
  "synced_at": "2026-01-01T12:00:00Z"
}
```

---

### レスポンス（失敗 - A案フォールバック）

**HTTP Status**: `200 OK`（エラーで止めない）

```json
{
  "status": "failed",
  "reason": "oauth_not_granted",
  "manual_event_payload": {
    "title": "日程調整ミーティング",
    "start_at": "2026-01-05T10:00:00+09:00",
    "end_at": "2026-01-05T11:00:00+09:00",
    "timezone": "Asia/Tokyo",
    "description": "以下のURLで参加してください\n\nhttps://meet.google.com/xxx-xxxx-xxx",
    "meet_url": "https://meet.google.com/xxx-xxxx-xxx"
  }
}
```

#### 失敗理由（reason）
| Reason | Description |
|--------|-------------|
| `oauth_not_granted` | OAuth未許可 |
| `api_error` | 外部API失敗 |
| `quota_exceeded` | API制限超過 |
| `invalid_slot` | 候補日が無効 |
| `thread_not_confirmed` | スレッド未確定 |

---

### エラーレスポンス（リクエスト不正）

**HTTP Status**: `400 Bad Request`

```json
{
  "error": "invalid_request",
  "message": "final_slot_id is required"
}
```

---

### エラーレスポンス（未認証）

**HTTP Status**: `401 Unauthorized`

```json
{
  "error": "unauthorized",
  "message": "Invalid or expired token"
}
```

---

### エラーレスポンス（スレッド未確定）

**HTTP Status**: `422 Unprocessable Entity`

```json
{
  "error": "thread_not_confirmed",
  "message": "Thread must be confirmed before syncing to calendar"
}
```

---

## GET /api/threads/:id/calendar/sync-status

### 概要
UIが同期状態を復元するために使用

---

### リクエスト

**HTTP Method**: `GET`  
**Path**: `/api/threads/:id/calendar/sync-status`  
**Authorization**: `Bearer <token>`

---

### レスポンス（同期済み）

**HTTP Status**: `200 OK`

```json
{
  "synced": true,
  "calendar_event_id": "evt_123",
  "meet_url": "https://meet.google.com/xxx-xxxx-xxx",
  "synced_at": "2026-01-01T12:00:00Z"
}
```

---

### レスポンス（未同期）

**HTTP Status**: `200 OK`

```json
{
  "synced": false
}
```

---

## 冪等性保証

### Idempotency Key
```
calendar_sync_key = thread_id + ":" + final_slot_id
```

### 動作
- 同じ `thread_id` + `final_slot_id` で複数回実行
- 初回: `status: "created"` を返す
- 2回目以降: `status: "already_synced"` を返す
- 既存の `calendar_event_id` と `meet_url` を返す

---

## セキュリティ

### OAuth スコープ（最小）
- `https://www.googleapis.com/auth/calendar.events.owned`
- （Read-only scope は不要）

### Authorization
- Bearer トークン必須
- トークンは organizer_user_id と紐付け
- 他人のスレッドは同期不可（403 Forbidden）

---

## 実装優先度

### Phase Next-7 Day1（審査後）
- ✅ POST `/api/threads/:id/calendar/sync`
- ✅ GET `/api/threads/:id/calendar/sync-status`
- ✅ D1 テーブル `calendar_syncs` 作成
- ✅ 冪等性保証
- ✅ A案フォールバック

### Phase Next-7 Day2（将来）
- 🔜 差分更新（時間変更時）
- 🔜 カレンダー削除（スレッド削除時）
- 🔜 複数カレンダー対応

---

## 参考

### Google Calendar API
- Docs: https://developers.google.com/calendar/api/v3/reference
- OAuth: https://developers.google.com/identity/protocols/oauth2

### Meet URL 生成
- `conferenceData.createRequest` で自動生成
- Scope: `https://www.googleapis.com/auth/calendar.events.owned`

---

## 次のステップ
- OAuth 審査完了を待つ
- `NEXT7_REVIEW_CHECKLIST.md` を完了
- Phase Next-7 Day1 実装開始
