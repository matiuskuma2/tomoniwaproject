# Lists Specification（確定版：一括送信用）

本ドキュメントは「Lists（送信先セグメント）」を確定定義する。
Lists は **顧客台帳の主役ではなく**、Contacts を束ねて「予定調整リンクを一括送信する」ための仕組み。

---

## 0. 位置づけ（確定）
- Contacts = 台帳（正）
- Lists = 送信先セグメント（束ね）
- list_members は contacts 参照で統一（同一人物の二重登録を避ける）

---

## 1. テーブル（確定案）

### 1.1 lists
- `id` TEXT (UUID) PK
- `workspace_id` TEXT NOT NULL
- `owner_user_id` TEXT NOT NULL
- `name` TEXT NOT NULL
- `description` TEXT NULL
- `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
- `updated_at` TEXT NOT NULL DEFAULT (datetime('now'))

Index：
- `idx_lists_workspace_owner` (workspace_id, owner_user_id)

### 1.2 list_members
- `id` TEXT (UUID) PK
- `workspace_id` TEXT NOT NULL
- `list_id` TEXT NOT NULL FK → lists(id) ON DELETE CASCADE
- `contact_id` TEXT NOT NULL FK → contacts(id) ON DELETE CASCADE
- `created_at` TEXT NOT NULL DEFAULT (datetime('now'))

Uniq（確定）：
- UNIQUE(list_id, contact_id)

Index：
- `idx_list_members_list` (list_id, created_at)
- `idx_list_members_contact` (contact_id)

---

## 2. 一括送信＝一括Invite作成（確定）
### 2.1 thread作成時のオプション（確定）
- `POST /api/threads` に `target_list_id` を渡す（将来拡張）
- サーバーは list_members を参照し、該当 contacts へ `thread_invites` を生成
- invites 生成後、Queueでメール送信（Resend）

> "メルマガ"というより「予定調整リンクを一括で配る」機能として確定。

---

## 3. 進捗確認（確定）
- 「イベント申込者の参加状況」＝スレッドの status APIで返す
  - 母集団：list_members count
  - 返信数：thread_selections count
  - 未返信数：invites - selections
  - 確定：thread_finalize の有無

---

## 4. 将来拡張（今はやらない）
- list_members に属性（import_source, custom_fields_json）
- 送信履歴（list_send_logs）  
- スパム対策（送信間隔/バウンス管理）
