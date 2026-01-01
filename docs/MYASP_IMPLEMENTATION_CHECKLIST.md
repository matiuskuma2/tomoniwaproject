# MyASP課金連携 実装チェックリスト（Jira/Backlog用）

**Version**: v1.0  
**Status**: Phase Next-11 実装対象  
**更新日**: 2026-01-01

---

## 📋 このドキュメントの使い方

このチェックリストは、**Jira/Backlogに直接コピペして使える**形式で記載しています。
各Epicは独立したタスクとして登録でき、受け入れ条件（Definition of Done）も明記されています。

---

## 🎯 ゴール（Phase Next-11）

- ✅ MyASP → tomonowa に課金状態をPOST同期できる
- ✅ tomonowaは保存して見える化できる
- ✅ 本体が未完成でも将来の制御点（gate）を用意しておく

---

## 📦 Epic 0：前提固定（Decision）

**優先度**: P0（最優先）  
**担当**: Tech Lead  
**工数見積**: 0.5日（ドキュメント確認のみ）

### タスク

- [ ] token付きURLで固定: `POST /api/billing/myasp/sync/:token`
- [ ] status定義固定: 1=登録 2=停止 3=復活 4=解約
- [ ] plan/amount固定: plan=1/2/3, amount=980/2980/15000
- [ ] 冪等キー固定: `dedupe_key = user_id|ts|status|plan`
- [ ] 課金の真実: MyASP（tomonowaは請求計算しない）

### 受け入れ条件（DoD）

- [ ] この5点が `MYASP_INTEGRATION_SPEC.md` と一致
- [ ] チーム全員がドキュメントを読了

---

## 🗄️ Epic 1：DB土台（最優先・後から変えると地獄）

**優先度**: P0（最優先）  
**担当**: Backend Engineer  
**工数見積**: 1-2日

### Epic 1-1: `billing_events`（監査・冪等）

#### タスク

- [ ] テーブル追加: `billing_events`
  - `id UUID PRIMARY KEY`
  - `myasp_user_id TEXT NOT NULL`
  - `email TEXT NOT NULL`
  - `plan INTEGER NOT NULL`
  - `amount INTEGER NOT NULL`
  - `status INTEGER NOT NULL`
  - `ts TEXT NOT NULL`
  - `dedupe_key TEXT NOT NULL UNIQUE`
  - `raw_payload_json JSONB`
  - `received_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] **UNIQUE制約**: `dedupe_key`
- [ ] **INDEX**: `(myasp_user_id, received_at)`
- [ ] migration ファイル作成
- [ ] migration テスト（ローカル）

#### 受け入れ条件（DoD）

- [ ] `npm run migrate` が通る
- [ ] 同じPOSTを2回送っても2回目は重複で落ちず「既処理」扱い
- [ ] `SELECT * FROM billing_events WHERE myasp_user_id = 'test'` が高速

### Epic 1-2: `billing_accounts`（現在状態の正）

#### タスク

- [ ] テーブル追加: `billing_accounts`
  - `id UUID PRIMARY KEY`
  - `myasp_user_id TEXT NOT NULL UNIQUE`
  - `email TEXT NOT NULL`
  - `plan INTEGER NOT NULL`
  - `amount INTEGER NOT NULL`
  - `status INTEGER NOT NULL`
  - `last_event_ts TEXT`
  - `updated_at TIMESTAMPTZ DEFAULT NOW()`
- [ ] **UNIQUE制約**: `myasp_user_id`
- [ ] **INDEX**: `(status, updated_at)`
- [ ] migration ファイル作成
- [ ] migration テスト（ローカル）

#### 受け入れ条件（DoD）

- [ ] `npm run migrate` が通る
- [ ] 最新イベントが来ると `billing_accounts` が上書き（upsert）される
- [ ] `SELECT * FROM billing_accounts WHERE status = 2` が高速

---

## 🔌 Epic 2：受信API（A案の核心）

**優先度**: P0（最優先）  
**担当**: Backend Engineer  
**工数見積**: 2-3日

### Epic 2-1: POST受信（token認証）

#### タスク

- [ ] ルート追加: `POST /api/billing/myasp/sync/:token`
- [ ] **token照合**（不一致は `401`）
  - `env.MYASP_SYNC_TOKEN` と比較
- [ ] **Content-Type対応**:
  - `application/x-www-form-urlencoded`（本命）
  - `application/json`（将来用）
- [ ] **必須フィールド検証**（`400`）:
  - `user_id`, `mail`, `plan`, `amount`, `status`, `ts`
- [ ] **plan/amount矛盾チェック**（`400`）:
  - `plan=1 → amount=980`
  - `plan=2 → amount=2980`
  - `plan=3 → amount=15000`
- [ ] エラーレスポンス実装

#### curl テストコマンド

```bash
# 成功ケース
curl -X POST "http://localhost:3000/api/billing/myasp/sync/test_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "data[User][user_id]=12345" \
  --data-urlencode "data[User][mail]=test@example.com" \
  --data-urlencode "data[User][plan]=3" \
  --data-urlencode "data[User][amount]=15000" \
  --data-urlencode "data[User][status]=1" \
  --data-urlencode "data[User][ts]=2026-01-01 12:00:00"

# 失敗ケース（token違い）
curl -X POST "http://localhost:3000/api/billing/myasp/sync/wrong_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "data[User][user_id]=12345" \
  --data-urlencode "data[User][mail]=test@example.com" \
  --data-urlencode "data[User][plan]=3" \
  --data-urlencode "data[User][amount]=15000" \
  --data-urlencode "data[User][status]=1" \
  --data-urlencode "data[User][ts]=2026-01-01 12:00:00"
```

#### 受け入れ条件（DoD）

- [ ] token違い → `401 Unauthorized`
- [ ] 欠落 → `400 Bad Request`
- [ ] plan/amount矛盾 → `400 Bad Request`
- [ ] 成功時 → `200 OK` + `{"success": true}`

### Epic 2-2: 冪等（dedupe）

#### タスク

- [ ] `dedupe_key` 生成関数実装
  ```typescript
  function generateDedupeKey(user_id: string, ts: string, status: number, plan: number): string {
    return `${user_id}|${ts}|${status}|${plan}`;
  }
  ```
- [ ] `billing_events` へINSERT（重複は吸収）
  ```sql
  INSERT INTO billing_events (...) VALUES (...)
  ON CONFLICT (dedupe_key) DO NOTHING
  ```
- [ ] `billing_accounts` へUPSERT
  ```sql
  INSERT INTO billing_accounts (...)
  ON CONFLICT (myasp_user_id) DO UPDATE SET ...
  ```
- [ ] 既処理判定ロジック

#### 受け入れ条件（DoD）

- [ ] 同一 `dedupe_key` を2回POST → 2回目は `already_processed=true` で `200` 返す
- [ ] DB確認: `billing_events` は1レコードのみ
- [ ] DB確認: `billing_accounts` は最新値で更新

---

## 🖥️ Epic 3：表示（本体未完成でも確認できる状態）

**優先度**: P1（高）  
**担当**: Frontend Engineer  
**工数見積**: 1-2日

### Epic 3-1: Organizer画面に「プラン状態」表示

#### タスク（Backend）

- [ ] API追加: `GET /api/billing/me`（ログイン必須）
  ```typescript
  Response:
  {
    "plan": 3,
    "status": 1,
    "amount": 15000,
    "updated_at": "2026-01-01T12:00:00Z"
  }
  ```

#### タスク（Frontend）

- [ ] ページ追加: `/settings/billing`
- [ ] プラン表示UI実装
  - 現在プラン（plan）
  - 状態（status）→「有効」「停止」「解約」
  - 月額（amount）
  - 最終更新日（updated_at）
- [ ] MyASP管理画面へのリンク（任意）

#### 受け入れ条件（DoD）

- [ ] MyASPからPOST → 数秒後に画面で反映が見える
- [ ] スマホ表示確認（iPhone / Android）

---

## 🚪 Epic 4：本体への"接続点"だけ先に作る（負債ゼロ）

**優先度**: P1（高）  
**担当**: Backend Engineer  
**工数見積**: 1日

### Epic 4-1: Gate（実行系だけ止める）

#### タスク

- [ ] サーバ側関数実装: `canExecute(userId, action)`
  ```typescript
  function canExecute(userId: string, action: string): { allowed: boolean; reason?: string } {
    const account = await db.query('SELECT status FROM billing_accounts WHERE myasp_user_id = $1', [userId]);
    if (!account) return { allowed: false, reason: 'no_billing_account' };
    
    const executionActions = ['thread_create', 'send_invite', 'finalize', 'calendar_sync'];
    if (!executionActions.includes(action)) return { allowed: true };
    
    if (account.status === 2) return { allowed: false, reason: 'billing_suspended' };
    if (account.status === 4) return { allowed: false, reason: 'billing_cancelled' };
    
    return { allowed: true };
  }
  ```
- [ ] 実行系API に gate 追加
  - `POST /api/threads` → gate check
  - `POST /api/threads/:id/finalize` → gate check
  - `POST /api/threads/:id/calendar/sync` → gate check
- [ ] エラーレスポンス実装（`403/402`）

#### 受け入れ条件（DoD）

- [ ] 「提案→確認」までは動く（status=2でも）
- [ ] confirmでPOSTしようとした時だけ `403/402`（メッセージ付き）
- [ ] フロントにエラーメッセージが表示される

**重要**: 本体のentitlementsが未完成でも、ここを先に作ると後から安全に拡張できる

---

## ⚙️ Epic 5：MyASP側の設定（運用タスク）

**優先度**: P2（中）  
**担当**: Tech Lead / PM  
**工数見積**: 1-2時間

### タスク

- [ ] MyASP「外部システムへの連動登録」にURL設定
  - **URL**: `https://app.tomoniwao.jp/api/billing/myasp/sync/694eRfw9eb4d`
  - **送信方法**: POST
  - **Content-Type**: `application/x-www-form-urlencoded`
- [ ] `data[User][...]` をコピペ（`MYASP_ADMIN_SETUP.md` 参照）
  - 登録時（status=1）
  - 停止時（status=2）
  - 復活時（status=3）
  - 解約時（status=4）
  - プラン変更時（status=1）
- [ ] 再送設定
  - 再送回数: 3回
  - 再送間隔: 5分
  - タイムアウト: 30秒
- [ ] サンクスページ → アプリTOPへリダイレクト設定

### 受け入れ条件（DoD）

- [ ] 登録/停止/復活/解約のいずれかをMyASPで実行すると tomonowa側DBに記録が残る
- [ ] MyASP管理画面でPOST成功を確認
- [ ] tomonowa側で `billing_events` にレコードが追加される

---

## 🧪 テスト（最小）

**優先度**: P0（最優先）  
**担当**: QA / Backend Engineer  
**工数見積**: 1日

### API単体（curl）

- [ ] **登録** `status=1`
  ```bash
  curl -X POST "http://localhost:3000/api/billing/myasp/sync/test_token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "data[User][user_id]=12345" \
    --data-urlencode "data[User][mail]=test@example.com" \
    --data-urlencode "data[User][plan]=3" \
    --data-urlencode "data[User][amount]=15000" \
    --data-urlencode "data[User][status]=1" \
    --data-urlencode "data[User][ts]=2026-01-01 12:00:00"
  ```

- [ ] **停止** `status=2`
- [ ] **復活** `status=3`
- [ ] **解約** `status=4`
- [ ] **同一payload 2回**（冪等）
  - 2回目は `already_processed=true`

### UI

- [ ] `/settings/billing` で plan/status が見える
- [ ] MyASPからPOST後、画面更新で反映される
- [ ] スマホ表示確認（iPhone / Android）

### Gate（実行制御）

- [ ] status=1（登録）→ 実行系OK
- [ ] status=2（停止）→ 実行系NG、提案OK
- [ ] status=3（復活）→ 実行系OK
- [ ] status=4（解約）→ 実行系NG

---

## 🚨 重要：本体未完成でも破綻しない進め方

### 今回のスコープ（Phase Next-11）

✅ **やること**:
- 課金同期の受け皿（DB + API）
- 見える化（`/settings/billing`）
- 実行ゲート（`canExecute`）

❌ **やらないこと**:
- Link数制限（本体のentitlementsで後から実装）
- 参加人数制限（同上）
- 同時進行数制限（同上）

### 将来の拡張（Phase Next-12以降）

- entitlements テーブル追加（plan別の制限値）
- `canExecute` を拡張（action別の制限チェック）
- フロント: 制限値の表示（「あと5個Linkを作成できます」）

**つまり**: 「止められる」「見える」「監査できる」だけ。これが負債にならない。

---

## 📊 工数見積（合計）

| Epic | 工数 | 優先度 |
|------|------|--------|
| Epic 0: 前提固定 | 0.5日 | P0 |
| Epic 1: DB土台 | 1-2日 | P0 |
| Epic 2: 受信API | 2-3日 | P0 |
| Epic 3: 表示 | 1-2日 | P1 |
| Epic 4: Gate | 1日 | P1 |
| Epic 5: MyASP設定 | 0.25日 | P2 |
| テスト | 1日 | P0 |
| **合計** | **7-10日** | - |

---

## 🔗 参照文書

- [MYASP_INTEGRATION_SPEC.md](./MYASP_INTEGRATION_SPEC.md): 実装仕様書
- [MYASP_ADMIN_SETUP.md](./MYASP_ADMIN_SETUP.md): MyASP管理画面設定手順
- [BILLING_AND_LIMITS.md](./BILLING_AND_LIMITS.md): 課金プランと制限値
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md): Phase Next-11 の位置づけ

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（Jira/Backlog用チェックリスト） | 開発チーム |

---

**END OF CHECKLIST**
