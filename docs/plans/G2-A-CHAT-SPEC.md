# G2-A Pool Booking: チャット会話仕様書（SSOT）

## Status: DRAFT
- Created: 2026-02-02
- Author: AI Developer + モギモギ（関屋紘之）
- Purpose: AI秘書がPool Bookingを透過的に使うための会話設計

---

## 0. ドキュメントの位置づけ

このドキュメントは **G2-A Pool Booking** のチャット会話仕様を定義する**Single Source of Truth（SSOT）**です。

### 前提
- **G2-A API MVP 完成済み**（PR #106-110 merged）
- Pool作成/Member管理/Slot管理/Reserve→Assign/Inbox通知 が動作
- ユーザーは API を直接触らない。**AI秘書がどう使うか**がプロダクト価値

### 方針
- **A: チャットから Pool を透過的に使う**（最優先）
- UI主導ではなく、チャット主導で体験を設計
- Pool管理画面は内部台帳、顧客の主役はAI秘書

---

## 1. MVP スコープ

### MVP-最小（パターン1〜5）
| # | パターン | 概要 |
|---|---|---|
| 1 | Pool作成（管理者） | 予約受付を始める |
| 2 | 申込（顧客/内部） | 空き枠を選んで予約 |
| 3 | 担当者通知確認 | 割り当て通知を確認 |
| 4 | 既存Poolへ追加申込 | リピート予約 |
| 5 | 枠がない場合 | 空きなし対応 |

### MVP-実運用（パターン1〜7を推奨）
| # | パターン | 概要 |
|---|---|---|
| 6 | メンバー追加/削除 | 担当者の変更 |
| 7 | 予約キャンセル | 申込者/管理者によるキャンセル |

### 将来検討（パターン8〜10）
| # | パターン | 概要 |
|---|---|---|
| 8 | 担当者変更（再割り当て） | 確定済み予約の担当を変更 |
| 9 | Pool一時停止 | 受付停止 |
| 10 | 複数Pool選択 | 複数Poolがある場合 |

---

## 2. パターン詳細（10パターン）

---

### パターン1: Pool作成（管理者）

#### 会話例
```
ユーザー: 営業チームで予約受付を始めたい
AI秘書: 了解しました。予約受付グループを作成します。
        担当するメンバーを教えてください。
        （例: 田中さん、佐藤さん、山田さん）

ユーザー: 田中、佐藤、山田の3人で
AI秘書: 田中さん、佐藤さん、山田さんを担当者として登録しました。
        予約枠の時間帯を設定します。
        いつの時間帯を公開しますか？
        （例: 来週の平日10時〜17時）

ユーザー: 来週月〜金の10時から17時、1時間枠で
AI秘書: 予約受付の準備ができました！
        
        📋 予約受付: 営業チーム打ち合わせ
        👥 担当者: 田中さん、佐藤さん、山田さん（ラウンドロビン）
        📅 公開枠: 2/3(月)〜2/7(金) 10:00-17:00（1時間枠 × 7枠/日）
        🔗 予約リンク: [URL]
        
        このリンクを共有すると、誰でも空き枠から予約できます。
        予約が入ると担当者にローテーションで自動割り当てされます。
```

#### Intent定義
```json
{
  "intent": "pool_booking.create",
  "category": "pool_booking.manage",
  "description": "予約受付グループ（Pool）を作成し公開リンクを発行",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "name": { "type": "string", "required": true, "description": "Pool名（例: 営業チーム打ち合わせ）" },
  "members": { 
    "type": "array", 
    "required": true,
    "items": { "type": "string" },
    "description": "担当メンバー（user_id or name）"
  },
  "slot_config": {
    "type": "object",
    "required": true,
    "properties": {
      "start_date": { "type": "string", "format": "date" },
      "end_date": { "type": "string", "format": "date" },
      "business_hours": { "type": "object", "description": "曜日ごとの営業時間" },
      "slot_duration_minutes": { "type": "integer", "default": 60 },
      "timezone": { "type": "string", "default": "Asia/Tokyo" }
    }
  }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.create
2. 前提チェック:
   - workspaceが存在するか
   - ユーザーがworkspace管理者か
3. 内部処理:
   a. POST /api/pools → pool_id取得
   b. 各メンバーに POST /api/pools/:id/members
   c. POST /api/pools/:id/slots (bulk) → slots生成
   d. 公開リンク生成（※要API追加）
4. 応答:
   - Pool名、担当者、公開枠数、公開リンクを表示
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `POST /api/pools/:id/slots` (bulk) | ✅ 存在 | slots[] で一括作成可能 |
| `GET /api/pools/:id/public-link` | ❌ 要追加 | 公開リンク発行 |

---

### パターン2: 申込（顧客/内部）

#### 会話例
```
ユーザー: 営業チームと打ち合わせしたい
AI秘書: 営業チームの空き枠をお見せします。

        📅 2/3(月)
        - 10:00-11:00 ○空き
        - 11:00-12:00 ○空き
        - 14:00-15:00 ○空き
        
        📅 2/4(火)
        - 10:00-11:00 ○空き
        - 13:00-14:00 ○空き
        
        ご希望の日時を選んでください。

ユーザー: 2/3の14時でお願いします
AI秘書: 予約を確定しました！
        
        ✅ 予約確定
        📅 2/3(月) 14:00-15:00
        👤 担当: 田中さん
        📍 営業チーム打ち合わせ
        
        田中さんに通知しました。
        当日よろしくお願いします！
```

#### Intent定義
```json
{
  "intent": "pool_booking.book",
  "category": "pool_booking.apply",
  "description": "Poolの空き枠から予約を申し込む",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "pool_id": { "type": "string", "required": true, "description": "予約先Pool" },
  "slot_id": { "type": "string", "required": true, "description": "選択した枠" },
  "note": { "type": "string", "optional": true, "description": "申込時のメッセージ" }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.book
2. 前提チェック:
   - pool_idが有効か
   - slot_idが'open'状態か
3. 内部処理:
   a. POST /api/pools/:poolId/book
      → Reserve → Assign（round-robin）
   b. Inbox通知が自動送信（担当者 + 管理者）
4. 応答:
   - 予約確定、日時、担当者を表示
```

#### 不足API
なし（既存APIで対応可能）

---

### パターン3: 担当者への通知確認

#### 会話例
```
（担当者: 田中さん）
AI秘書: 📩 新しい予約が割り当てられました
        
        👤 申込者: 鈴木さん
        📅 2/3(月) 14:00-15:00
        📍 営業チーム打ち合わせ
        💬 「製品について相談したい」
        
        [詳細を見る]

田中: 詳細を見せて
AI秘書: 予約の詳細です：
        
        📋 予約ID: BK-20260203-001
        👤 申込者: 鈴木さん (suzuki@example.com)
        📅 日時: 2/3(月) 14:00-15:00
        📍 グループ: 営業チーム打ち合わせ
        💬 メモ: 「製品について相談したい」
        
        [カレンダーに追加] [キャンセル]
```

#### Intent定義
```json
{
  "intent": "pool_booking.view_assigned",
  "category": "pool_booking.read",
  "description": "自分に割り当てられた予約を確認",
  "side_effect": "read",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "booking_id": { "type": "string", "optional": true, "description": "特定の予約ID" },
  "filter": { 
    "type": "string", 
    "enum": ["upcoming", "past", "all"],
    "default": "upcoming"
  }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.view_assigned
2. 内部処理:
   a. GET /api/inbox?type=pool_booking_assigned
   b. または GET /api/pools/:id/bookings?assignee=me
3. 応答:
   - 予約詳細を表示
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `GET /api/pools/:id/bookings?assignee=me` | ❌ 要追加 | 担当者フィルター |

---

### パターン4: 既存Poolへ追加申込

#### 会話例
```
ユーザー: 前回と同じ営業チームで予約したい
AI秘書: 前回は「営業チーム打ち合わせ」でしたね。
        空き枠をお見せします。

        📅 2/10(月)
        - 10:00-11:00 ○空き
        - 14:00-15:00 ○空き
        
        ご希望の日時を選んでください。

ユーザー: 10時で
AI秘書: 予約を確定しました！
        
        ✅ 予約確定
        📅 2/10(月) 10:00-11:00
        👤 担当: 佐藤さん（前回: 田中さん）
        📍 営業チーム打ち合わせ
```

#### Intent定義
```json
{
  "intent": "pool_booking.rebook",
  "category": "pool_booking.apply",
  "description": "過去に利用したPoolから再予約",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "pool_id": { "type": "string", "optional": true, "description": "Pool ID（省略時は履歴から推測）" },
  "slot_id": { "type": "string", "required": true },
  "note": { "type": "string", "optional": true }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.rebook
2. 前提チェック:
   - 過去の予約履歴からpool_idを特定
3. 内部処理:
   a. GET /api/users/me/booking-history（※要API追加）
   b. POST /api/pools/:poolId/book
4. 応答:
   - 予約確定を表示
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `GET /api/users/me/booking-history` | ❌ 要追加 | 予約履歴 |

---

### パターン5: 枠がない場合

#### 会話例
```
ユーザー: 営業チームと打ち合わせしたい
AI秘書: 申し訳ありません。現在「営業チーム打ち合わせ」に
        空き枠がありません。

        以下の方法があります:
        1. 新しい枠が追加されたら通知を受け取る
        2. 別の日程を管理者に依頼する
        
        どうしますか？

ユーザー: 通知をお願い
AI秘書: 了解しました。
        「営業チーム打ち合わせ」に新しい枠が追加されたら
        お知らせします。
```

#### Intent定義
```json
{
  "intent": "pool_booking.notify_availability",
  "category": "pool_booking.subscribe",
  "description": "空き枠が追加されたら通知を受け取る",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "pool_id": { "type": "string", "required": true },
  "user_id": { "type": "string", "required": true }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.notify_availability
2. 内部処理:
   a. POST /api/pools/:id/watchers（※要API追加）
3. 応答:
   - 通知設定完了を表示
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `POST /api/pools/:id/watchers` | ❌ 要追加 | 空き通知登録 |
| `DELETE /api/pools/:id/watchers/:userId` | ❌ 要追加 | 空き通知解除 |

---

### パターン6: メンバー追加/削除

#### 会話例
```
ユーザー: 営業チームに木村さんを追加して
AI秘書: 木村さんを「営業チーム打ち合わせ」の担当者に
        追加しました。

        👥 現在の担当者:
        1. 田中さん
        2. 佐藤さん
        3. 山田さん
        4. 木村さん（新規）
        
        予約が来ると、この順番でローテーションします。
```

#### Intent定義
```json
{
  "intent": "pool_booking.manage_members",
  "category": "pool_booking.manage",
  "description": "Poolのメンバーを追加/削除",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "pool_id": { "type": "string", "required": true },
  "action": { "type": "string", "enum": ["add", "remove"], "required": true },
  "user_id": { "type": "string", "required": true }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.manage_members
2. 前提チェック:
   - ユーザーがPool管理者か
3. 内部処理:
   a. action=add: POST /api/pools/:id/members
   b. action=remove: DELETE /api/pools/:id/members/:memberId
4. 応答:
   - 更新後のメンバー一覧を表示
```

#### 不足API
なし（既存APIで対応可能）

---

### パターン7: 予約キャンセル

#### 会話例（申込者）
```
ユーザー: 2/3の予約をキャンセルしたい
AI秘書: 以下の予約をキャンセルしますか？
        
        📅 2/3(月) 14:00-15:00
        👤 担当: 田中さん
        📍 営業チーム打ち合わせ
        
        [キャンセルする] [やめる]

ユーザー: キャンセルする
AI秘書: 予約をキャンセルしました。
        担当の田中さんに通知しました。
```

#### Intent定義
```json
{
  "intent": "pool_booking.cancel",
  "category": "pool_booking.manage",
  "description": "予約をキャンセル",
  "side_effect": "write_local",
  "requires_confirmation": true,
  "confirmation_prompt": "この予約をキャンセルしますか？",
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "booking_id": { "type": "string", "required": true },
  "reason": { "type": "string", "optional": true }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.cancel
2. 確認:
   - 「キャンセルしますか？」
3. 内部処理:
   a. PATCH /api/pools/:poolId/bookings/:bookingId/cancel（※要API追加）
   b. Inbox通知: 担当者 + 管理者
   c. slot.status を 'open' に戻す
4. 応答:
   - キャンセル完了を表示
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `PATCH /api/pools/:poolId/bookings/:bookingId/cancel` | ❌ 要追加 | 予約キャンセル |

---

### パターン8: 担当者変更（再割り当て）

#### 会話例
```
ユーザー: 2/3の予約、田中さんから佐藤さんに変更して
AI秘書: 担当者を変更しました。
        
        📅 2/3(月) 14:00-15:00
        👤 変更前: 田中さん → 変更後: 佐藤さん
        
        両名に通知しました。
```

#### Intent定義
```json
{
  "intent": "pool_booking.reassign",
  "category": "pool_booking.manage",
  "description": "予約の担当者を変更",
  "side_effect": "write_local",
  "requires_confirmation": true,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "booking_id": { "type": "string", "required": true },
  "new_assignee_user_id": { "type": "string", "required": true }
}
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `PATCH /api/pools/:poolId/bookings/:bookingId/reassign` | ❌ 要追加 | 担当者変更 |

---

### パターン9: Pool一時停止

#### 会話例
```
ユーザー: 営業チームの予約受付を一時停止して
AI秘書: 「営業チーム打ち合わせ」の予約受付を
        一時停止しました。
        
        ⏸️ 状態: 受付停止中
        📅 未処理の枠: 15枠（そのまま保持）
        
        再開する場合は「予約受付を再開して」と
        お伝えください。
```

#### Intent定義
```json
{
  "intent": "pool_booking.pause",
  "category": "pool_booking.manage",
  "description": "Poolの予約受付を一時停止/再開",
  "side_effect": "write_local",
  "requires_confirmation": true,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "pool_id": { "type": "string", "required": true },
  "action": { "type": "string", "enum": ["pause", "resume"], "required": true }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.pause
2. 内部処理:
   a. PATCH /api/pools/:id { is_active: 0 or 1 }
3. 応答:
   - 状態変更を表示
```

#### 不足API
なし（既存の `PATCH /api/pools/:id` で対応可能）

---

### パターン10: 複数Pool選択

#### 会話例
```
ユーザー: 予約したい
AI秘書: どちらの予約をご希望ですか？

        1. 営業チーム打ち合わせ
           👥 田中さん、佐藤さん、山田さん
        
        2. カスタマーサポート
           👥 鈴木さん、高橋さん
        
        3. 技術相談窓口
           👥 伊藤さん

ユーザー: 1番で
AI秘書: 営業チームの空き枠をお見せします...
```

#### Intent定義
```json
{
  "intent": "pool_booking.select_pool",
  "category": "pool_booking.read",
  "description": "複数のPoolから選択",
  "side_effect": "read",
  "requires_confirmation": false,
  "topology": "N:1"
}
```

#### パラメータ
```json
{
  "query": { "type": "string", "optional": true, "description": "検索キーワード" }
}
```

#### 内部処理フロー
```
1. intent判定: pool_booking.select_pool
2. 内部処理:
   a. GET /api/pools (公開Poolの一覧)
3. 応答:
   - Pool一覧を表示し選択を促す
```

#### 不足API
| API | 状態 | 説明 |
|---|---|---|
| `GET /api/pools/public` | ❌ 要追加 | 公開Pool一覧 |

---

## 3. 不足API一覧（優先度順）

### MVP-最小（優先度: 高）

| API | 説明 | パターン |
|---|---|---|
| `GET /api/pools/:id/public-link` | 公開リンク発行 | 1 |
| `PATCH /api/pools/:poolId/bookings/:bookingId/cancel` | 予約キャンセル | 7 |

### MVP-実運用（優先度: 中）

| API | 説明 | パターン |
|---|---|---|
| `GET /api/pools/:id/bookings?assignee=me` | 担当者フィルター | 3 |
| `GET /api/users/me/booking-history` | 予約履歴 | 4 |
| `POST /api/pools/:id/watchers` | 空き通知登録 | 5 |

### 将来（優先度: 低）

| API | 説明 | パターン |
|---|---|---|
| `PATCH /api/pools/:poolId/bookings/:bookingId/reassign` | 担当者変更 | 8 |
| `GET /api/pools/public` | 公開Pool一覧 | 10 |

---

## 4. Intent カタログ追加（JSON）

以下を `docs/intent_catalog.json` に追加する。

```json
{
  "intents": [
    {
      "intent": "pool_booking.create",
      "category": "pool_booking.manage",
      "description": "予約受付グループを作成し公開リンクを発行",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "name": { "type": "string", "required": true },
        "members": { "type": "array", "required": true },
        "slot_config": { "type": "object", "required": true }
      },
      "executor": "pool_booking.create",
      "api": ["POST /api/pools", "POST /api/pools/:id/members", "POST /api/pools/:id/slots"],
      "examples": [
        "営業チームで予約受付を始めたい",
        "打ち合わせの予約受付を作って",
        "チームへの予約ができるようにして"
      ]
    },
    {
      "intent": "pool_booking.book",
      "category": "pool_booking.apply",
      "description": "Poolの空き枠から予約を申し込む",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "pool_id": { "type": "string", "required": true },
        "slot_id": { "type": "string", "required": true },
        "note": { "type": "string", "optional": true }
      },
      "executor": "pool_booking.book",
      "api": "POST /api/pools/:poolId/book",
      "examples": [
        "営業チームと打ち合わせしたい",
        "相談の予約をしたい",
        "空いてる枠で予約したい"
      ]
    },
    {
      "intent": "pool_booking.view_assigned",
      "category": "pool_booking.read",
      "description": "自分に割り当てられた予約を確認",
      "side_effect": "read",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "booking_id": { "type": "string", "optional": true },
        "filter": { "type": "string", "enum": ["upcoming", "past", "all"], "default": "upcoming" }
      },
      "executor": "pool_booking.view_assigned",
      "api": "GET /api/inbox?type=pool_booking_assigned",
      "examples": [
        "割り当てられた予約を見せて",
        "今日の予約は？",
        "自分の担当予約を確認"
      ]
    },
    {
      "intent": "pool_booking.rebook",
      "category": "pool_booking.apply",
      "description": "過去に利用したPoolから再予約",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "pool_id": { "type": "string", "optional": true },
        "slot_id": { "type": "string", "required": true },
        "note": { "type": "string", "optional": true }
      },
      "executor": "pool_booking.rebook",
      "api": "POST /api/pools/:poolId/book",
      "examples": [
        "前回と同じところで予約したい",
        "また営業チームに予約したい",
        "リピート予約して"
      ]
    },
    {
      "intent": "pool_booking.notify_availability",
      "category": "pool_booking.subscribe",
      "description": "空き枠が追加されたら通知を受け取る",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "pool_id": { "type": "string", "required": true }
      },
      "executor": "pool_booking.notify_availability",
      "api": "POST /api/pools/:id/watchers",
      "examples": [
        "空きが出たら教えて",
        "枠が追加されたら通知して"
      ]
    },
    {
      "intent": "pool_booking.manage_members",
      "category": "pool_booking.manage",
      "description": "Poolのメンバーを追加/削除",
      "side_effect": "write_local",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "pool_id": { "type": "string", "required": true },
        "action": { "type": "string", "enum": ["add", "remove"], "required": true },
        "user_id": { "type": "string", "required": true }
      },
      "executor": "pool_booking.manage_members",
      "api": ["POST /api/pools/:id/members", "DELETE /api/pools/:id/members/:memberId"],
      "examples": [
        "営業チームに田中さんを追加して",
        "佐藤さんを担当から外して"
      ]
    },
    {
      "intent": "pool_booking.cancel",
      "category": "pool_booking.manage",
      "description": "予約をキャンセル",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "confirmation_prompt": "この予約をキャンセルしますか？",
      "topology": "N:1",
      "params_schema": {
        "booking_id": { "type": "string", "required": true },
        "reason": { "type": "string", "optional": true }
      },
      "executor": "pool_booking.cancel",
      "api": "PATCH /api/pools/:poolId/bookings/:bookingId/cancel",
      "examples": [
        "予約をキャンセルしたい",
        "2/3の予約を取り消して"
      ]
    },
    {
      "intent": "pool_booking.reassign",
      "category": "pool_booking.manage",
      "description": "予約の担当者を変更",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "confirmation_prompt": "担当者を変更しますか？",
      "topology": "N:1",
      "params_schema": {
        "booking_id": { "type": "string", "required": true },
        "new_assignee_user_id": { "type": "string", "required": true }
      },
      "executor": "pool_booking.reassign",
      "api": "PATCH /api/pools/:poolId/bookings/:bookingId/reassign",
      "examples": [
        "担当を田中さんに変更して",
        "予約の担当者を佐藤さんに"
      ]
    },
    {
      "intent": "pool_booking.pause",
      "category": "pool_booking.manage",
      "description": "Poolの予約受付を一時停止/再開",
      "side_effect": "write_local",
      "requires_confirmation": true,
      "confirmation_prompt": "予約受付を一時停止しますか？",
      "topology": "N:1",
      "params_schema": {
        "pool_id": { "type": "string", "required": true },
        "action": { "type": "string", "enum": ["pause", "resume"], "required": true }
      },
      "executor": "pool_booking.pause",
      "api": "PATCH /api/pools/:id",
      "examples": [
        "予約受付を止めて",
        "受付を再開して"
      ]
    },
    {
      "intent": "pool_booking.select_pool",
      "category": "pool_booking.read",
      "description": "複数のPoolから選択",
      "side_effect": "read",
      "requires_confirmation": false,
      "topology": "N:1",
      "params_schema": {
        "query": { "type": "string", "optional": true }
      },
      "executor": "pool_booking.select_pool",
      "api": "GET /api/pools",
      "examples": [
        "予約できるところを見せて",
        "どこに予約できる？"
      ]
    }
  ],
  "category_summary": {
    "pool_booking.manage": "予約受付管理（Pool作成/メンバー/停止）",
    "pool_booking.apply": "予約申込",
    "pool_booking.read": "予約参照",
    "pool_booking.subscribe": "通知登録"
  }
}
```

---

## 5. 実装優先順位

### Phase 1: MVP-最小（パターン1,2,3）
1. `pool_booking.create` - Pool作成フロー
2. `pool_booking.book` - 申込フロー
3. `pool_booking.view_assigned` - 通知確認

**必要API追加**:
- `GET /api/pools/:id/public-link`

### Phase 2: MVP-実運用（パターン4,5,6,7）
1. `pool_booking.rebook` - リピート予約
2. `pool_booking.notify_availability` - 空き通知
3. `pool_booking.manage_members` - メンバー管理
4. `pool_booking.cancel` - キャンセル

**必要API追加**:
- `PATCH /api/pools/:poolId/bookings/:bookingId/cancel`
- `GET /api/users/me/booking-history`
- `POST /api/pools/:id/watchers`

### Phase 3: 運用拡張（パターン8,9,10）
- 優先度低。必要時に追加

---

## 6. テスト方針

### Unit Tests（API層）
- `pool_booking.create`: Pool/Members/Slots 作成が正常動作
- `pool_booking.book`: 予約 → Inbox通知 2件送信
- `pool_booking.cancel`: booking.status='cancelled', slot.status='open'に戻る

### E2E Tests（チャット層）
- **パターン1完走**: 発話 → Pool作成 → 枠生成 → リンク発行
- **パターン2完走**: 発話 → 枠選択 → 予約確定 → 担当者通知
- **Round-robin検証**: 3回連続予約 → 担当者が A→B→C とローテーション

---

## 7. 次のアクション

1. **このドキュメントをレビュー** → 方針確定
2. **不足API（高優先）を追加**:
   - `GET /api/pools/:id/public-link`
   - `PATCH /api/pools/:poolId/bookings/:bookingId/cancel`
3. **intent_catalog.json に追加**
4. **チャット executor を実装**

---

## Appendix: 用語

| 用語 | 説明 |
|---|---|
| Pool | 予約受付グループ（例: 営業チーム） |
| Member | Poolの担当者（予約が割り当てられる人） |
| Slot | 公開された予約枠（時間帯） |
| Booking | 確定した予約 |
| Round-robin | 担当者をローテーションで割り当てる方式 |
| Reserve | 予約枠を一時的に確保する処理 |
| Assign | 担当者を決定し予約を確定する処理 |
