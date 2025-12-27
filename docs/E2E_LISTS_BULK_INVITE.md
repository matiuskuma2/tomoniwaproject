# ローカルE2E: Lists API + Bulk Invite

## 前提
- x-user-id: `test-user-phase-b`
- test-user が D1 に存在している
- Local DB: `webapp-production` (--local)
- Base URL: `http://localhost:3000`
- Health check: `http://localhost:3000/` (404 = 正常)

---

## Step 0: Contacts 2件追加

### Contact 1: 田中太郎 (tanaka@example.com)
```bash
curl -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "kind": "external_person",
    "email": "tanaka@example.com",
    "display_name": "田中太郎",
    "relationship_type": "coworker",
    "tags": ["VIP", "技術部"],
    "notes": "プロジェクトマネージャー。優先度高。"
  }' | jq .
```

**Expected**: `{ "id": "CONTACT_ID_1", "invitee_key": "e:75ceba6fc4617918", ... }`

---

### Contact 2: 鈴木花子 (suzuki@example.com)
```bash
curl -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "kind": "external_person",
    "email": "suzuki@example.com",
    "display_name": "鈴木花子",
    "relationship_type": "coworker",
    "tags": ["デザイナー"],
    "notes": "UIデザイン担当"
  }' | jq .
```

**Expected**: `{ "id": "CONTACT_ID_2", "invitee_key": "e:abc123def456", ... }`

---

## Step 1: List 作成

```bash
curl -X POST http://localhost:3000/api/lists \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "name": "プロジェクトXチーム",
    "description": "新規プロジェクトXの主要メンバー"
  }' | jq .
```

**Expected**:
```json
{
  "id": "LIST_ID",
  "workspace_id": "ws-default",
  "owner_user_id": "test-user-phase-b",
  "name": "プロジェクトXチーム",
  "description": "新規プロジェクトXの主要メンバー",
  "created_at": "...",
  "updated_at": "..."
}
```

**⚠️ LIST_ID をコピーしておく！**

---

## Step 2: List にメンバー追加（2件）

### Member 1: 田中太郎
```bash
curl -X POST http://localhost:3000/api/lists/LIST_ID/members \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "contact_id": "CONTACT_ID_1"
  }' | jq .
```

**Expected**: `{ "id": "MEMBER_ID_1", "list_id": "LIST_ID", "contact_id": "CONTACT_ID_1", ... }`

---

### Member 2: 鈴木花子
```bash
curl -X POST http://localhost:3000/api/lists/LIST_ID/members \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "contact_id": "CONTACT_ID_2"
  }' | jq .
```

**Expected**: `{ "id": "MEMBER_ID_2", "list_id": "LIST_ID", "contact_id": "CONTACT_ID_2", ... }`

---

## Step 3: List Members 確認（最重要ポイント 1: JOIN 済み確認）

```bash
curl -s http://localhost:3000/api/lists/LIST_ID/members \
  -H "x-user-id: test-user-phase-b" | jq .
```

**Expected**:
```json
{
  "members": [
    {
      "id": "MEMBER_ID_1",
      "workspace_id": "ws-default",
      "list_id": "LIST_ID",
      "contact_id": "CONTACT_ID_1",
      "contact_kind": "external_person",
      "contact_user_id": null,
      "contact_email": "tanaka@example.com",
      "contact_display_name": "田中太郎",
      "contact_relationship_type": "coworker",
      "contact_tags_json": "[\"VIP\",\"技術部\"]",
      "contact_tags": ["VIP", "技術部"],
      "contact_notes": "プロジェクトマネージャー。優先度高。",
      "contact_summary": null,
      "contact_invitee_key": "e:75ceba6fc4617918",
      "created_at": "..."
    },
    {
      "id": "MEMBER_ID_2",
      "contact_email": "suzuki@example.com",
      "contact_display_name": "鈴木花子",
      "contact_invitee_key": "e:abc123def456",
      ...
    }
  ],
  "total": 2,
  "limit": 100,
  "offset": 0
}
```

**✅ チェックポイント**:
- `contact_email` が返っている
- `contact_display_name` が返っている
- `contact_invitee_key` が返っている

これらが全て返っていれば、**最重要ポイント 1** をクリア！

---

## Step 4: bulk invite（POST /api/threads with target_list_id）

```bash
curl -X POST http://localhost:3000/api/threads \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "title": "プロジェクトXキックオフMTG",
    "description": "新規プロジェクトXのキックオフミーティング日程調整",
    "target_list_id": "LIST_ID"
  }' | jq .
```

**Expected**:
```json
{
  "thread": {
    "id": "THREAD_ID",
    "title": "プロジェクトXキックオフMTG",
    "description": "新規プロジェクトXのキックオフミーティング日程調整",
    "organizer_user_id": "test-user-phase-b",
    "status": "draft",
    "created_at": "..."
  },
  "candidates": [
    {
      "name": "田中太郎",
      "email": "tanaka@example.com",
      "reason": "From list: プロジェクトXチーム",
      "invite_token": "TOKEN_1",
      "invite_url": "https://webapp.snsrilarc.workers.dev/i/TOKEN_1"
    },
    {
      "name": "鈴木花子",
      "email": "suzuki@example.com",
      "reason": "From list: プロジェクトXチーム",
      "invite_token": "TOKEN_2",
      "invite_url": "https://webapp.snsrilarc.workers.dev/i/TOKEN_2"
    }
  ],
  "message": "Thread created with 2 candidate invitations sent",
  "skipped_count": 0
}
```

**✅ チェックポイント**:
- `candidates.length` == 2（メンバー数と一致）
- `skipped_count` == 0（email が無い contact は無し）
- `invite_token` が生成されている

**⚠️ THREAD_ID をコピーしておく！**

---

## Step 5: status で pending / invites を確認

```bash
curl -s http://localhost:3000/api/threads/THREAD_ID/status \
  -H "x-user-id: test-user-phase-b" | jq .
```

**Expected**:
```json
{
  "thread_id": "THREAD_ID",
  "title": "プロジェクトXキックオフMTG",
  "status": "draft",
  "pending_count": 2,
  "accepted_count": 0,
  "declined_count": 0,
  "total_invites": 2,
  "pending_invites": [
    {
      "email": "tanaka@example.com",
      "name": "田中太郎",
      "status": "pending",
      "created_at": "..."
    },
    {
      "email": "suzuki@example.com",
      "name": "鈴木花子",
      "status": "pending",
      "created_at": "..."
    }
  ],
  "accepted_invites": [],
  "declined_invites": []
}
```

**✅ チェックポイント**:
- `pending_count` == 2
- `pending_invites.length` == 2
- `email` が正しく設定されている

---

## 🚨 最重要ポイント 2: 1000件制限テスト（オプション）

### 1001件のリストを作成してエラーを確認

```bash
# 1001件の contacts を作成（省略）
# List に 1001件追加（省略）

curl -X POST http://localhost:3000/api/threads \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "title": "大規模イベント",
    "target_list_id": "LARGE_LIST_ID"
  }' | jq .
```

**Expected**:
```json
{
  "error": "List size exceeds 1000 contacts. Please split into smaller lists.",
  "total": 1001,
  "limit": 1000
}
```

---

## 🚨 最重要ポイント 3: email 無し contact の除外テスト

### email が無い contact を追加

```bash
curl -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "kind": "external_person",
    "display_name": "山田太郎（email未登録）",
    "relationship_type": "external",
    "notes": "emailアドレス未登録"
  }' | jq .
```

**Expected**: `{ "id": "CONTACT_ID_NO_EMAIL", ... }`

---

### List に追加

```bash
curl -X POST http://localhost:3000/api/lists/LIST_ID/members \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "contact_id": "CONTACT_ID_NO_EMAIL"
  }' | jq .
```

---

### bulk invite 実行

```bash
curl -X POST http://localhost:3000/api/threads \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-phase-b" \
  -d '{
    "title": "プロジェクトXキックオフMTG v2",
    "target_list_id": "LIST_ID"
  }' | jq .
```

**Expected**:
```json
{
  "candidates": [
    {
      "name": "田中太郎",
      "email": "tanaka@example.com",
      ...
    },
    {
      "name": "鈴木花子",
      "email": "suzuki@example.com",
      ...
    }
  ],
  "message": "Thread created with 2 candidate invitations sent",
  "skipped_count": 1
}
```

**✅ チェックポイント**:
- `candidates.length` == 2（email 有りのみ）
- `skipped_count` == 1（email 無し contact が除外された）

---

## ✅ ローカルE2E完了判定

以下を全てクリアすれば **Step 2 + Step 3 完了**：

1. ✅ Lists API 4本が正常動作
2. ✅ GET /api/lists/:id/members が JOIN 済みの形を返す
3. ✅ POST /api/threads { target_list_id } で一括invite が成功
4. ✅ 1000件制限エラーが正常動作
5. ✅ email 無し contact が除外され、skipped_count が返る
6. ✅ GET /api/threads/:id/status で pending_count が正しい

---

## 次のステップ

ローカルE2Eが完了したら：
1. Git commit & push
2. Production deploy (`npx wrangler deploy`)
3. 本番E2E（Bearer token で実行）
