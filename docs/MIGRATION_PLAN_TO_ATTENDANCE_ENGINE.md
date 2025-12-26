# Migration Plan to Attendance Engine

## 0. ゴール

AttendanceRuleEngine（ALL/ANY/K-of-N/REQUIRED_PLUS_K/GROUP_ANY/EXPRESSION）を DB・API・判定ロジックで単一系統に統合し、以下が同じデータ構造で動く状態にする。

- 外部日程調整（/i/:token）
- 内部ユーザー同士（ルーム内/チャット）
- お客さんリスト（ListMember）への一括募集（N対1）
- 進捗確認・リマインド・確定

---

## 1. まず結論：採用する"正"の系統

### 1.1 テーブル系統の正

- **Thread本体**: `scheduling_threads` を正（既存の運用系）
- **招待**: `thread_invites` を正（InviteeKey導入で拡張）
- **参加**: `thread_participants` を正（確定参加者）
- **通知**: `inbox` を正（`inbox_items` は過去資産）

### 1.2 新規に追加する最小セット（確定）

Attendance Engine に必要で、現状不足している中核は以下：

- **`scheduling_slots`**（候補枠）
- **`thread_selections`**（選択/辞退/未返信）
- **`thread_finalize`**（確定結果）
- **`thread_attendance_rules`**（AttendanceRule JSON保存）

既存の `scheduling_candidates` が存在する場合は **互換テーブルとして残し**、新機能は `scheduling_slots` を正に寄せる（後で統合）。

---

## 2. 差分表（現状 → 目標）

| 領域 | 現状 | 目標（確定） | 対応 |
|------|------|-------------|------|
| Thread本体 | `scheduling_threads`（ある） | `scheduling_threads`（正）+ attendance_rule 参照 | `thread_attendance_rules`追加 |
| 候補枠 | 実装/テーブルが不統一（候補が固定 or なし） | `scheduling_slots`（slot_id/start/end/tz/label） | 新規テーブル追加 |
| 回答 | `thread_invites` の status で代用/acceptのみ | `thread_selections`（pending/selected/declined/expired） | 新規テーブル追加＋既存inviteと整合 |
| 確定 | acceptで成立扱い（単純） | `thread_finalize`（final_slot_id, finalized_at, policy, final_participants） | 新規テーブル追加 |
| 参加条件 | コードに散在/未定義 | AttendanceRule JSON（v1）で統一 | `thread_attendance_rules`保存＋判定エンジン |
| Invitee識別 | user/email混在 | InviteeKey（u:/e:/lm:） | `thread_invites.invitee_key`追加 |
| リスト（お客さん） | `lists`/`list_members` あり（想定） | `list_members`→InviteeKeyで招待 | `invitee_key=lm:...` |
| inbox | `inbox` + `inbox_items`混在の履歴 | `inbox`が正 | `inbox_items`は参照停止（維持） |
| auth | Cookie+Bearer | 同じ | 変更不要 |
| API | `/api/threads` 作成・`/i/:token` | `/api/scheduling/*` or `/api/threads/*`でもOK | 互換維持しつつ拡張 |

---

## 3. マイグレーション計画（段階・安全重視）

### Phase A（破壊なし：拡張だけ）— 今すぐ入れる

#### A-1. `0032_add_invitee_key_to_thread_invites.sql`

- `thread_invites` に `invitee_key`（TEXT）追加
- 既存データ：
  - 内部ユーザー招待 → `u:<user_id>` へ補完
  - 外部メール招待 → `e:<sha256_16(email)>` を後で埋める（backfill job）

#### A-2. `0033_create_thread_attendance_rules.sql`

- `thread_attendance_rules`
  - `thread_id` (PK or UNIQUE)
  - `version` INT
  - `rule_json` TEXT
  - `finalize_policy` TEXT
  - `created_at`/`updated_at`

#### A-3. `0034_create_scheduling_slots.sql`

- `scheduling_slots`
  - `slot_id` TEXT PK
  - `thread_id` TEXT
  - `start_at`/`end_at` TEXT(ISO)
  - `timezone` TEXT
  - `label` TEXT
  - `created_at`
  - Index: `(thread_id, start_at)`

#### A-4. `0035_create_thread_selections.sql`

- `thread_selections`
  - `selection_id` TEXT PK
  - `thread_id` TEXT
  - `invite_id` TEXT（`thread_invites.id` 参照）
  - `invitee_key` TEXT（冗長だが高速化）
  - `status` TEXT CHECK(pending/selected/declined/expired)
  - `selected_slot_id` TEXT（nullable）
  - `responded_at` TEXT
  - UNIQUE: `(thread_id, invitee_key)`（一人一回答）
  - Index: `(thread_id, selected_slot_id)`, `(thread_id, status)`

#### A-5. `0036_create_thread_finalize.sql`

- `thread_finalize`
  - `thread_id` TEXT PK
  - `final_slot_id` TEXT
  - `finalize_policy` TEXT
  - `finalized_by` TEXT（user_id）
  - `finalized_at` TEXT
  - `final_participants_json` TEXT（InviteeKeyの配列 or participants表を正に）
  - Index: `(finalized_at)`

**このPhase Aが入ると、既存フローを壊さずに「ルール・候補・回答・確定」を保存できる。**

---

### Phase B（整合：既存フローを"新表にも書く"）— 実装差分は小さい

#### B-1. `/api/threads` POST（作成）

- `scheduling_threads` 作成後に
  - `thread_attendance_rules` をデフォルトで作成
    - stranger 1対N募集なら：ANY or K_OF_N
    - チームなら：ALL or REQUIRED_PLUS_K
  - `scheduling_slots` を作る（MVP：3候補、将来はAI生成）
  - `thread_invites` 作成時に `invitee_key` を必ず埋める

#### B-2. `/i/:token` GET（表示）

- 表示対象は `thread_invites` で invite取得
- 候補枠は `scheduling_slots` を表示

#### B-3. `/i/:token/accept`（回答）

- **これまで**: accept=参加確定に近い
- **これから**: **acceptは"selected_slot_idを伴う selection"**にする
  - POST body: `{ selected_slot_id }`（+declineも可）
  - `thread_selections` upsert
  - その後 `evaluate_and_finalize(thread_id)` を実行

#### B-4. `evaluate_and_finalize(thread_id)`

- `thread_attendance_rules.rule_json` を読み込み
- 各slotの acceptedInvitees を計算
- policyに従い確定できるなら `thread_finalize` 作成/更新
- 確定時：
  - `thread_participants` を確定参加者で upsert
  - `inbox` へ通知（主催者/参加者）
  - 未返信にはリマインド対象として残す

---

### Phase C（互換削減：旧構造の参照を減らす）— 落ち着いてから

#### C-1. `thread_invites.status` の意味を整理

- `status` は招待の状態（sent/expiredなど）
- 参加可否は `thread_selections.status` を正にする

#### C-2. `scheduling_candidates` がある場合

- `scheduling_slots` へ移行 or viewで統合
- 新規は slots のみ

#### C-3. `inbox_items`

- 参照ゼロを確認後、将来的にdrop（今はdrop不要）

---

## 4. API差分（確定）

### 4.1 新規/拡張：外部回答

- **GET `/i/:token`**
  - slots表示
- **POST `/i/:token/respond`**
  - `{ status: "selected", selected_slot_id }` または `{ status: "declined" }`
  - ※現行 `/accept` は互換で残してOK（内部で `/respond` に委譲）

### 4.2 進捗確認（チャット向け）

- **GET `/api/threads/:id/status`**
  - 返信数、未返信、slot別の成立状況、成立見込み
- **POST `/api/threads/:id/remind`**
  - 未返信にリマインド（queueでメール）

### 4.3 参加条件変更（MVPは管理者のみ）

- **PATCH `/api/threads/:id/rule`**
  - `rule_json` 更新
  - 再評価（`evaluate_and_finalize`）

---

## 5. "お客さん（リスト）"との接続（確定）

### 5.1 ListMember → InviteeKey

- `list_members` を招待する場合：
  - `invitee_key = "lm:<list_member_id>"`
  - `candidate_email`/`name` は `list_member` からコピー
  - 外部リンク `/i/:token` を送る

### 5.2 N対1募集の作り方（確定）

- AttendanceRule:
  - `K_OF_N` / `REQUIRED_PLUS_K` / `GROUP_ANY` を使う
  - 例：
    - **「10人中5人OKなら開催」** → `K_OF_N(k=5,set=teamA)`
    - **「CとE必須＋追加4人」** → `REQUIRED_PLUS_K`

---

## 6. リスクと注意点（直した方がいい点）

### 6.1 "threads vs scheduling_threads"混在

- **正は `scheduling_threads`**
- `threadsRepository` を残すなら `scheduling_threads` wrapperに変更
  （中途半端に両方触るのが一番事故る）

### 6.2 認証テスト用 user-alice/user-bob の残骸

- 本番データにテストユーザーを混ぜない運用に寄せる
- `ENVIRONMENT=production` で `x-user-id` が使えないなら、E2Eは
  - OAuthで2アカウントログイン
  - Rooms招待でbobをメンバー化
  - で通す（DB直insertは最終手段）

### 6.3 コスト面（Gemini優先）

- `candidate_generation` は Geminiのみが基本（fallback禁止）
- fallbackは adminが明示ONにしたときだけ
- `ai_usage_logs` を admin dashboard で集計→日次上限で抑止

---

## 7. 次に実装する"判定エンジン"の置き場所（確定）

**`apps/api/src/services/attendanceEngine.ts`**

- `evaluateRule(rule_json, selections, sets)`
- `suggestBestSlot(policy, slots, selections)`
- `finalizeThread(thread_id)`（D1 write）

---

## 8. 実装順（最短・安全）

1. **Phase A のマイグレーション**（0032〜0036）
2. `/i/:token` を slots表示に変更
3. `/respond` を追加し selections に書く
4. finalize（policy: EARLIEST_VALID）を入れる
5. チャット用 status/remind を追加
6. リスト招待（lm:）導入（N対1募集）

---

## 9. "いまやるべきか？"結論

**今やるべきです。**

**理由**: フロントやチャットUXを作り込むほど、後でDB統合が痛くなるため。

**Phase A（追加だけ）まで入れておけば、後は実装を上に積むだけで済みます。**
