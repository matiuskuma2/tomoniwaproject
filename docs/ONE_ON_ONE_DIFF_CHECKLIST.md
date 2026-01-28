# 1対1（R0: 他人・カレンダー非共有）差分チェックシート

> **Version**: 2026-01-28（B-4完了）  
> **Status**: Phase B-1〜B-4 全て完了  
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

## 2. Phase B-1〜B-4 完了状況

### Phase概要

| Phase | 機能 | 概要 | 状態 |
|-------|------|------|------|
| **B-1** | 候補3つ提示 | 固定複数候補を作って相手に選ばせる | ✅ **完了** (2026-01-27) |
| **B-2** | 主催者freebusyから候補生成 | 主催者の空きだけから3候補を作る | ✅ **完了** (2026-01-28) |
| **B-3** | 別日希望→再提案 | 最大2回の再提案、条件入力 | ✅ **完了** (2026-01-28) |
| **B-4** | TimeRex型（Open Slots） | 空き枠カレンダーを提示して選ばせる | ✅ **完了** (2026-01-28) |

---

## Phase B-1: 候補3つ提示（固定複数候補） ✅ 完了

> 「来週木〜日 午後で3つ候補送って」= 候補3枠を作って相手に選ばせる  
> **2026-01-27 完了**: DB, API, Intent, テストフィクスチャ全て実装・デプロイ済み

### PRs

| PR | タイトル | 状態 |
|----|---------|------|
| #41 | db(b1): add slot_policy and constraints_json to scheduling_threads | ✅ merged |
| #43 | feat(api): PR-B1-API - add /candidates/prepare endpoint | ✅ merged |
| #44 | docs(ssot): add schedule.1on1.candidates3 intent | ✅ merged |
| #45 | feat(frontend): PR-B1-FE - candidates3 classifier and executor | ✅ merged |
| #46 | test(e2e): PR-B1-E2E - candidates3 E2E tests | ✅ merged |

### 実装詳細

- **DB**: `slot_policy`, `constraints_json` カラム追加 (0082マイグレーション)
- **API**: `POST /api/one-on-one/candidates/prepare`
- **SSOT**: `schedule.1on1.candidates3` intent
- **FE**: `classifyOneOnOne` に複数候補検出ロジック、`executeOneOnOneCandidates` 追加
- **E2E**: 4テストケース（招待ページ表示、選択→承諾、デフォルト選択、辞退ダイアログ）

---

## Phase B-2: 主催者freebusyから候補生成 ✅ 完了

> 相手は他人なので **相手のfreebusyは見ない**。主催者のGoogleカレンダーだけ見て候補を作る。
> **2026-01-28 完了**

### PRs

| PR | タイトル | 状態 |
|----|---------|------|
| #47 | feat(api): PR-B2-API - add /freebusy/prepare endpoint | ✅ merged |
| #48 | docs(ssot): PR-B2-SSOT - add schedule.1on1.freebusy intent | ✅ merged |
| #49 | feat(frontend): PR-B2-FE - freebusy classifier/executor | ✅ merged |
| #50 | test(e2e): PR-B2-E2E - freebusy-context fixture and Playwright tests | ✅ merged |

### 実装詳細

- **API**: `POST /api/one-on-one/freebusy/prepare`
  - 主催者の Google Calendar freebusy を取得
  - `slotGenerator.generateAvailableSlots()` で空き枠生成
  - 3候補を選出して `scheduling_slots` に保存
- **SSOT**: `schedule.1on1.freebusy` intent
- **FE**: 
  - `FREEBUSY_KEYWORDS`: 「空いてるところから」「私の空き」等のトリガーワード
  - `hasFreebusyKeyword()` 判定関数
  - `executeOneOnOneFreebusy` executor
- **E2E**: freebusy-context fixture (busy_pattern: standard/all_busy/all_free)

---

## Phase B-3: 別日希望→再提案（最大2回） ✅ 完了

> "別日希望"を辞退扱いで終わらせない。再提案の条件・回数制限を実装。
> **2026-01-28 完了**

### PRs

| PR | タイトル | 状態 |
|----|---------|------|
| #51 | feat(invite): PR-B3-UI+API - add alternate request modal and endpoint | ✅ merged |
| #52 | docs(ssot): PR-B3-SSOT - add schedule.1on1.request_alternate intent | ✅ merged |
| #53 | test(e2e): PR-B3-E2E - add request-alternate flow tests | ✅ merged |

### 実装詳細

- **UI**: 別日希望モーダル (`#alternateModal`)
  - 希望期間: 来週/再来週/指定なし (`#alternate-range`)
  - 時間帯: 午前/午後/夕方/指定なし (`#alternate-prefer`)
  - 補足コメント: 任意 (`#alternate-comment`)
  - CTA: 「この条件で再提案する」/「やめる」
- **API**: `POST /i/:token/request-alternate`
  - 入力: range, prefer, comment
  - 処理: `additional_propose_count` 確認 → 2回以下で `constraints_json` 更新・`proposal_version` +1・新スロット生成
  - 3回超過時: `max_reached=true` → Open Slots へ誘導
- **SSOT**: `schedule.1on1.request_alternate` intent
- **E2E**: 4テストケース（モーダル表示、別日希望→新候補、キャンセル、singleSlotUI対応）

### ガードルール

- 再提案最大2回
- 3回目は Open Slots へ誘導
- `additional_propose_count` で追跡

---

## Phase B-4: TimeRex型（Open Slots） ✅ 完了

> 1〜2週間分の空き枠を "カレンダー形式で提示" し、相手が選んで確定。
> **2026-01-28 完了**

### PRs

| PR | タイトル | 状態 |
|----|---------|------|
| #54 | docs+db(b4): PR-B4-DB - add open_slots tables and plan | ✅ merged |
| #55 | feat(api): PR-B4-API - add open-slots/prepare and /open/:token routes | ✅ merged |
| #56 | test(e2e): PR-B4-E2E - add open slots fixture and Playwright tests | ✅ merged |
| #57 | test(e2e): PR-B4-E2E - add Open Slots flow tests | ✅ merged |
| #58 | docs(ssot): PR-B4-SSOT - add schedule.1on1.open_slots intent | ✅ merged |
| #59 | feat(frontend): PR-B4-FE - add open_slots classifier and executor | ✅ merged |

### 実装詳細

#### DB (0083マイグレーション)

```sql
CREATE TABLE open_slots (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  invitee_name TEXT NOT NULL,
  invitee_email TEXT,
  title TEXT DEFAULT '打ち合わせ',
  time_min TEXT NOT NULL,
  time_max TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 60,
  prefer TEXT DEFAULT 'afternoon',
  days_json TEXT DEFAULT '["mon","tue","wed","thu","fri"]',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  constraints_json TEXT
);

CREATE TABLE open_slot_items (
  id TEXT PRIMARY KEY,
  open_slots_id TEXT NOT NULL,
  slot_id TEXT UNIQUE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT DEFAULT 'available',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (open_slots_id) REFERENCES open_slots(id)
);
```

#### API

| エンドポイント | 用途 |
|---------------|------|
| `POST /api/one-on-one/open-slots/prepare` | Open Slots招待を発行 |
| `GET /open/:token` | 公開枠一覧ページ（日付ごと・時間帯ボタン） |
| `POST /open/:token/select` | 枠を選択して確定 |
| `GET /open/:token/thank-you` | 選択完了ページ（Googleカレンダー追加） |

#### SSOT

```json
{
  "intent": "schedule.1on1.open_slots",
  "category": "schedule.1on1",
  "description": "主催者の空き枠を公開し、相手に選んでもらう（TimeRex型）- Phase B-4",
  "executor": "frontend:executors/oneOnOne.ts::executeOneOnOneOpenSlots",
  "api": "POST /api/one-on-one/open-slots/prepare"
}
```

#### FE

- `OPEN_SLOTS_KEYWORDS`: 「選んでもらう」「公開して」「空き枠を共有」等
- `hasOpenSlotsKeyword()` 判定関数
- `executeOneOnOneOpenSlots` executor
- **判定順序**: open_slots > freebusy > candidates3 > fixed（最優先）

#### E2E

- fixture: `POST /test/fixtures/open-slots`
- テストケース: 公開枠ページ表示、枠選択→確定、thank-youページ、複数選択変更、本番ガード

---

## 3. 矛盾・要確認事項（解決済み）

| # | 観点 | 現状 | 解決方法 |
|---|------|------|---------|
| 1 | `thread.mode` | `one_on_one`/`group`/`public` | ✅ `slot_policy` カラムで細分化 |
| 2 | 別日希望UI | 文言不統一 | ✅ B-3で統一モーダル実装 |
| 3 | 再提案トリガー | `additional_propose` は1:N向け | ✅ B-3で1対1用ロジック追加 |
| 4 | email未知のケース | `invitee.email` optional | ✅ share_link モードで対応 |
| 5 | constraints保存 | なし | ✅ `constraints_json` カラム追加 |

---

## 4. 全PR一覧

### Phase B-1 (2026-01-27)

| PR | 内容 | 状態 |
|----|------|------|
| #41 | PR-B1-DB: slot_policy, constraints_json | ✅ merged |
| #43 | PR-B1-API: /candidates/prepare | ✅ merged |
| #44 | PR-B1-SSOT: schedule.1on1.candidates3 | ✅ merged |
| #45 | PR-B1-FE: classifier/executor | ✅ merged |
| #46 | PR-B1-E2E: Playwright tests | ✅ merged |

### Phase B-2 (2026-01-28)

| PR | 内容 | 状態 |
|----|------|------|
| #47 | PR-B2-API: /freebusy/prepare | ✅ merged |
| #48 | PR-B2-SSOT: schedule.1on1.freebusy | ✅ merged |
| #49 | PR-B2-FE: freebusy classifier/executor | ✅ merged |
| #50 | PR-B2-E2E: freebusy-context fixture | ✅ merged |

### Phase B-3 (2026-01-28)

| PR | 内容 | 状態 |
|----|------|------|
| #51 | PR-B3-UI+API: alternate modal + endpoint | ✅ merged |
| #52 | PR-B3-SSOT: schedule.1on1.request_alternate | ✅ merged |
| #53 | PR-B3-E2E: request-alternate tests | ✅ merged |

### Phase B-4 (2026-01-28)

| PR | 内容 | 状態 |
|----|------|------|
| #54 | PR-B4-DB: open_slots tables | ✅ merged |
| #55 | PR-B4-API: open-slots/prepare + /open/:token | ✅ merged |
| #56 | PR-B4-E2E: open slots fixture | ✅ merged |
| #57 | PR-B4-E2E: Open Slots flow tests | ✅ merged |
| #58 | PR-B4-SSOT: schedule.1on1.open_slots | ✅ merged |
| #59 | PR-B4-FE: open_slots classifier/executor | ✅ merged |

---

## 5. 次のステップ

Phase B-1〜B-4 が完了し、R0（他人）向けの1対1日程調整の主要機能が揃いました。

### 今後の拡張案

| Phase | 機能 | 概要 |
|-------|------|------|
| **B-5** | B-3 → B-4 自動誘導 | 再提案3回目で自動的に Open Slots 生成 |
| **C-1** | R1対応（知人） | 相手のカレンダーも参照して共通空き時間を提示 |
| **C-2** | R2対応（家族） | 予定の自動投入に近い体験 |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-27 | 初版作成（v1完了範囲 + Phase B-1〜B-4差分） |
| 2026-01-27 | Phase B-1 完了 |
| 2026-01-28 | Phase B-2 完了 |
| 2026-01-28 | Phase B-3 完了 |
| 2026-01-28 | Phase B-4 完了、全Phase完了に更新 |
