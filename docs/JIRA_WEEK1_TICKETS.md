# Jira Week1 Tickets - MyASP Billing Sync + Gate

**Version**: 1.0  
**Created**: 2026-01-01  
**Sprint**: Week1 (5営業日)  
**Epic**: MyASP課金同期＋実行Gate

---

## 📋 このドキュメントの使い方

このファイルは **Jiraに直接コピペしてチケット起票できる形式** です。

### チケット起票手順
1. Epic を作成（Epic 0）
2. Story を順番に作成（Story 0-1 〜 Story 0-5）
3. 各 Story に Subtask を追加
4. DoD（Definition of Done）を確認条件に設定

---

## 🎯 Epic 0: 課金同期の受け皿＋実行Gate

### Epic Summary
```
MyASP課金同期＋実行Gate（confirmだけ止める）
```

### Epic Description
```
【目的】
MyASPからの課金状態を受信し、実行系（confirm）だけを制御するGateを実装する。

【スコープ】
- billing_events / billing_accounts テーブル作成
- POST /api/billing/myasp/sync/:token 実装
- GET /api/billing/me 実装
- /settings/billing 画面実装
- canExecute(userId, action) Gate実装
- E2Eテスト＋スマホ確認

【期間】
Day1〜Day5（5営業日）

【関連ドキュメント】
- docs/SPRINT_WEEK1_MYASP_INTEGRATION.md
- docs/MYASP_INTEGRATION_SPEC.md
- docs/MYASP_IMPLEMENTATION_CHECKLIST.md
```

### Epic Labels
```
priority:P0, phase:next-11, type:foundation
```

---

## 📝 Story 0-1: billing_events テーブル作成

### Story Summary
```
billing_events テーブル作成（監査ログ＋冪等性）
```

### Story Description
```
【目的】
MyASPからのPOSTを監査できる＋dedupe_keyで冪等性を保証する

【受入条件】
- billing_events テーブルが作成されている
- dedupe_key に UNIQUE制約がある
- raw_payload を保存できる
- マイグレーションが通る

【テーブル定義】
CREATE TABLE billing_events (
  id SERIAL PRIMARY KEY,
  myasp_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  plan INTEGER NOT NULL,           -- 1=Free, 2=Pro, 3=Business
  amount INTEGER NOT NULL,          -- 980, 2980, 15000
  status INTEGER NOT NULL,          -- 1=登録, 2=停止, 3=復活, 4=解約
  dedupe_key TEXT UNIQUE NOT NULL,  -- user_id|ts|status|plan
  raw_payload JSONB NOT NULL,       -- 元のPOSTデータ
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_billing_events_myasp_user_id ON billing_events(myasp_user_id);
CREATE INDEX idx_billing_events_received_at ON billing_events(received_at DESC);
```

### Subtasks
```
- [ ] マイグレーションファイル作成（/migrations/YYYYMMDDHHMMSS_create_billing_events.sql）
- [ ] テーブル作成＋インデックス作成
- [ ] ローカルでマイグレーション実行
- [ ] マイグレーション成功を確認
```

### DoD（Definition of Done）
```
✅ マイグレーションが通る
✅ dedupe_key に UNIQUE制約がある
✅ 同一dedupe_keyの挿入が失敗する（エラーハンドリング確認）
✅ PRがマージされている
```

### Story Points
```
2
```

### Labels
```
type:database, priority:P0, day:1
```

---

## 📝 Story 0-2: billing_accounts テーブル作成

### Story Summary
```
billing_accounts テーブル作成（現在の課金状態）
```

### Story Description
```
【目的】
ユーザーごとの現在の課金状態を保存する（最新状態のみ）

【受入条件】
- billing_accounts テーブルが作成されている
- myasp_user_id に UNIQUE制約がある
- plan / status / amount を保存できる
- マイグレーションが通る

【テーブル定義】
CREATE TABLE billing_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,                  -- tomonowaのuser_id（後で紐付け）
  myasp_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  plan INTEGER NOT NULL,            -- 1=Free, 2=Pro, 3=Business
  amount INTEGER NOT NULL,           -- 980, 2980, 15000
  status INTEGER NOT NULL,           -- 1=登録, 2=停止, 3=復活, 4=解約
  last_event_id INTEGER,             -- billing_events.id への参照
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_billing_accounts_user_id ON billing_accounts(user_id);
CREATE INDEX idx_billing_accounts_status ON billing_accounts(status);
```

### Subtasks
```
- [ ] マイグレーションファイル作成（/migrations/YYYYMMDDHHMMSS_create_billing_accounts.sql）
- [ ] テーブル作成＋インデックス作成
- [ ] ローカルでマイグレーション実行
- [ ] マイグレーション成功を確認
```

### DoD（Definition of Done）
```
✅ マイグレーションが通る
✅ myasp_user_id に UNIQUE制約がある
✅ plan / status / amount が保存できる
✅ PRがマージされている
```

### Story Points
```
2
```

### Labels
```
type:database, priority:P0, day:1
```

---

## 📝 Story 0-3: POST /api/billing/myasp/sync/:token 実装

### Story Summary
```
POST受信API実装（冪等・token認証・upsert）
```

### Story Description
```
【目的】
MyASPからのPOSTを受信し、billing_events / billing_accounts に保存する

【受入条件】
- POST /api/billing/myasp/sync/:token が実装されている
- token認証が動作する（不正token → 401）
- dedupe_key で冪等性が保証されている
- billing_events にINSERT、billing_accounts にUPSERT
- curlテストが通る

【API仕様】
POST https://app.tomoniwao.jp/api/billing/myasp/sync/694eRfw9eb4d
Content-Type: application/x-www-form-urlencoded

data[User][user_id]=%user_id%
data[User][mail]=%mail%
data[User][plan]=1|2|3
data[User][amount]=980|2980|15000
data[User][status]=1|2|3|4
data[User][ts]=%datetime_registration%
data[User][sig]=%mail%%user_id%

【レスポンス】
200 OK: { "success": true, "message": "processed" }
200 OK: { "success": true, "message": "duplicate (already processed)" }
400 Bad Request: { "error": "invalid parameters" }
401 Unauthorized: { "error": "invalid token" }
```

### Subtasks
```
- [ ] ルート追加（POST /api/billing/myasp/sync/:token）
- [ ] token認証実装（固定token: 694eRfw9eb4d）
- [ ] バリデーション実装（plan/status/amount）
- [ ] dedupe_key生成（myasp_user_id|ts|status|plan）
- [ ] billing_events INSERT（dedupe_key UNIQUE制約で冪等性）
- [ ] billing_accounts UPSERT（myasp_user_id で上書き）
- [ ] エラーハンドリング（400/401）
- [ ] curlテスト作成
```

### DoD（Definition of Done）
```
✅ POST /api/billing/myasp/sync/:token が動作する
✅ token認証が動作する（不正token → 401）
✅ dedupe_keyで冪等性が保証されている（2回POST → 2回目は既処理）
✅ billing_events / billing_accounts に保存されている
✅ curlテストが通る（登録/停止/復活/解約の4パターン）
✅ PRがマージされている
```

### curlテスト例
```bash
# 1. 登録（status=1）
curl -X POST http://localhost:3000/api/billing/myasp/sync/694eRfw9eb4d \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[User][user_id]=user123&data[User][mail]=test@example.com&data[User][plan]=2&data[User][amount]=2980&data[User][status]=1&data[User][ts]=2026-01-01T10:00:00&data[User][sig]=test@example.comuser123"

# 2. 停止（status=2）
curl -X POST http://localhost:3000/api/billing/myasp/sync/694eRfw9eb4d \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[User][user_id]=user123&data[User][mail]=test@example.com&data[User][plan]=2&data[User][amount]=2980&data[User][status]=2&data[User][ts]=2026-01-02T10:00:00&data[User][sig]=test@example.comuser123"

# 3. 復活（status=3）
curl -X POST http://localhost:3000/api/billing/myasp/sync/694eRfw9eb4d \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[User][user_id]=user123&data[User][mail]=test@example.com&data[User][plan]=2&data[User][amount]=2980&data[User][status]=3&data[User][ts]=2026-01-03T10:00:00&data[User][sig]=test@example.comuser123"

# 4. 解約（status=4）
curl -X POST http://localhost:3000/api/billing/myasp/sync/694eRfw9eb4d \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[User][user_id]=user123&data[User][mail]=test@example.com&data[User][plan]=2&data[User][amount]=2980&data[User][status]=4&data[User][ts]=2026-01-04T10:00:00&data[User][sig]=test@example.comuser123"

# 5. 不正token（401エラー確認）
curl -X POST http://localhost:3000/api/billing/myasp/sync/INVALID_TOKEN \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[User][user_id]=user123&data[User][mail]=test@example.com&data[User][plan]=2&data[User][amount]=2980&data[User][status]=1&data[User][ts]=2026-01-01T10:00:00&data[User][sig]=test@example.comuser123"

# 6. 冪等性確認（同じdedupe_keyを2回POST → 2回目は既処理扱い）
curl -X POST http://localhost:3000/api/billing/myasp/sync/694eRfw9eb4d \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "data[User][user_id]=user123&data[User][mail]=test@example.com&data[User][plan]=2&data[User][amount]=2980&data[User][status]=1&data[User][ts]=2026-01-01T10:00:00&data[User][sig]=test@example.comuser123"
```

### Story Points
```
5
```

### Labels
```
type:api, priority:P0, day:1-2
```

---

## 📝 Story 0-4: GET /api/billing/me 実装

### Story Summary
```
現在のプラン取得API実装
```

### Story Description
```
【目的】
ログイン中のユーザーの現在のプラン情報を取得する

【受入条件】
- GET /api/billing/me が実装されている
- plan / status / amount / updated_at を返す
- 認証が必要（ログインユーザーのみ）
- curlテストが通る

【API仕様】
GET /api/billing/me
Authorization: Bearer <token>

【レスポンス】
200 OK:
{
  "plan": 2,
  "status": 1,
  "amount": 2980,
  "updated_at": "2026-01-01T10:00:00Z"
}

404 Not Found:
{
  "error": "billing account not found"
}
```

### Subtasks
```
- [ ] ルート追加（GET /api/billing/me）
- [ ] 認証チェック（ログインユーザーのみ）
- [ ] billing_accounts から現在のプラン取得
- [ ] レスポンス返却（plan/status/amount/updated_at）
- [ ] エラーハンドリング（404）
- [ ] curlテスト作成
```

### DoD（Definition of Done）
```
✅ GET /api/billing/me が動作する
✅ plan / status / amount / updated_at が返る
✅ 認証が必要（未認証 → 401）
✅ billing_accounts が存在しない場合は 404
✅ curlテストが通る
✅ PRがマージされている
```

### curlテスト例
```bash
# 1. 正常取得
curl -X GET http://localhost:3000/api/billing/me \
  -H "Authorization: Bearer <token>"

# 2. 未認証（401エラー確認）
curl -X GET http://localhost:3000/api/billing/me
```

### Story Points
```
3
```

### Labels
```
type:api, priority:P0, day:3
```

---

## 📝 Story 0-5: /settings/billing 画面実装

### Story Summary
```
課金設定画面の実装（現在のプラン表示）
```

### Story Description
```
【目的】
ユーザーが現在の課金プランを確認できる画面を実装する

【受入条件】
- /settings/billing ページが実装されている
- GET /api/billing/me でプラン情報を取得している
- plan / status / amount が表示されている
- スマホ表示が崩れない
- PRがマージされている

【UI要件】
- 現在のプラン（Free / Pro / Business）
- ステータス（登録中 / 停止中 / 解約済み）
- 金額（980円 / 2,980円 / 15,000円）
- 更新日時
- 「プランを変更する」ボタン（後で実装）

【表示例】
現在のプラン: Pro（2,980円/月）
ステータス: 登録中
更新日時: 2026-01-01 10:00

[ プランを変更する ]（グレーアウト・後で実装）
```

### Subtasks
```
- [ ] /settings/billing ページ作成
- [ ] GET /api/billing/me でプラン取得
- [ ] plan / status / amount を表示
- [ ] スマホ表示確認（Tailwind CSS使用）
- [ ] エラー表示（billing_accounts が存在しない場合）
- [ ] 「プランを変更する」ボタン（グレーアウト・後で実装）
```

### DoD（Definition of Done）
```
✅ /settings/billing ページが表示される
✅ plan / status / amount が表示されている
✅ スマホ表示が崩れない
✅ billing_accounts が存在しない場合はエラー表示
✅ PRがマージされている
```

### Story Points
```
3
```

### Labels
```
type:frontend, priority:P0, day:3
```

---

## 📝 Story 0-6: canExecute(userId, action) Gate実装

### Story Summary
```
実行系制御Gate実装（confirmだけ止める）
```

### Story Description
```
【目的】
status=2/4（停止/解約）の場合に、confirm実行だけを止める

【受入条件】
- canExecute(userId, action) 関数が実装されている
- status=2/4 の場合に confirm実行が止まる
- 提案は止まらない（提案は継続）
- Gateが confirm実行点に差し込まれている
- curlテストが通る

【Gate仕様】
canExecute(userId, action):
  - action = "confirm" の場合のみチェック
  - billing_accounts.status を確認
  - status=2/4 → false（実行不可）
  - status=1/3 → true（実行可能）
  - billing_accounts が存在しない → true（デフォルトFree）

【挿入箇所】
- POST /api/schedules/:id/confirm（確定）
- POST /api/schedules/:id/execute（実行）
- その他の実行系API

【提案は止めない】
- POST /api/schedules/:id/propose（提案）← Gateを入れない
- POST /api/schedules/:id/vote（投票）← Gateを入れない
```

### Subtasks
```
- [ ] canExecute(userId, action) 関数実装
- [ ] billing_accounts.status を確認
- [ ] status=2/4 → false（実行不可）
- [ ] status=1/3 → true（実行可能）
- [ ] confirm実行点にGate挿入（POST /api/schedules/:id/confirm）
- [ ] エラーレスポンス実装（403 Forbidden: "Your account is suspended"）
- [ ] curlテスト作成
```

### DoD（Definition of Done）
```
✅ canExecute(userId, action) 関数が動作する
✅ status=2/4 の場合に confirm実行が止まる（403エラー）
✅ status=1/3 の場合に confirm実行が通る
✅ 提案は止まらない（提案は継続）
✅ curlテストが通る
✅ PRがマージされている
```

### curlテスト例
```bash
# 1. status=1（登録）→ confirm実行OK
curl -X POST http://localhost:3000/api/schedules/123/confirm \
  -H "Authorization: Bearer <token>"

# 2. status=2（停止）→ confirm実行NG（403エラー）
curl -X POST http://localhost:3000/api/schedules/123/confirm \
  -H "Authorization: Bearer <token>"

# 3. status=3（復活）→ confirm実行OK
curl -X POST http://localhost:3000/api/schedules/123/confirm \
  -H "Authorization: Bearer <token>"

# 4. status=4（解約）→ confirm実行NG（403エラー）
curl -X POST http://localhost:3000/api/schedules/123/confirm \
  -H "Authorization: Bearer <token>"

# 5. 提案は止まらない
curl -X POST http://localhost:3000/api/schedules/123/propose \
  -H "Authorization: Bearer <token>"
```

### Story Points
```
5
```

### Labels
```
type:backend, priority:P0, day:4
```

---

## 📝 Story 0-7: E2Eテスト＋スマホ確認

### Story Summary
```
E2Eテスト＋スマホ表示確認
```

### Story Description
```
【目的】
MyASP→POST→反映→停止で実行が止まる E2Eテストを実施

【受入条件】
- E2Eテストが通る
- スマホ表示が崩れない
- PRがマージされている

【E2Eテストシナリオ】
1. MyASP → POST /api/billing/myasp/sync/:token（status=1登録）
2. GET /api/billing/me で plan=2, status=1 を確認
3. /settings/billing で「Pro（登録中）」を確認
4. POST /api/schedules/:id/confirm が通る（status=1）
5. MyASP → POST /api/billing/myasp/sync/:token（status=2停止）
6. GET /api/billing/me で plan=2, status=2 を確認
7. /settings/billing で「Pro（停止中）」を確認
8. POST /api/schedules/:id/confirm が失敗する（status=2 → 403エラー）
9. POST /api/schedules/:id/propose は通る（提案は継続）

【スマホ確認】
- /settings/billing がスマホで崩れない
- 「停止中」のバナーが表示される（後で実装）
```

### Subtasks
```
- [ ] E2Eテストシナリオ作成
- [ ] curlでE2Eテスト実行
- [ ] スマホ実機確認（iOS/Android）
- [ ] テスト結果をドキュメント化
```

### DoD（Definition of Done）
```
✅ E2Eテストが通る
✅ MyASP→POST→反映→停止で実行が止まる
✅ 提案は止まらない
✅ スマホ表示が崩れない
✅ テスト結果がドキュメント化されている
✅ PRがマージされている
```

### Story Points
```
5
```

### Labels
```
type:testing, priority:P0, day:5
```

---

## 📊 スプリント全体の見積もり

| Day | Story | Story Points | 累計 |
|-----|-------|--------------|------|
| Day1 | Story 0-1: billing_events テーブル | 2 | 2 |
| Day1 | Story 0-2: billing_accounts テーブル | 2 | 4 |
| Day1-2 | Story 0-3: POST API実装 | 5 | 9 |
| Day3 | Story 0-4: GET API実装 | 3 | 12 |
| Day3 | Story 0-5: /settings/billing 画面 | 3 | 15 |
| Day4 | Story 0-6: Gate実装 | 5 | 20 |
| Day5 | Story 0-7: E2E＋スマホ確認 | 5 | 25 |

**合計**: 25 Story Points（5営業日）

---

## 🎯 Epic完了条件（DoD）

### 全Story完了時の確認事項
```
✅ billing_events / billing_accounts テーブルが作成されている
✅ POST /api/billing/myasp/sync/:token が動作する（冪等・token認証）
✅ GET /api/billing/me が動作する
✅ /settings/billing 画面が表示される
✅ canExecute(userId, action) Gateが動作する（confirm実行だけ止める）
✅ E2Eテストが通る（MyASP→POST→反映→停止で実行のみ停止）
✅ スマホ表示が崩れない
✅ 全PRがマージされている
✅ 本番環境にデプロイされている
```

---

## 📝 Jira起票時の注意事項

### Epic作成
1. Epic Name: `MyASP課金同期＋実行Gate`
2. Epic Link: `EPIC-0`
3. Labels: `priority:P0, phase:next-11, type:foundation`
4. Description: 上記の Epic Description をコピペ

### Story作成
1. Story を Epic にリンク（Epic Link: EPIC-0）
2. Story Points を設定
3. Labels を設定（type / priority / day）
4. Subtasks を追加
5. DoD を確認条件に設定

### Sprint設定
1. Sprint Name: `Week1: MyASP Billing Sync + Gate`
2. Sprint Goal: `課金同期の受け皿＋実行Gate実装`
3. Duration: 5営業日（Day1〜Day5）

---

## 🚀 次のステップ（Jira起票後）

### Day1（今日）
1. ✅ Epic 0 を作成
2. ✅ Story 0-1, 0-2, 0-3 を作成
3. ✅ Sprint に Story を追加
4. ✅ Story 0-1 を着手（billing_events テーブル）

### Day1 終了時
- ✅ Story 0-1 完了（billing_events テーブル）
- ✅ Story 0-2 完了（billing_accounts テーブル）
- 🔄 Story 0-3 進行中（POST API実装）

### Day2 終了時
- ✅ Story 0-3 完了（POST API実装）

### Day3 終了時
- ✅ Story 0-4 完了（GET API実装）
- ✅ Story 0-5 完了（/settings/billing 画面）

### Day4 終了時
- ✅ Story 0-6 完了（Gate実装）

### Day5 終了時
- ✅ Story 0-7 完了（E2E＋スマホ確認）
- ✅ Epic 0 完了

---

## 📚 関連ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [SPRINT_WEEK1_MYASP_INTEGRATION.md](./SPRINT_WEEK1_MYASP_INTEGRATION.md) | 今週のスプリント計画 |
| [MYASP_INTEGRATION_SPEC.md](./MYASP_INTEGRATION_SPEC.md) | 実装仕様書 |
| [MYASP_ADMIN_SETUP.md](./MYASP_ADMIN_SETUP.md) | 設定手順書 |
| [MYASP_IMPLEMENTATION_CHECKLIST.md](./MYASP_IMPLEMENTATION_CHECKLIST.md) | 実装チェックリスト |
| [P0_NON_FUNCTIONAL_REQUIREMENTS_IMPLEMENTATION_GUIDE.md](./P0_NON_FUNCTIONAL_REQUIREMENTS_IMPLEMENTATION_GUIDE.md) | 実装PR手順 |

---

## 🎉 結論

このファイルをJiraにコピペすれば、Week1スプリントのチケット起票が完了します。

各Storyには以下が含まれています：
- ✅ Story Summary（タイトル）
- ✅ Story Description（詳細説明）
- ✅ Subtasks（実装タスク）
- ✅ DoD（Definition of Done）
- ✅ curlテスト例
- ✅ Story Points（工数見積もり）
- ✅ Labels（type / priority / day）

**手戻りゼロの開発が始まります** 🚀
