# Scheduling API Reference (確定版)

本ドキュメントは「日程調整（Thread）」と「外部招待（/i/:token）」、および「参加条件（Attendance Rule）」を運用するためのAPIを確定定義する。

## 0. 認証

- **保護API**: Bearer 必須（`Authorization: Bearer <access_token>`）
  - tokenは `POST /auth/token` で session cookie から取得可能
- **公開API**: ログイン不要
  - `/i/:token` 系（外部招待）

---

## 1. Thread作成（主催者）

### 1.1 POST /api/threads

新規スレッド作成 + 候補生成 + 招待生成

- **Auth**: required
- **Rate limit**: 10/min/user（推奨）

#### Request

```json
{
  "title": "テーマ",
  "description": "補足（任意）",
  "mode": "one_on_one | group | public (任意)",
  "attendance_rule": { "...": "ATTENDANCE_RULE_SCHEMA.md準拠（任意）" },
  "candidates": [
    { "start_at": "2026-01-01T10:00:00Z", "end_at": "2026-01-01T11:00:00Z" }
  ],
  "invitees": [
    { "invitee_key": "u:xxx" },
    { "email": "a@example.com" }
  ]
}
```

#### Response

```json
{
  "thread": { "id":"...", "title":"...", "status":"draft" },
  "slots": [{ "id":"slot1", "start_at":"...", "end_at":"..." }],
  "invites": [
    { "id":"inv1", "invitee_key":"e:...", "token":"...", "invite_url":"https://app.../i/..." }
  ]
}
```

**MVPでは `attendance_rule` を省略可（サーバ側でデフォルトルールを作成）**

---

## 2. Thread一覧/詳細（主催者）

### 2.1 GET /api/threads

- **Auth**: required
- **Query**:
  - `status` (optional)
  - `limit` (default 50)
  - `offset` (default 0)

#### Response

```json
{
  "threads": [
    { "id":"...", "title":"...", "status":"draft", "invite_count":3, "accepted_count":1 }
  ],
  "pagination": { "total": 10, "limit": 50, "offset": 0, "has_more": false }
}
```

### 2.2 GET /api/threads/:id

- **Auth**: required（organizer only）

#### Response

```json
{
  "thread": { "id":"...", "title":"...", "status":"draft" },
  "slots": [{ "id":"...", "start_at":"...", "end_at":"..." }],
  "invites": [{ "id":"...", "invitee_key":"...", "status":"pending" }],
  "attendance_rule": { "version":"1.0", "type":"K_OF_N", ... },
  "finalize": null
}
```

---

## 3. 進捗確認（AI秘書の「今どうなってる？」）

### 3.1 GET /api/threads/:id/status

- **Auth**: required（organizer only）

#### Response

```json
{
  "thread_id":"...",
  "summary":{
    "invite_total": 10,
    "responded": 6,
    "pending": 4
  },
  "eval":{
    "can_finalize": false,
    "recommended_slot_id": null,
    "followups": {
      "pending_invitee_keys": ["e:..","u:.."],
      "required_missing_invitee_keys": ["u:c","u:e"],
      "suggested_remind_invitee_keys": ["u:c","u:e","u:a"]
    }
  }
}
```

---

## 4. 外部招待ページ（未登録者でも使える）

### 4.1 GET /i/:token  （Public）

説明ページ + 候補枠選択UI（HTML）

### 4.2 POST /i/:token/respond （Public）

外部参加者の回答（slot選択 or 辞退）

#### Request

```json
{
  "action": "select | decline",
  "selected_slot_id": "slot_xxx",
  "display_name": "任意（外部向け）"
}
```

#### Response

```json
{
  "ok": true,
  "status": "selected",
  "thread_id": "...",
  "invite_id": "...",
  "eval": { "can_finalize": true, "recommended_slot_id": "slot_xxx" }
}
```

**`action=decline` の場合 `selected_slot_id` は不要**

---

## 5. 催促（AI秘書の「返事来てない人に催促して」）

### 5.1 POST /api/threads/:id/remind

- **Auth**: required（organizer only）

#### Request

```json
{
  "target": "pending_only | required_missing | custom",
  "invitee_keys": ["u:...", "e:..."],
  "message": "任意の追い文"
}
```

#### Response

```json
{
  "ok": true,
  "queued": 4
}
```

**送信はQueue（EMAIL_QUEUE）経由。Resendのドメイン認証が未完了ならキューに溜まるだけでもOK。**

---

## 6. ルール更新（主催者）

### 6.1 PUT /api/threads/:id/rule

- **Auth**: required（organizer only）
- **ルールは確定前のみ変更可能**（`thread_finalize` が無いこと）

#### Request

```json
{
  "attendance_rule": { "...": "ATTENDANCE_RULE_SCHEMA.md準拠" }
}
```

#### Response

```json
{ "ok": true }
```

---

## 7. 確定（自動/手動）

### 7.1 POST /api/threads/:id/finalize

- **Auth**: required（organizer only）

#### Request

```json
{
  "mode": "auto | manual",
  "slot_id": "slot_xxx (manualの場合必須)"
}
```

#### Response

```json
{
  "ok": true,
  "final": {
    "thread_id":"...",
    "final_slot_id":"...",
    "finalized_at":"..."
  }
}
```

---

## 8. AI秘書（チャット）からのコマンド対応方針

- **「今どうなってる？」** → `/api/threads/:id/status`
- **「催促して」** → `/api/threads/:id/remind`
- **「この条件で成立したら確定して」** → `rule.finalize_policy.auto_finalize=true` + status APIで条件満たせば finalize
