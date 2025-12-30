# AI_INSTRUCTION_PHASE_NEXT3.md

## Phase Next-3（カレンダー閲覧 + P1 intents）実装用：AI指示テンプレ（コピペ用・1枚）

あなたは「ToMoniWao（tomoniwaproject）」の開発補助AIです。  
このタスクは Phase Next-3 のみを対象とし、既存の実装・DB・APIを壊さずに機能追加します。

---

## 0. 今回の目的（Next-3で成立させること）

/chat 上で「予定を見る（カレンダー閲覧）」ができる状態を作る。

**P1 intents（テキスト入力のみ）:**
- schedule.today：今日の予定
- schedule.week：今週（または直近7日）の予定
- schedule.freebusy：空き時間（busy/freeの抽象化）

**UIは /chat の CardsPane（右ペイン）にカードで表示する**

"書き込み"や "自動調整" は今やらない（既存の確定→Meet生成は従来どおり）

---

## 1. 不変条件（Breaking禁止）

### 1.1 既存E2Eを絶対に壊さない
- /threads/new → /i/:token → /threads/:id → finalize → Meet生成 が従来通り動くこと
- Next-2 P0（external.create / status.check / finalize）が従来通り動くこと

### 1.2 DB / Migration
- 既存テーブル/カラムの削除・リネーム禁止
- 既存migrationの編集禁止
- 追加が必要でも、Next-3では原則「追加しない」。どうしても必要なら提案のみ（実装は止める）

### 1.3 API
- 既存API（/api/threads系、/auth系）を変更しない
- Next-3は「追加APIのみ」（calendar読み取り用）
- 既存レスポンスキー削除禁止

### 1.4 スコープ
- OAuth審査中/通過状況により "読み取りスコープ追加" が必要になる可能性がある
- ただし Next-3は「実装を段階化」し、権限不足時はフロントに分かる形で返す（403等）
- 勝手にスコープ増やす前提で話を進めない。必要なら"提案"して止める

---

## 2. 実装範囲（やること / やらないこと）

### 2.1 やること（必須）

#### A) Workers（apps/api）に "カレンダー閲覧用のRead-only API" を追加
- GET /api/calendar/today
- GET /api/calendar/week
- GET /api/calendar/freebusy?range=today|week

#### B) Frontend（/chat）にカード表示を追加
- CalendarCardToday
- CalendarCardWeek
- FreeBusyCard

#### C) /chat のテキスト入力に P1 intents を追加
- 「今日の予定」「今週の予定」「空いてる時間」などを判定してAPI呼び出し
- confidenceが低い場合は聞き返し（今日/今週のどっち？など）

### 2.2 やらないこと（禁止）
- ❌ 音声入力（Next-4以降）
- ❌ coworker/family の他人予定閲覧（Room/Grid可視性・許諾）（将来）
- ❌ 自動再調整ループ（最大2回制御の自動化）（将来）
- ❌ 既存の threads / invites / selections のロジック変更
- ❌ "カレンダー書き込み"の変更（確定→Meet生成は既存のまま）

---

## 3. 実装前に必ず出力（着手前チェック）

次を "必ず" 先に出力してから実装すること。

1. 変更/追加ファイル一覧（frontend / workers）
2. 追加APIの一覧（URL・method・返却JSONの形）
3. 既存E2Eが壊れない理由（どのファイルを触らないか）
4. DoD（完了条件）チェックリスト（下にあるDoDをコピペして使う）

---

## 4. 追加API（固定フォーマット）

### 4.1 GET /api/calendar/today

**返却JSON（固定）:**
```json
{
  "range": "today",
  "timezone": "Asia/Tokyo",
  "events": [
    {
      "id": "string",
      "start": "ISO",
      "end": "ISO",
      "summary": "string",
      "meet_url": "string|null"
    }
  ]
}
```

### 4.2 GET /api/calendar/week

**返却JSON（固定）:**
```json
{
  "range": "week",
  "timezone": "Asia/Tokyo",
  "events": [
    {
      "id": "string",
      "start": "ISO",
      "end": "ISO",
      "summary": "string",
      "meet_url": "string|null"
    }
  ]
}
```

### 4.3 GET /api/calendar/freebusy?range=today|week

**返却JSON（固定）:**
```json
{
  "range": "today|week",
  "timezone": "Asia/Tokyo",
  "free": [
    { "start": "ISO", "end": "ISO" }
  ],
  "busy": [
    { "start": "ISO", "end": "ISO" }
  ]
}
```

※ busy/freeは "中身の予定名は返さない"。時間帯だけ。

---

## 5. Frontend（/chat）表示ルール

- CardsPane に "Calendar" セクションを追加（右ペイン）
- thread未選択でも表示可能でOK（カレンダーはユーザー自身の情報なので）
- 403/401 の場合はカード内に「権限が必要」など明確な文言を出す（クラッシュさせない）

---

## 6. P1 intents（Next-3で追加）

### schedule.today
- **入力例:** 「今日の予定ある？」「今日の予定教えて」
- **実行:** GET /api/calendar/today
- **表示:** CalendarCardToday

### schedule.week
- **入力例:** 「今週の予定」「今週何がある？」
- **実行:** GET /api/calendar/week
- **表示:** CalendarCardWeek

### schedule.freebusy
- **入力例:** 「空いてる時間教えて」「今日の空きは？」
- **実行:** GET /api/calendar/freebusy?range=today（曖昧なら聞き返し）
- **表示:** FreeBusyCard（freeの上位N件だけ見せる等）

---

## 7. DoD（完了条件）

### 7.1 Next-3機能
- [ ] /chat で「今日の予定」が動く（カード表示）
- [ ] /chat で「今週の予定」が動く（カード表示）
- [ ] /chat で「空いてる時間」が動く（カード表示）
- [ ] 403/401時にUIが壊れない（説明表示）

### 7.2 回帰テスト（必須）
- [ ] /threads/new → /i/:token → /threads/:id → finalize → Meet生成 が従来通り
- [ ] Next-2 P0：
  - [ ] external.create
  - [ ] status.check
  - [ ] finalize
- [ ] /dashboard → Chat(β) → /chat が従来通り

---

## 8. 実装後に必ず提出（完了報告の形）

1. 変更差分の要約（追加API/追加コンポーネント/変更点）
2. 手動テスト手順（Next-3 + 回帰テスト）
3. DoDチェック結果（✅/❌で列挙）
4. 既存E2Eに影響がない説明（1段落）

---

## 9. 禁止事項（よくある事故）

- 「ついで」に threads/invites/selections を触る
- スコープ追加を確定事項として進める（必要なら提案で止める）
- freebusyで予定名・詳細を返す（プライバシー違反）
- UIが崩れたら "仕様変更"で逃げる（まず最小修正）

---

## タスク本文（これをAIに渡す）

Phase Next-3として、/chat にカレンダー閲覧（today/week/freebusy）を追加してください。

Workersに GET /api/calendar/* を追加し、Frontend CardsPaneに CalendarCard/FreeBusyCard を追加してください。

DB/API（既存）/migrationは変更禁止。既存E2Eは必ず回帰テストして壊さないでください。

P1 intents（today/week/freebusy）だけを追加し、音声入力や自動調整は実装しないでください。

---

**AI指示テンプレート終わり**
