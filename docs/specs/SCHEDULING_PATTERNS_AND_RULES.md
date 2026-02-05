# 日程調整パターン・ルール完全ガイド

> **最終更新**: 2026-02-05
> **対象バージョン**: main (commit d7ae20f)

このドキュメントは、Tomoniwaoの日程調整に関するすべてのパターン、ルール、制約を網羅しています。

---

## 目次

1. [調整パターン概要](#1-調整パターン概要)
2. [1対多調整 (Standard Thread)](#2-1対多調整-standard-thread)
3. [1対1調整 (One-on-One)](#3-1対1調整-one-on-one)
4. [追加候補機能](#4-追加候補機能)
5. [リマインド機能](#5-リマインド機能)
6. [確定通知フロー](#6-確定通知フロー)
7. [Pool Booking (G2-A)](#7-pool-booking-g2-a)
8. [関係性管理 (D0)](#8-関係性管理-d0)
9. [Intent分類ルール](#9-intent分類ルール)
10. [API エンドポイント一覧](#10-api-エンドポイント一覧)
11. [データベーススキーマ](#11-データベーススキーマ)
12. [制約・ガードレール](#12-制約ガードレール)

---

## 1. 調整パターン概要

### パターン一覧

| パターン | 説明 | 実装状況 |
|----------|------|----------|
| **1対多 (Thread)** | 主催者が複数の候補日を提示し、参加者が回答 | ✅ 完了 |
| **1対1 Fixed** | 確定日時での1対1調整 | ✅ 完了 |
| **1対1 Candidates** | 候補日提示での1対1調整 | ✅ 完了 |
| **1対1 Freebusy** | 空き時間自動検出での1対1調整 | ✅ 完了 |
| **Pool Booking** | 受付プールへの予約申込 | ✅ 完了 |
| **N対N** | 複数グループ間の調整 | ❌ 対象外 |

### フロー概念図

```
[チャット入力] → [Intent分類] → [Executor実行] → [API呼び出し] → [結果表示]
                     ↓
              pending_actions（確認フロー）
                     ↓
              [ユーザー決定] → [実行]
```

---

## 2. 1対多調整 (Standard Thread)

### 基本フロー

1. **スレッド作成** - タイトルと候補日を設定
2. **招待送信** - メールアドレス or リストで招待
3. **回答収集** - 参加者が○×△で回答
4. **確定** - 全員参加可能な日程を選択して確定

### 状態遷移

```
draft → sent → finalized
         ↓
       failed (期限切れ等)
```

### API

| エンドポイント | 説明 |
|---------------|------|
| `POST /api/threads` | スレッド作成 |
| `GET /api/threads` | スレッド一覧 |
| `GET /api/threads/:id` | スレッド詳細 |
| `POST /api/threads/:id/slots` | 候補日追加 |
| `POST /api/threads/:id/invites` | 招待追加 |
| `POST /api/threads/prepare-send` | 新規スレッド + 招待準備 |
| `POST /api/threads/:id/finalize` | 確定 |

### 招待準備フロー (Beta A)

```typescript
// 1. prepare-send で pending_action を生成
POST /api/threads/prepare-send
{
  "title": "ミーティング",
  "slots": [...],
  "invitees": ["a@example.com", "b@example.com"]
}

// 2. 3語決定
POST /api/pending-actions/:token/decide
{ "decision": "confirm" | "cancel" | "new_thread" }

// 3. 実行
POST /api/pending-actions/:token/execute
```

---

## 3. 1対1調整 (One-on-One)

### 3.1 Fixed (確定日時)

**ユースケース**: 「Aさんと来週木曜17時から1時間」

```typescript
POST /api/one-on-one/fixed/prepare
{
  "invitee": { "name": "Aさん", "email": "a@example.com" },
  "slot": { 
    "start_at": "2026-01-29T17:00:00+09:00", 
    "end_at": "2026-01-29T18:00:00+09:00" 
  },
  "title": "打ち合わせ"
}
```

**レスポンス**: 招待URL + pending_action

### 3.2 Candidates (候補日提示)

**ユースケース**: 「来週Aさんと会いたい、候補を3つ出して」

```typescript
POST /api/one-on-one/candidates/prepare
{
  "invitee": { "name": "Aさん", "email": "a@example.com" },
  "slots": [
    { "start_at": "...", "end_at": "..." },
    { "start_at": "...", "end_at": "..." },
    { "start_at": "...", "end_at": "..." }
  ],
  "title": "打ち合わせ"
}
```

### 3.3 Freebusy (空き時間自動検出)

**ユースケース**: 「来週で空いてる時間にAさんと会いたい」

```typescript
POST /api/one-on-one/freebusy/prepare
{
  "invitee": { "email": "a@example.com" },
  "duration_minutes": 60,
  "range": "next_week",
  "title": "打ち合わせ"
}
```

**制約**:
- 相手のカレンダーがGoogle連携されている必要あり
- プライバシー設定で freebusy 共有が許可されている必要あり

---

## 4. 追加候補機能

### 概要

回答が集まらない場合に、既存スレッドに候補日を追加する機能。

### 制約・ガードレール

| ルール | 説明 |
|--------|------|
| **最大2回まで** | `additional_propose_count <= 2` |
| **collecting状態のみ** | `status = 'sent'` の時のみ追加可能 |
| **既存回答は消さない** | 絶対条件 |
| **重複除外** | 同一 `start_at/end_at` は自動除外 |

### API

```typescript
// 1. 候補生成
POST /api/threads/:id/proposals/prepare
{
  "count": 3,           // 候補数
  "duration": 30,       // 分
  "range": "next_week"  // 範囲
}

// 2. 確認 → 実行
POST /api/pending-actions/:token/execute
{ "mode": "add_slots" }
```

### DB スキーマ

```sql
-- threads テーブル
additional_propose_count INTEGER DEFAULT 0;

-- slots テーブル
proposal_version INTEGER DEFAULT 1;  -- 追加時にインクリメント

-- selections テーブル
proposal_version_at_response INTEGER;  -- 回答時のバージョン記録
```

---

## 5. リマインド機能

### パターン

| Intent | 対象 | 説明 |
|--------|------|------|
| `remind.status` | 全般 | 未回答者の状況確認 |
| `remind.pending` | 未回答者 | リマインドメール送信 |
| `remind.need_response` | 特定の人 | 個別リマインド |

### API

```typescript
// リマインド送信
POST /api/threads/:id/remind
{
  "target": "all" | "pending" | ["email1", "email2"]
}
```

---

## 6. 確定通知フロー

### フロー

1. **日程確定** - `POST /api/threads/:id/finalize`
2. **通知生成**
   - Inbox 通知: 「【確定】スレッドタイトル」
   - メール通知: 確定日時 + Google Meet リンク（任意）
3. **カレンダー登録** - Google Calendar に自動登録（オプション）

### 確定条件

- 少なくとも1つの候補日で全員が○（参加可能）
- 主催者が明示的に確定操作を実行

---

## 7. Pool Booking (G2-A)

### 概要

受付プール（複数の担当者）への予約申込システム。

### エンティティ

```
Pool (受付プール)
  ├── Members (担当者たち)
  ├── Slots (受付枠)
  └── Bookings (予約)
```

### フロー

```
1. 管理者: Pool作成 → Member追加 → Slot作成
2. 申込者: Slot予約 (book)
3. システム: Round-Robin でアサイン
4. 通知: 担当者・管理者・申込者に通知
```

### API

| エンドポイント | 説明 |
|---------------|------|
| `POST /api/pools` | プール作成 |
| `POST /api/pools/:id/members` | メンバー追加 |
| `POST /api/pools/:id/slots` | 枠作成 |
| `POST /api/pools/:id/book` | 予約 |
| `GET /api/pools/:id/public-link` | 公開リンク取得 |
| `PATCH /api/pools/:id/bookings/:bookingId/cancel` | キャンセル |

### アサインメントアルゴリズム

**Round-Robin**:
```typescript
function getNextMemberRoundRobin(poolId) {
  const members = getActiveMembers(poolId);
  const lastAssigned = pool.last_assigned_member_id;
  
  if (!lastAssigned) return members[0];
  
  const lastIndex = members.findIndex(m => m.user_id === lastAssigned);
  const nextIndex = (lastIndex + 1) % members.length;
  
  return members[nextIndex];
}
```

### 状態遷移

```
Slot: open → reserved → booked
                ↓
             released (キャンセル時)
                ↓
              open (再公開)
```

### Chat Executor

| Intent | 説明 |
|--------|------|
| `pool_booking.book` | 予約実行 |
| `pool_booking.cancel` | 予約キャンセル |
| `pool_booking.list` | 予約一覧・空き枠確認 |
| `pool_booking.create` | プール作成（管理者） |

---

## 8. 関係性管理 (D0)

### 概要

ユーザー間の関係性（workmate/family）を管理し、機能アクセス制御の基盤とする。

### 関係タイプ

| タイプ | 説明 | 権限 |
|--------|------|------|
| `workmate` | 仕事仲間 | freebusy閲覧、予定調整 |
| `family` | 家族 | 詳細カレンダー閲覧 |

### フロー

```
1. A: 「BさんをWorkmateに追加」
2. システム: relation_invitations に招待作成
3. B: 通知受信 → 承諾/拒否
4. 承諾時: relationships に関係成立
```

### API

| エンドポイント | 説明 |
|---------------|------|
| `POST /api/relationships/request` | 関係申請 |
| `GET /api/relationships/pending` | 受信した申請一覧 |
| `POST /api/relationships/:token/accept` | 承諾 |
| `POST /api/relationships/:token/decline` | 拒否 |
| `GET /api/relationships` | 関係一覧 |
| `POST /api/relationships/block` | ブロック |

### Chat Executor

| Intent | 説明 |
|--------|------|
| `relation.request.workmate` | Workmate申請 |
| `relation.approve` | 申請承諾 |
| `relation.decline` | 申請拒否 |

---

## 9. Intent分類ルール

### 優先順位（固定）

```typescript
// classifier/index.ts の実行順序
1. pendingDecision    // pending_action がある場合
2. confirmCancel      // yes/no の確認
3. lists              // リスト5コマンド
4. calendar           // カレンダー読み取り
5. propose            // 候補提案
6. remind             // リマインド
7. thread             // スレッド操作
8. preference         // 設定変更
9. oneOnOne           // 1対1調整
10. relation          // 関係性管理
11. pool              // Pool Booking
12. unknown           // nlRouter fallback
```

### Intent タイプ一覧

```typescript
type IntentType = 
  // カレンダー
  | 'schedule.today'
  | 'schedule.week'
  | 'schedule.freebusy'
  | 'schedule.freebusy.batch'
  
  // スレッド
  | 'thread.create'
  | 'thread.status'
  | 'schedule.finalize'
  | 'schedule.invite.list'
  
  // 自動提案
  | 'schedule.auto_propose'
  | 'schedule.auto_propose.confirm'
  | 'schedule.auto_propose.cancel'
  
  // 追加候補
  | 'schedule.additional_propose'
  | 'schedule.additional_propose.confirm'
  | 'schedule.additional_propose.cancel'
  
  // リマインド
  | 'remind.status'
  | 'remind.pending'
  | 'remind.pending.confirm'
  | 'remind.pending.cancel'
  | 'remind.need_response'
  | 'remind.need_response.list'
  
  // 確定通知
  | 'schedule.notify.confirmed'
  | 'schedule.notify.confirmed.confirm'
  | 'schedule.notify.confirmed.cancel'
  
  // リスト
  | 'list.create'
  | 'list.list'
  | 'list.members'
  | 'list.add_member'
  | 'list.invite'
  
  // 1対1
  | 'one_on_one.fixed'
  | 'one_on_one.candidates'
  | 'one_on_one.freebusy'
  
  // 関係性 (D0)
  | 'relation.request.workmate'
  | 'relation.approve'
  | 'relation.decline'
  
  // Pool Booking (G2-A)
  | 'pool_booking.book'
  | 'pool_booking.cancel'
  | 'pool_booking.list'
  | 'pool_booking.create'
  
  // 設定
  | 'preference.set'
  | 'preference.show'
  | 'preference.clear'
  
  // 決定
  | 'pending.confirm'
  | 'pending.cancel'
  | 'pending.action.decide'
  
  // その他
  | 'unknown';
```

---

## 10. API エンドポイント一覧

### 認証

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| GET | `/auth/google/start` | 不要 | OAuth開始 |
| GET | `/auth/google/callback` | 不要 | OAuthコールバック |
| POST | `/auth/token` | 不要 | トークン取得 |
| GET | `/auth/me` | 必要 | ユーザー情報 |

### スレッド

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| POST | `/api/threads` | 必要 | スレッド作成 |
| GET | `/api/threads` | 必要 | スレッド一覧 |
| GET | `/api/threads/:id` | 必要 | スレッド詳細 |
| POST | `/api/threads/:id/slots` | 必要 | 候補追加 |
| POST | `/api/threads/:id/invites` | 必要 | 招待追加 |
| POST | `/api/threads/prepare-send` | 必要 | 新規+招待準備 |
| POST | `/api/threads/:id/finalize` | 必要 | 確定 |
| POST | `/api/threads/:id/remind` | 必要 | リマインド |

### Pending Actions

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| POST | `/api/pending-actions/:token/decide` | 必要 | 決定 |
| POST | `/api/pending-actions/:token/execute` | 必要 | 実行 |

### 1対1

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| POST | `/api/one-on-one/fixed/prepare` | 必要 | 確定日時調整 |
| POST | `/api/one-on-one/candidates/prepare` | 必要 | 候補日調整 |
| POST | `/api/one-on-one/freebusy/prepare` | 必要 | 空き時間調整 |

### Pool Booking

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| POST | `/api/pools` | 必要 | プール作成 |
| GET | `/api/pools` | 必要 | プール一覧 |
| GET | `/api/pools/:id` | 必要 | プール詳細 |
| POST | `/api/pools/:id/members` | 必要 | メンバー追加 |
| GET | `/api/pools/:id/members` | 必要 | メンバー一覧 |
| POST | `/api/pools/:id/slots` | 必要 | 枠作成 |
| GET | `/api/pools/:id/slots` | 必要 | 枠一覧 |
| POST | `/api/pools/:id/book` | 必要 | 予約 |
| GET | `/api/pools/:id/public-link` | 必要 | 公開リンク |
| PATCH | `/api/pools/:id/bookings/:bookingId/cancel` | 必要 | キャンセル |

### 関係性

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| POST | `/api/relationships/request` | 必要 | 関係申請 |
| GET | `/api/relationships/pending` | 必要 | 受信申請一覧 |
| POST | `/api/relationships/:token/accept` | 必要 | 承諾 |
| POST | `/api/relationships/:token/decline` | 必要 | 拒否 |
| GET | `/api/relationships` | 必要 | 関係一覧 |
| POST | `/api/relationships/block` | 必要 | ブロック |

### 招待（公開）

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| GET | `/i/:token` | 不要 | 招待ページ |
| POST | `/i/:token/respond` | 不要 | 回答送信 |

---

## 11. データベーススキーマ

### 主要テーブル

```sql
-- ユーザー
users (id, email, display_name, google_id, ...)

-- ワークスペース
workspaces (id, name, slug, owner_user_id, ...)

-- スレッド
threads (id, workspace_id, owner_user_id, title, status, 
         additional_propose_count, ...)

-- 候補日
slots (id, thread_id, start_at, end_at, label, proposal_version, ...)

-- 招待
invites (id, thread_id, email, status, token, ...)

-- 回答
selections (id, invite_id, slot_id, status, proposal_version_at_response, ...)

-- Pending Actions
pending_actions (id, user_id, type, status, confirm_token, 
                 expires_at, payload, ...)

-- 関係性
relationships (id, user_id, other_user_id, relation_type, status, ...)

-- 関係性招待
relation_invitations (id, inviter_user_id, invitee_user_id, 
                      requested_type, status, token, ...)

-- Pool
pools (id, workspace_id, owner_user_id, name, description, 
       public_link_token, last_assigned_member_id, ...)

-- Pool メンバー
pool_members (id, pool_id, user_id, join_order, ...)

-- Pool 枠
pool_slots (id, pool_id, start_at, end_at, status, 
            reserved_count, booked_count, ...)

-- Pool 予約
pool_bookings (id, pool_id, slot_id, requester_user_id, 
               assignee_user_id, assignment_algo, status, ...)

-- ブロック
blocks (id, user_id, blocked_user_id, reason, ...)
```

### マイグレーション履歴（主要）

| 番号 | ファイル | 説明 |
|------|----------|------|
| 0065 | create_pending_actions.sql | Beta A 確認フロー |
| 0066 | create_invite_deliveries.sql | 配信追跡 |
| 0084 | add_workmate_relation_type.sql | 関係タイプ追加 |
| 0088 | create_pool_booking.sql | Pool Booking テーブル |
| 0089 | add_last_assigned_member_id.sql | Round-Robin用 |
| 0090 | create_blocks_and_pool_public_links.sql | ブロック + 公開リンク |

---

## 12. 制約・ガードレール

### セキュリティ

| ルール | 説明 |
|--------|------|
| **テナント分離** | 全てのクエリに `workspace_id` 条件 |
| **認証必須** | `/api/*` は Bearer token 必須 |
| **公開招待は別パス** | `/i/:token` は認証不要、制限付き |

### ビジネスロジック

| ルール | 説明 |
|--------|------|
| **追加候補は2回まで** | `additional_propose_count <= 2` |
| **既存回答は消さない** | 追加候補でも保持 |
| **確定は全員参加可能な日のみ** | 少なくとも1つの候補で全員○ |
| **Round-Robin公平性** | `last_assigned_member_id` で追跡 |

### 運用

| ルール | 説明 |
|--------|------|
| **pending_action有効期限** | 24時間（設定変更可） |
| **招待トークン有効期限** | 7日間 |
| **スロット予約有効期限** | 5分（Reserve → Book） |

---

## 付録: チャット入力例 → Intent マッピング

### カレンダー

| 入力例 | Intent |
|--------|--------|
| 「今日の予定」 | `schedule.today` |
| 「今週の予定」 | `schedule.week` |
| 「来週の空き」 | `schedule.freebusy` |

### スレッド

| 入力例 | Intent |
|--------|--------|
| 「ミーティングを作成」 | `thread.create` |
| 「進捗を教えて」 | `thread.status` |
| 「確定して」 | `schedule.finalize` |

### リスト

| 入力例 | Intent |
|--------|--------|
| 「営業部リストを作って」 | `list.create` |
| 「リスト見せて」 | `list.list` |
| 「営業部リストのメンバー」 | `list.members` |
| 「aさんを営業部リストに追加」 | `list.add_member` |
| 「営業部リストに招待」 | `list.invite` |

### 1対1

| 入力例 | Intent |
|--------|--------|
| 「来週木曜17時にAさんと」 | `one_on_one.fixed` |
| 「来週Aさんと会いたい」 | `one_on_one.candidates` |
| 「Aさんと空いてる時間で」 | `one_on_one.freebusy` |

### Pool Booking

| 入力例 | Intent |
|--------|--------|
| 「予約したい」「申し込む」 | `pool_booking.book` |
| 「予約キャンセル」 | `pool_booking.cancel` |
| 「空き枠確認」「予約一覧」 | `pool_booking.list` |

### 関係性

| 入力例 | Intent |
|--------|--------|
| 「BさんをWorkmateに追加」 | `relation.request.workmate` |
| 「承認する」「受け入れる」 | `relation.approve` |
| 「拒否する」 | `relation.decline` |

---

*このドキュメントは定期的に更新されます。最新版は GitHub リポジトリを参照してください。*
