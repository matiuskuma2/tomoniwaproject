# People ドメイン用語集（SSOT）

最終更新日: 2026-02-06
ステータス: 確定（SSOT準拠）

---

## 1. 概要

ToMoniWaoにおける「人」に関するドメインは3つの独立した概念で構成される。
**これらは同義ではなく、異なる目的と用途を持つ。**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          People ドメイン                                 │
├──────────────────┬───────────────────────┬──────────────────────────────┤
│    Contacts      │       Lists           │      Relationships           │
│   （連絡先）      │   （リスト/セグメント）  │      （つながり）             │
├──────────────────┼───────────────────────┼──────────────────────────────┤
│ 名刺・アドレス帳  │ 一括招待用の宛先集合   │ 双方向で合意した関係          │
│ 一方的に登録可   │ Contactsから構成      │ 承諾が必要                    │
│ 相手はアプリ不要 │ メール必須            │ 相手もアプリユーザー          │
└──────────────────┴───────────────────────┴──────────────────────────────┘
```

---

## 2. Contacts（連絡先）

### 2.1 定義

**名刺やCSV、手入力で追加するアドレス帳エントリ。**
相手がToMoniWaoを使っていなくても存在できる。

### 2.2 用途

- 日程調整の招待先として参照
- 名刺管理（OCR取り込み）
- 一括招待リストのソース

### 2.3 特徴

| 特性 | 説明 |
|------|------|
| 登録方法 | 一方的（相手の承諾不要） |
| メールアドレス | 任意（一括招待には必須） |
| 相手のアカウント | 不要（外部の人も可） |
| DBテーブル | `contacts` |
| API | `/api/contacts` |

### 2.4 種類（kind）

| kind | 説明 |
|------|------|
| `internal_user` | ToMoniWaoアカウント保有者 |
| `external_person` | 外部の人（名刺など） |
| `list_member` | リストからのみ参照可能 |

### 2.5 relationship_type（旧設計）

**注意**: これは旧設計の名残で、`Relationships`とは別概念。

| relationship_type | 説明 |
|-------------------|------|
| `external` | デフォルト（関係なし） |
| `coworker` | 同僚（workmate相当） |
| `family` | 家族 |

---

## 3. Lists（リスト / セグメント）

### 3.1 定義

**一括招待のための宛先グループ。**
Contactsから選んで構成する。

### 3.2 用途

- 「全員に招待送信」の対象
- 定期的な日程調整のセグメント
- チームやプロジェクト単位の管理

### 3.3 特徴

| 特性 | 説明 |
|------|------|
| 構成要素 | Contactsのサブセット |
| メールアドレス | **必須**（招待送信に必要） |
| 重複 | 同一Contactを複数Listに登録可 |
| DBテーブル | `lists`, `list_members` |
| API | `/api/lists`, `/api/lists/:id/members` |

### 3.4 SSOT制約

```
⚠️ リストメンバーは email 必須

理由: 一括招待でメール送信するため
例外: なし（メールなしはエラー）
```

### 3.5 メンバー追加方法

1. **Contacts から選択**: 既存連絡先を追加
2. **CSV 取り込み**: 一括登録
3. **テキスト貼り付け**: コピペで追加
4. **チャット経由**: 「リストに追加して」

---

## 4. Relationships（つながり）

### 4.1 定義

**双方が承諾して成立する関係性。**
相手もToMoniWaoユーザーである必要がある。

### 4.2 用途

- **プールメンバー制約**: workmate/family のみプール予約可
- **権限管理**: カレンダー閲覧権限など
- **通知チャネル**: 関係性に応じた通知先選択

### 4.3 特徴

| 特性 | 説明 |
|------|------|
| 成立条件 | 相手の承諾が必要 |
| 相手のアカウント | **必須**（アプリユーザー） |
| 双方向性 | A→B と B→A は同一レコード |
| DBテーブル | `relationships`, `relationship_requests` |
| API | `/api/relationships`, `/api/relationships/request` |

### 4.4 関係種別（relation_type）

| relation_type | 説明 | 権限レベル |
|---------------|------|-----------|
| `stranger` | 他人（デフォルト） | 最小 |
| `workmate` | 仕事仲間 | 空き時間閲覧 |
| `family` | 家族 | 詳細閲覧（設定次第で代理作成も可） |

### 4.5 状態遷移

```
                  ┌─────────┐
                  │ pending │ ← 申請直後
                  └────┬────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌──────────┐   ┌──────────┐
   │ active  │   │ declined │   │ expired  │
   │ (成立)  │   │ (辞退)   │   │ (期限切れ)│
   └─────────┘   └──────────┘   └──────────┘
        │
        ▼
   ┌─────────┐
   │ blocked │ ← ブロック
   └─────────┘
```

### 4.6 権限プリセット（permission_preset）

| preset | 説明 |
|--------|------|
| `workmate_default` | 仕事仲間のデフォルト権限 |
| `family_view_freebusy` | 空き/予定あり を閲覧可 |
| `family_can_write` | 代理で予定作成可 |

---

## 5. 3概念の比較表

| 項目 | Contacts | Lists | Relationships |
|------|----------|-------|---------------|
| **日本語名** | 連絡先 | リスト/セグメント | つながり |
| **目的** | アドレス帳 | 一括招待 | 権限・制約 |
| **相手の承諾** | 不要 | 不要 | **必要** |
| **メール** | 任意 | **必須** | - |
| **相手がアプリユーザー** | 任意 | 任意 | **必須** |
| **作成方法** | 名刺/CSV/手入力 | Contactsから選択 | 申請→承諾 |
| **双方向性** | 一方向 | 一方向 | **双方向** |

---

## 6. よくある混乱と回答

### Q1: 連絡先に追加 = つながりが成立？

**A: いいえ。別概念です。**

- 連絡先に追加: アドレス帳に登録しただけ（相手は知らない）
- つながり成立: 申請→相手が承諾してはじめて成立

### Q2: リストのメンバーはつながりが必要？

**A: いいえ。不要です。**

- リスト: 一括招待の宛先（メールさえあればOK）
- つながり: プールメンバー制約などに使う

### Q3: workmate/family を contacts に登録するには？

**A: 両方を行う必要があります。**

1. まず連絡先（Contacts）に追加
2. 次につながり申請（Relationships）を送信
3. 相手が承諾したら関係成立

または、チャットで「○○さんを仕事仲間として追加して」と言えば両方を同時に処理。

### Q4: つながりを解除したら連絡先も消える？

**A: いいえ。連絡先は残ります。**

- つながり解除: 権限のみ削除（strangerに戻る）
- 連絡先削除: アドレス帳から削除

---

## 7. UI表示ガイドライン

### 7.1 バッジ表示

| 状態 | バッジ | 色 |
|------|-------|-----|
| 仕事仲間 | `workmate` | 青 |
| 家族 | `family` | 緑 |
| 外部 | `external` | グレー |
| 申請中 | `pending` | 黄 |
| ブロック | `blocked` | 赤 |

### 7.2 警告表示

**メールなしの連絡先をリストに追加しようとした場合**:
```
⚠️ メールアドレスがないため追加できません。
   先にメールアドレスを登録してください。
```

**つながりのない人にプール招待を送ろうとした場合**:
```
⚠️ プール予約は「仕事仲間」または「家族」のみ利用可能です。
   先につながり申請を送信してください。
```

---

## 8. DBスキーマ概要

### contacts
```sql
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- internal_user, external_person, list_member
  email TEXT,
  display_name TEXT,
  relationship_type TEXT DEFAULT 'external',  -- 旧設計（参考）
  ...
);
```

### lists / list_members
```sql
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ...
);

CREATE TABLE list_members (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  ...
);
```

### relationships / relationship_requests
```sql
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL,         -- 正規化（a < b）
  user_b_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,     -- workmate, family, stranger
  status TEXT NOT NULL DEFAULT 'active',
  permission_preset TEXT,
  ...
  UNIQUE(user_a_id, user_b_id)
);

CREATE TABLE relationship_requests (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL,
  invitee_user_id TEXT,
  requested_type TEXT NOT NULL,    -- workmate, family
  status TEXT DEFAULT 'pending',
  token TEXT NOT NULL UNIQUE,
  ...
);
```

---

## 9. 関連ドキュメント

- `PEOPLE_HUB_SPEC.md` - People Hub UI設計
- `SSOT_DOMAIN_MAPPING.md` - ドメインマッピング表
- `NOTIFICATION_CHANNEL_RULES.md` - 関係性別通知ルール

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-06 | 初版作成（3概念の明確な定義） |
