# Phase B: API Integration for Attendance Rule Engine

## Overview

Phase B では、Attendance Rule Engine の基盤（Phase A で完成）を活用し、以下の API を実装します：

1. **POST /i/:token/respond** - 招待者の回答受付
2. **GET /api/threads/:id/status** - 進捗確認
3. **POST /api/threads/:id/remind** - 未回答者への催促
4. **POST /api/threads/:id/finalize** - 手動確定

これらの API は、外部招待フロー、チャット/ルーム内での日程調整、リスト募集など、すべてのシナリオで共通利用されます。

---

## 1. POST /i/:token/respond

### Purpose
招待者が候補日時（Slot）を選択 or 辞退する API。
- **外部招待（未登録者）**: `/i/:token` ページから直接回答
- **内部ユーザー**: チャット/ルーム/Inbox から `/i/:token` 経由で回答

### Endpoint
```
POST /i/:token/respond
```

### Authentication
- **不要**: トークンベース認証（`thread_invites.token` で検証）
- トークンが期限切れ（`expires_at` 超過）の場合は `410 Gone`

### Request Body
```json
{
  "status": "selected",
  "slot_ids": [1, 3],
  "message": "この日時なら参加できます"
}
```

または辞退の場合：
```json
{
  "status": "declined",
  "message": "都合が合わず参加できません"
}
```

### Validation Rules
- `status`: `"selected"` または `"declined"` のみ許可
- `slot_ids`: `status="selected"` の場合は必須（1つ以上）
- `slot_ids`: `status="declined"` の場合は空配列 or null
- `message`: オプション（最大500文字）

### Data Model Mapping

#### thread_invites 更新
```sql
UPDATE thread_invites
SET status = 'accepted',  -- status='selected' → 'accepted'
    accepted_at = CURRENT_TIMESTAMP
WHERE token = :token;
```

#### thread_selections 記録
各 `slot_id` に対して：
```sql
INSERT INTO thread_selections (
  thread_id, slot_id, invitee_key, status, created_at
)
VALUES (
  :thread_id, :slot_id, :invitee_key, 'selected', CURRENT_TIMESTAMP
);
```

辞退の場合（全Slotに対して `declined` を記録）：
```sql
INSERT INTO thread_selections (
  thread_id, slot_id, invitee_key, status, created_at
)
SELECT
  :thread_id, s.id, :invitee_key, 'declined', CURRENT_TIMESTAMP
FROM scheduling_slots s
WHERE s.thread_id = :thread_id;
```

### Process Flow

```
1. Token検証（expires_at, 既回答チェック）
2. thread_invites.status = 'accepted' へ更新
3. thread_selections に回答を記録
4. AttendanceEngine.evaluateRule() で成立判定
5. 自動確定条件を満たす場合:
   - thread_finalize に記録
   - inbox 通知（主催者へ）
   - 確定メール送信
6. Response 返却
```

### Response (Success)
```json
{
  "success": true,
  "thread_id": 123,
  "invitee_key": "e:a3f2b8c9d1e4f5a6",
  "status": "selected",
  "slot_ids": [1, 3],
  "evaluation": {
    "finalized": false,
    "reason": "waiting_for_more_responses",
    "pending_count": 2,
    "required_count": 3
  }
}
```

### Response (Auto-Finalized)
```json
{
  "success": true,
  "thread_id": 123,
  "invitee_key": "e:a3f2b8c9d1e4f5a6",
  "status": "selected",
  "slot_ids": [1, 3],
  "evaluation": {
    "finalized": true,
    "finalized_slot_id": 1,
    "finalized_at": "2025-12-26T10:00:00Z",
    "reason": "auto_finalized_earliest_valid",
    "participants": ["u:1", "u:2", "e:a3f2b8c9d1e4f5a6"]
  }
}
```

### Error Responses

#### 410 Gone - トークン期限切れ
```json
{
  "error": "token_expired",
  "message": "この招待リンクは期限切れです",
  "expires_at": "2025-12-20T10:00:00Z"
}
```

#### 409 Conflict - 既に回答済み
```json
{
  "error": "already_responded",
  "message": "既に回答済みです",
  "previous_status": "selected",
  "previous_slot_ids": [2, 3]
}
```

#### 400 Bad Request - 無効な Slot ID
```json
{
  "error": "invalid_slot_ids",
  "message": "指定されたSlot IDが無効です",
  "invalid_ids": [99]
}
```

---

## 2. GET /api/threads/:id/status

### Purpose
Thread の進捗状況を確認する API。
- 回答状況（pending/selected/declined）
- 成立可能性（evaluation）
- 推奨アクション（remind, finalize など）

### Endpoint
```
GET /api/threads/:id/status
```

### Authentication
- **必須**: Bearer トークン（`Authorization: Bearer <token>`）
- 主催者（`scheduling_threads.host_user_id`）またはスーパー管理者のみアクセス可

### Response
```json
{
  "thread_id": 123,
  "title": "プロジェクトキックオフ",
  "host_user_id": 1,
  "status": "active",
  "created_at": "2025-12-26T10:00:00Z",
  "attendance_rule": {
    "type": "K_OF_N",
    "rule": { "k": 3, "n": 5 }
  },
  "slots": [
    {
      "id": 1,
      "start_time": "2025-12-30T10:00:00Z",
      "end_time": "2025-12-30T11:00:00Z",
      "selected_count": 3,
      "declined_count": 0,
      "pending_count": 2
    },
    {
      "id": 2,
      "start_time": "2025-12-31T14:00:00Z",
      "end_time": "2025-12-31T15:00:00Z",
      "selected_count": 2,
      "declined_count": 1,
      "pending_count": 2
    }
  ],
  "invites": {
    "total": 5,
    "responded": 3,
    "pending": 2,
    "selected": 3,
    "declined": 0
  },
  "evaluation": {
    "can_finalize": true,
    "recommended_slot_id": 1,
    "reason": "slot_1_meets_k_of_n_requirement",
    "score": 0.8,
    "pending_invitee_keys": ["u:4", "u:5"]
  },
  "actions": {
    "can_remind": true,
    "can_finalize": true,
    "can_update_rule": true
  }
}
```

### Error Responses

#### 403 Forbidden - 権限なし
```json
{
  "error": "forbidden",
  "message": "このThreadへのアクセス権限がありません"
}
```

#### 404 Not Found
```json
{
  "error": "not_found",
  "message": "指定されたThreadが見つかりません"
}
```

---

## 3. POST /api/threads/:id/remind

### Purpose
未回答の招待者に催促メールを送信する API。

### Endpoint
```
POST /api/threads/:id/remind
```

### Authentication
- **必須**: Bearer トークン
- 主催者またはスーパー管理者のみ実行可

### Request Body (Optional)
```json
{
  "invitee_keys": ["u:4", "u:5"],
  "custom_message": "お忙しいところ恐れ入りますが、ご回答をお願いします"
}
```

- `invitee_keys`: 省略時は全未回答者に送信
- `custom_message`: カスタムメッセージ（最大500文字）

### Process Flow
```
1. Thread存在確認 + 権限確認
2. 未回答者リスト取得（thread_invites WHERE status='pending'）
3. 各招待者にリマインドメール送信
4. inbox 通知作成（催促された側へ）
5. Response 返却
```

### Response
```json
{
  "success": true,
  "thread_id": 123,
  "reminded_count": 2,
  "reminded_invitee_keys": ["u:4", "u:5"],
  "sent_at": "2025-12-26T12:00:00Z"
}
```

### Error Responses

#### 400 Bad Request - 全員回答済み
```json
{
  "error": "no_pending_invites",
  "message": "全員が既に回答済みです"
}
```

---

## 4. POST /api/threads/:id/finalize

### Purpose
主催者が手動で Thread を確定する API。
- 自動確定が無効（`auto_finalize: false`）の場合に使用
- 複数候補がある場合に主催者が選択

### Endpoint
```
POST /api/threads/:id/finalize
```

### Authentication
- **必須**: Bearer トークン
- 主催者またはスーパー管理者のみ実行可

### Request Body
```json
{
  "slot_id": 1,
  "reason": "manual_selection",
  "notify_all": true
}
```

- `slot_id`: 必須（確定するSlot ID）
- `reason`: 確定理由（オプション）
- `notify_all`: 全招待者に通知するか（デフォルト: true）

### Validation Rules
- 指定された `slot_id` が Attendance Rule を満たすか検証
- 既に確定済みの場合は `409 Conflict`

### Process Flow
```
1. Thread存在確認 + 権限確認
2. slot_id の妥当性確認（AttendanceEngine.evaluateRule）
3. thread_finalize に記録
4. scheduling_threads.status = 'finalized' へ更新
5. inbox 通知（全招待者へ）
6. 確定メール送信
7. カレンダー登録（Phase C）
8. ビデオ会議URL生成（Phase C）
```

### Response
```json
{
  "success": true,
  "thread_id": 123,
  "finalized_slot_id": 1,
  "finalized_at": "2025-12-26T12:30:00Z",
  "start_time": "2025-12-30T10:00:00Z",
  "end_time": "2025-12-30T11:00:00Z",
  "participants": ["u:1", "u:2", "u:3"],
  "notifications_sent": 5
}
```

### Error Responses

#### 400 Bad Request - 条件未達
```json
{
  "error": "rule_not_satisfied",
  "message": "指定されたSlotはAttendance Ruleを満たしていません",
  "slot_id": 2,
  "evaluation": {
    "required": 3,
    "actual": 2,
    "missing_invitee_keys": ["u:5"]
  }
}
```

#### 409 Conflict - 既に確定済み
```json
{
  "error": "already_finalized",
  "message": "このThreadは既に確定済みです",
  "finalized_slot_id": 1,
  "finalized_at": "2025-12-26T11:00:00Z"
}
```

---

## Idempotency & Error Handling

### Idempotency
- **POST /i/:token/respond**: 同じトークンで再度POSTした場合、409 Conflict を返す（既回答として扱う）
- **POST /api/threads/:id/finalize**: 同じ `slot_id` で再度POSTした場合、200 OK + 既存の finalize 情報を返す

### Error Handling Priority
1. **Authentication/Authorization** (401/403)
2. **Resource Not Found** (404)
3. **Validation Errors** (400)
4. **Conflict/State Errors** (409/410)
5. **Server Errors** (500)

---

## Compatibility with Legacy /i/:token/accept

Phase B 移行中、既存の `/i/:token/accept` は以下のように扱います：

### Option 1: Deprecate（推奨）
- `/i/:token/accept` を廃止し、`/i/:token/respond` に統一
- 既存のフロントエンドを更新

### Option 2: Compatibility Layer
- `/i/:token/accept` を内部で `/i/:token/respond` にリダイレクト
```typescript
app.post('/i/:token/accept', async (c) => {
  // Legacy endpoint - redirect to new API
  const token = c.req.param('token');
  return c.redirect(`/i/${token}/respond`, 308);
});
```

---

## Integration Flow

### 1. Thread作成時
```typescript
// POST /api/threads
const thread = await db.insert(scheduling_threads).values({
  host_user_id,
  title,
  description,
  status: 'active'
});

// Attendance Rule 保存
await db.insert(thread_attendance_rules).values({
  thread_id: thread.id,
  rule_json: attendanceRule
});

// Slots 作成
for (const slot of slots) {
  await db.insert(scheduling_slots).values({
    thread_id: thread.id,
    start_time: slot.start_time,
    end_time: slot.end_time
  });
}

// Invites 送信
for (const invitee of invitees) {
  const token = generateSecureToken();
  await db.insert(thread_invites).values({
    thread_id: thread.id,
    invitee_key: invitee.key,
    email: invitee.email,
    token,
    expires_at: addDays(new Date(), 7)
  });
  await sendInviteEmail(invitee.email, token);
}
```

### 2. 回答時
```typescript
// POST /i/:token/respond
const invite = await db.select().from(thread_invites).where(eq(token, token));

// Update invite
await db.update(thread_invites)
  .set({ status: 'accepted', accepted_at: new Date() })
  .where(eq(thread_invites.token, token));

// Record selections
for (const slotId of slot_ids) {
  await db.insert(thread_selections).values({
    thread_id: invite.thread_id,
    slot_id: slotId,
    invitee_key: invite.invitee_key,
    status: 'selected'
  });
}

// Evaluate rule
const evaluation = await AttendanceEngine.evaluateRule(thread_id);

if (evaluation.can_finalize && evaluation.auto_finalize) {
  await AttendanceEngine.finalizeThread(thread_id, evaluation.recommended_slot_id);
}
```

### 3. 確定時
```typescript
// POST /api/threads/:id/finalize
const finalized = await AttendanceEngine.finalizeThread(thread_id, slot_id);

await db.update(scheduling_threads)
  .set({ status: 'finalized' })
  .where(eq(scheduling_threads.id, thread_id));

// Notify all
await notifyAllParticipants(thread_id, finalized);
```

---

## Summary

Phase B では以下を実装します：

1. ✅ **POST /i/:token/respond** - 回答受付 + 自動評価
2. ✅ **GET /api/threads/:id/status** - 進捗確認
3. ✅ **POST /api/threads/:id/remind** - 催促
4. ✅ **POST /api/threads/:id/finalize** - 手動確定

**Next Steps**:
- Phase C: カレンダー統合、ビデオ会議URL生成
- Phase D: リスト募集（N対1）の実装
- Phase E: フロントエンド分離とCloudflare Pages化
