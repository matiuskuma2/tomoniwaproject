# People Hub 設計書（SSOT統合UI）

最終更新日: 2026-02-05
ステータス: 設計中（P1実装予定）

---

## 1. 概要

### 1.1 背景・課題

現在、「人」に関する情報が3つの画面に分散している：

| 画面 | 役割 | 問題点 |
|------|------|--------|
| 連絡先（ContactsPage） | アドレス帳 | 関係性が分かりにくい |
| リスト（ListsPage） | 一括招待セグメント | メール必須でない / 一覧が出ない |
| つながり（RelationshipRequestPage） | workmate/family申請 | 連絡先と別画面で混乱 |

**SSOT違反の具体例**:
- 同じ人が Contacts と List に重複して存在
- リストメンバーにメールがないと一括招待が壊れる
- 連絡先とつながりの関係が見えない

### 1.2 解決方針

**People（台帳）を1つにして、3つのビューで切り替える**

```
┌─────────────────────────────────────────────────────┐
│  People Hub (/people)                               │
├─────────────────────────────────────────────────────┤
│  [検索] [取り込み] [つながり申請]                    │
├───────────┬───────────┬───────────────────────────────┤
│ 連絡先    │ リスト    │ つながり                      │
│ (Contacts)│ (Segments)│ (Relations)                   │
├───────────┴───────────┴───────────────────────────────┤
│                                                     │
│  一覧表示（タブ別）                                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 2. データモデル（SSOT）

### 2.1 Contacts（連絡先）

**役割**: 名刺/CSV/手入力で入るアドレス帳。相手がアプリ未使用でも存在する。

```typescript
interface Contact {
  id: string;
  kind: 'internal_user' | 'external_person' | 'organization' | 'group';
  display_name: string;
  email?: string;          // 一括招待には必須
  user_id?: string;        // 内部ユーザーの場合
  relationship_type?: string; // legacy
  notes?: string;
  tags?: string[];
  created_at: string;
}
```

**重要**: `email` は連絡先としては任意だが、一括招待セグメントに入れる場合は必須。

### 2.2 Lists（リスト / セグメント）

**役割**: 一括招待の宛先集合。Contactsから構成される。

```typescript
interface List {
  id: string;
  name: string;
  description?: string;
  member_count: number;        // 追加: メンバー数
  valid_email_count: number;   // 追加: 有効メール数
  created_at: string;
}

interface ListMember {
  id: string;
  list_id: string;
  contact_id: string;
  contact_display_name: string;
  contact_email?: string;      // 必須にすべき
  contact_kind: string;
  contact_relationship_type?: string;
}
```

**SSOT要件**:
- リストメンバーは `contact_email` 必須（UIでバリデーション）
- メールなしは「送信不可」として赤で警告

### 2.3 Relationships（つながり）

**役割**: 相手が承諾して成立する関係。Poolメンバー条件に使う。

```typescript
type RelationType = 'workmate' | 'family' | 'stranger';

interface Relationship {
  relationship_id: string;
  user_id: string;              // 相手のuser_id
  relation_type: RelationType;
  display_name?: string;
  email?: string;
  status: 'active' | 'pending' | 'blocked';
}
```

**状態遷移**:
```
申請 → pending → active（承諾）
           ↓
       blocked（拒否/ブロック）
```

---

## 3. UI設計

### 3.1 People Hub ページ構成

**URL**: `/people`

```
┌─────────────────────────────────────────────────────┐
│  People Hub                                         │
│  [検索バー]                                         │
│  [取り込み ▼] [つながり申請]                        │
├─────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌──────────────┐            │
│  │連絡先  │ │リスト  │ │つながり      │            │
│  │(123)   │ │(5)     │ │(12 active)   │            │
│  └────────┘ └────────┘ └──────────────┘            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  タブ別コンテンツ                                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 3.2 連絡先タブ

**表示項目**:
- 名前
- メールアドレス（欠落時は赤で警告）
- 種別バッジ（内部/外部）
- 関係性バッジ（workmate/family/stranger）

**アクション**:
- つながり申請（workmateの場合は日程調整ボタンも表示）
- 詳細編集
- 削除

### 3.3 リストタブ

**表示項目**:
- リスト名
- 説明
- メンバー数 / 有効メール数
- 作成日

**アクション**:
- メンバー確認（モーダル）
- メンバー追加（連絡先から選択 / CSV / コピペ）
- 一括招待
- 削除

**重要な警告表示**:
```
⚠️ メールなし: 3名（一括招待に含まれません）
```

### 3.4 つながりタブ

**表示項目**:
- 名前
- メールアドレス
- 関係種別（workmate/family）
- 状態（active/pending/blocked）

**アクション**:
- 日程調整（workmate/familyのみ）
- 関係解除
- ブロック解除

---

## 4. 操作フロー

### 4.1 チャット主導（推奨）

```
ユーザー: 「名刺を登録して」
  ↓
画像アップロード → OCR → email抽出
  ↓
チャット: 「田中太郎さん（taro@example.com）を登録しますか？」
  ↓
confirm → contacts 追加
  ↓
チャット: 「仕事仲間として申請しますか？」
  ↓
confirm → relationship_request 作成 → 通知
```

### 4.2 UI操作（救済・監査）

**取り込みメニュー**:
- 名刺から追加（カメラ/画像）
- CSVから追加
- テキスト貼り付け

**取り込み結果表示**:
```
取り込み結果: 10件
├── 成功: 8件
├── 重複: 1件（既存と統合）
└── エラー: 1件（メール形式不正）
```

### 4.3 リストへのメンバー追加

```
1. 「メンバー追加」クリック
2. モーダル表示:
   - 連絡先から選択（チェックボックス）
   - CSV取り込み
   - テキスト貼り付け
3. メール必須のバリデーション
4. 確認 → 追加
```

---

## 5. バリデーションルール

### 5.1 連絡先追加時

| フィールド | 必須 | バリデーション |
|-----------|------|---------------|
| display_name | ✅ | 1文字以上 |
| email | - | 形式チェック |
| kind | ✅ | enum値 |

### 5.2 リストメンバー追加時

| フィールド | 必須 | バリデーション |
|-----------|------|---------------|
| contact_id | ✅ | 存在チェック |
| contact_email | ✅ | 形式チェック / 存在必須 |

**メールなしの連絡先をリストに追加しようとした場合**:
```
⚠️ 田中太郎さんはメールアドレスがないため追加できません。
   先にメールアドレスを登録してください。
```

---

## 6. 実装計画

### Phase 1: 統合UIの骨格

1. `PeopleHubPage.tsx` 作成
2. タブ切り替え実装（連絡先/リスト/つながり）
3. 既存の `ContactsPage`, `ListsPage`, `RelationshipRequestPage` の機能を移植
4. ルーティング変更: `/people` をメインに、旧URLはリダイレクト

### Phase 2: SSOT強化

1. リストメンバーのメール必須バリデーション
2. メール欠落警告の表示
3. 重複検出と統合機能

### Phase 3: チャット連携

1. 取り込みフロー（名刺/CSV/テキスト）の統一
2. confirm → 反映の標準化
3. `import_runs` / `import_items` テーブルの検討

---

## 7. 旧画面との互換性

| 旧URL | 対応 |
|-------|------|
| `/contacts` | `/people?tab=contacts` にリダイレクト |
| `/lists` | `/people?tab=lists` にリダイレクト |
| `/relationships/request` | `/people?tab=relationships&action=request` |

設定メニューも更新：
- 「連絡先管理」→「People Hub」に変更
- 「リスト管理」→ 削除（統合）
- 「つながりを作る」→ 削除（統合）

---

## 8. 関連ドキュメント

- `SSOT_DOMAIN_MAPPING.md` - ドメインマッピング
- `NOTIFICATION_SYSTEM_PLAN.md` - 通知システム設計
- `NOTIFICATION_CHANNEL_RULES.md` - 通知チャネルルール

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-05 | 初版作成（P1設計） |
