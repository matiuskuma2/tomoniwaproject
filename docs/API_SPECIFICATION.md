# ToMoniWao - API仕様書

**最終更新**: 2025-12-28  
**Base URL**: `https://app.tomoniwao.jp`  
**API Version**: v1 (implicit)

---

## 🔐 認証

### 認証方式

**Cookie + Bearer Token ハイブリッド**

#### Cookie認証（OAuth callback用）
```http
Cookie: session=<session_token>
```

#### Bearer Token認証（API呼び出し用）
```http
Authorization: Bearer <access_token>
```

### 認証フロー

1. **OAuth開始**: `GET /auth/google/start`
2. **OAuth Callback**: `GET /auth/google/callback`
3. **Token取得**: `POST /auth/token` (Cookie必須)
4. **以降のAPI**: `Authorization: Bearer <token>`

---

## 📋 APIエンドポイント一覧

### 認証系

| Method | Endpoint | 説明 | 認証 |
|--------|----------|------|------|
| GET | `/auth/google/start` | OAuth開始 | 不要 |
| GET | `/auth/google/callback` | OAuth Callback | 不要 |
| POST | `/auth/token` | Bearer Token取得 | Cookie必須 |
| GET | `/auth/me` | ユーザー情報取得 | 必要 |
| POST | `/auth/logout` | ログアウト | 必要 |

### Threads（スケジュール調整）

| Method | Endpoint | 説明 | 認証 |
|--------|----------|------|------|
| POST | `/api/threads` | Thread作成 | 必要 |
| GET | `/api/threads` | Thread一覧取得 | 必要 |
| GET | `/api/threads/:id` | Thread詳細取得 | 必要 |
| PATCH | `/api/threads/:id` | Thread更新 | 必要 |
| DELETE | `/api/threads/:id` | Thread削除 | 必要 |
| GET | `/api/threads/:id/status` | 進捗状況取得 | 必要 |
| POST | `/api/threads/:id/remind` | リマインダー送信 | 必要 |
| POST | `/api/threads/:id/finalize` | 確定＋Meet生成 | 必要 |

### Contacts（連絡先）

| Method | Endpoint | 説明 | 認証 |
|--------|----------|------|------|
| POST | `/api/contacts` | Contact作成 | 必要 |
| GET | `/api/contacts` | Contact一覧取得 | 必要 |
| GET | `/api/contacts/:id` | Contact詳細取得 | 必要 |
| PATCH | `/api/contacts/:id` | Contact更新 | 必要 |
| DELETE | `/api/contacts/:id` | Contact削除 | 必要 |

### Lists（リスト）

| Method | Endpoint | 説明 | 認証 |
|--------|----------|------|------|
| POST | `/api/lists` | List作成 | 必要 |
| GET | `/api/lists` | List一覧取得 | 必要 |
| GET | `/api/lists/:id` | List詳細取得 | 必要 |
| PATCH | `/api/lists/:id` | List更新 | 必要 |
| DELETE | `/api/lists/:id` | List削除 | 必要 |
| GET | `/api/lists/:id/members` | メンバー一覧取得 | 必要 |
| POST | `/api/lists/:id/members` | メンバー追加 | 必要 |
| DELETE | `/api/lists/:id/members/:memberId` | メンバー削除 | 必要 |

### Business Cards（名刺）

| Method | Endpoint | 説明 | 認証 |
|--------|----------|------|------|
| POST | `/api/business-cards` | 名刺登録 | 必要 |
| GET | `/api/business-cards` | 名刺一覧取得 | 必要 |
| GET | `/api/business-cards/:id` | 名刺詳細取得 | 必要 |
| DELETE | `/api/business-cards/:id` | 名刺削除 | 必要 |

### 外部招待（Public）

| Method | Endpoint | 説明 | 認証 |
|--------|----------|------|------|
| GET | `/i/:token` | 招待ページ表示 | 不要 |
| POST | `/i/:token/select` | 候補日時選択 | 不要 |
| POST | `/i/:token/decline` | 辞退 | 不要 |

---

## 📝 API詳細仕様

### 認証系 API

#### POST /auth/token
**目的**: Cookie sessionからBearer tokenを取得

**Request**:
```http
POST /auth/token HTTP/1.1
Host: app.tomoniwao.jp
Cookie: session=<session_token>
Content-Type: application/json
```

**Response** (200 OK):
```json
{
  "access_token": "abc123...",
  "token_type": "Bearer",
  "expires_at": "2025-01-28T00:00:00Z"
}
```

**Error** (401 Unauthorized):
```json
{
  "error": "No active session. Please login first."
}
```

---

#### GET /auth/me
**目的**: 現在のユーザー情報取得

**Request**:
```http
GET /auth/me HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
```

**Response** (200 OK):
```json
{
  "id": "user_123",
  "email": "user@example.com",
  "name": "田中太郎",
  "avatar_url": "https://...",
  "role": "user",
  "created_at": "2025-01-01T00:00:00Z"
}
```

---

### Threads API

#### POST /api/threads
**目的**: 新規Thread作成

**Request**:
```http
POST /api/threads HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "打ち合わせ日程調整",
  "description": "プロジェクトキックオフミーティング",
  "invites": [
    {
      "email": "tanaka@example.com",
      "name": "田中さん",
      "reason": "プロジェクトリーダー"
    }
  ],
  "slots": [
    {
      "start_time": "2025-01-15T10:00:00Z",
      "end_time": "2025-01-15T11:00:00Z",
      "timezone": "Asia/Tokyo"
    },
    {
      "start_time": "2025-01-16T14:00:00Z",
      "end_time": "2025-01-16T15:00:00Z",
      "timezone": "Asia/Tokyo"
    }
  ]
}
```

**Response** (201 Created):
```json
{
  "thread": {
    "id": "thread_123",
    "title": "打ち合わせ日程調整",
    "description": "プロジェクトキックオフミーティング",
    "status": "active",
    "created_at": "2025-01-10T00:00:00Z"
  },
  "invites": [
    {
      "id": "invite_456",
      "thread_id": "thread_123",
      "email": "tanaka@example.com",
      "token": "abc123xyz",
      "invitee_key": "inv_789",
      "status": "pending",
      "invite_url": "https://app.tomoniwao.jp/i/abc123xyz"
    }
  ],
  "slots": [
    {
      "id": "slot_111",
      "thread_id": "thread_123",
      "start_time": "2025-01-15T10:00:00Z",
      "end_time": "2025-01-15T11:00:00Z",
      "timezone": "Asia/Tokyo",
      "status": "available"
    },
    {
      "id": "slot_222",
      "thread_id": "thread_123",
      "start_time": "2025-01-16T14:00:00Z",
      "end_time": "2025-01-16T15:00:00Z",
      "timezone": "Asia/Tokyo",
      "status": "available"
    }
  ]
}
```

---

#### GET /api/threads
**目的**: Thread一覧取得

**Request**:
```http
GET /api/threads?status=active&limit=20&offset=0 HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
```

**Query Parameters**:
- `status` (optional): active/archived/deleted
- `limit` (optional): 取得件数（デフォルト: 20）
- `offset` (optional): オフセット（デフォルト: 0）

**Response** (200 OK):
```json
{
  "threads": [
    {
      "id": "thread_123",
      "title": "打ち合わせ日程調整",
      "description": "プロジェクトキックオフミーティング",
      "status": "active",
      "created_at": "2025-01-10T00:00:00Z",
      "invite_count": 1,
      "pending_count": 1,
      "accepted_count": 0,
      "declined_count": 0
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

#### GET /api/threads/:id/status
**目的**: Thread進捗状況取得

**Request**:
```http
GET /api/threads/thread_123/status HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
```

**Response** (200 OK):
```json
{
  "thread_id": "thread_123",
  "status": "active",
  "total_invites": 1,
  "responses": {
    "pending": 0,
    "accepted": 1,
    "declined": 0,
    "expired": 0
  },
  "invites": [
    {
      "id": "invite_456",
      "email": "tanaka@example.com",
      "name": "田中さん",
      "status": "accepted",
      "accepted_at": "2025-01-12T10:00:00Z",
      "selected_slot": {
        "id": "slot_111",
        "start_time": "2025-01-15T10:00:00Z",
        "end_time": "2025-01-15T11:00:00Z"
      }
    }
  ],
  "finalized": false
}
```

---

#### POST /api/threads/:id/finalize
**目的**: Thread確定＋Google Meet生成

**Request**:
```http
POST /api/threads/thread_123/finalize HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "slot_id": "slot_111"
}
```

**Response** (200 OK):
```json
{
  "thread_id": "thread_123",
  "slot_id": "slot_111",
  "google_event_id": "event_abc123",
  "meet_link": "https://meet.google.com/abc-defg-hij",
  "calendar_link": "https://calendar.google.com/calendar/event?eid=...",
  "finalized_at": "2025-01-12T12:00:00Z"
}
```

**Error** (400 Bad Request):
```json
{
  "error": "No google account connected. Please re-authenticate with calendar access."
}
```

---

### Contacts API

#### POST /api/contacts
**目的**: 新規Contact作成

**Request**:
```http
POST /api/contacts HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "田中太郎",
  "email": "tanaka@example.com",
  "phone": "090-1234-5678",
  "company": "株式会社ABC",
  "position": "営業部長",
  "tags": "顧客,VIP",
  "notes": "セミナーで名刺交換"
}
```

**Response** (201 Created):
```json
{
  "id": "contact_123",
  "user_id": "user_456",
  "name": "田中太郎",
  "email": "tanaka@example.com",
  "phone": "090-1234-5678",
  "company": "株式会社ABC",
  "position": "営業部長",
  "tags": "顧客,VIP",
  "notes": "セミナーで名刺交換",
  "created_at": "2025-01-10T00:00:00Z"
}
```

---

### Lists API

#### POST /api/lists
**目的**: 新規List作成

**Request**:
```http
POST /api/lists HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "セミナー参加者",
  "description": "2025年1月セミナー参加者リスト"
}
```

**Response** (201 Created):
```json
{
  "id": "list_123",
  "user_id": "user_456",
  "name": "セミナー参加者",
  "description": "2025年1月セミナー参加者リスト",
  "created_at": "2025-01-10T00:00:00Z"
}
```

---

#### POST /api/lists/:id/members
**目的**: List にメンバー追加

**Request**:
```http
POST /api/lists/list_123/members HTTP/1.1
Host: app.tomoniwao.jp
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "contact_ids": ["contact_111", "contact_222", "contact_333"]
}
```

**Response** (201 Created):
```json
{
  "list_id": "list_123",
  "added_count": 3,
  "members": [
    {
      "id": "member_001",
      "list_id": "list_123",
      "contact_id": "contact_111",
      "added_at": "2025-01-10T00:00:00Z"
    },
    {
      "id": "member_002",
      "list_id": "list_123",
      "contact_id": "contact_222",
      "added_at": "2025-01-10T00:00:00Z"
    },
    {
      "id": "member_003",
      "list_id": "list_123",
      "contact_id": "contact_333",
      "added_at": "2025-01-10T00:00:00Z"
    }
  ]
}
```

---

### 外部招待 API

#### GET /i/:token
**目的**: 招待ページ表示（HTML）

**Request**:
```http
GET /i/abc123xyz HTTP/1.1
Host: app.tomoniwao.jp
```

**Response** (200 OK):
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <title>日程調整 - 打ち合わせ</title>
  ...
</head>
<body>
  <h1>打ち合わせ日程調整</h1>
  <p>候補日時から選択してください</p>
  ...
</body>
</html>
```

---

#### POST /i/:token/select
**目的**: 候補日時選択

**Request**:
```http
POST /i/abc123xyz/select HTTP/1.1
Host: app.tomoniwao.jp
Content-Type: application/json

{
  "slot_id": "slot_111"
}
```

**Response** (200 OK):
```json
{
  "message": "日程選択が完了しました",
  "thread_id": "thread_123",
  "invite_id": "invite_456",
  "slot_id": "slot_111",
  "selected_at": "2025-01-12T10:00:00Z"
}
```

---

## 🚨 エラーレスポンス

### 統一エラー形式

```json
{
  "error": "Error message",
  "details": "Optional details"
}
```

### ステータスコード

| Code | 説明 |
|------|------|
| 200 | OK - 成功 |
| 201 | Created - リソース作成成功 |
| 400 | Bad Request - リクエスト不正 |
| 401 | Unauthorized - 認証エラー |
| 403 | Forbidden - 権限エラー |
| 404 | Not Found - リソース未存在 |
| 500 | Internal Server Error - サーバーエラー |

---

## 📊 Rate Limiting

### 制限
- **IP単位**: 100 req/min
- **User単位**: 1000 req/hour

### レスポンスヘッダー
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1672531200
```

### 超過時
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{
  "error": "Rate limit exceeded. Please try again later."
}
```

---

**次のドキュメント**: [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md)
