# D0-CONNECT-CHAT-SPEC: 知り合い登録・仕事仲間化のチャット体験（SSOT）

## Status: APPROVED
- Created: 2026-02-02
- Author: AI Developer + モギモギ（関屋紘之）
- Purpose: G1/G2-A の前段となる「入口体験」の会話設計

---

## 0. ドキュメントの位置づけ

このドキュメントは **知り合い登録 → 仕事仲間化** の会話仕様を定義する **Single Source of Truth（SSOT）** です。

### 全体の流れ
```
D0 (知り合う/仕事仲間になる)
    ↓
G2-A (Pool Booking / N対1割当)
    ↓
G1 (1対N日程調整)
    ↓
R0/R1/R2 (1対1予定調整)
```

### このドキュメントがカバーする範囲
- 名刺/QR/ID/メール からの連絡先登録
- CSV/PDF/テキスト からの一括登録
- 仕事仲間（workmate）申請・承諾・拒否・ブロック
- アプリ招待（予定調整とは別レーン）
- stranger → workmate への関係昇格

### カバーしない範囲（別SSOT）
- Pool作成・予約割当 → `G2-A-CHAT-SPEC.md`
- 1対N日程調整 → `G1-PLAN.md`
- 1対1予定調整 → `intent_catalog.json` の schedule.1on1.*

---

## 1. 設計原則（超重要）

| # | 原則 | 説明 |
|---|---|---|
| 1 | **主役は常にAI秘書** | ユーザーは「この人を登録して」だけ言えばいい |
| 2 | **概念名を言わせない** | workmate / pool / relation 等の用語は会話に出さない |
| 3 | **最初はゆるくつながる** | stranger で始めて、後から昇格もOK |
| 4 | **承諾が必要なものは非同期** | 相手への確認は inbox 経由 |
| 5 | **スパム防止は裏側で制御** | 会話はシンプルに保つ |

---

## 2. 関係値モデル

| 関係 | 説明 | 承諾 | できること |
|---|---|---|---|
| `stranger` | 一時的・招待リンクのみ | 不要 | URL共有のみ |
| `workmate` | 仕事仲間 | **必須** | 予定参照・Pool対象・チーム調整 |
| `family` | 家族（将来） | **必須＋確認** | 代理予約・強権限 |

> **MVP は workmate まで。family は将来実装。**

---

## 3. 会話パターン（D0-1 〜 D0-12）

---

### D0-1: 名刺アップロード → 登録 → workmate申請

**入口の王道パターン**

#### 会話例
```
ユーザー: この名刺の人を登録して
          [画像: 名刺]

AI秘書: 名刺を読み込みました。

        👤 山田 太郎
        📧 yamada@example.com
        🏢 株式会社ABC 営業部
        
        この方を「仕事仲間」として登録しますか？
        [はい] [他人のまま登録]

ユーザー: はい

AI秘書: 山田さんに仕事仲間の申請を送りました。
        承諾されると予定調整ができるようになります。
```

#### Intent定義
```json
{
  "intent": "contact.import.business_card",
  "category": "contact.import",
  "description": "名刺画像から連絡先を登録",
  "side_effect": "write_local",
  "requires_confirmation": true,
  "confirmation_prompt": "この方を仕事仲間として登録しますか？"
}
```

#### パラメータ
```json
{
  "image_url": { "type": "string", "required": true, "description": "名刺画像URL" },
  "relation_type": { "type": "string", "enum": ["workmate", "stranger"], "default": "workmate" }
}
```

#### 内部処理フロー
```
1. 画像OCR → 名前・メール・会社・電話を抽出
2. contacts テーブルに INSERT
3. relation_type == workmate の場合:
   a. relation_requests テーブルに INSERT
   b. 相手に inbox 通知（type: relation_request_received）
4. 応答: 登録完了 + 申請送信
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `POST /api/contacts/import/business-card` | ❌ 要追加 | 名刺OCR + 登録 |
| `POST /api/relations/request` | ❌ 要追加 | workmate申請 |

---

### D0-2: QRコード → 即つながり申請

**アプリ同士で会った場合**

#### 会話例
```
（QRコード読み取り後）

AI秘書: 佐藤さん（sato@example.com）ですね。
        どの関係でつながりますか？
        
        [仕事仲間] [他人（予定案内のみ）]

ユーザー: 仕事仲間

AI秘書: 佐藤さんに仕事仲間の申請を送りました。
```

#### Intent定義
```json
{
  "intent": "relation.request.qr",
  "category": "relation.request",
  "description": "QRコードから関係申請",
  "side_effect": "write_local",
  "requires_confirmation": false
}
```

#### パラメータ
```json
{
  "target_user_id": { "type": "string", "required": true },
  "relation_type": { "type": "string", "enum": ["workmate", "stranger"], "required": true }
}
```

#### 内部処理フロー
```
1. QRコードから target_user_id を取得
2. relation_type == workmate の場合:
   a. relation_requests に INSERT
   b. 相手に inbox 通知
3. relation_type == stranger の場合:
   a. contacts に追加（relation なし）
```

---

### D0-3: ID指定 → workmate申請

**Slack感覚で検索**

#### 会話例
```
ユーザー: id: tanaka_planner に申請して

AI秘書: 田中プランナーさんに仕事仲間の申請を送りました。
        承諾されるとお互いの予定が調整できるようになります。
```

#### Intent定義
```json
{
  "intent": "relation.request.by_id",
  "category": "relation.request",
  "description": "ユーザーIDで関係申請",
  "side_effect": "write_local",
  "requires_confirmation": false
}
```

#### パラメータ
```json
{
  "target_handle": { "type": "string", "required": true, "description": "ユーザーID（@なし）" },
  "relation_type": { "type": "string", "enum": ["workmate", "stranger"], "default": "workmate" }
}
```

---

### D0-4: メール検索 → 申請

**アプリを使っているか不明な相手**

#### 会話例
```
ユーザー: suzuki@example.com を登録して

AI秘書: 鈴木さんはまだアプリを使っていないようです。
        招待を送りますか？
        
        [招待を送る] [他人のまま登録だけ]

ユーザー: 招待を送る

AI秘書: 鈴木さんに招待メールを送りました。
        参加後、仕事仲間として自動でつながります。
```

#### Intent定義
```json
{
  "intent": "contact.import.email",
  "category": "contact.import",
  "description": "メールアドレスから連絡先登録＋招待",
  "side_effect": "write_external",
  "requires_confirmation": true,
  "confirmation_prompt": "招待メールを送りますか？"
}
```

#### パラメータ
```json
{
  "email": { "type": "string", "format": "email", "required": true },
  "name": { "type": "string", "optional": true },
  "send_invite": { "type": "boolean", "default": true }
}
```

#### 内部処理フロー
```
1. メールでユーザー検索
2. 存在する場合:
   a. relation_requests に INSERT
   b. inbox 通知
3. 存在しない場合:
   a. contacts に INSERT（relation なし）
   b. send_invite == true なら招待メール送信
   c. pending_invites に登録（参加後に自動 workmate 化）
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `GET /api/users/search?email=` | ✅ 存在確認 | メール検索 |
| `POST /api/invites/app` | ❌ 要追加 | アプリ招待メール送信 |

---

### D0-5: CSV一括登録

**営業台帳・名簿からの一括登録**

#### 会話例
```
ユーザー: このCSVの人たちを登録して
          [ファイル: contacts.csv]

AI秘書: 25名を検出しました。
        
        📋 内訳:
        - 新規登録: 20名
        - 既存と重複: 5名（スキップ）
        
        全員に仕事仲間の招待を送りますか？
        [全員に送る] [登録だけ] [キャンセル]

ユーザー: 全員に送る

AI秘書: 20名を登録し、招待を送りました。
        進捗は「招待状況」から確認できます。
```

#### Intent定義
```json
{
  "intent": "contact.import.csv",
  "category": "contact.import",
  "description": "CSVから一括登録",
  "side_effect": "write_external",
  "requires_confirmation": true,
  "confirmation_prompt": "全員に招待を送りますか？"
}
```

#### パラメータ
```json
{
  "file_url": { "type": "string", "required": true },
  "column_mapping": { 
    "type": "object", 
    "optional": true,
    "description": "カラムマッピング（name, email, phone, company）"
  },
  "send_invite": { "type": "boolean", "default": true }
}
```

#### 内部処理フロー
```
1. CSV パース
2. 各行について:
   a. メールで既存チェック
   b. 新規なら contacts に INSERT
   c. send_invite == true なら招待 or workmate申請
3. 結果サマリを返却
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `POST /api/contacts/import/csv` | ❌ 要追加 | CSV一括登録 |

---

### D0-6: PDF台帳 → 確認付き登録

**名寄せ・重複対策が必要なケース**

#### 会話例
```
ユーザー: このPDFを登録したい
          [ファイル: member_list.pdf]

AI秘書: 30名を検出しました。
        
        ⚠️ 同姓同名が3件あります:
        
        1. 山田 太郎
           - yamada_t@a.com（新規）
           - yamada@b.com（既存: 山田太郎@ABC社）
        
        どちらを登録しますか？
        [新規を追加] [既存を更新] [両方登録]

ユーザー: 新規を追加

AI秘書: 28名を登録しました。
        残り2件の同姓同名も確認しますか？
```

#### Intent定義
```json
{
  "intent": "contact.import.pdf",
  "category": "contact.import",
  "description": "PDF台帳から登録（重複確認付き）",
  "side_effect": "write_local",
  "requires_confirmation": true
}
```

#### 内部処理フロー
```
1. PDF パース（OCR）
2. 名寄せチェック（同姓同名、類似メール）
3. 重複候補があれば pending.contact.select を発行
4. ユーザー選択後に登録実行
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `POST /api/contacts/import/pdf` | ❌ 要追加 | PDFパース＋登録 |

---

### D0-7: テキスト貼り付け登録

**最軽量パターン**

#### 会話例
```
ユーザー: 山田 yamada@a.com
          佐藤 sato@b.com
          鈴木 suzuki@c.com

AI秘書: 3名を検出しました。
        
        👤 山田（yamada@a.com）
        👤 佐藤（sato@b.com）
        👤 鈴木（suzuki@c.com）
        
        登録して招待を送りますか？
        [送る] [登録だけ]

ユーザー: 送る

AI秘書: 3名を登録し、招待を送りました。
```

#### Intent定義
```json
{
  "intent": "contact.import.text",
  "category": "contact.import",
  "description": "テキストから連絡先を抽出して登録",
  "side_effect": "write_local",
  "requires_confirmation": true
}
```

#### パラメータ
```json
{
  "raw_text": { "type": "string", "required": true },
  "send_invite": { "type": "boolean", "default": true }
}
```

---

### D0-8: 他人のままアプリ招待

**予定調整とは別レーンで「アプリに誘う」**

#### 会話例
```
ユーザー: この人をアプリに誘いたい
          tanaka@example.com

AI秘書: 田中さんにアプリの招待リンクを送りました。
        
        📩 招待メール送信済み
        
        参加後に仕事仲間にもできます。
```

#### Intent定義
```json
{
  "intent": "invite.app.send",
  "category": "invite.app",
  "description": "アプリ招待を送信（予定調整とは別）",
  "side_effect": "write_external",
  "requires_confirmation": false
}
```

#### パラメータ
```json
{
  "email": { "type": "string", "format": "email", "required": true },
  "message": { "type": "string", "optional": true, "description": "招待メッセージ" }
}
```

---

### D0-9: 相手側の承諾（Inbox体験）

**workmate申請を受けた側**

#### 会話例
```
（相手のInboxに通知）

AI秘書: 📩 新しいリクエスト
        
        紘之さんから「仕事仲間」の申請が届いています。
        
        👤 紘之（関屋紘之）
        🏢 開発会社経営
        
        承諾すると、お互いの予定調整ができるようになります。
        
        [承諾する] [拒否する] [あとで]

相手: 承諾する

AI秘書: 紘之さんと仕事仲間になりました！
```

#### Intent定義
```json
{
  "intent": "relation.approve",
  "category": "relation.respond",
  "description": "関係申請を承諾",
  "side_effect": "write_local",
  "requires_confirmation": false
}
```

#### パラメータ
```json
{
  "request_id": { "type": "string", "required": true }
}
```

#### 内部処理フロー
```
1. relation_requests.status = 'approved' に更新
2. relations テーブルに双方向レコード INSERT
3. 申請者に inbox 通知（type: relation_approved）
```

---

### D0-10: 承諾後の確認（申請者側）

**関係成立の瞬間**

#### 会話例
```
（申請者のInboxに通知）

AI秘書: 🎉 山田さんと仕事仲間になりました！
        
        これでできること:
        - お互いの空き時間を参照して予定調整
        - チーム予約の担当者に追加
        - グループ調整への招待
        
        [山田さんと予定調整する]
```

#### Intent定義
```json
{
  "intent": "relation.notify.approved",
  "category": "relation.notify",
  "description": "関係成立通知",
  "side_effect": "none",
  "requires_confirmation": false
}
```

---

### D0-11: 拒否・ブロック（静かに処理）

**UXは静か、裏で制御**

#### 会話例（拒否）
```
相手: この申請は拒否

AI秘書: わかりました。
        （相手には「保留中」と表示されます）
```

#### 会話例（ブロック）
```
相手: この人をブロックして

AI秘書: ブロックしました。
        今後この方からの申請は届きません。
```

#### Intent定義
```json
{
  "intent": "relation.decline",
  "category": "relation.respond",
  "description": "関係申請を拒否",
  "side_effect": "write_local",
  "requires_confirmation": false
}
```

```json
{
  "intent": "relation.block",
  "category": "relation.respond",
  "description": "ユーザーをブロック",
  "side_effect": "write_local",
  "requires_confirmation": true,
  "confirmation_prompt": "この方をブロックしますか？今後の申請も届かなくなります。"
}
```

#### スパム防止ルール（裏側）
| ルール | 値 |
|---|---|
| 1日あたりの申請上限 | 20件 |
| 拒否後のクールダウン | 30日 |
| ブロック後 | 永久（解除可能） |
| 同一相手への再申請 | 1回まで |

---

### D0-12: 関係昇格（stranger → workmate）

**何度かやり取りした後の自然な昇格**

#### 会話例
```
AI秘書: 💡 ヒント
        
        鈴木さんと3回予定調整をしました。
        仕事仲間にすると、次からもっとスムーズに調整できます。
        
        [仕事仲間にする] [このままでいい]

ユーザー: 仕事仲間にする

AI秘書: 鈴木さんに仕事仲間の申請を送りました。
```

#### Intent定義
```json
{
  "intent": "relation.upgrade",
  "category": "relation.request",
  "description": "stranger から workmate への昇格申請",
  "side_effect": "write_local",
  "requires_confirmation": false
}
```

#### トリガー条件
- 同一相手と3回以上の予定調整完了
- 過去30日以内にやり取りあり
- まだ workmate ではない

---

## 4. 不足API一覧（優先度順）

### MVP-必須（優先度: 高）

| API | 説明 | パターン |
|---|---|---|
| `POST /api/relations/request` | workmate申請 | D0-1,2,3 |
| `PATCH /api/relations/requests/:id/approve` | 申請承諾 | D0-9 |
| `PATCH /api/relations/requests/:id/decline` | 申請拒否 | D0-11 |
| `POST /api/contacts/import/business-card` | 名刺OCR | D0-1 |
| `POST /api/contacts/import/email` | メール検索＋登録 | D0-4 |

### MVP-実運用（優先度: 中）

| API | 説明 | パターン |
|---|---|---|
| `POST /api/contacts/import/csv` | CSV一括登録 | D0-5 |
| `POST /api/contacts/import/pdf` | PDF台帳登録 | D0-6 |
| `POST /api/contacts/import/text` | テキスト抽出登録 | D0-7 |
| `POST /api/invites/app` | アプリ招待送信 | D0-8 |
| `POST /api/relations/block` | ブロック | D0-11 |

### 将来（優先度: 低）

| API | 説明 | パターン |
|---|---|---|
| `POST /api/relations/upgrade` | 関係昇格 | D0-12 |

---

## 5. Intent カタログ追加（JSON）

以下を `docs/intent_catalog.json` に追加する。

```json
{
  "intents": [
    {
      "intent": "contact.import.business_card",
      "category": "contact.import",
      "description": "名刺画像から連絡先を登録（D0-1）",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "confirmation_prompt": "この方を仕事仲間として登録しますか？",
      "params_schema": {
        "image_url": { "type": "string", "required": true },
        "relation_type": { "type": "string", "enum": ["workmate", "stranger"], "default": "workmate" }
      },
      "executor": "contact.import.business_card",
      "api": "POST /api/contacts/import/business-card",
      "examples": [
        "この名刺の人を登録して",
        "名刺を読み込んで"
      ]
    },
    {
      "intent": "contact.import.csv",
      "category": "contact.import",
      "description": "CSVから一括登録（D0-5）",
      "side_effect": "write_external",
      "requires_confirmation": true,
      "confirmation_prompt": "全員に招待を送りますか？",
      "params_schema": {
        "file_url": { "type": "string", "required": true },
        "send_invite": { "type": "boolean", "default": true }
      },
      "executor": "contact.import.csv",
      "api": "POST /api/contacts/import/csv",
      "examples": [
        "このCSVを登録して",
        "名簿を一括登録したい"
      ]
    },
    {
      "intent": "contact.import.pdf",
      "category": "contact.import",
      "description": "PDF台帳から登録（D0-6）",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "params_schema": {
        "file_url": { "type": "string", "required": true }
      },
      "executor": "contact.import.pdf",
      "api": "POST /api/contacts/import/pdf",
      "examples": [
        "このPDFを登録して",
        "台帳を取り込みたい"
      ]
    },
    {
      "intent": "contact.import.text",
      "category": "contact.import",
      "description": "テキストから連絡先を抽出（D0-7）",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "params_schema": {
        "raw_text": { "type": "string", "required": true },
        "send_invite": { "type": "boolean", "default": true }
      },
      "executor": "contact.import.text",
      "api": "POST /api/contacts/import/text",
      "examples": [
        "山田 yamada@a.com を登録して",
        "このメアドを登録"
      ]
    },
    {
      "intent": "contact.import.email",
      "category": "contact.import",
      "description": "メールアドレスから登録＋招待（D0-4）",
      "side_effect": "write_external",
      "requires_confirmation": true,
      "confirmation_prompt": "招待メールを送りますか？",
      "params_schema": {
        "email": { "type": "string", "format": "email", "required": true },
        "name": { "type": "string", "optional": true },
        "send_invite": { "type": "boolean", "default": true }
      },
      "executor": "contact.import.email",
      "api": "POST /api/contacts",
      "examples": [
        "suzuki@example.com を登録して",
        "このメールの人を追加"
      ]
    },
    {
      "intent": "relation.request.workmate",
      "category": "relation.request",
      "description": "仕事仲間の申請（D0-1,3,4）",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "params_schema": {
        "target_user_id": { "type": "string", "required": true }
      },
      "executor": "relation.request.workmate",
      "api": "POST /api/relations/request",
      "examples": [
        "田中さんと仕事仲間になりたい",
        "この人と連携したい"
      ]
    },
    {
      "intent": "relation.request.qr",
      "category": "relation.request",
      "description": "QRコードから関係申請（D0-2）",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "params_schema": {
        "target_user_id": { "type": "string", "required": true },
        "relation_type": { "type": "string", "enum": ["workmate", "stranger"], "required": true }
      },
      "executor": "relation.request.qr",
      "api": "POST /api/relations/request"
    },
    {
      "intent": "relation.request.by_id",
      "category": "relation.request",
      "description": "ユーザーIDで関係申請（D0-3）",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "params_schema": {
        "target_handle": { "type": "string", "required": true },
        "relation_type": { "type": "string", "enum": ["workmate", "stranger"], "default": "workmate" }
      },
      "executor": "relation.request.by_id",
      "api": "POST /api/relations/request",
      "examples": [
        "id: tanaka に申請して",
        "@sato_planner と仕事仲間に"
      ]
    },
    {
      "intent": "relation.approve",
      "category": "relation.respond",
      "description": "関係申請を承諾（D0-9）",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "params_schema": {
        "request_id": { "type": "string", "required": true }
      },
      "executor": "relation.approve",
      "api": "PATCH /api/relations/requests/:id/approve",
      "examples": [
        "承諾する",
        "仕事仲間になる"
      ]
    },
    {
      "intent": "relation.decline",
      "category": "relation.respond",
      "description": "関係申請を拒否（D0-11）",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "params_schema": {
        "request_id": { "type": "string", "required": true }
      },
      "executor": "relation.decline",
      "api": "PATCH /api/relations/requests/:id/decline",
      "examples": [
        "拒否する",
        "この申請はお断り"
      ]
    },
    {
      "intent": "relation.block",
      "category": "relation.respond",
      "description": "ユーザーをブロック（D0-11）",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "confirmation_prompt": "この方をブロックしますか？今後の申請も届かなくなります。",
      "params_schema": {
        "target_user_id": { "type": "string", "required": true }
      },
      "executor": "relation.block",
      "api": "POST /api/relations/block",
      "examples": [
        "この人をブロック",
        "もう連絡こないようにして"
      ]
    },
    {
      "intent": "relation.upgrade",
      "category": "relation.request",
      "description": "stranger から workmate への昇格（D0-12）",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "params_schema": {
        "target_user_id": { "type": "string", "required": true }
      },
      "executor": "relation.upgrade",
      "api": "POST /api/relations/upgrade",
      "examples": [
        "この人を仕事仲間にする",
        "関係をアップグレード"
      ]
    },
    {
      "intent": "invite.app.send",
      "category": "invite.app",
      "description": "アプリ招待を送信（D0-8）",
      "side_effect": "write_external",
      "requires_confirmation": false,
      "params_schema": {
        "email": { "type": "string", "format": "email", "required": true },
        "message": { "type": "string", "optional": true }
      },
      "executor": "invite.app.send",
      "api": "POST /api/invites/app",
      "examples": [
        "この人をアプリに誘いたい",
        "招待リンクを送って"
      ]
    }
  ],
  "category_summary": {
    "contact.import": "連絡先登録（名刺/CSV/PDF/テキスト/メール）",
    "relation.request": "関係申請（workmate/QR/ID）",
    "relation.respond": "関係応答（承諾/拒否/ブロック）",
    "invite.app": "アプリ招待（予定調整とは別）"
  }
}
```

---

## 6. G2-A / G1 との接続点

### workmate が必要な機能

| 機能 | workmate必須 | 説明 |
|---|---|---|
| Pool作成 | ✅ | 担当者（member）は workmate のみ |
| Pool予約 | ❌ | stranger でも予約可能 |
| 1対N調整（G1） | ✅ | 参加者は workmate のみ |
| 1対1調整 | ❌ | stranger でもURL共有可能 |

### チャットでの自然な連結

```
ユーザー: 営業チームで予約受付を始めたい

AI秘書（内部）:
1. Pool作成の intent を検出
2. 指定メンバーが workmate か確認
3. workmate でない場合:
   「田中さんはまだ仕事仲間ではありません。
    先に仕事仲間の申請を送りますか？」
4. workmate の場合:
   → G2-A フローへ（pool_booking.create）
```

---

## 7. 実装優先順位

### Phase 1: MVP-最小（D0-1,3,4,9,10）
1. `relation.request.workmate` - workmate申請
2. `relation.approve` / `relation.decline` - 承諾/拒否
3. `contact.import.email` - メール登録

**必要API**:
- `POST /api/relations/request`
- `PATCH /api/relations/requests/:id/approve`
- `PATCH /api/relations/requests/:id/decline`

### Phase 2: MVP-実運用（D0-1,2,5,7,8,11）
1. `contact.import.business_card` - 名刺
2. `contact.import.csv` - CSV一括
3. `contact.import.text` - テキスト
4. `invite.app.send` - アプリ招待
5. `relation.block` - ブロック

### Phase 3: 将来（D0-6,12）
- `contact.import.pdf` - PDF台帳
- `relation.upgrade` - 関係昇格

---

## 8. テスト方針

### Unit Tests（API層）
- `relation.request`: 申請作成 → inbox通知送信
- `relation.approve`: status更新 → relations作成 → 双方に通知
- `relation.decline`: status更新 → 申請者に通知なし（静か）
- `relation.block`: blocks テーブル INSERT → 以降の申請を拒否

### E2E Tests（チャット層）
- **D0-1完走**: 名刺アップ → 登録 → workmate申請 → 相手承諾 → 関係成立
- **D0-4完走**: メール入力 → 招待送信 → 参加 → 自動workmate化
- **スパム防止**: 20件超の申請 → エラー

---

## 9. DBスキーマ（参考）

### relations テーブル（新設）
```sql
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  relation_type TEXT NOT NULL, -- 'workmate' | 'family'
  created_at TEXT NOT NULL,
  UNIQUE(user_id, target_user_id)
);
```

### relation_requests テーブル（新設）
```sql
CREATE TABLE relation_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pending' | 'approved' | 'declined'
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### blocks テーブル（新設）
```sql
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, blocked_user_id)
);
```

---

## Appendix: 用語

| 用語 | 説明 |
|---|---|
| stranger | 一時的な関係（URL共有のみ） |
| workmate | 仕事仲間（予定参照・Pool対象） |
| family | 家族（代理予約可能、将来実装） |
| relation_request | 関係申請（承諾待ち状態） |
| block | ブロック（申請を永久拒否） |
| D0 | 知り合い登録・仕事仲間化の会話仕様（本ドキュメント） |
| G2-A | Pool Booking（N対1割当） |
| G1 | 1対N日程調整 |
