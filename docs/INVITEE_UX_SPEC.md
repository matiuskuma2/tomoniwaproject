# Invitee UX Spec（誘われた側のユーザー体験仕様）

**Version**: v1.0  
**Status**: 確定（Phase Next-8 実装対象）  
**更新日**: 2026-01-01

---

## 📌 目的

tomo.niwaでは、**誘われた側（Invitee）**の体験を以下の2つに分ける：

1. **external（外部）**: リンク経由で候補から選ぶだけ（ログイン不要）
2. **work/team/family（内部）**: ログイン後、自分のカレンダーと連携

このドキュメントは、**誘われた側のUXと技術実装**を固定し、開発時の混乱を防ぐ。

---

## 🔑 Invitee の種類と体験

| 種類 | ログイン | カレンダー参照 | 体験 | 実装 |
|------|----------|----------------|------|------|
| **external** | **不要** | なし | リンク経由で候補選択 → 主催者が確定 | `/i/:schedule_id` |
| **work** | 必要 | free/busy のみ | スレッドで候補選択 → 承認待ち | `/threads/:id` |
| **team** | 必要 | full detail | スレッドで候補選択 → 自動確定 | `/threads/:id` |
| **family** | 必要 | full detail | スレッドで候補選択 → 自動確定 | `/threads/:id` |

---

## 🌐 External Invitee（外部リンク経由）

### 体験フロー

1. **リンク受信**: 主催者から `https://tomo.niwa/i/abc123` を受け取る（email / SMS / LINE）
2. **ページを開く**: ログイン不要で候補日時を表示
3. **候補を選択**: 「○」「△」「×」で回答（複数選択可）
4. **送信**: 名前とメールアドレスを入力して送信
5. **待機**: 主催者が確定するまで「確認中」状態
6. **確定通知**: 主催者が確定 → email で通知 + iCal添付

### UI仕様（スマホ優先）

```
┌─────────────────────────────┐
│  tomo.niwa                  │
│  山田さんとの打ち合わせ     │
├─────────────────────────────┤
│  以下の候補から選んでください│
│                             │
│  [ ] 1/15(月) 14:00-15:00   │
│  [x] 1/16(火) 10:00-11:00   │
│  [ ] 1/17(水) 16:00-17:00   │
│                             │
│  名前: [__________________] │
│  Email: [_________________] │
│                             │
│  [送信]                     │
└─────────────────────────────┘
```

### API

#### 候補取得
```
GET /api/invites/:schedule_id
Response:
{
  "schedule_id": "abc123",
  "title": "打ち合わせ",
  "host_name": "山田太郎",
  "slots": [
    { "id": "slot1", "start": "2026-01-15T14:00:00+09:00", "end": "...", "votes": 2 },
    { "id": "slot2", "start": "2026-01-16T10:00:00+09:00", "end": "...", "votes": 5 }
  ],
  "deadline": "2026-01-14T23:59:59+09:00"
}
```

#### 回答送信
```
POST /api/invites/:schedule_id/vote
Body:
{
  "guest_name": "佐藤花子",
  "guest_email": "sato@example.com",
  "votes": [
    { "slot_id": "slot1", "preference": "ok" },
    { "slot_id": "slot2", "preference": "maybe" }
  ]
}
Response:
{
  "status": "pending",
  "message": "主催者が確定するまでお待ちください"
}
```

### セキュリティ

- **公開範囲**: スケジュールIDを知っている人のみアクセス可能（UUID使用）
- **Rate Limit**: 同一IPから10分間に3回まで
- **スパム対策**: Turnstile（Cloudflare）を導入検討

---

## 👤 Internal Invitee（work/team/family）

### 体験フロー

1. **通知受信**: email / SMS / アプリ通知で「新しいスレッドに追加されました」
2. **ログイン**: tomo.niwaにログイン
3. **スレッド参加**: `/threads/:id` で候補を確認
4. **カレンダー連携**: 自分のGoogleカレンダーと照合（free/busy または full detail）
5. **候補選択**: 「○」「△」「×」で回答
6. **自動確定 or 承認待ち**:
   - **team/family**: 全員が投票完了 → 自動確定
   - **work**: 主催者が「確定」をクリック → 確定

### UI仕様（チャット上部バナー）

```
┌─────────────────────────────────────┐
│  🗓️ 候補日時を選んでください        │
│                                     │
│  [ ] 1/15(月) 14:00-15:00 (空いてます) │
│  [x] 1/16(火) 10:00-11:00 (空いてます) │
│  [ ] 1/17(水) 16:00-17:00 (予定あり)   │
│                                     │
│  [送信]                             │
└─────────────────────────────────────┘
```

### API

#### 候補取得（ログイン済み）
```
GET /api/threads/:thread_id/schedule
Response:
{
  "schedule_id": "abc123",
  "title": "打ち合わせ",
  "slots": [
    { "id": "slot1", "start": "...", "busy": false },
    { "id": "slot2", "start": "...", "busy": true }
  ],
  "my_votes": [...],
  "all_votes": [...]
}
```

#### 投票送信
```
POST /api/threads/:thread_id/schedule/vote
Body:
{
  "votes": [
    { "slot_id": "slot1", "preference": "ok" },
    { "slot_id": "slot2", "preference": "ng" }
  ]
}
```

---

## 🔐 同意とプライバシー

### External Invitee

- **必要な同意**: リンク経由の参加のみ（カレンダー参照なし）
- **データ収集**: 名前・メールアドレス・投票内容のみ
- **保持期間**: スケジュール確定後30日で削除

### Internal Invitee

- **必要な同意**:
  - **work**: `calendar_read`（free/busy） + `notification_sms`（任意）
  - **team**: `calendar_read`（full detail） + 共有カレンダー同意
  - **family**: 包括同意
- **データ収集**: カレンダー情報（free/busy or full detail）・投票内容・チャット履歴
- **保持期間**: ユーザーが削除するまで保持（または90日間未アクセスで要約化）

---

## 🚨 揉めポイント潰し

### Q1: external でもカレンダー連携したい人は？

→ **work に昇格**させる。external は「ツールを使わない相手」前提。

### Q2: external の人が「いつも使う」ようになったら？

→ **アカウント作成を促す** → work に昇格。

### Q3: external リンクが漏れたら？

→ **UUID使用 + Rate Limit + 締切後無効化**で対策。必要なら主催者がリンクを再生成可能。

### Q4: 投票後に「やっぱり変更したい」は？

→ **再投票可能**。締切前なら何度でも変更OK。

---

## 📋 Phase Next-8 DoD

- [ ] `/i/:schedule_id` ページ実装（ログイン不要）
- [ ] `POST /api/invites/:schedule_id/vote` 実装
- [ ] Rate Limit 実装（Cloudflare）
- [ ] スマホ表示確認（iPhone / Android）
- [ ] email 通知テンプレート作成（external 用）
- [ ] 実機テスト（external リンク → 投票 → 確定 → 通知）
- [ ] work/team の投票フロー実機テスト

---

## 📚 参照文書

- [PRODUCT_VISION_OS.md](./PRODUCT_VISION_OS.md)（v1.2-final）: 全体像と距離感の定義
- [RELATIONSHIP_POLICY.md](./RELATIONSHIP_POLICY.md)（v1.0）: 距離感と同意の設計
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)（v1.0）: Next-8 の実装計画

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（Next-8 確定版） | 開発チーム |
