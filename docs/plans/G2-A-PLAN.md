# G2-A-PLAN v1.0: Pool Booking（N対1 / 誰か1人に割当）

## Status: DRAFT
- Created: 2026-02-01
- Author: AI Developer + モギモギ（関屋紘之）
- Decision: Pending approval

---

## 0. ゴール

**「担当者プール（N人）に対して申込が来たら、空いている誰か1人に自動で割り当て、予定を成立させる」**

### 典型例
- ライフプランナー10人のカレンダーを束ねて公開
- 顧客が枠を選ぶと、空いている担当者に自動アサイン
- 担当者には「割り当てられました」通知が届く

### G1（1対N）との違い

| 観点 | G1（1対N） | G2-A（N対1 Pool） |
|------|-----------|------------------|
| 方向 | 主催者→N人 | N人の枠←申込者 |
| 確定の核 | slot が確定 → thread 確定 | slot が確定 → **assignment** 確定 |
| 成立条件 | 全員/定足/必須 | **誰か1人が空いてればOK** |
| 割当 | なし | **自動ルーティング（round-robin等）** |

---

## 1. N対1 の2系統（G2-A vs G2-B）

N対1 を混ぜると破綻するため、最初から分離：

### G2-A: Pool Booking（誰か1人でOK）← 本計画書
- 「10人のうち誰でもいい」
- 申込 → 自動割当（ルーティング/アサインがコア）
- **MVP で実装**

### G2-B: Group Availability（全員/定足/必須）← 別計画
- 「全員が空いてる枠」「3人以上」「キーパーソン必須」
- freebusy intersection と成立条件がコア
- G1 の拡張として後で実装

---

## 2. 用語定義

| 用語 | 説明 |
|------|------|
| **Pool** | 担当者の集合（例: ライフプランナー10人） |
| **Pool Member** | プールに所属するユーザー（担当者候補） |
| **Pool Slot** | プール全体として公開する申込枠 |
| **Booking** | 申込（顧客/社内ユーザーが行う） |
| **Assignment** | 申込を特定メンバーへ割り当てること |
| **Routing Policy** | 割当アルゴリズム（round-robin 等） |

---

## 3. MVP スコープ（削りに削る）

### 含む
- workmate グループのみ（stranger 不可）
- モード: pool（誰か1人）のみ
- 割当戦略: **round-robin 固定**
- 成立条件: 1枠 = 1担当
- 公開: 内部トークンのみ（ログイン前提）
- 通知: inbox のみ（メール/Slack は後）

### 含まない（G2-A.1 以降）
- 外部（未ログイン）からの申込
- 複数割当戦略（least-loaded, skill-based 等）
- キャンセル時の再割当
- 公開URL（TimeRex型の外部公開）
- メール/Slack 通知

---

## 4. 成立フロー（図で1本）

```
┌─────────────────────────────────────────────────────────────────┐
│                      Pool Booking Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Pool 作成          2. Member 追加        3. Slot 生成       │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐        │
│  │ POST     │         │ POST     │         │ POST     │        │
│  │ /pools   │ ──────> │ /pools/  │ ──────> │ /pools/  │        │
│  │          │         │ :id/     │         │ :id/     │        │
│  │          │         │ members  │         │ generate │        │
│  └──────────┘         └──────────┘         └──────────┘        │
│       │                    │                    │               │
│       v                    v                    v               │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐        │
│  │ pools    │         │ pool_    │         │ pool_    │        │
│  │          │         │ members  │         │ slots    │        │
│  └──────────┘         └──────────┘         └──────────┘        │
│                                                 │               │
│  ════════════════════════════════════════════════════════════  │
│                                                 │               │
│  4. 申込（Book）                                v               │
│  ┌──────────┐         ┌──────────────────────────────────┐     │
│  │ POST     │         │          Booking Process          │     │
│  │ /pools/  │ ──────> │                                   │     │
│  │ :id/book │         │  4a. Reserve slot (CAS lock)      │     │
│  └──────────┘         │       ↓                           │     │
│                       │  4b. Find available member        │     │
│                       │       (round-robin)               │     │
│                       │       ↓                           │     │
│                       │  4c. Create assignment            │     │
│                       │       ↓                           │     │
│                       │  4d. Notify assignee (inbox)      │     │
│                       │       ↓                           │     │
│                       │  4e. Return booking result        │     │
│                       └──────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 割当アルゴリズム v1（round-robin）

### なぜ round-robin か
- **公平**: 全員に均等に割り当たる
- **説明しやすい**: 「順番に回る」で運用者が納得
- **事故りにくい**: 複雑なロジックがない

### アルゴリズム詳細

```
function assignMember(pool_id, slot) {
  // 1. その枠に空いているメンバーを取得
  candidates = getAvailableMembers(pool_id, slot.start_at, slot.end_at)
  
  if (candidates.length === 0) {
    return { success: false, reason: 'no_available_member' }
  }
  
  // 2. round-robin: 最後に割り当てられた順番を見て、次の人
  lastAssignee = getLastAssignedMember(pool_id)
  nextIndex = (lastAssignee.order + 1) % candidates.length
  
  // 3. 候補の中で次の順番の人を選ぶ
  assignee = candidates.sort(by: order).find(c => c.order >= nextIndex)
             || candidates[0]  // wrap around
  
  return { success: true, assignee_user_id: assignee.user_id }
}
```

### 空き判定（MVP）
- Google Calendar 連携済みの場合: freebusy API で判定
- 未連携の場合: 常に空きとみなす（MVP では許容）

---

## 6. 競合防止（必須）

### 問題
- 同じ枠に同時に2人が申込 → 二重割当のリスク

### 解決策: 2段階 Reserve → Assign

```sql
-- Step 1: Reserve (CAS lock)
INSERT INTO pool_slot_reservations (id, pool_slot_id, booking_id, reserved_at, expires_at)
VALUES (?, ?, ?, datetime('now'), datetime('now', '+2 minutes'))
ON CONFLICT (pool_slot_id) DO NOTHING;

-- 成功した場合のみ Step 2 へ
-- 失敗 = 既に誰かが予約中 → 409 Conflict

-- Step 2: Assign (予約成功後)
UPDATE pool_slots SET status = 'booked' WHERE id = ? AND status = 'reserved';
INSERT INTO pool_bookings (...) VALUES (...);
```

### TTL（Time To Live）
- 予約は2分で失効
- cron で expired reservations を掃除

---

## 7. データモデル（最小）

### 7.1 pools

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT | UUID |
| workspace_id | TEXT | FK |
| owner_user_id | TEXT | 作成者 |
| name | TEXT | プール名 |
| timezone | TEXT | タイムゾーン |
| business_hours_json | TEXT | 営業時間帯（JSON） |
| slot_duration_minutes | INTEGER | 1枠の長さ（デフォルト: 30） |
| routing_policy | TEXT | 'round_robin'（MVP固定） |
| is_active | INTEGER | 有効フラグ |
| created_at | TEXT | 作成日時 |
| updated_at | TEXT | 更新日時 |

### 7.2 pool_members

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT | UUID |
| pool_id | TEXT | FK |
| user_id | TEXT | FK |
| role | TEXT | 'member' \| 'admin' |
| order | INTEGER | round-robin 順序 |
| is_active | INTEGER | 有効フラグ |
| created_at | TEXT | 作成日時 |

### 7.3 pool_slots

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT | UUID |
| pool_id | TEXT | FK |
| start_at | TEXT | 開始日時 |
| end_at | TEXT | 終了日時 |
| timezone | TEXT | タイムゾーン |
| status | TEXT | 'open' \| 'reserved' \| 'booked' \| 'cancelled' |
| capacity | INTEGER | 定員（MVP: 1固定） |
| created_at | TEXT | 作成日時 |

### 7.4 pool_slot_reservations

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT | UUID |
| pool_slot_id | TEXT | FK + UNIQUE |
| booking_id | TEXT | 申込ID |
| reserved_at | TEXT | 予約日時 |
| expires_at | TEXT | 失効日時（2分後） |

### 7.5 pool_bookings

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT | UUID |
| pool_id | TEXT | FK |
| pool_slot_id | TEXT | FK |
| requester_user_id | TEXT | 申込者 |
| assignee_user_id | TEXT | 割当先 |
| status | TEXT | 'pending' \| 'booked' \| 'failed' \| 'cancelled' |
| failure_reason | TEXT | 失敗理由（nullable） |
| customer_name | TEXT | 顧客名（nullable） |
| note | TEXT | メモ（nullable） |
| created_at | TEXT | 作成日時 |
| updated_at | TEXT | 更新日時 |

### business_hours_json 例

```json
{
  "monday": [{"start": "09:00", "end": "12:00"}, {"start": "13:00", "end": "18:00"}],
  "tuesday": [{"start": "09:00", "end": "18:00"}],
  "wednesday": [{"start": "09:00", "end": "18:00"}],
  "thursday": [{"start": "09:00", "end": "18:00"}],
  "friday": [{"start": "09:00", "end": "17:00"}],
  "saturday": [],
  "sunday": []
}
```

---

## 8. API 設計（MVP）

### 管理側

| Endpoint | Method | 説明 |
|----------|--------|------|
| `/api/pools` | POST | プール作成 |
| `/api/pools/:id` | GET | プール詳細 |
| `/api/pools/:id` | PATCH | プール更新 |
| `/api/pools/:id/members` | POST | メンバー追加 |
| `/api/pools/:id/members/:userId` | DELETE | メンバー削除 |
| `/api/pools/:id/generate-slots` | POST | 枠生成（期間・営業時間帯から） |
| `/api/pools/:id/slots` | GET | 枠一覧 |

### 申込側

| Endpoint | Method | 説明 |
|----------|--------|------|
| `/api/pools/:id/available-slots` | GET | 空き枠一覧（申込者向け） |
| `/api/pools/:id/book` | POST | 申込（slot_id 指定） |

### 通知

| Endpoint | Method | 説明 |
|----------|--------|------|
| (inbox 経由) | - | 割当完了通知 |

---

## 9. inbox 通知（type 追加）

| type | 対象 | タイトル | action_url |
|------|------|----------|------------|
| `pool_booking_assigned` | assignee | 「予約が割り当てられました」 | `/pools/:poolId/bookings/:bookingId` |
| `pool_booking_confirmed` | requester | 「予約が確定しました」 | `/pools/:poolId/bookings/:bookingId` |
| `pool_booking_failed` | requester | 「予約できませんでした」 | `/pools/:poolId` |

---

## 10. UI 設計（MVP）

### Pool 管理ページ
- プール作成フォーム（名前、営業時間帯、枠の長さ）
- メンバー追加（workmate 検索 → 追加）
- 枠生成（期間指定 → 一括生成）

### 枠一覧ページ
- カレンダー or リスト形式
- status 表示（open / reserved / booked）

### 申込画面（内部ユーザー向け）
- 空き枠一覧（open のみ表示）
- 枠クリック → 確認 → 申込

### 確定後
- assignee: inbox に通知、カレンダーに表示
- requester: inbox に通知、担当者名表示

---

## 11. E2E テスト（MVP）

### G2-A-E2E-1: 基本フロー
1. Pool 作成（5人メンバー）
2. 枠生成（10枠）
3. 申込 → 成功 → assignee に通知
4. 同じ枠に再申込 → 409 Conflict

### G2-A-E2E-2: round-robin 検証
1. 5人 Pool
2. 5回申込 → 各メンバーに1回ずつ割当
3. 6回目 → 最初のメンバーに戻る

### G2-A-E2E-3: 空きなし
1. メンバー全員が freebusy で埋まっている枠
2. 申込 → 失敗（no_available_member）

---

## 12. PR 分割

| PR | 内容 | 優先度 |
|----|------|--------|
| PR-G2-A-PLAN | この企画書を docs/plans/ へ | High |
| PR-G2-A-DB | テーブル作成（pools, pool_members, pool_slots, pool_bookings, pool_slot_reservations） | High |
| PR-G2-A-API | CRUD + book + reservation | High |
| PR-G2-A-FE | Pool管理 + 申込UI + 通知 | Medium |
| PR-G2-A-E2E | 基本フロー + round-robin + 競合 | Medium |

---

## 13. N1-MVP との関係

> **N1-MVP（inbox に依頼が積まれる軽量版）は、G2-A の「通知モード」として自然に内包される**

### なぜ別途 N1-MVP を作らないか
- G2-A では「申込 → 自動割当 → inbox 通知」が標準フロー
- N1-MVP の「依頼を受けて処理する」は、G2-A の `pool_booking_assigned` 通知と同等
- G2-A を作れば、「手動割当モード」を追加するだけで N1-MVP 相当になる

### 将来の拡張
- `routing_policy = 'manual'` を追加 → 管理者が手動で assignee を選ぶ
- これが N1-MVP の「inbox で処理する」体験と同等

---

## 14. Decision（承認待ち）

| # | Decision | Status |
|---|----------|--------|
| 1 | N対1 は Pool Booking（G2-A）から始める | ⏳ Pending |
| 2 | MVP は workmate のみ、外部は G2-A.1 へ | ⏳ Pending |
| 3 | 割当戦略は round-robin 固定（MVP） | ⏳ Pending |
| 4 | 競合防止は Reserve → Assign の2段階 | ⏳ Pending |

---

## 15. リスクとガード

### 競合（二重割当）
- **ガード**: pool_slot_reservations の UNIQUE 制約 + CAS

### スパム
- **ガード**: 申込レート制限（1ユーザー/1日/1Pool あたり N件）

### 担当者の空き判定ミス
- **ガード**: MVP では「未連携 = 常に空き」。G2-A.1 で強制連携を検討

### 割当の公平性
- **ガード**: round-robin で均等。ログで検証可能

---

## Appendix: G2-B（Group Availability）との違い

| 観点 | G2-A (Pool) | G2-B (Group) |
|------|-------------|--------------|
| 目的 | 誰か1人に割当 | 全員/定足の空き |
| 成立条件 | assignee が決まれば成立 | finalize_policy（G1と同じ） |
| アルゴリズム | round-robin / least-loaded | freebusy intersection |
| 複雑度 | 中 | 高 |
| 実装順 | **先（MVP）** | 後（G2-B） |
