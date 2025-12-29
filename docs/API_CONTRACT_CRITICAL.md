# API_CONTRACT_CRITICAL.md
## ToMoniWao – API コントラクト（固定キー表）

最終更新日: 2025-12-29  
ステータス: 確定（破壊禁止）

---

## 1. このドキュメントの目的

本ドキュメントは以下を定義する：

- **API レスポンスの固定キー**
- **DB スキーマの固定カラム名**
- **変更・削除・リネーム禁止のフィールド**

👉 **これらを変更すると既存の実装が全て壊れる**

---

## 2. 破壊禁止ルール

### A. APIレスポンスキーの変更・削除・リネーム禁止

- Frontend が依存しているキーは削除・リネーム不可
- 追加は OK、変更・削除は NG

### B. DBカラム名の変更・削除禁止

- マイグレーション追加は OK
- 既存カラムの変更・削除は NG

### C. 列挙型（Enum）の互換性維持

- 既存の値を削除・リネーム禁止
- 追加は OK

---

## 3. scheduling_slots テーブル

### カラム名（固定）

| カラム名 | 型 | 備考 |
|---------|---|------|
| slot_id | TEXT (UUID) | 主キー |
| thread_id | TEXT (UUID) | FK |
| start_at | TEXT (ISO 8601) | **start_time ではない** |
| end_at | TEXT (ISO 8601) | **end_time ではない** |
| timezone | TEXT (IANA) | デフォルト: 'Asia/Tokyo' |
| label | TEXT (nullable) | 任意ラベル |

### API レスポンス（固定）

```json
{
  "slots": [
    {
      "slot_id": "uuid",
      "start_at": "2025-12-30T14:00:00.000Z",
      "end_at": "2025-12-30T15:00:00.000Z",
      "timezone": "Asia/Tokyo",
      "label": null
    }
  ]
}
```

### 禁止事項
- ❌ `start_at` → `start_time` にリネーム
- ❌ `end_at` → `end_time` にリネーム
- ❌ `slot_id` を削除
- ✅ `label` の追加は OK

---

## 4. thread_invites テーブル

### カラム名（固定）

| カラム名 | 型 | 備考 |
|---------|---|------|
| id | TEXT (UUID) | 主キー |
| thread_id | TEXT (UUID) | FK |
| token | TEXT | 招待トークン |
| email | TEXT | 招待先メール |
| candidate_name | TEXT | 招待者名 |
| invitee_key | TEXT | **重要**: 外部=email、内部=u:userId |
| status | TEXT | 'pending' / 'accepted' / 'declined' |
| expires_at | TEXT (ISO 8601) | 有効期限 |
| accepted_at | TEXT (ISO 8601, nullable) | 承認日時 |
| created_at | TEXT (ISO 8601) | 作成日時 |

### API レスポンス（固定）

#### GET /api/threads/:id/status

```json
{
  "invites": [
    {
      "invite_id": "uuid",
      "email": "user@example.com",
      "candidate_name": "田中太郎",
      "invitee_key": "user@example.com",
      "status": "accepted",
      "token": "abc123",
      "invite_url": "https://app.tomoniwao.jp/i/abc123",
      "expires_at": "2025-12-30T23:59:59.000Z",
      "responded_at": "2025-12-28T10:00:00.000Z"
    }
  ]
}
```

### invite_url の構築ルール（最重要）

```typescript
// ✅ 正しい（host を動的に取得）
const host = c.req.header('host') || 'app.tomoniwao.jp';
invite_url: `https://${host}/i/${token}`

// ❌ 間違い（workers.dev を固定）
invite_url: `https://webapp.snsrilarc.workers.dev/i/${token}`
```

### invitee_key のフォーマット（固定）

| ユーザー種別 | invitee_key フォーマット | 例 |
|-------------|------------------------|---|
| 外部（未登録） | email そのまま | "user@example.com" |
| 内部（登録済み） | "u:" + userId | "u:123e4567-e89b-12d3-a456-426614174000" |

### 禁止事項
- ❌ `invite_url` に workers.dev を固定
- ❌ `invitee_key` のフォーマットを変更
- ❌ `status` の列挙型を変更（'pending' / 'accepted' / 'declined'）
- ✅ `status` に新しい値を追加するのは OK（例: 'expired'）

---

## 5. thread_selections テーブル

### カラム名（固定）

| カラム名 | 型 | 備考 |
|---------|---|------|
| selection_id | TEXT | 主キー |
| thread_id | TEXT (UUID) | FK |
| invite_id | TEXT (UUID, nullable) | FK（外部のみ） |
| invitee_key | TEXT | **重要**: invite_id が null の場合は必須 |
| selected_slot_id | TEXT (UUID) | FK |
| status | TEXT | **'selected' / 'declined'** |
| responded_at | TEXT (ISO 8601) | 回答日時 |
| created_at | TEXT (ISO 8601) | 作成日時 |

### API レスポンス（固定）

#### GET /api/threads/:id/status

```json
{
  "selections": [
    {
      "selection_id": "sel-123",
      "invitee_key": "user@example.com",
      "status": "selected",
      "selected_slot_id": "uuid",
      "responded_at": "2025-12-28T10:00:00.000Z"
    }
  ]
}
```

### status の値（最重要）

| 値 | 意味 | 備考 |
|---|-----|------|
| 'selected' | 日程を選択 | **'accepted' ではない** |
| 'declined' | 辞退 | |

**注意**: `thread_invites.status` は 'accepted' / 'declined'、`thread_selections.status` は 'selected' / 'declined' と異なる。

### 禁止事項
- ❌ `status` を 'accepted' に統一
- ❌ `invitee_key` を削除
- ❌ `selected_slot_id` を `slot_id` にリネーム
- ✅ `status` に新しい値を追加するのは OK

---

## 6. thread_finalize テーブル

### カラム名（固定）

| カラム名 | 型 | 備考 |
|---------|---|------|
| thread_id | TEXT (UUID) | 主キー |
| final_slot_id | TEXT (UUID) | FK |
| finalize_policy | TEXT | 'MANUAL' / 'EARLIEST_VALID' / 'MAX_ATTENDANCE' |
| finalized_by_user_id | TEXT (UUID) | 確定者 |
| finalized_at | TEXT (ISO 8601) | 確定日時 |
| final_participants_json | TEXT (JSON) | 参加者リスト |
| meeting_provider | TEXT (nullable) | 'google_meet' / etc. |
| meeting_url | TEXT (nullable) | Google Meet URL |
| calendar_event_id | TEXT (nullable) | Google Calendar Event ID |

### API レスポンス（固定）

#### GET /api/threads/:id/status（finalize 後）

```json
{
  "evaluation": {
    "finalized": true,
    "final_slot_id": "uuid",
    "finalized_at": "2025-12-29T12:00:00.000Z",
    "finalized_by": "userId",
    "meeting": {
      "provider": "google_meet",
      "url": "https://meet.google.com/abc-defg-hij",
      "calendar_event_id": "eventId123"
    }
  }
}
```

#### POST /api/threads/:id/finalize のレスポンス

```json
{
  "finalized": true,
  "thread_id": "uuid",
  "selected_slot_id": "uuid",
  "meeting": {
    "provider": "google_meet",
    "url": "https://meet.google.com/abc-defg-hij",
    "calendar_event_id": "eventId123"
  },
  "final_participants": ["u:userId1", "user@example.com"],
  "participants_count": 2,
  "finalized_at": "2025-12-29T12:00:00.000Z"
}
```

### meeting オブジェクトの構造（固定）

```typescript
{
  provider: 'google_meet',  // 列挙型
  url: string,              // Google Meet URL
  calendar_event_id: string // Google Calendar Event ID
}
```

### 禁止事項
- ❌ `meeting.url` を `meet_url` にリネーム
- ❌ `meeting` オブジェクトの構造を変更
- ❌ `finalized_by` を `finalized_by_user_id` に統一（レスポンスは `finalized_by`、DB は `finalized_by_user_id`）
- ✅ `meeting.provider` に新しい値を追加するのは OK（例: 'zoom'）

---

## 7. GET /api/threads/:id/status の全体レスポンス

### 構造（固定）

```json
{
  "thread": {
    "id": "uuid",
    "organizer_user_id": "uuid",
    "title": "string",
    "description": "string",
    "status": "draft" | "active" | "confirmed" | "cancelled",
    "mode": "one_on_one" | "group",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  },
  "rule": {
    "version": 1,
    "type": "ANY" | "ALL" | "REQUIRED_PLUS_QUORUM",
    "finalize_policy": "EARLIEST_VALID" | "MANUAL" | "MAX_ATTENDANCE",
    "details": { /* AttendanceRule */ }
  },
  "slots": [ /* Slot[] */ ],
  "invites": [ /* Invite[] */ ],
  "selections": [ /* Selection[] */ ],
  "evaluation": {
    "finalized": false,
    "valid_slots": [ /* ValidSlot[] */ ],
    "can_finalize": boolean
  },
  "pending": {
    "count": number,
    "invites": [ /* PendingInvite[] */ ],
    "required_missing": [ /* invitee_key[] */ ]
  }
}
```

### 禁止事項
- ❌ トップレベルキーを削除・リネーム（thread / rule / slots / invites / selections / evaluation / pending）
- ❌ `evaluation` を `result` にリネーム
- ❌ `pending` を `waiting` にリネーム
- ✅ 新しいトップレベルキーを追加するのは OK

---

## 8. timezone の扱い

### デフォルト値（固定）

```typescript
timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
```

### IANA 形式（固定）

- ✅ 'Asia/Tokyo'
- ✅ 'America/New_York'
- ❌ 'JST'（略称は使用禁止）
- ❌ 'UTC+9'（オフセット表記は使用禁止）

### 禁止事項
- ❌ timezone を 'JST' 固定
- ❌ timezone を offset（+09:00）に変更
- ✅ ユーザー指定 timezone の追加は OK

---

## 9. ISO 8601 形式（固定）

### 日時の形式

```
2025-12-30T14:00:00.000Z  ✅ 正しい
2025-12-30T14:00:00Z      ✅ OK（ミリ秒なし）
2025-12-30 14:00:00       ❌ 間違い（T区切りなし）
2025/12/30 14:00:00       ❌ 間違い（スラッシュ区切り）
```

### 禁止事項
- ❌ ISO 8601 以外のフォーマットを使用
- ❌ タイムゾーン情報を削除
- ✅ ミリ秒の有無は許容

---

## 10. まとめ

### 固定されているもの
1. **テーブル名**: scheduling_threads / scheduling_slots / thread_invites / thread_selections / thread_finalize
2. **カラム名**: start_at / end_at / slot_id / invitee_key / status / meeting_url
3. **API レスポンスキー**: thread / rule / slots / invites / selections / evaluation / pending / meeting
4. **列挙型の値**: status / finalize_policy / meeting_provider
5. **invitee_key フォーマット**: email / "u:userId"
6. **invite_url の構築**: `https://${host}/i/${token}`
7. **timezone 形式**: IANA 形式
8. **日時形式**: ISO 8601

### 追加可能なもの
- 新しいカラム（既存カラムを壊さない限り）
- 新しいトップレベルキー（既存キーを壊さない限り）
- 新しい列挙型の値（既存値を壊さない限り）

### 絶対禁止
- 既存カラムの変更・削除・リネーム
- 既存 API レスポンスキーの変更・削除・リネーム
- 既存列挙型の値の変更・削除
- invite_url に workers.dev を固定
- timezone を略称に変更

---

👉 **このコントラクトを変更する場合は必ず設計レビューを行う**

---
