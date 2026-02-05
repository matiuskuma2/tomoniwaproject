# SSOT ドメインマッピング表

最終更新日: 2026-02-05
ステータス: 確定（SSOT準拠）

---

## 1. 概要

本ドキュメントは、ToMoniWaoのドメインモデルとUI画面のSSOT（Single Source of Truth）対応を定義する。

### 用語定義

| 記号 | 名称 | 説明 |
|------|------|------|
| **G1** | 1対1調整 | 主催者と参加者1名の日程調整 |
| **G2-A** | 1対N調整（候補選択型） | 主催者と複数参加者の投票型調整 |
| **G2-B** | 1対N調整（申込式） | 先着順のオープンスロット型調整 |
| **G2-C** | N対1調整（プール予約） | 複数予約者が1つのプールから予約 |
| **D0** | 関係性管理 | 仕事仲間/家族の関係性定義 |

---

## 2. ドメインモデル → API マッピング

### 2.1 スレッド（Thread）

| ドメイン | DB テーブル | API エンドポイント |
|---------|------------|-------------------|
| スレッド作成 | `scheduling_threads` | `POST /api/threads` |
| スレッド取得 | `scheduling_threads` | `GET /api/threads/:id` |
| スレッド一覧 | `scheduling_threads` | `GET /api/threads` |
| ステータス取得 | `scheduling_threads` + joins | `GET /api/threads/:id/status` |
| 日程確定 | `scheduling_threads` | `POST /api/threads/:id/finalize` |

### 2.2 スロット（Slot）

| ドメイン | DB テーブル | API エンドポイント |
|---------|------------|-------------------|
| スロット追加 | `scheduling_slots` | `POST /api/threads/:id/slots` |
| スロット一覧 | `scheduling_slots` | (status API に含まれる) |

### 2.3 招待（Invite）

| ドメイン | DB テーブル | API エンドポイント |
|---------|------------|-------------------|
| 招待作成 | `thread_invites` | (スレッド作成時 or batch) |
| 招待一覧 | `thread_invites` | (status API に含まれる) |
| 招待応答 | `thread_invites` + `thread_selections` | `POST /i/:token/respond` |

### 2.4 プール（Pool）

| ドメイン | DB テーブル | API エンドポイント |
|---------|------------|-------------------|
| プール作成 | `pools` | `POST /api/pools` |
| プール取得 | `pools` | `GET /api/pools/:id` |
| プール一覧 | `pools` | `GET /api/pools` |
| スロット追加 | `pool_slots` | `POST /api/pools/:id/slots` |
| 予約 | `pool_bookings` | `POST /api/pools/:id/book` |
| 予約キャンセル | `pool_bookings` | `DELETE /api/pool-bookings/:id` |

### 2.5 関係性（Relationship）

| ドメイン | DB テーブル | API エンドポイント |
|---------|------------|-------------------|
| 申請 | `relationship_requests` | `POST /api/relationships/request` |
| 承認 | `relationships` | `POST /api/relationships/accept/:token` |
| 辞退 | `relationship_requests` | `POST /api/relationships/decline/:token` |
| 一覧 | `relationships` | `GET /api/relationships` |
| 検索 | `users` + `relationships` | `GET /api/relationships/search` |

---

## 3. UI画面 → API マッピング

### 3.1 チャット画面（ChatPage）

| UI コンポーネント | データソース | API |
|-----------------|------------|-----|
| `ThreadsList` | スレッド一覧 | `GET /api/threads` |
| `ChatPane` | チャット履歴 | (ローカル state) |
| `CardsPane` | スレッドステータス | `GET /api/threads/:id/status` |
| `NotificationBell` | 通知一覧 | `GET /api/inbox` |

### 3.2 右ペイン カード（CardsPane）

| カード | 表示条件 | データソース |
|--------|---------|------------|
| `ThreadStatusCard` | 常時 | `status.thread` |
| `InvitesCard` | 招待者あり | `status.invites` |
| `SlotsCard` | スロットあり | `status.slots` |
| `MeetCard` | 確定時 | `status.meeting` |
| `CalendarTodayCard` | カレンダー連携時 | Calendar API |

### 3.3 トポロジー別 カード切り替え（ThreadCardsSwitch）

| トポロジー | mode | 表示カード |
|-----------|------|-----------|
| `one_on_one` (G1) | `fixed` | ThreadStatusCard + InvitesCard + SlotsCardOneOnOne + MeetCard |
| `one_to_many` (G2-A) | `candidates` | ThreadStatusCard + InvitesCard + SlotsCardCandidates + MeetCard |
| `one_to_many` (G2-B) | `open_slots` | ThreadStatusCard + InvitesCard + SlotsCardOpenSlots + MeetCard |
| `many_to_one` (G2-C) | `pool_booking` | PoolStatusCard + PoolSlotsCard + PoolBookingsCard |

---

## 4. ThreadViewModel（SSOT）

### 4.1 定義

```typescript
// frontend/src/core/models/threadViewModel.ts
interface ThreadViewModel {
  // 基本情報
  threadId: string;
  title: string;
  status: ThreadStatus;
  
  // トポロジーとモード（SSOT）
  topology: 'one_on_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  mode: 'fixed' | 'candidates' | 'open_slots' | 'pool_booking';
  
  // 派生データ
  invitees: InviteeViewModel[];
  slots: SlotViewModel[];
  meetingUrl?: string;
}
```

### 4.2 トポロジー推論ロジック

```typescript
function inferTopologyAndMode(status: ThreadStatus_API): { topology, mode } {
  // 1. プール予約かどうか
  if (status.pool_id || status.thread.mode === 'pool_booking') {
    return { topology: 'many_to_one', mode: 'pool_booking' };
  }
  
  // 2. 招待者数で判定
  const inviteCount = status.invites?.length || 0;
  
  if (inviteCount <= 1) {
    return { topology: 'one_on_one', mode: 'fixed' };
  }
  
  // 3. モードで判定
  const threadMode = status.thread.mode;
  
  if (threadMode === 'open_slots') {
    return { topology: 'one_to_many', mode: 'open_slots' };
  }
  
  // デフォルト: 候補選択型
  return { topology: 'one_to_many', mode: 'candidates' };
}
```

---

## 5. 状態遷移

### 5.1 スレッド状態

```
draft → active → confirmed
          ↓
       cancelled
```

| 状態 | 説明 | 遷移条件 |
|------|------|---------|
| `draft` | 下書き | 作成直後 |
| `active` | 募集中 | 招待送信後 |
| `confirmed` | 確定済み | finalize 後 |
| `cancelled` | キャンセル | cancel 後 |

### 5.2 招待状態

```
pending → accepted
    ↓
declined
```

| 状態 | 説明 |
|------|------|
| `pending` | 未返信 |
| `accepted` | 承諾（スロット選択済み） |
| `declined` | 辞退 |

### 5.3 プール予約状態

```
pending → confirmed → cancelled
    ↓
rejected
```

---

## 6. データフロー図

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   ChatPane  │────▶│ apiExecutor │────▶│   API       │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  ThreadVM   │◀────│   Cache     │◀────│     DB      │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│ CardsPane   │
│ (UI表示)    │
└─────────────┘
```

---

## 7. 関連ドキュメント

- `NOTIFICATION_SYSTEM_PLAN.md` - 通知システム設計
- `NOTIFICATION_CHANNEL_RULES.md` - 通知チャネルルール
- `DATABASE_SCHEMA.md` - DBスキーマ
- `API_SPECIFICATION.md` - API仕様

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-05 | 初版作成（G1/G2/D0マッピング） |
