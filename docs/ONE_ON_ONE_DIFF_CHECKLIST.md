# 1対1（R0: 他人・カレンダー非共有）差分チェックシート

> **Version**: 2026-01-27（B-1完了）  
> **Status**: Phase B-1 完了、B-2〜B-4 未実装  
> **対象**: R0（他人）のみ。R1/R2は別フェーズ。

---

## 0. 前提定義

### 関係値（Relation）の定義

| 関係値 | 説明 | カレンダー共有 | 対応フェーズ |
|--------|------|---------------|-------------|
| **R0: Stranger（他人）** | 相手のカレンダー情報は一切見ない | なし | **今回の対象** |
| R1: Acquaintance（知人） | 共有許可がある状態 | あり | 将来フェーズ |
| R2: Family（家族） | 予定の自動投入に近い | あり | 将来フェーズ |

### 今回のスコープ

**R0（他人）で「候補3つ提示」「空き時間から候補生成」「別日希望→再提案」「TimeRex型」を実現する**

---

## 1. 現状で「できている」実装（v1 完了範囲）

> "固定1枠 → 送付（URL/Email） → 承諾/別日希望 → Thank you → 前日リマインド送信" は通っている

### 1-1. Intent / SSOT

| 項目 | ファイル | 状態 |
|------|---------|------|
| Intent定義 | [`docs/intent_catalog.json`](../docs/intent_catalog.json) | ✅ `schedule.1on1.fixed` |
| Frontend classifier | [`frontend/src/core/chat/classifier/oneOnOne.ts`](../frontend/src/core/chat/classifier/oneOnOne.ts) | ✅ |
| Frontend executor | [`frontend/src/core/chat/executors/oneOnOne.ts`](../frontend/src/core/chat/executors/oneOnOne.ts) | ✅ |
| API | [`apps/api/src/routes/oneOnOne.ts`](../apps/api/src/routes/oneOnOne.ts) | ✅ `POST /api/one-on-one/fixed/prepare` |

### 1-2. API

| API | ファイル | エンドポイント | 状態 |
|-----|---------|---------------|------|
| 固定1枠作成 | [`apps/api/src/routes/oneOnOne.ts`](../apps/api/src/routes/oneOnOne.ts) | `POST /api/one-on-one/fixed/prepare` | ✅ |
| 招待ページ | [`apps/api/src/routes/invite.ts`](../apps/api/src/routes/invite.ts) | `GET /i/:token` | ✅ |
| 回答 | 同上 | `POST /i/:token/respond` | ✅ |
| Thank you | 同上 | `GET /i/:token/thank-you` | ✅ |

### 1-3. Email送付（send_via=email）

| 項目 | ファイル | 関数/Type |
|------|---------|----------|
| Producer | [`apps/api/src/services/emailQueue.ts`](../apps/api/src/services/emailQueue.ts) | `type: 'one_on_one'` |
| Consumer | [`apps/api/src/queue/emailConsumer.ts`](../apps/api/src/queue/emailConsumer.ts) | `generateOneOnOneEmail` |
| Template | [`apps/api/src/utils/emailModel.ts`](../apps/api/src/utils/emailModel.ts) | `composeOneOnOneEmailModel` |

### 1-4. 前日リマインド

| 項目 | ファイル | 備考 |
|------|---------|------|
| DB定義 | [`db/migrations/0081_scheduled_reminders.sql`](../db/migrations/0081_scheduled_reminders.sql) | テーブル作成 |
| 承諾時に予約作成 | [`apps/api/src/routes/invite.ts`](../apps/api/src/routes/invite.ts) | respond内 |
| cron拾い | [`apps/api/src/scheduled/processReminders.ts`](../apps/api/src/scheduled/processReminders.ts) | 毎時実行 |
| cron呼び出し | [`apps/api/src/index.ts`](../apps/api/src/index.ts) | scheduled handler |
| 送信後DB更新 | [`apps/api/src/queue/emailConsumer.ts`](../apps/api/src/queue/emailConsumer.ts) | `scheduled_reminder_id` があればUPDATE |

---

## 2. 不足している1対1体験の差分（Phase B-1〜B-4）

### Phase概要

| Phase | 機能 | 概要 | 状態 |
|-------|------|------|------|
| **B-1** | 候補3つ提示 | 固定複数候補を作って相手に選ばせる | ✅ **完了** (2026-01-27) |
| **B-2** | 主催者freebusyから候補生成 | 主催者の空きだけから3候補を作る | ❌ 未実装 |
| **B-3** | 別日希望→再提案 | 最大2回の再提案、条件入力 | ⚠️ 部分実装 |
| **B-4** | TimeRex型（Open Slots） | 空き枠カレンダーを提示して選ばせる | ❌ 未実装 |

---

## Phase B-1: 候補3つ提示（固定複数候補） ✅ 完了

> 「来週木〜日 午後で3つ候補送って」= 候補3枠を作って相手に選ばせる  
> **2026-01-27 完了**: DB, API, Intent, テストフィクスチャ全て実装・デプロイ済み

### B-1-DB（差分）

#### 既存（流用可能）

| テーブル/カラム | ファイル | 用途 |
|----------------|---------|------|
| `scheduling_threads` | [`db/migrations/0001_init_core.sql`](../db/migrations/0001_init_core.sql) | スレッド管理 |
| `scheduling_slots` | [`db/migrations/0034_create_scheduling_slots.sql`](../db/migrations/0034_create_scheduling_slots.sql) | 候補枠（複数対応済み） |
| `proposal_version` | [`db/migrations/0067_add_proposal_version_to_threads.sql`](../db/migrations/0067_add_proposal_version_to_threads.sql) | 世代管理 |
| `additional_propose_count` | 同上 | 追加候補の実行回数 |

#### ✅ 追加済み（0082マイグレーション）

| カラム | テーブル | 型 | 用途 | 状態 |
|--------|---------|---|------|------|
| `slot_policy` | `scheduling_threads` | `TEXT` | `fixed_single` / `fixed_multi` / `freebusy_multi` / `open_slots` | ✅ |
| `constraints_json` | `scheduling_threads` | `TEXT` | `{"prefer":"afternoon","days":["thu","fri"],"duration":60}` | ✅ |

#### マイグレーション（適用済み）

```sql
-- db/migrations/0082_add_slot_policy_constraints_to_threads.sql ✅
ALTER TABLE scheduling_threads 
  ADD COLUMN slot_policy TEXT DEFAULT 'fixed_single'
  CHECK(slot_policy IN ('fixed_single', 'fixed_multi', 'freebusy_multi', 'open_slots'));

ALTER TABLE scheduling_threads 
  ADD COLUMN constraints_json TEXT;

CREATE INDEX IF NOT EXISTS idx_scheduling_threads_slot_policy
  ON scheduling_threads(slot_policy);
```

### B-1-API ✅ 実装済み

| 項目 | 詳細 | 状態 |
|------|------|------|
| **API** | `POST /api/one-on-one/candidates/prepare` | ✅ 本番デプロイ済み |
| **処理** | 1〜5候補を受け取り → `scheduling_slots` に複数INSERT → `thread_invites` 1本作成 → `share_url` を返す | ✅ |
| **実装** | [`apps/api/src/routes/oneOnOne.ts`](../apps/api/src/routes/oneOnOne.ts) | ✅ |

#### Request/Response（案）

```typescript
// Request
interface CandidatesPrepareRequest {
  invitee: { name: string; email?: string; contact_id?: string };
  candidates: Array<{ start_at: string; end_at: string }>;  // 3つ指定
  title?: string;
  message_hint?: string;
  send_via?: 'email' | 'share_link';
}

// Response
interface CandidatesPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
}
```

### B-1-UI（差分）

| 項目 | 状態 | 備考 |
|------|------|------|
| `multiSlotUI()` | ✅ 既存流用 | [`apps/api/src/routes/invite.ts:374`](../apps/api/src/routes/invite.ts) |
| 候補選択 | ✅ 既存流用 | ラジオボタンで選択 |
| 承諾/辞退 | ✅ 既存流用 | `selectSlot()` / `declineInvite()` |

### B-1-Intent ✅ 完全実装済み

| 項目 | ファイル | 状態 |
|------|---------|------|
| SSOT | [`docs/intent_catalog.json`](../docs/intent_catalog.json) | ✅ `schedule.1on1.candidates3` 追加済み |
| Classifier | [`frontend/src/core/chat/classifier/oneOnOne.ts`](../frontend/src/core/chat/classifier/oneOnOne.ts) | ✅ 複数候補検出ロジック実装済み（PR-B1-FE） |
| Executor | [`frontend/src/core/chat/executors/oneOnOne.ts`](../frontend/src/core/chat/executors/oneOnOne.ts) | ✅ `executeOneOnOneCandidates()` 実装済み |
| apiExecutor | [`frontend/src/core/chat/apiExecutor.ts`](../frontend/src/core/chat/apiExecutor.ts) | ✅ `schedule.1on1.candidates3` 分岐追加済み |
| Tests | [`frontend/src/core/chat/classifier/__tests__/oneOnOne.regression.test.ts`](../frontend/src/core/chat/classifier/__tests__/oneOnOne.regression.test.ts) | ✅ 13パターン回帰テスト |

#### Intent定義（案）

```json
{
  "intent": "schedule.1on1.candidates3",
  "category": "schedule.1on1",
  "description": "1対1で候補3つを提示して調整",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "1:1",
  "params_schema": {
    "invitee": { "type": "object", "required": true },
    "candidates": { "type": "array", "minItems": 2, "maxItems": 5, "required": true },
    "title": { "type": "string", "optional": true },
    "send_via": { "type": "string", "enum": ["share_link", "email"], "optional": true }
  },
  "executor": "frontend:executors/oneOnOne.ts::executeOneOnOneCandidates",
  "api": "POST /api/one-on-one/candidates/prepare",
  "examples": [
    "来週木〜日の午後で3つ候補を送って",
    "田中さんに3つ日程の選択肢を送りたい"
  ]
}
```

---

## Phase B-2: 主催者freebusyから候補生成

> 相手は他人なので **相手のfreebusyは見ない**。主催者のGoogleカレンダーだけ見て候補を作る。

### B-2-API（差分）

| 項目 | 詳細 |
|------|------|
| **新API** | `POST /api/one-on-one/freebusy/prepare` |
| **処理** | 主催者のfreebusy取得 → 空き枠生成 → 3候補選出 → invite発行 |

#### 流用可能な資産

| 資産 | ファイル | 関数 |
|------|---------|------|
| 空き枠生成 | [`apps/api/src/utils/slotGenerator.ts`](../apps/api/src/utils/slotGenerator.ts) | `generateAvailableSlots()` |
| freebusy取得 | [`apps/api/src/routes/calendar.ts`](../apps/api/src/routes/calendar.ts) | freebusy系エンドポイント |
| スコアリング | [`apps/api/src/utils/slotScorer.ts`](../apps/api/src/utils/slotScorer.ts) | `scoreSlots()` |

### B-2-Intent（差分）

| Intent | 説明 |
|--------|------|
| `schedule.1on1.freebusy` | 主催者の空きから候補を自動生成 |

---

## Phase B-3: 別日希望→再提案（最大2回）

> "別日希望"を辞退扱いで終わらせない。再提案の条件・回数制限が必要。

### B-3-UI（差分：重要）

| 項目 | 現状 | 必要な変更 |
|------|------|-----------|
| 別日希望ボタン | `singleSlotUI`: "別の日程を希望する" / `multiSlotUI`: "辞退する" | **統一 + 入力フォーム追加** |
| 入力フォーム | ❌ なし | モーダルで希望条件入力 |

#### 入力フォーム項目（案）

- 希望期間（来週/再来週/特定日）
- 時間帯（午前/午後/夕方/指定なし）
- NGコメント（任意）

### B-3-API（差分）

| 項目 | 詳細 |
|------|------|
| **新API** | `POST /i/:token/request-alternate` |
| **処理** | 希望条件を `constraints_json` に保存 → 再提案トリガー → `additional_propose_count` 更新 |

### B-3-ロジック（差分）

| 項目 | 既存 | 必要な変更 |
|------|------|-----------|
| `additional_propose_count` | ✅ カラム存在 | 1対1での利用ロジック追加 |
| `proposal_version` | ✅ カラム存在 | 再提案時に+1するロジック追加 |
| 最大2回制限 | ✅ 構造あり | 1対1用の判定追加 |
| 2回目でOpen Slots誘導 | ❌ なし | ルール実装が必要 |

---

## Phase B-4: TimeRex型（Open Slots）

> 1〜2週間分の空き枠を "カレンダー形式で提示" し、相手が選んで確定。

### B-4-UI（差分：新規UI）

| 項目 | 詳細 |
|------|------|
| 新UI | `openSlotsUI()` または別ファイル |
| 要件 | 予定そのものは見せない（空き枠だけ） / カレンダー形式で提示 |

### B-4-API（差分）

| API | 用途 |
|-----|------|
| `POST /api/one-on-one/open-slots/prepare` | Open Slots招待を発行 |
| `GET /api/one-on-one/open-slots/:token` | 公開枠一覧を取得（UI用） |
| `POST /i/:token/select-slot` | 枠を選択して確定 |

### B-4-DB（差分）

| 項目 | 詳細 |
|------|------|
| `slot_policy` | `open_slots` を使用 |
| slots数 | 大量（例: 80枠）になる可能性 |
| 確定処理 | 選ばれた枠以外をどうするか（削除 or 無効化） |

---

## 3. 矛盾・要確認事項

| # | 観点 | 現状 | 問題/確認事項 | 推奨対応 |
|---|------|------|--------------|---------|
| 1 | `thread.mode` | `one_on_one`/`group`/`public` | 1:1内の細分化が不可 | `slot_policy` カラム追加で解決 |
| 2 | 別日希望UI | 文言不統一 | `singleSlotUI`="別の日程を希望する" / `multiSlotUI`="辞退する" | B-3で統一（"別日希望"） |
| 3 | 再提案トリガー | `additional_propose` は1:N向け | 1:1に適用するか | B-3で専用ロジック追加 |
| 4 | email未知のケース | `invitee.email` optional | 再提案時の通知手段 | share_link必須 or メール入力促進 |
| 5 | constraints保存 | なし | B-1で必要 | `constraints_json` カラム追加 |

---

## 4. PR分割案

### Phase B-1

| PR | 内容 | 依存 | DoD |
|----|------|------|-----|
| **PR-B1-DB** | `0082_add_slot_policy_constraints.sql` | なし | 本番D1適用成功 |
| **PR-B1-API** | `POST /candidates/prepare` 実装 | PR-B1-DB | curl で3枠生成確認 |
| **PR-B1-SSOT** | `schedule.1on1.candidates3` 追加 | PR-B1-API | nlRouter経由で動作 |
| **PR-B1-FE** | frontend classifier/executor対応 | PR-B1-SSOT | チャットから候補3つ発行 |
| **PR-B1-E2E** | Playwright: 3候補→選択→thank-you | PR-B1-* | CI green |

### Phase B-2

| PR | 内容 | 依存 | DoD |
|----|------|------|-----|
| **PR-B2-API** | `POST /freebusy/prepare` 実装 | B-1完了 | 主催者の空きから候補生成 |
| **PR-B2-SSOT** | `schedule.1on1.freebusy` 追加 | PR-B2-API | nlRouter経由で動作 |
| **PR-B2-FE** | frontend対応 | PR-B2-SSOT | チャットからfreebusy候補発行 |

### Phase B-3

| PR | 内容 | 依存 | DoD |
|----|------|------|-----|
| **PR-B3-UI** | 別日希望モーダル | なし | UI表示確認 |
| **PR-B3-API** | `POST /request-alternate` 実装 | PR-B3-UI | 別日希望→再提案トリガー |
| **PR-B3-LOGIC** | 最大2回ルール実装 | PR-B3-API | 2回目でOpen Slots誘導 |

### Phase B-4

| PR | 内容 | 依存 | DoD |
|----|------|------|-----|
| **PR-B4-** | Open Slots（大きいので分割推奨） | B-1〜B-3完了後 | 別途設計 |

---

## 5. 最初に着手すべきPR

**B-1（候補3つ）** が最短で価値が出る。

UIは既存の `multiSlotUI()` が使えるので、実装順序は：

1. **PR-B1-DB**: マイグレーション（`slot_policy`, `constraints_json`）
2. **PR-B1-API**: `POST /api/one-on-one/candidates/prepare`
3. **PR-B1-SSOT**: `schedule.1on1.candidates3`
4. **PR-B1-FE**: frontend classifier/executor
5. **PR-B1-E2E**: Playwright テスト

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-27 | 初版作成（v1完了範囲 + Phase B-1〜B-4差分） |
