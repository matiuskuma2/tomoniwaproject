# People Hub 設計書

最終更新日: 2026-02-05
ステータス: 設計確定 → 実装中

---

## 1. 概要

### 1.1 目的

「連絡先」「リスト」「つながり」を **同一の台帳（People）** として統合し、以下の問題を解決する：

1. **連絡先/リスト/つながりが分断されてユーザーが混乱**
2. **リストにemail無しで登録され一括招待が失敗**
3. **同じ人が複数箇所に存在し重複管理**

### 1.2 設計原則

- **SSOT（Single Source of Truth）**: 人（contacts）を一元管理
- **UIは監査専用**: 登録はチャット経由、UIは確認・修正・救済
- **email必須化**: 一括招待の成立を保証

---

## 2. データモデル（SSOT）

### 2.1 contacts（台帳）

```sql
-- db/migrations/0041_create_contacts.sql
CREATE TABLE contacts (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL,
  owner_user_id    TEXT NOT NULL,
  kind             TEXT NOT NULL, -- 'internal_user' | 'external_person' | 'list_member'
  user_id          TEXT NULL,     -- 内部ユーザーリンク
  email            TEXT NULL,     -- 正規化済み（lowercase）
  display_name     TEXT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'external', -- 'family' | 'coworker' | 'external'
  tags_json        TEXT NOT NULL DEFAULT '[]',
  notes            TEXT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

### 2.2 lists（セグメント）

```sql
-- db/migrations/0042_create_lists.sql
CREATE TABLE lists (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

### 2.3 list_members（セグメント所属）

```sql
-- db/migrations/0043_create_list_members.sql
CREATE TABLE list_members (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  list_id      TEXT NOT NULL,
  contact_id   TEXT NOT NULL, -- contacts.id への参照（コピー保持しない）
  created_at   TEXT NOT NULL
);
```

### 2.4 relationships（つながり）

```sql
-- db/migrations/0001_init_core.sql + 0084_add_workmate_relation_type.sql
CREATE TABLE relationships (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  related_user_id TEXT NOT NULL,
  closeness       TEXT, -- 'stranger' | 'workmate' | 'family'
  visibility      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

---

## 3. UI設計

### 3.1 ページ構成

**People Hub（/people）**: 1ページ + 3タブ

```
┌─────────────────────────────────────────────────────────┐
│  People Hub                                [検索] [取込] │
├─────────────────────────────────────────────────────────┤
│  [連絡先]  [リスト]  [つながり]                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  (タブ内容)                                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 タブ: 連絡先（Contacts）

| 項目 | 内容 |
|------|------|
| 表示 | contacts テーブルの一覧 |
| 検索 | display_name / email |
| バッジ | 関係性（workmate/family）、エラー（email欠落） |
| アクション | 編集、削除、つながり申請 |

**空状態**: 「連絡先がありません（チャットで名刺取り込み）」

### 3.3 タブ: リスト（Lists / Segments）

| 項目 | 内容 |
|------|------|
| 表示 | lists テーブルの一覧 + メンバー数 |
| バッジ | 有効email数 / 無効email数 |
| アクション | メンバー確認、一括招待、削除 |

**警告表示**: email欠落メンバーがいる場合は赤で表示

### 3.4 タブ: つながり（Relations）

| 項目 | 内容 |
|------|------|
| 表示 | relationships テーブルの一覧 |
| フィルタ | 仕事仲間 / 家族 / 申請中 |
| アクション | 承認、辞退、解除、日程調整 |

**統合**: 現在の RelationshipRequestPage の機能をここに統合

---

## 4. 状態表示ルール

### 4.1 関係性バッジ

| relationship_type | バッジ | 色 |
|-------------------|--------|-----|
| workmate | 仕事仲間 | 青 |
| family | 家族 | 緑 |
| external | (なし) | - |

### 4.2 エラーバッジ

| 条件 | バッジ | 色 |
|------|--------|-----|
| email = NULL | メール未設定 | 赤 |
| email不正 | 無効なメール | 赤 |
| 重複疑い | 重複？ | 黄 |

---

## 5. 操作フロー

### 5.1 登録（チャット経由）

```
ユーザー: 「名刺の画像」
秘書: OCR → 確認画面 → 「OKなら登録します」
ユーザー: 「OK」
秘書: contacts に INSERT → 成功メッセージ
```

### 5.2 編集（UI経由）

People Hub → 連絡先タブ → 行クリック → 編集モーダル

### 5.3 リストへの追加（UI経由）

People Hub → リストタブ → メンバー追加 → 連絡先から選択

---

## 6. 実装計画

### Phase 1: People Hub ページ作成

1. `/home/user/tomoniwaproject/frontend/src/pages/PeopleHubPage.tsx`
2. 3タブ UI（Contacts / Lists / Relations）
3. 既存 API を使用（contactsApi / listsApi / relationshipsApi）

### Phase 2: ルーティング追加

1. `/people` → PeopleHubPage
2. 既存の `/contacts`, `/lists` は `/people` にリダイレクト
3. メニューは「People Hub」に統合

### Phase 3: email必須化

1. リストメンバー追加時に email 必須バリデーション
2. email欠落メンバーの警告表示

---

## 7. 関連ドキュメント

- `SSOT_DOMAIN_MAPPING.md` - ドメインマッピング
- `NOTIFICATION_SYSTEM_PLAN.md` - 通知システム設計

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-05 | 初版作成 |
