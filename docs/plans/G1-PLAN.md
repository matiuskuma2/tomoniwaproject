# G1-PLAN v1.0: 1対N（日程調整 / 出欠 / 申込）企画書

## Status: APPROVED
- Created: 2026-01-30
- Author: AI Developer + モギモギ（関屋紘之）
- Decision: All 4 decisions approved

---

## 0. ゴール

- **R0（他人）/ R1（仕事仲間）/ R2（家族）** を前提にした 1→N の調整体験を定義し、実装の軸を固定する
- 1対1で作った資産を流用しつつ、**成立条件・締切・再提案・大規模制限**を先に確定し、負債/インシデントを防ぐ

---

## 1. 1対Nの型（4モード）

### 1.1 Fixed（日時決め打ち）
- **例**: 2/3 16:00 開催。参加/不参加
- **目的**: 出欠回収（調整ではない）
- **特徴**: 多人数でも安定

### 1.2 Candidates（候補複数）
- **例**: A/B/C のどれが良い？（3候補）
- **目的**: 候補の中から「確定」を作る
- **特徴**: 投票型

### 1.3 Open Slots（申込カレンダー型）
- **例**: 空き枠カレンダーから申し込んで
- **目的**: 参加者が枠を選ぶ（先着/定員制）
- **特徴**: 不特定多数・イベントに最適

### 1.4 Range→Auto Propose（範囲指定→候補生成）
- **例**: 来週木〜日 午後で3候補投げて
- **R0**: 主催者の空きから生成（参加者のカレンダーは見ない）
- **R1**: 参加者のfreebusyを参照して共通空きから生成（※人数制限が必須）

---

## 2. 1対Nの成立条件（OS）

> 1対Nはここを決めないと実装がズレます。

### 2.1 必須：締切

| 項目 | 値 |
|---|---|
| `deadline_at` | **必須**（デフォルト：作成から72h） |
| 締切後の遷移 | 必ず「確定 or 不成立 or 再提案」へ |

### 2.2 成立条件（Finalization Policy）

以下のいずれかを thread に持たせる：

| Policy | 説明 | 用途 |
|---|---|---|
| `organizer_decides` | 締切まで回答を集め、主催者が最終確定 | **推奨デフォルト**（安全・事故が少ない） |
| `quorum` | K人以上OKで確定（例：5人中3人） | 出欠回収向け |
| `required_people` | 必須メンバー全員OKなら確定（他は任意） | キーパーソン優先 |
| `all_required` | 全員OK | 小規模のみ。大規模には不向き |

### 2.3 自動確定（Auto Finalize）

| 項目 | 値 |
|---|---|
| `auto_finalize` | **デフォルト false** |
| 動作 | 条件達成 → 主催者に「確定してOK？」通知 |

> "勝手に動かない"方針と整合

---

## 3. 再提案ルール（共通）

| 項目 | 値 |
|---|---|
| `max_reproposals` | **2**（既存方針を踏襲） |
| 2回失敗時 | 不成立（デフォルト） |
| 代替案 | 「Open Slotsを作る」を選択肢として提示（自動ではない） |

---

## 4. 距離感（R0/R1/R2）ごとの挙動

### 4.1 R0（他人）

| 項目 | 内容 |
|---|---|
| カレンダー | 参加者のカレンダーは見ない（URL/メール中心） |
| 使える型 | Fixed / Candidates / Open Slots / Range→Auto(from organizer) |
| 成立判定 | 投票/回答の集計で行う |
| 不特定多数イベント | Open Slots + 締切 + 定員が基本 |

### 4.2 R1（仕事仲間）

| 項目 | 内容 |
|---|---|
| カレンダー | freebusy参照可能（permission_presetで制御済み） |
| Range→Auto | 「共通空き」生成ができる |
| 制限 | `participant_limit_internal = 10`（初期）、`candidate_count <= 3`（初期） |
| 30人超 | 方式限定（後述） |

### 4.3 R2（家族）

| 項目 | 内容 |
|---|---|
| 権限 | proxy booking で「書き込み」も可能 |
| 初期実装 | 通常の成立条件＋確定 |
| 将来 | `family_can_write` の場合のみ "確定時に自動登録" を許可 |

---

## 5. 大規模（>30人）の方式限定

> 30人超は次の方式のみ許可（初期）

| 方式 | 可否 |
|---|---|
| Fixed（出欠） | ✅ 許可 |
| Open Slots（申込） | ✅ 許可 |
| Candidates（投票 + quorum or organizer_decides） | ✅ 許可 |
| R1 freebusy intersection | ❌ 不可（コスト・遅延・失敗率が跳ねる） |

---

## 6. データ設計（実装の骨子）

### 6.1 DB（案）

#### 既存テーブル活用
- `scheduling_threads`
- `thread_invites`
- `thread_selections`
- `scheduled_reminders`
- `lists` / `list_members`
- `contacts` / `contact_channels`

#### 新設・拡張

| テーブル/カラム | 内容 |
|---|---|
| `scheduling_threads.topology` | `one_on_one` \| `one_to_many`（新設推奨） |
| `scheduling_threads.group_policy_json` | JSON で成立条件を持つ |
| `thread_responses` | 回答記録（新設推奨） |

#### group_policy_json の構造

```json
{
  "mode": "fixed|candidates|open_slots|range_auto",
  "deadline_at": "2026-02-03T16:00:00+09:00",
  "finalize_policy": "organizer_decides|quorum|required_people|all_required",
  "quorum_count": 3,
  "required_user_ids": ["user-1", "user-2"],
  "auto_finalize": false,
  "max_reproposals": 2,
  "participant_limit": 30
}
```

#### thread_responses の構造

| カラム | 型 | 説明 |
|---|---|---|
| `id` | TEXT | UUID |
| `thread_id` | TEXT | FK |
| `user_id` | TEXT | 内部ユーザー（nullable） |
| `external_key` | TEXT | 外部参加者キー（nullable） |
| `response` | TEXT | `ok` \| `no` \| `maybe` |
| `selected_slot_id` | TEXT | candidates/open_slots 用 |
| `created_at` | TEXT | 回答日時 |

### 6.2 API（案）

| Endpoint | 説明 |
|---|---|
| `POST /api/scheduling/group/prepare` | グループ調整を開始 |
| `GET /api/scheduling/group/:threadId` | 状態取得 |
| `POST /api/scheduling/group/:threadId/respond` | 回答を記録 |
| `POST /api/scheduling/group/:threadId/finalize` | 確定（organizer_decides用） |
| `POST /api/scheduling/group/:threadId/repropose` | 再提案（最大2回） |

### 6.3 通知（inbox）

| type | 説明 |
|---|---|
| `group_request_received` | 調整依頼を受信 |
| `group_reminder` | 締切前リマインド |
| `group_finalized` | 確定通知 |
| `group_cancelled` | 不成立通知 |

---

## 7. Decision（確定済み）

| # | Decision | Status |
|---|---|---|
| 1 | 1対Nの初期実装は「R0（他人）」から始める | ✅ **Yes** |
| 2 | 成立条件のデフォルトは `organizer_decides` | ✅ **Yes** |
| 3 | 締切は必須（デフォルト72h） | ✅ **Yes** |
| 4 | 大規模（>30）は方式限定 | ✅ **Yes** |

---

## 8. 実装PR分割（G1）

| PR | 内容 | 優先度 |
|---|---|---|
| PR-G1-PLAN | この企画書を docs/plans/ へ | ✅ **完了** |
| PR-G1-DB | topology + group_policy_json + responses | High |
| PR-G1-API | group/prepare + respond + finalize | High |
| PR-G1-FE | 一覧/詳細/回答UI + NotificationBell | High |
| PR-G1-E2E | R0: candidates→集計→確定、open-slots申込 | Medium |

---

## 9. 除外事項（N対1は別企画）

N対1（Inbound Scheduling）は本企画の対象外：
- "要求"が多数来る
- 1人のカレンダーに対して受付・選別・キュー管理が必要
- 成立条件ではなく**優先順位・キャパ・受付期限**が必要

→ 別企画（G2-PLAN）で設計予定

---

## Appendix: 用語

| 用語 | 説明 |
|---|---|
| R0 | 他人（カレンダー非共有、URL/メール中心） |
| R1 | 仕事仲間（アプリ内通知＋freebusy参照） |
| R2 | 家族（書き込み権限も可能） |
| 1対N | Broadcast Scheduling（主催者1人→N人に送る） |
| N対1 | Inbound Scheduling（N人→1人に要求が来る） |
| topology | 調整の形態（one_on_one / one_to_many） |
| finalize_policy | 成立条件の種類 |
| quorum | 定足数（N人中K人でOK） |
