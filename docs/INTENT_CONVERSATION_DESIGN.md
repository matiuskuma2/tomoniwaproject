# インテント駆動会話設計書（SSOT）

最終更新日: 2026-02-06
ステータス: 確定（SSOT準拠）

---

## 1. 概要

ToMoniWaoのAI秘書は**インテント駆動**で動作する。
ユーザーの自然言語入力を解析し、適切なインテントにルーティングして実行する。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         会話処理フロー                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ユーザー入力  →  意図分類  →  パラメータ抽出  →  確認  →  実行          │
│                                                                         │
│  "田中さんと来週"   schedule    invitee: 田中    確認     API呼出         │
│    "打ち合わせ"    .1on1       range: 来週     モーダル                   │
│                   .freebusy                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 設計原則

### 2.1 絶対ルール

| ルール | 説明 |
|--------|------|
| **AIは解釈のみ** | AIは意図を解釈・提案するだけ。実行はルールベース |
| **外部送信は必ず確認** | メール/SMS等の外部送信は必ずユーザー確認を経る |
| **状態はDBが真実** | 会話履歴・状態は全てDBに永続化 |

### 2.2 副作用の分類

| 種類 | 説明 | 確認要否 |
|------|------|---------|
| `none` | 副作用なし（キャンセル系） | 不要 |
| `read` | 参照のみ（安全） | 不要 |
| `write_local` | DB更新（外部送信なし） | 任意 |
| `write_external` | メール/SMS/Slack等送信 | **必須** |

---

## 3. インテント分類体系

### 3.1 カテゴリ一覧

| カテゴリ | 説明 | 代表インテント |
|---------|------|---------------|
| `calendar.read` | カレンダー参照 | schedule.today, schedule.week, schedule.freebusy |
| `schedule.1on1` | 1対1予定調整 | schedule.1on1.fixed, schedule.1on1.candidates3, schedule.1on1.freebusy |
| `invite.prepare` | 招待準備 | invite.prepare.emails, invite.prepare.list |
| `schedule.remind` | リマインド | schedule.remind.pending, schedule.remind.need_response |
| `schedule.commit` | 確定操作 | schedule.finalize |
| `pool_booking.*` | プール予約（G2-A） | pool_booking.create, pool_booking.book |
| `contact.import` | 連絡先取り込み | contact.import.business_card, contact.import.csv |
| `relation.*` | つながり管理 | relation.request.workmate, relation.approve |
| `list.*` | リスト管理 | list.create, list.add_member |
| `chat` | 雑談 | chat.general |
| `fallback` | フォールバック | unknown |

### 3.2 トポロジーとインテントの対応

| トポロジー | インテント例 | 説明 |
|-----------|-------------|------|
| 1:0 | schedule.today | 自分のみ（参照） |
| 1:1 | schedule.1on1.* | 主催者と参加者1名 |
| 1:N | invite.prepare.*, schedule.remind.* | 主催者と複数参加者 |
| N:1 | pool_booking.* | 複数予約者が1つのPoolから予約 |
| N:N | schedule.freebusy.batch | 複数参加者の共通空き |

---

## 4. 主要インテント詳細

### 4.1 1対1予定調整（schedule.1on1.*）

#### schedule.1on1.fixed
**固定日時の招待リンク発行**

```
ユーザー: 「田中さんと明日14時から1時間打ち合わせしたい」
→ intent: schedule.1on1.fixed
→ params: { invitee: {name: "田中"}, slot: {start_at: "2026-02-07T14:00", end_at: "2026-02-07T15:00"} }
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| invitee.name | ✅ | 相手の名前 |
| invitee.email | - | メールアドレス（未知でもOK） |
| slot.start_at | ✅ | 開始日時 |
| slot.end_at | ✅ | 終了日時 |
| send_via | - | share_link / email（デフォルト: share_link） |

#### schedule.1on1.freebusy
**カレンダー空きから候補自動生成**

```
ユーザー: 「田中さんと来週の空いてるところで打ち合わせ」
→ intent: schedule.1on1.freebusy
→ params: { invitee: {name: "田中"}, constraints: {time_min: "...", time_max: "..."} }
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| invitee.name | ✅ | 相手の名前 |
| constraints.time_min | - | 検索開始（デフォルト: 翌営業日） |
| constraints.time_max | - | 検索終了（デフォルト: 2週間後） |
| constraints.prefer | - | morning/afternoon/evening/business |
| candidate_count | - | 候補数（デフォルト: 3） |

#### schedule.1on1.open_slots
**空き枠を公開して選んでもらう（TimeRex型）**

```
ユーザー: 「田中さんに私の空き時間から選んでもらいたい」
→ intent: schedule.1on1.open_slots
→ params: { invitee: {name: "田中"}, constraints: {...} }
```

### 4.2 プール予約（pool_booking.*）

#### pool_booking.create
**予約受付グループを作成**

```
ユーザー: 「営業チームで予約受付を始めたい」
→ intent: pool_booking.create
→ params: { name: "営業チーム", members: [...], slot_config: {...} }
```

#### pool_booking.book
**Poolから予約申込**

```
ユーザー: 「営業チームと打ち合わせしたい」
→ intent: pool_booking.book
→ params: { pool_id: "...", slot_id: "..." }
```

### 4.3 連絡先・つながり

#### contact.import.business_card
**名刺から登録**

```
ユーザー: 「この名刺の人を登録して」[画像添付]
→ intent: contact.import.business_card
→ params: { image_url: "...", relation_type: "workmate" }
```

#### relation.request.workmate
**仕事仲間申請**

```
ユーザー: 「田中さんと仕事仲間になりたい」
→ intent: relation.request.workmate
→ params: { target_user_id: "..." }
```

### 4.4 リスト管理

#### list.create
**リスト作成**

```
ユーザー: 「営業リストを作って」
→ intent: list.create
→ params: { name: "営業リスト" }
```

#### list.add_member
**メンバー追加**

```
ユーザー: 「田中さんを営業リストに追加して」
→ intent: list.add_member
→ params: { listName: "営業リスト", email: "tanaka@example.com" }
```

---

## 5. 確認フロー

### 5.1 確認が必要なインテント

| インテント | 確認プロンプト | 副作用 |
|-----------|---------------|--------|
| invite.prepare.* | 「この宛先に招待を送る準備をしますか？」 | write_local |
| schedule.remind.* | 「リマインドを送りますか？」 | write_external |
| schedule.finalize | 「この候補で確定しますか？」 | write_local |
| list.delete | 「リスト「○○」を削除しますか？」 | write_local |
| relation.block | 「この方をブロックしますか？」 | write_local |

### 5.2 確認フロー図

```
┌─────────────────────────────────────────────────────────────────────┐
│                        確認フロー                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  インテント実行                                                      │
│       │                                                             │
│       ▼                                                             │
│  requires_confirmation?                                             │
│       │                                                             │
│  ┌────┴────┐                                                        │
│  │  true   │  false                                                 │
│  ▼         ▼                                                        │
│  確認UI    即実行                                                    │
│  表示      API呼出                                                   │
│   │                                                                 │
│   ├───▶ 「はい」 → 実行                                             │
│   │                                                                 │
│   └───▶ 「いいえ」 → キャンセル                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. 会話パターン例

### 6.1 1対1予定調整（happy path）

```
ユーザー: 田中さんと来週打ち合わせしたい
AI秘書: 田中さんとの打ち合わせですね。来週の空き枠から候補を探しますか？
       それとも日時を指定しますか？

ユーザー: 空いてるところで3つ候補出して
AI秘書: 来週の空き枠から3つ候補を探しました。
       ・2/10(月) 14:00-15:00
       ・2/11(火) 10:00-11:00
       ・2/12(水) 15:00-16:00
       この候補で招待リンクを発行しますか？

ユーザー: お願いします
AI秘書: 招待リンクを発行しました 🔗
       https://app.tomoniwao.jp/i/abc123
       田中さんにこのリンクを共有してください。
```

### 6.2 プール予約（happy path）

```
ユーザー: 営業チームで予約受付を始めたい
AI秘書: 予約受付グループを作成しますね。
       担当メンバーは誰ですか？

ユーザー: 田中さんと佐藤さん
AI秘書: 営業チームの予約受付を作成しました。
       ・担当: 田中さん、佐藤さん
       ・公開リンク: https://app.tomoniwao.jp/pool/xyz789
       このリンクを共有すると、他の人が予約できるようになります。
```

### 6.3 つながり申請（happy path）

```
ユーザー: [名刺画像を送信]
AI秘書: 名刺を読み取りました。
       田中太郎さん（tanaka@example.com）を登録しますか？

ユーザー: はい、仕事仲間として登録して
AI秘書: 田中太郎さんを連絡先に登録しました。
       仕事仲間として申請を送信しますか？

ユーザー: お願いします
AI秘書: 仕事仲間の申請を送信しました。
       田中さんが承諾すると、カレンダーの空き情報が共有されます。
```

### 6.4 エラーハンドリング

```
ユーザー: 打ち合わせしたい
AI秘書: 誰との打ち合わせですか？
       相手の名前を教えてください。

ユーザー: えーと、忘れた
AI秘書: 大丈夫です。相手が決まったらまた教えてくださいね。
       連絡先一覧から選ぶこともできますよ。
```

---

## 7. 不足している会話パターン（TODO）

### 7.1 未実装インテント

| インテント | 説明 | 優先度 |
|-----------|------|--------|
| schedule.cancel | 確定済み予定のキャンセル | P1 |
| schedule.modify | 確定済み予定の変更 | P1 |
| pool_booking.cancel | 予約キャンセル | P1 |
| pool_booking.reassign | 担当者変更 | P2 |
| contact.merge | 重複連絡先の統合 | P2 |

### 7.2 未整備の会話フロー

| フロー | 説明 | 優先度 |
|--------|------|--------|
| 票割れ時の誘導 | 候補が割れた場合の再提案フロー | P1 |
| 全員辞退時 | 全員が辞退した場合の再調整誘導 | P1 |
| 期限切れ通知 | 招待の期限切れ時の対応 | P2 |
| プロアクティブ提案 | 「そろそろ確認しますか？」等 | P3 |

---

## 8. クラリフィケーション（不足情報の確認）

### 8.1 各インテントのクラリファイルール

| インテント | 不足時の質問 |
|-----------|-------------|
| schedule.1on1.* | 「誰との予定ですか？」「いつの予定ですか？」 |
| invite.prepare.* | 「宛先を教えてください」 |
| list.add_member | 「どのリストに追加しますか？」「メールアドレスを教えてください」 |

### 8.2 デフォルト値

| パラメータ | デフォルト値 |
|-----------|-------------|
| duration | 60分 |
| timezone | Asia/Tokyo |
| prefer | afternoon（午後） |
| candidate_count | 3 |
| send_via | share_link |

---

## 9. 関連ドキュメント

- `intent_catalog.json` - インテント定義（SSOT）
- `CONV_CHAT_DESIGN.md` - 雑談対応設計
- `AI_CONVERSATIONAL_ROADMAP.md` - AI会話化ロードマップ
- `PEOPLE_DOMAIN_GLOSSARY.md` - 連絡先/リスト/つながりの定義

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-06 | 初版作成（インテント体系の整理） |
