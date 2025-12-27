# Contacts Specification（確定版）

本ドキュメントは「ともにわ」における **Contacts（人の台帳）** を "正（Source of Truth）" として確定定義する。
本システムは予定調整ツールであり、Contacts は **予定調整/案内送信/関係性管理の起点** とする。

---

## 0. 位置づけ（確定）
- **Contacts = 人の台帳（外部/内部を含む）**
- **Lists = Contacts を束ねる送信先セグメント（＝一括で予定調整リンクを配布するための束ね）**
- "顧客台帳"は Contacts に集約する（Listsは「配る」ためのグルーピングであり、台帳の主役ではない）

---

## 1. Contactsの種類（確定）

### 1.1 contact_kind（確定）
- `internal_user`：サービス登録ユーザー（Google OAuthで users に存在）
- `external_person`：未登録外部（メール/名前のみで管理）
- `list_member`：リスト由来（後述の Lists に属する顧客台帳。内部的には external_person と同等だが出自を持つ）

> 実装上は **contacts テーブルは1つ**に統合する（kindで区別）。

### 1.2 relationship_type（確定）
- `family`
- `coworker`
- `external`

> "できること"の分岐は、将来 `permission_level` を導入して拡張する（今は relationship_type のみでOK）。

---

## 2. Contactsテーブル（確定：最小）

### 2.1 テーブル（確定案）
`contacts`
- `id` TEXT (UUID) PK
- `workspace_id` TEXT NOT NULL   ※テナント境界（必須）
- `owner_user_id` TEXT NOT NULL  ※この台帳を管理する主体（個人/管理者）
- `kind` TEXT NOT NULL CHECK (kind IN ('internal_user','external_person','list_member'))
- `user_id` TEXT NULL            ※ internal_user の場合のみ users.id 参照
- `email` TEXT NULL              ※ external の場合に必須（正規化 lower）
- `display_name` TEXT NULL
- `relationship_type` TEXT NOT NULL DEFAULT 'external' CHECK (relationship_type IN ('family','coworker','external'))
- `tags_json` TEXT NOT NULL DEFAULT '[]'   ※ JSON配列（例：["VIP","整形外科","顧客500"]）
- `notes` TEXT NULL                         ※ 手入力メモ（短文）
- `summary` TEXT NULL                       ※ 200〜400文字の要約（将来/任意）
- `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
- `updated_at` TEXT NOT NULL DEFAULT (datetime('now'))

#### Index（確定）
- `idx_contacts_workspace_owner` (workspace_id, owner_user_id)
- `idx_contacts_email` (workspace_id, lower(email))
- `idx_contacts_user_id` (workspace_id, user_id)
- `idx_contacts_relationship` (workspace_id, relationship_type)

---

## 3. InviteeKey との接続（確定）
Attendance Engine / Threads / Invite は invitee_key（統一ID）を使用する。

### 3.1 InviteeKey形式（確定）
- `u:<user_id>` … internal_user
- `e:<sha256_16(email_lower)>` … external_person（メール由来）
- `lm:<list_member_id>` … list_member（将来対応）

### 3.2 Contacts → invitee_key 生成（確定）
- internal_user：`u:${user_id}`
- external_person/list_member：`e:${sha256_16(lower(email))}` を正とする  
  ※暫定で `e:${lower(email)}` を保持している場合は、バックフィルでsha化に寄せる（Phase CでOK）

---

## 4. 予定調整ツールとしての"最低限の体験"（確定）

### 4.1 チャット/音声での問い合わせ（確定）
- 「〇〇さんどういう人？」→ contacts.summary / notes / tags を返す
- 「〇〇さんに日程調整送って」→ contacts を解決して thread_invites を作り /i/:token を送る
- 「〇〇リストに一括で送って」→ ListMembers → contacts を辿り一括 invite 作成→メール送信

### 4.2 "AIに全部読ませない"（確定）
- 検索はDB（SQL/FTS）で行い、LLMには **要約＋タグ＋短メモ＋直近状態** だけ渡す
- Contacts全文をLLMに投げない（コスト/漏洩/遅延リスク）

---

## 5. セキュリティ（確定：壊れない線）
- contacts 取得/更新/検索は **必ず workspace_id + owner_user_id** で絞り込み
- Admin操作（インポート/一括送信）は audit_logs（将来）へ記録
- 外部に見せるのは /i/:token のみ（contacts詳細は外部に返さない）

---

## 6. 将来拡張（今は作らないが設計に含む）
- `permission_level`（can_view_availability / can_auto_schedule）
- contact_summary 自動生成（手動再生成→バッチ→定期更新の順で成熟）
- embeddings/ベクトル検索（数万人規模になってから導入）
