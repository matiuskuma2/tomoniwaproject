# PHASE_NEXT2_INTENT_CLASSIFICATION.md
## ToMoniWao – Phase Next-2: Intent 分類仕様（確定版）

最終更新日: 2025-12-29  
ステータス: 確定（Phase Next-2 実装の "正"）

---

## 0. この仕様の目的

Phase Next-2 では **「発話 → Intent 分類 → 既存API呼び出し」** を実装する。

- ✅ やること: チャット入力を受け取り、Intent を判定し、既存APIを呼び分ける
- ❌ やらないこと: 新API作成、DB変更、migration追加

---

## 1. Intent 一覧（10種類・実装優先順位付き）

| Priority | Intent ID | Intent Name | 説明 | 関係性 |
|----------|-----------|-------------|------|--------|
| **P0（最優先）** | `schedule.external.create` | 外部招待型日程調整作成 | 他人に調整リンクを送る | external |
| **P0** | `schedule.status.check` | 日程調整状況確認 | 募集中の予定や進捗を確認 | - |
| **P0** | `schedule.finalize` | 日程確定 | 主催者が日程を確定する | - |
| **P1（次優先）** | `schedule.coworker.create` | 仕事仲間との調整 | Room/Grid前提の調整 | coworker |
| **P1** | `schedule.remind` | リマインド送信 | 未返信者にリマインドを送る | - |
| **P1** | `schedule.today` | 今日の予定確認 | 自分の予定を確認 | - |
| **P2（後回し）** | `schedule.family.create` | 家族予定登録 | 家族の予定を自動確定 | family |
| **P2** | `schedule.renegotiate` | 再調整 | 同一スレッド内で再調整 | - |
| **P2** | `schedule.cancel` | 調整キャンセル | スレッドをキャンセル | - |
| **P3（将来）** | `schedule.calendar.sync` | カレンダー同期 | Google Calendar との同期 | - |

---

## 2. Intent 詳細仕様（P0: 最優先実装）

### 2.1 `schedule.external.create`（外部招待型日程調整作成）

**発話例**:
- 「田中さんと佐藤さんに日程調整送って」
- 「このリスト30人に勉強会の案内送って。締切2週間後」
- 「山田さんに来週の午後で日程調整送って」

**判定条件**:
- 関係性: `external`（未登録者 or 登録済みだが外部扱い）
- 動詞: 「送る」「調整」「案内」
- 対象: 人名 or リスト名

**API呼び出し**:
1. `POST /api/threads`
   - `title`: AI が生成（例: 「田中さん・佐藤さんとの打ち合わせ」）
   - `description`: AI が生成（任意）
   - `candidates`: AI が抽出（例: [{name: "田中太郎", email: "tanaka@example.com"}]）
   - `target_list_id`: リスト指定の場合のみ
2. 招待メール送信（自動：Queue経由）

**UI表示**:
- チャット: 「2名に調整リンクを送りました」
- カード（任意）: ThreadStatusCard（未返信数・締切表示）

**Phase Next-2 での実装範囲**:
- テキスト入力 → Intent判定 → API呼び出し
- 音声入力は Phase Next-3

---

### 2.2 `schedule.status.check`（日程調整状況確認）

**発話例**:
- 「今募集してる予定って何がある？」
- 「この勉強会、何人参加してる？」
- 「未返信は誰？」

**判定条件**:
- 動詞: 「確認」「見る」「教えて」
- 対象: 「予定」「募集」「進捗」

**API呼び出し**:
1. `GET /api/threads?status=active`（全体確認の場合）
2. `GET /api/threads/:id/status`（特定スレッドの場合）

**UI表示**:
- カード: ThreadStatusCard
  - 参加人数（承諾数）
  - 未返信数
  - 締切
- チャット: 「現在の状況を表示しています」

**Phase Next-2 での実装範囲**:
- スレッド一覧から選択 → status API呼び出し
- スレッドID自動推論（コンテキスト管理）

---

### 2.3 `schedule.finalize`（日程確定）

**発話例**:
- 「この日で確定して」
- 「12/30 15:00 で決めて」
- 「一番人数多い日で確定して」

**判定条件**:
- 動詞: 「確定」「決める」「この日」
- 前提: 主催者権限、status === active

**API呼び出し**:
1. `POST /api/threads/:id/finalize`
   - `selected_slot_id`: AI が選択（または最多票数）
   - `reason`: AI が生成（任意）
2. Google Calendar API（内部処理）
3. Meet URL 生成（内部処理）

**UI表示**:
- チャット: 「12/30 15:00 で確定しました」
- カード: MeetCard
  - Meet URL（コピー/参加ボタン）
  - Calendar event ID

**Phase Next-2 での実装範囲**:
- テキスト入力 → slot選択 → finalize API呼び出し
- 「一番人数多い」等の条件判定

---

## 3. Intent 詳細仕様（P1: 次優先実装）

### 3.1 `schedule.coworker.create`（仕事仲間との調整）

**発話例**:
- 「AさんとBさんと来週どこかで1時間打ち合わせ入れといて」
- 「明日の午後ならいつでもいい、決めといて」

**判定条件**:
- 関係性: `coworker`（Room/Grid参加者）
- 動詞: 「打ち合わせ」「入れる」「決める」

**API呼び出し**:
1. `POST /api/threads`
2. `GET /api/threads/:id/status`（進捗確認）
3. 必要に応じて再調整（同スレッド）

**UI表示**:
- チャットのみ（原則カードなし）
- 「確定しました」で完了

**Phase Next-2 での実装範囲**:
- カレンダー読み取りは Phase Next-3
- 現状は手動候補日時生成

---

### 3.2 `schedule.remind`（リマインド送信）

**発話例**:
- 「未返信の人にリマインド送って」
- 「締切前に通知して」

**判定条件**:
- 動詞: 「リマインド」「通知」「催促」
- 前提: pending invites 存在

**API呼び出し**:
- `POST /api/threads/:id/remind`

**UI表示**:
- チャット: 「3名にリマインドを送信しました」

**Phase Next-2 での実装範囲**:
- 単純なIntent判定 → API呼び出し

---

### 3.3 `schedule.today`（今日の予定確認）

**発話例**:
- 「今日の予定ある？」
- 「今日何時から？」

**判定条件**:
- 時間: 「今日」「今」
- 対象: 「予定」

**API呼び出し**:
- `GET /api/events?date=today`（※ Phase Next-3 で実装予定）

**UI表示**:
- チャット + 簡易カード

**Phase Next-2 での実装範囲**:
- API未実装のため、Phase Next-3 へ

---

## 4. Intent 詳細仕様（P2: 後回し実装）

### 4.1 `schedule.family.create`（家族予定登録）

**発話例**:
- 「家族旅行で3週間後から1週間予定全部入れといて」

**判定条件**:
- 関係性: `family`
- 確認: 不要

**API呼び出し**:
- `POST /api/threads`
- `finalize` 処理（自動）

**UI表示**:
- チャットのみ: 「予定を入れました」

**Phase Next-2 での実装範囲**:
- Phase Next-3 で実装（家族権限モデル未実装）

---

### 4.2 `schedule.renegotiate`（再調整）

**発話例**:
- 「別の候補で調整し直して」
- 「もう一度送って」

**判定条件**:
- 動詞: 「再調整」「やり直し」
- 前提: 既存スレッド存在、調整回数 < 2

**API呼び出し**:
- `POST /api/threads/:id/renegotiate`（※ 未実装）

**UI表示**:
- チャット: 「新しい候補で再調整を開始しました」

**Phase Next-2 での実装範囲**:
- 調整回数制御は Phase Next-3
- 現状は運用で制限

---

### 4.3 `schedule.cancel`（調整キャンセル）

**発話例**:
- 「この調整キャンセルして」
- 「やっぱりやめる」

**判定条件**:
- 動詞: 「キャンセル」「中止」「やめる」

**API呼び出し**:
- `PATCH /api/threads/:id`（status = cancelled）

**UI表示**:
- チャット: 「調整をキャンセルしました」

**Phase Next-2 での実装範囲**:
- 単純なIntent判定 → API呼び出し

---

## 5. Intent 判定フロー（Phase Next-2 実装）

```
1. ユーザー入力（テキスト）
   ↓
2. Intent Parser（AI）
   - 発話内容を分析
   - 10種類の Intent から最適なものを選択
   - confidence スコア算出（0.0 - 1.0）
   ↓
3. Intent Router
   - confidence >= 0.7: Intent実行
   - confidence < 0.7: 曖昧性確認（「〜という意味ですか？」）
   ↓
4. API Executor
   - 既存APIを呼び出し
   - レスポンスを整形
   ↓
5. UI Renderer
   - チャット表示
   - カード表示（必要な場合のみ）
```

---

## 6. Phase Next-2 での実装優先順位

### Day 1-3: P0（最優先）
- `schedule.external.create`
- `schedule.status.check`
- `schedule.finalize`

### Day 4-6: P1（次優先）
- `schedule.coworker.create`（カレンダー読み取りなし版）
- `schedule.remind`

### Day 7-10: P2（後回し）
- `schedule.cancel`
- `schedule.renegotiate`（調整回数制御なし版）

### Phase Next-3: P3（将来）
- `schedule.family.create`
- `schedule.today`
- `schedule.calendar.sync`

---

## 7. 不変条件（Phase Next-2 のガードレール）

- ❌ 新API作成禁止
- ❌ DB変更禁止
- ❌ 既存E2E破壊禁止
- ❌ 無限再調整禁止
- ✅ 既存APIの組み合わせのみ
- ✅ Intent判定は AI に委譲
- ✅ UIは結果表示のみ

---

## 8. Phase Next-2 完了条件（DoD）

### 必須条件
- [ ] P0 の3つの Intent が動作する
  - [ ] `schedule.external.create`
  - [ ] `schedule.status.check`
  - [ ] `schedule.finalize`
- [ ] テキスト入力 → Intent判定 → API呼び出し → UI表示が動作する
- [ ] 既存E2Eが一切壊れていない（Phase Next-1 のDoD全て✅）

### オプション条件
- [ ] P1 の2つの Intent が動作する
  - [ ] `schedule.coworker.create`
  - [ ] `schedule.remind`
- [ ] confidence < 0.7 の場合に曖昧性確認が動作する

---

## 9. 次フェーズへの接続（Phase Next-3）

Phase Next-3 で以下を実装する：

- 音声入力対応
- Google Calendar 読み取り（freebusy/events.list）
- 調整回数制御（最大2回）のコード化
- family / coworker の権限管理
- 自動確定ロジック

---

## 10. 重要な注記（誤解防止）

- Intent 分類は AI に委譲（GPT-4o-mini / Gemini-2.0-flash-exp）
- Phase Next-2 は「テキスト入力のみ」（音声は Next-3）
- カレンダー読み取りは Phase Next-3（現状は手動候補生成）
- 調整回数制御は Phase Next-3（現状は運用で制限）

---

以上。
