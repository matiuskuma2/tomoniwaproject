# Phase R1: 仕事仲間同士の日程調整体験

**Status**: Planning  
**Version**: 2026-01-29 v1.0  
**Dependencies**: Phase D-1 完了（PR #65-#77）

---

## 1. 概要

### 1.1 目的
workmate（仕事仲間）同士がアプリ内で日程調整できる体験を実装する。

### 1.2 前提条件
- D-1 で「つながり」土台が完成済み
  - ユーザー検索 → 申請 → 承認 → workmate/family 関係成立
  - `view_freebusy` 権限で相手の空き情報を取得可能
  - `RelationshipAccessService` で権限チェック済み
- 既存資産
  - `freebusyBatch.ts`: 複数参加者の busy 取得 + intersection 計算
  - `slotGenerator.ts`: 共通空き枠生成
  - `slotScorer.ts`: 参加者の好みに基づくスコアリング
  - `inbox` テーブル + `InboxRepository`: 通知基盤

### 1.3 R1 で実現する体験（ユーザーストーリー）
1. **US-R1-1**: workmate として「つながった」相手を「参加者」として選択できる
2. **US-R1-2**: 双方の freebusy intersection で共通の空き候補を提案される
3. **US-R1-3**: 相手へベル通知で日程調整の依頼が届く
4. **US-R1-4**: 相手が候補から選択すると日程が確定し、双方に通知される

---

## 2. システム設計

### 2.1 データフロー
```
[主催者: User A]
      |
      v
 1. POST /api/scheduling/internal
    { participants: [userId_B], prefer, duration, range }
      |
      v
 2. freebusyBatch.getBatchFreeBusy()
    - User A (self) の busy 取得
    - User B (app_user) の busy 取得
    - ※ view_freebusy 権限チェック済み
      |
      v
 3. mergeBusyUnion() → generateAvailableSlots()
    共通空き枠を生成
      |
      v
 4. scheduling_threads 作成
    - type: 'internal' (新規フラグ)
    - participants: app_user IDs
      |
      v
 5. inbox に通知追加
    - user_id: User B
    - type: 'scheduling_request_received'
    - action_url: '/scheduling/:threadId'
      |
      v
[受信者: User B]
      |
      v
 6. NotificationBell に表示
    「○○さんから日程調整の依頼が届きました」
      |
      v
 7. 候補選択 → POST /api/threads/:id/respond
    { selected_slot_id }
      |
      v
 8. thread 確定処理
    - thread.status = 'confirmed'
    - Google Calendar 登録（双方）
    - inbox に通知追加（主催者へ）
```

### 2.2 新規テーブル（不要 - 既存活用）
既存の `scheduling_threads` + `scheduling_slots` を活用。
差分は `scheduling_threads.type` カラム追加のみ。

#### Migration: 0074_add_thread_type.sql
```sql
-- scheduling_threads に type カラムを追加
-- 'external': 従来の外部招待（/i/:token）
-- 'internal': アプリ内日程調整（R1）
ALTER TABLE scheduling_threads ADD COLUMN type TEXT DEFAULT 'external';

-- インデックス追加
CREATE INDEX idx_scheduling_threads_type ON scheduling_threads(type);
```

### 2.3 API 設計

#### 2.3.1 POST /api/scheduling/internal（新規）
アプリ内ユーザー同士の日程調整を開始する。

**Request:**
```json
{
  "title": "1on1 ミーティング",
  "description": "週次の1on1",
  "participants": ["user-id-b"],
  "duration": 60,
  "range": "week",
  "prefer": "afternoon"
}
```

**Response:**
```json
{
  "success": true,
  "thread": {
    "id": "thread-xxx",
    "type": "internal",
    "status": "sent",
    "title": "1on1 ミーティング",
    "participants": [
      { "user_id": "user-id-b", "name": "山田太郎", "status": "pending" }
    ],
    "available_slots": [
      { "id": "slot-1", "start": "...", "end": "...", "score": 85 }
    ]
  },
  "notifications_sent": 1
}
```

**権限チェック:**
- 全参加者に対して `view_freebusy` 権限が必要
- 権限なし → 403 `{ error: 'no_permission', message: '...' }`

#### 2.3.2 GET /api/scheduling/internal/:threadId
調整中のスレッド情報を取得する（参加者のみ）。

**Response:**
```json
{
  "thread": {
    "id": "thread-xxx",
    "type": "internal",
    "status": "sent",
    "title": "1on1 ミーティング",
    "organizer": { "user_id": "...", "name": "..." },
    "participants": [...],
    "slots": [
      { "id": "slot-1", "start": "...", "end": "...", "score": 85, "selected_by": [] }
    ]
  }
}
```

#### 2.3.3 POST /api/scheduling/internal/:threadId/respond
参加者が候補を選択する。

**Request:**
```json
{
  "selected_slot_id": "slot-1"
}
```

**Response:**
```json
{
  "success": true,
  "thread_status": "confirmed",
  "confirmed_slot": {
    "id": "slot-1",
    "start": "2026-01-30T14:00:00+09:00",
    "end": "2026-01-30T15:00:00+09:00"
  },
  "calendar_events": [
    { "user_id": "...", "google_event_id": "..." }
  ]
}
```

### 2.4 通知タイプ（inbox.type）

| type | 対象 | 説明 |
|------|------|------|
| `scheduling_request_received` | 参加者 | 日程調整の依頼を受信 |
| `scheduling_request_confirmed` | 主催者 | 相手が日程を選択して確定 |
| `scheduling_request_declined` | 主催者 | 相手が辞退 |

#### 通知データ例
```json
{
  "type": "scheduling_request_received",
  "title": "日程調整の依頼",
  "message": "山田太郎さんから「1on1 ミーティング」の日程調整依頼が届きました",
  "action_type": "scheduling_respond",
  "action_target_id": "thread-xxx",
  "action_url": "/scheduling/thread-xxx",
  "priority": "high"
}
```

---

## 3. UI 設計

### 3.1 主催者側（日程調整開始）

#### 3.1.1 参加者選択 UI
- 「つながり」リストから workmate/family を選択
- 複数選択可能（R1 では 1:1 を優先、複数は将来）
- 権限がない相手は選択不可（グレーアウト）

```tsx
// components/ParticipantSelector.tsx
interface Props {
  onSelect: (userIds: string[]) => void;
  maxParticipants?: number;
}
```

#### 3.1.2 候補表示 UI
- 共通空き枠をカレンダー形式またはリスト形式で表示
- スコア上位を「おすすめ」マーク
- 「送信」ボタンで依頼を送信

### 3.2 受信者側（通知ベル）

#### 3.2.1 NotificationBell 拡張
- `scheduling_request_received` タイプを追加
- アクション: 「確認する」→ スレッド詳細へ遷移

```tsx
// 既存の NotificationBell.tsx を拡張
case 'scheduling_request_received':
  return (
    <div>
      <p>{item.message}</p>
      <button onClick={() => navigate(item.action_url)}>確認する</button>
    </div>
  );
```

#### 3.2.2 スレッド詳細ページ
- `/scheduling/:threadId`
- 候補一覧を表示
- 「この日程でOK」ボタンで選択 → 確定

---

## 4. 実装 PR 分割

### PR-R1-DB
**目的**: scheduling_threads に type カラム追加

**DoD:**
- [ ] Migration: 0074_add_thread_type.sql
- [ ] 既存データは type='external' にデフォルト
- [ ] TypeScript 型定義更新

### PR-R1-API
**目的**: 内部日程調整 API を実装

**DoD:**
- [ ] POST /api/scheduling/internal
- [ ] GET /api/scheduling/internal/:threadId
- [ ] POST /api/scheduling/internal/:threadId/respond
- [ ] inbox 通知作成
- [ ] 権限チェック（view_freebusy）
- [ ] TypeScript checks OK

### PR-R1-FE
**目的**: 日程調整 UI を実装

**DoD:**
- [ ] ParticipantSelector コンポーネント
- [ ] 共通空き枠表示 UI
- [ ] NotificationBell に scheduling_request 対応追加
- [ ] /scheduling/:threadId ページ
- [ ] キャッシュ更新（inbox, relationships）

### PR-R1-E2E
**目的**: 日程調整フローを E2E テスト

**DoD:**
- [ ] Fixture: 2 ユーザー + workmate 関係作成
- [ ] テスト: 依頼送信 → 通知受信 → 選択 → 確定
- [ ] 権限なしケース: 403

---

## 4.1 R1 完了条件（MVP DoD）

**最小限の完了条件（R1 MVP）:**
1. workmate 2人で「共通空き候補が3つ以上」表示される
2. 相手がアプリ内（NotificationBell → スレッド詳細）で候補を選択できる
3. 選択後、双方のアプリ内で「確定」が見える（スレッド詳細 / inbox 通知）

**R1.1 への先送り項目（MVP 外）:**
- 双方の Google Calendar への自動書き込み（R1 では主催者のみ、または手動）
- メール通知の併用
- 複数参加者（3人以上）対応
- リマインダー通知

---

## 5. 技術的考慮事項

### 5.1 既存資産の活用
```
freebusyBatch.ts
├── getBatchFreeBusy()     # 複数参加者の busy 取得
│   ├── D-1 権限チェック済み（view_freebusy）
│   ├── isThreadContext: true → 権限チェックスキップ（既存 R0 用）
│   ├── isThreadContext: false → 権限チェック実行（R1 用）
│   └── self/app_user/external の振り分け
└── getThreadParticipants() # スレッド参加者取得

※ R1 では isThreadContext=false で呼び出し、全参加者に view_freebusy 権限を要求

slotGenerator.ts
├── generateAvailableSlots() # 共通空き枠生成
└── getTimeWindowFromPrefer() # prefer → 時間帯

slotScorer.ts
└── scoreSlots()           # 参加者の好みでスコアリング
```

### 5.2 R1 と既存 Thread フローの違い

| 観点 | 既存（external） | R1（internal） |
|------|-----------------|----------------|
| 参加者 | メール招待（/i/:token） | アプリユーザー（user_id） |
| 権限 | なし（token で認証） | view_freebusy 必須 |
| 通知 | メール配信 | inbox（ベル通知） |
| busy 取得 | 主催者のみ | 全参加者 |
| 確定 | 主催者が手動確定 | 相手が選択で自動確定 |

### 5.3 将来拡張
- **複数参加者**: R1 は 1:1 優先、将来は N 人対応
- **リマインダー**: 確定日の前日に inbox 通知
- **Google Calendar 自動招待**: 確定時に参加者全員を招待者として追加

---

## 6. リスクと緩和策

| リスク | 影響 | 緩和策 |
|--------|------|--------|
| 相手が Google 未連携 | busy 取得不可 | 「連携を促すメッセージ」を表示、連携済みの参加者のみで計算 |
| 権限チェックの漏れ | セキュリティ問題 | 全 API エンドポイントで requirePermission() を呼び出し |
| inbox 通知の見落とし | UX 低下 | バッジ表示 + 高優先度マーク |

---

## 7. 成功指標

| 指標 | 目標 | 測定方法 |
|------|------|----------|
| 日程調整完了率 | 80%+ | confirmed / sent |
| 通知開封率 | 90%+ | inbox read_at |
| 確定までの時間 | 24h 以内 | confirmed_at - created_at |

---

## 8. 実装順序（推奨）

1. **PR-R1-DB**: Migration + 型定義（1 day）
2. **PR-R1-API**: API 実装（2-3 days）
3. **PR-R1-FE**: UI 実装（2-3 days）
4. **PR-R1-E2E**: テスト（1 day）

**合計見積もり**: 6-8 days

---

## 9. 参考資料

- [Phase D-1 計画書](./PHASE_D1_RELATIONS.md)
- [D-1 PR #65-#77](https://github.com/matiuskuma2/tomoniwaproject)
- [freebusyBatch.ts](../../apps/api/src/services/freebusyBatch.ts)
- [InboxRepository](../../apps/api/src/repositories/inboxRepository.ts)

---

## 更新履歴

| 日付 | バージョン | 内容 |
|------|-----------|------|
| 2026-01-29 | v1.0 | 初版作成 |
