# SYNC_RUNBOOK.md
Calendar Sync Runbook (Phase Next-7 Day0)

## 1. 目的
日程が「確定」したスレッドについて、ユーザーの明示操作により
外部カレンダー（Google Calendar 等）へイベントを同期する。

※ 本Runbookは「設計のみ」。
OAuth審査完了までは **実装・自動同期は禁止**。

---

## 2. 非目的（やらないこと）
- ❌ 自動同期（ユーザー操作なし）
- ❌ 未確定スレッドの同期
- ❌ 差分更新（時間変更・再同期）
- ❌ カレンダー削除・編集
- ❌ バックグラウンド実行

---

## 3. 同期トリガー条件（厳守）
以下 **すべて** を満たす場合のみ同期可能：

1. `thread.status === "confirmed"`
2. `evaluation.final_slot_id` が存在
3. ユーザーが「同期する」を明示的に実行
4. OAuth 審査が完了している

---

## 4. 同期フロー（To-Be）

### 正常系
1. ユーザーが「カレンダーに同期」を押す
2. API `/api/threads/:id/calendar/sync` を呼び出す
3. 外部カレンダーにイベント作成
4. 結果を UI に表示
   - 作成済み（`status: "created"`）
   - すでに同期済み（`status: "already_synced"`、冪等）

### 失敗系（A案フォールバック）
- API失敗 / OAuth失敗 / 制限超過 の場合：
  - エラーで止めない
  - **手動登録用の情報セットを返す**
  - ユーザーが自分で登録可能

---

## 5. 冪等性設計（最重要）

### Idempotency Key

```
calendar_sync_key = thread_id + ":" + final_slot_id
```

### ルール
- 同じ key での同期は **必ず同一結果** を返す
- すでに同期済みの場合：
  - 新規作成しない
  - `status = "already_synced"` を返す
  - 既存の `calendar_event_id` と `meet_url` を返す

### 実装方針
- D1 テーブル: `calendar_syncs`
  - `thread_id` (PK)
  - `final_slot_id` (PK)
  - `calendar_event_id`
  - `meet_url`
  - `synced_at`
  - `status` (created / already_synced / failed)

---

## 6. 失敗時フォールバック（A案）

同期に失敗した場合でも、
以下の情報を **必ず返却** する：

- タイトル（スレッドタイトル）
- 開始/終了日時（`start_at` / `end_at`）
- タイムゾーン（`timezone`）
- Meet URL（あれば）
- 説明文（コピー用）

→ ユーザーは手動でカレンダー登録可能  
→ **事故ゼロ**

---

## 7. ログ・監査（最低限）
記録する情報：
- `thread_id`
- `final_slot_id`
- 実行ユーザー（`organizer_user_id`）
- 実行日時（`synced_at`）
- 結果（`created` / `already_synced` / `failed`）
- 失敗理由（`failure_reason`）

---

## 8. 実装解禁条件
- ✅ OAuth 審査完了
- ✅ `NEXT7_REVIEW_CHECKLIST.md` 全項目チェック済み
- ✅ 既存ユーザーの再同意完了（必要な場合）

---

## 9. 用語
- **同期**: 外部カレンダーにイベントを作成すること
- **確定**: `thread.status === "confirmed"` かつ `final_slot_id` が存在する状態
- **冪等**: 同じ操作を何度実行しても同じ結果が得られること
- **A案フォールバック**: API失敗時に手動登録用の情報セットを返すこと

---

## 10. 状態遷移

```
未同期 (initial)
  ↓ ユーザーが「同期する」を押す
  ↓ POST /api/threads/:id/calendar/sync
  ├→ 成功: 同期済み (synced)
  └→ 失敗: フォールバック (failed)
       ↓ 手動登録セットを返す
       └→ ユーザーが手動で登録
```

---

## 11. セキュリティ考慮
- OAuth トークンは暗号化保存
- 最小スコープのみ要求（`calendar.events.readonly` + `calendar.events.owned`）
- ユーザーごとにトークンを管理
- リフレッシュトークンの有効期限管理

---

## 12. 次のステップ
- Phase Next-7 Day1: 実装（審査完了後）
- API I/F: `docs/SYNC_API_SPEC.md`
- チェックリスト: `docs/NEXT7_REVIEW_CHECKLIST.md`
