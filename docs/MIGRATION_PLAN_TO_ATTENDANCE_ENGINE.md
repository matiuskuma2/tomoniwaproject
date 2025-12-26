# Migration Plan to Attendance Engine (確定版)

（Attendance Rule Engine / 外部誘導UX / 参加条件式 対応のための差分計画）

本ドキュメントは、現在の「ともにわ」バックエンドを、確定仕様（参加条件式＝Attendance Rule Engine）へ揃えるための **DBマイグレーション計画（差分表）** を定義する。  
目的は「今の実装を壊さずに、段階導入できる」こと。

---

## 0. ゴール（確定）

### 0.1 実現したいユーザー体験（確定）

- チャット/音声で「条件」を話すだけで、日程調整が進む  
  - 例：  
    - ALL（全員）  
    - ANY（誰か1人）  
    - K_OF_N（K人以上）  
    - REQUIRED_PLUS_QUORUM（必須+C&E+追加4人以上）  
    - GROUP_ANY（A&B or C&D or E&F）
- 外部の人（未登録者）には Spear/TimeRex 型の URL を送り「選ぶだけ」で完結（登録は後で誘導）
- 進捗確認（status）・催促（remind）・確定（finalize）が API として成立

### 0.2 DBの確定状態（確定）

- 参加条件は JSON（`thread_attendance_rules.rule_json`）として保存
- 候補枠は正規化された `scheduling_slots` に保存
- 各招待者の回答は `thread_selections` に保存
- 確定結果は `thread_finalize` に保存
- 招待者の正規キーは `thread_invites.invitee_key` に保存（内部/外部/リストを統一）

---

## 1. 現状（As-Is）と課題

### 1.1 既存の主なテーブル（要点）

- `scheduling_threads`（スレッド本体。主催者＝`organizer_user_id`）
- `scheduling_candidates`（候補。既存）
- `thread_invites`（招待トークン。既存）
- `thread_message_deliveries`（通知配信。既存）
- `inbox`（通知。正式版）
- `inbox_items`（旧。非推奨）

### 1.2 課題（Attendance Engineの観点）

- 候補枠が `scheduling_candidates` であるため「参加者回答」「成立判定」「確定結果」を正規化しにくい
- 招待者の識別が email/内部ID/リスト等で統一されていない
- 参加条件式（ALL/ANY/K_OF_N/…）をDBで保持できない
- 確定結果のスナップショットがないため、再現性・監査が弱い

---

## 2. 方針（最重要：壊さず段階導入）

### Phase A（追加だけ）: 既存を壊さず **新テーブル/新列を追加**

- 既存フローは動かしたまま
- 新フロー（Attendance Engine）は新テーブルを参照・生成する

### Phase B（切替）: APIと内部処理を新テーブルへ寄せる

- `/i/:token/respond` を `thread_selections` に書く
- `status/remind/finalize` を新テーブルベースで確定

### Phase C（整理）: 旧テーブルの非推奨化・リダイレクト

- `scheduling_candidates` を非推奨（読み取り残しは許容）
- `inbox_items` は非推奨マーカー（構造変更なし）

---

## 3. 差分表（マイグレーション計画）

> ここでの「差分表」は **"確定仕様へ揃えるための変更点"** を一覧化したもの。

### 3.1 Phase A（追加だけ）— 0032〜0038（確定）

| No | Migration | 目的 | 影響範囲 | 互換性 |
|---:|---|---|---|---|
| 0032 | `0032_add_invitee_key_to_thread_invites.sql` | 招待者IDを統一する `invitee_key` を追加 | `thread_invites` | 既存OK（NULL許容） |
| 0033 | `0033_create_thread_attendance_rules.sql` | 参加条件ルール(JSON)を保存 | 新テーブル追加 | 既存OK |
| 0034 | `0034_create_scheduling_slots.sql` | 候補枠を正規化 | 新テーブル追加 | 既存OK |
| 0035 | `0035_create_thread_selections.sql` | 招待者の回答（選択/辞退/保留）を保存 | 新テーブル追加 | 既存OK |
| 0036 | `0036_create_thread_finalize.sql` | 確定結果と参加者スナップショットを保存 | 新テーブル追加 | 既存OK |
| 0037 | `0037_backfill_invitee_keys.sql` | 既存 `thread_invites` に `invitee_key` を埋める | 既存データ更新 | 安全（NULLのみ更新） |
| 0038 | `0038_backfill_default_attendance_rules.sql` | 既存 thread にデフォルトルール作成 | 既存データ追加 | 安全（未作成のみ） |

### 3.2 Phase B（切替）— 追加マイグレーション（必要なら）

Phase Bは基本「API実装・ロジック切替」が中心で、DB変更は最小が望ましい。  
ただし運用上必要になる可能性が高いものは以下。

| No | Migration案 | 目的 | 必須度 |
|---:|---|---|---|
| 0039 | `0039_add_indexes_for_eval.sql` | 評価エンジン高速化（slot/selection集計） | 中 |
| 0040 | `0040_add_thread_finalize_lock.sql` | 二重確定防止（ユニーク/状態制約） | 中 |
| 0041 | `0041_add_remind_log.sql` | 催促履歴（スパム対策/監査） | 低〜中 |

※ まずは 0032〜0038 で十分にPhase Bへ移行可能、というのが確定方針。

### 3.3 Phase C（整理）— 非推奨マーカー（確定）

| No | Migration | 目的 | 備考 |
|---:|---|---|---|
| 0030 | `0030_deprecate_inbox_items.sql` | `inbox_items` 非推奨マーカー | 構造変更なし（ドキュメント用） |
| 00xx | `deprecate_scheduling_candidates.sql`（将来） | `scheduling_candidates` 非推奨 | 破壊的変更はしない |

---

## 4. DBスキーマ（確定：最小要件）

### 4.1 thread_attendance_rules（確定）

- `thread_id`（PK）
- `rule_json`（AttendanceRule JSON）
- `finalize_policy`（EARLIEST_VALID/BEST_SCORE/MANUAL）
- `created_at/updated_at`

### 4.2 scheduling_slots（確定）

- `id`（PK）
- `thread_id`
- `start_at/end_at`
- `label`（任意）
- `score_hint`（任意：最終評価の補助）
- index: `(thread_id, start_at)`

### 4.3 thread_selections（確定）

- `id`（PK）
- `thread_id`
- `invite_id`
- `invitee_key`
- `status`（pending/selected/declined/expired）
- `selected_slot_id`（selectedのみ）
- `created_at`
- index: `(thread_id, invitee_key, created_at)`, `(thread_id, selected_slot_id)`

### 4.4 thread_finalize（確定）

- `thread_id`（PK）
- `final_slot_id`
- `finalize_policy`
- `final_participants_json`（確定時の参加者スナップショット）
- `finalized_at`

### 4.5 thread_invites.invitee_key（確定）

- `invitee_key`（NULL許容→バックフィル後は基本埋まる）
- （将来）`UNIQUE(thread_id, invitee_key)`を強める

---

## 5. バックフィル方針（確定）

### 5.1 invitee_key バックフィル（0037）

- 現時点は DBのみで完結できる形として  
  `invitee_key = e:<lower(email)>` を採用（暫定）
- 将来、アプリ側バッチで `e:<sha256_16(email)>` に変換（推奨最終形）

### 5.2 デフォルト attendance_rule（0038）

- 既存 thread に対し `ANY` のデフォルトルールを付与（安全側）
- ただし将来は「thread作成時に intent から作る」が本命

---

## 6. API/ロジック切替の順序（確定）

### Step B-1: 生成

- `POST /api/threads` 実行時に
  - `thread_attendance_rules` 作成
  - `scheduling_slots` 作成
  - `thread_invites.invitee_key` 付与
  - `thread_selections` は未作成（pending扱い）

### Step B-2: 外部回答

- `POST /i/:token/respond`
  - `thread_selections` に insert（選択 or 辞退）
  - `AttendanceEngine.evaluate(thread_id)` を呼ぶ
  - `auto_finalize` なら `thread_finalize` 作成

### Step B-3: 主催者の確認

- `GET /api/threads/:id/status`
  - `AttendanceEngine` の結果を返す
  - pending/required_missing を返す

### Step B-4: 催促

- `POST /api/threads/:id/remind`
  - `status` から抽出した pending/required_missing に送信
  - 送信ログ（将来: 0041）

### Step B-5: 確定

- `POST /api/threads/:id/finalize`
  - manual finalize を許可（final_slot_id 指定）
  - `thread_finalize` を作成（idempotent）

---

## 7. 参加条件式（確定：どこまで保証？）

このPhase Aの段階で「DBは受け皿として整い、判定エンジン骨格は追加済み」。  
Phase Bで `respond/status/remind/finalize` に繋げることで、以下の柔軟性が保証される。

- ALL / ANY / K_OF_N / REQUIRED_PLUS_QUORUM / GROUP_ANY  
- 必須参加者 + 任意クオラム
- 「どのslotで成立するか」もslot単位で評価
- 「確定時に確定参加者を自動決定/主催者選択」  
  - `finalize_policy` により自動/手動の両対応

---

## 8. 顧客リスト（顧客=invitee）の扱い（確定）

- 顧客リストは将来 `list_members`（既存）を invitee として扱う想定  
- `invitee_key = lm:<list_member_id>` を追加すれば Attendance Engine 側は同一ロジックで扱える
- これにより「500人リストから ANY/K_OF_N で成立」などが可能になる

---

## 9. スケーラビリティ/コスト（確定観点）

### 9.1 評価エンジンのクエリ負荷

- `thread_selections` の集計が中心
- index を入れれば O(invitees + selections) で評価可能
- 大規模（数十万人）想定では「スレッド単位で局所化される」ため現実的

### 9.2 AIコスト

- Attendance Engine自体はAI不要
- AIは「候補生成」「文面生成」「意図解析」に限定
- Free tier は Gemini-only（fallback禁止）が安全（既に実装方針あり）

---

## 10. PWA → ネイティブアプリへの準備（確定）

- 認証は `POST /auth/token` により Bearer を渡せる形が最重要（ネイティブに向く）
- Scheduling/Invite は URL（/i/:token）があり、ネイティブDeepLinkにも転用可能
- フロントは Pages 分離が正解（Workers APIは維持）

---

## 11. まとめ（この計画で何が担保されるか）

- DBを壊さず追加で「参加条件式」を表現できる受け皿ができる（Phase A）
- 次のPhase Bで「外部誘導UX + 参加条件判定 + 催促 + 確定」まで繋がる
- 以降はフロント/ネイティブ/運用UIを積み上げるだけになる

**以上が、確定仕様へ揃えるためのマイグレーション計画（差分表）確定版。**
