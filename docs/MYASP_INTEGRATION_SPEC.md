# MyASP課金連携 実装仕様書（A案：POSTで状態同期のみ）

**Version**: v1.0  
**Status**: 確定（Phase Next-11 実装対象）  
**更新日**: 2026-01-01

---

## 📌 0. 目的（事故ゼロ／技術負債ゼロ）

- **課金の真実（Source of Truth）は MyASP**
- tomonowa側は MyASPからのPOSTを受けて **"プラン状態"を更新するだけ**
- Stripe/Pay.jp連携は当面しない（BANリスク回避）
- **メール送信等の自動実行はしない**（課金連携では「状態同期のみ」）

---

## 🔗 1. MyASP → tomonowa のPOST先（固定）

### 本番POST先（固定トークン付き）
```
POST https://app.tomoniwao.jp/api/billing/myasp/sync/694eRfw9eb4d
```

**重要**: この末尾トークン `694eRfw9eb4d` を **共有シークレット** 扱いにする

---

## ⚙️ 2. MyASP側設定（外部システムへの連動登録）

### MyASP 管理画面での設定
```
シナリオ管理メニュー > 外部システムへの連動登録
```

- **URL**: `https://app.tomoniwao.jp/api/billing/myasp/sync/694eRfw9eb4d`
- **データ**: 下記のフォーマットで送信（登録/停止/復活/解約/プラン変更 すべて同型）

### 送信データ（基本：登録時）

```
data[User][user_id]=%user_id%
data[User][mail]=%mail%
data[User][plan]=3
data[User][amount]=15000
data[User][status]=1
data[User][ts]=%datetime_registration%
data[User][sig]=%mail%%user_id%
```

### status 定義（固定）

| status | 意味 | tomonowa側の動作 |
|--------|------|-------------------|
| `1` | 登録 | 実行系を有効化 |
| `2` | 停止（課金失敗含む） | 実行系を無効化 |
| `3` | 復活 | 実行系を再有効化 |
| `4` | 解約 | 実行系を無効化（閲覧は可） |

### plan / amount（固定）

| plan | amount | プラン名 |
|------|--------|----------|
| `1` | `980` | ライト |
| `2` | `2980` | スタンダード |
| `3` | `15000` | プロ |

**重要**: プラン変更時も同じPOSTで、plan/amount/status を更新するだけ

**注意**: `sig` は改ざん防止にならないので「トークンURLで認証」する（後述）

---

## 🛠️ 3. tomonowa側 実装範囲（Workers API）

### 3-1. 新規エンドポイント（必須）

```
POST /api/billing/myasp/sync/:token
```

**例**: `/api/billing/myasp/sync/694eRfw9eb4d`

- MyASPは `application/x-www-form-urlencoded` で来る可能性が高いので両対応する
  - `application/x-www-form-urlencoded` ✅
  - `application/json`（将来用） ✅

### 3-2. 認証（必須）

- URLパスの `:token` が一致しない場合は **401**
- トークンは **env** に置く

```bash
# 本番
MYASP_SYNC_TOKEN=694eRfw9eb4d

# 開発
MYASP_SYNC_TOKEN_DEV=test_token_dev
```

### 3-3. 入力バリデーション（必須）

#### 受け取る値（必須）

| フィールド | 型 | 説明 |
|------------|-----|------|
| `user_id` | string | MyASP user_id |
| `mail` | string | メールアドレス |
| `plan` | int | 1/2/3 |
| `amount` | int | 980/2980/15000 |
| `status` | int | 1/2/3/4 |
| `ts` | string | 登録日時（文字列でOK） |

#### 拒否条件

- **欠損** → `400 Bad Request`
- **plan と amount の矛盾** → `400 Bad Request`
  - 例：`plan=1` なのに `amount=15000`

### 3-4. 冪等（超重要：二重POSTでも壊れない）

MyASPは同じイベントを複数回POSTする可能性があるため、**必ず冪等化**する。

```typescript
// 冪等キーの生成
const dedupe_key = `${myasp_user_id}|${ts}|${status}|${plan}`;

// dedupe_keyが既に処理済みなら 200で成功返却（DB更新しない）
const existing = await db.query('SELECT id FROM billing_events WHERE dedupe_key = $1', [dedupe_key]);
if (existing) {
  return c.json({ success: true, message: 'already_processed' });
}
```

### 3-5. DB更新（必須）

#### 推奨テーブル（最小）

**1. `billing_accounts`（現時点の契約状態）**

```sql
CREATE TABLE billing_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  myasp_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  plan INTEGER NOT NULL CHECK (plan IN (1, 2, 3)),
  amount INTEGER NOT NULL,
  status INTEGER NOT NULL CHECK (status IN (1, 2, 3, 4)),
  last_event_ts TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_billing_accounts_myasp_user ON billing_accounts(myasp_user_id);
CREATE INDEX idx_billing_accounts_email ON billing_accounts(email);
```

**2. `billing_events`（監査ログ／冪等キー保持）**

```sql
CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  myasp_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  plan INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status INTEGER NOT NULL,
  ts TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload_json JSONB
);

CREATE INDEX idx_billing_events_myasp_user ON billing_events(myasp_user_id, received_at);
CREATE INDEX idx_billing_events_dedupe ON billing_events(dedupe_key);
```

#### 更新ルール

1. **billing_events に dedupe_key を insert**（重複なら無視）
2. **billing_accounts は myasp_user_id をキーに upsert**
3. **status が 2/4 の場合は「機能制限状態」にする**（後述）

```typescript
// 1. イベント記録（冪等チェック）
await db.query(`
  INSERT INTO billing_events (dedupe_key, myasp_user_id, email, plan, amount, status, ts, raw_payload_json)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (dedupe_key) DO NOTHING
`, [dedupe_key, user_id, mail, plan, amount, status, ts, JSON.stringify(body)]);

// 2. 契約状態更新（upsert）
await db.query(`
  INSERT INTO billing_accounts (myasp_user_id, email, plan, amount, status, last_event_ts)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (myasp_user_id) DO UPDATE SET
    email = EXCLUDED.email,
    plan = EXCLUDED.plan,
    amount = EXCLUDED.amount,
    status = EXCLUDED.status,
    last_event_ts = EXCLUDED.last_event_ts,
    updated_at = NOW()
`, [user_id, mail, plan, amount, status, ts]);
```

### 3-6. アプリ側の権限制御（必須）

アプリ内の権限（entitlements）は `billing_accounts.status / plan` を参照する。

| status | 制御内容 |
|--------|----------|
| `2`（停止） | **実行系を止める**（提案は表示OK） |
| `4`（解約） | 同上（必要なら閲覧も制限） |

**実行系** = 「作成/送信/確定/同期」

**重要**: 既存の安全原則「提案は出すが実行は止める」と整合

```typescript
// 権限チェック関数
function canExecute(user_id: string): boolean {
  const account = db.query('SELECT status FROM billing_accounts WHERE myasp_user_id = $1', [user_id]);
  if (!account) return false;
  return account.status === 1 || account.status === 3; // 登録 or 復活
}
```

### 3-7. レスポンス（MyASP向け）

MyASP側はレスポンスを使わない前提でOKだが、**200を返すこと**。

```json
{
  "success": true
}
```

---

## 🖥️ 4. フロント（UI）側対応（最小）

- **サンクスページはトップへ転送でOK**（MyASP側）
- tomonowa側はトップに戻っても、次回ログイン/リロード時にプラン状態が反映されていればOK
- できれば `/settings/billing` に以下を表示（任意、後回し可）:
  - 現在プラン（plan/status）
  - 次回更新の案内文（「変更はMyASPで行ってください」）

### UI例（最小）

```
┌─────────────────────────────┐
│  課金プラン                 │
├─────────────────────────────┤
│  現在のプラン: プロ         │
│  月額: ¥15,000              │
│  状態: 有効                 │
│                             │
│  プラン変更・解約は         │
│  MyASPで行ってください      │
│                             │
│  [MyASP管理画面へ]          │
└─────────────────────────────┘
```

---

## ✅ 5. テスト（DoD：最低限）

### DoD1：登録（status=1）
- [ ] MyASPからPOST（手動curlで代替可）→ `billing_accounts` が `plan=3 status=1` になる

### DoD2：停止→復活
- [ ] `status=2` のPOST → 実行系が止まる
- [ ] `status=3` のPOST → 実行系が復活する

### DoD3：冪等
- [ ] 同じ`dedupe_key`のPOSTを2回投げても二重更新されない

### DoD4：トークン認証
- [ ] token不一致 → `401 Unauthorized`

---

## 🧪 6. Curl例（開発確認用）

### form-urlencoded想定

```bash
curl -X POST "https://app.tomoniwao.jp/api/billing/myasp/sync/694eRfw9eb4d" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "data[User][user_id]=12345" \
  --data-urlencode "data[User][mail]=test@example.com" \
  --data-urlencode "data[User][plan]=3" \
  --data-urlencode "data[User][amount]=15000" \
  --data-urlencode "data[User][status]=1" \
  --data-urlencode "data[User][ts]=2026-01-01 12:00:00" \
  --data-urlencode "data[User][sig]=test@example.com12345"
```

### 停止テスト（status=2）

```bash
curl -X POST "https://app.tomoniwao.jp/api/billing/myasp/sync/694eRfw9eb4d" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "data[User][user_id]=12345" \
  --data-urlencode "data[User][mail]=test@example.com" \
  --data-urlencode "data[User][plan]=3" \
  --data-urlencode "data[User][amount]=15000" \
  --data-urlencode "data[User][status]=2" \
  --data-urlencode "data[User][ts]=2026-01-02 10:00:00" \
  --data-urlencode "data[User][sig]=test@example.com12345"
```

---

## 🚨 7. 重要メモ（技術負債を増やさないための固定）

1. **sigは信用しない**（生成できてしまうため）
   - → 認証はURLトークンで担保

2. **冪等（dedupe_key）を必ず入れる**
   - → MyASPの再POST/リトライで壊れない

3. **課金はMyASPが真実**
   - → tomonowaが勝手に課金状態を作らない

---

## 📋 実装チェックリスト

### Backend（Workers API）
- [ ] `POST /api/billing/myasp/sync/:token` エンドポイント作成
- [ ] URLトークン認証実装
- [ ] form-urlencoded パース対応
- [ ] 入力バリデーション実装
- [ ] 冪等キー（dedupe_key）生成・チェック実装
- [ ] `billing_events` テーブル作成・insert実装
- [ ] `billing_accounts` テーブル作成・upsert実装
- [ ] 権限チェック関数（`canExecute`）実装
- [ ] 監査ログ記録

### Frontend（任意・後回し可）
- [ ] `/settings/billing` ページ作成
- [ ] 現在プラン表示
- [ ] MyASP管理画面へのリンク

### Testing
- [ ] curl テスト（登録/停止/復活/解約）
- [ ] 冪等テスト（同じPOSTを2回）
- [ ] トークン不一致テスト（401確認）
- [ ] plan/amount矛盾テスト（400確認）

---

## 📚 参照文書

- [MYASP_ADMIN_SETUP.md](./MYASP_ADMIN_SETUP.md): MyASP管理画面設定手順（コピペ用）
- [BILLING_AND_LIMITS.md](./BILLING_AND_LIMITS.md): 課金プランと制限値の設計
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md): Phase Next-11 の実装計画

---

## 📋 Implementation Checklist（実装順序・受け入れ条件）

### **ゴール（Phase Next-11）**
- MyASP → tomonowa に課金状態をPOST同期できる
- tomonowaは保存して見える化できる
- 本体が未完成でも将来の制御点（gate）を用意しておく

---

### **Epic 0：前提固定（Decision）**

- [ ] **token付きURLで固定**: `POST /api/billing/myasp/sync/:token`
- [ ] **status定義固定**: 1=登録 2=停止 3=復活 4=解約
- [ ] **plan/amount固定**: plan=1/2/3, amount=980/2980/15000
- [ ] **冪等キー固定**: `dedupe_key = user_id|ts|status|plan`
- [ ] **課金の真実**: MyASP（tomonowaは請求計算しない）

**受け入れ条件**: この5点が `MYASP_INTEGRATION_SPEC.md` と一致

---

### **Epic 1：DB土台（最優先・後から変えると地獄）**

#### 1-1. `billing_events`（監査・冪等）

- [ ] テーブル追加: `billing_events`
  - `id`, `myasp_user_id`, `email`, `plan`, `amount`, `status`, `ts`, `dedupe_key`, `raw_payload_json`, `received_at`
- [ ] **UNIQUE制約**: `dedupe_key`
- [ ] **INDEX**: `(myasp_user_id, received_at)`

**受け入れ条件**:
- 同じPOSTを2回送っても2回目は重複で落ちず「既処理」扱い

#### 1-2. `billing_accounts`（現在状態の正）

- [ ] テーブル追加: `billing_accounts`
  - `id`, `myasp_user_id` UNIQUE, `email`, `plan`, `amount`, `status`, `last_event_ts`, `updated_at`
- [ ] **INDEX**: `(status, updated_at)`

**受け入れ条件**:
- 最新イベントが来ると `billing_accounts` が上書き（upsert）される

---

### **Epic 2：受信API（A案の核心）**

#### 2-1. POST受信（token認証）

- [ ] ルート追加: `POST /api/billing/myasp/sync/:token`
- [ ] **token照合**（不一致は `401`）
- [ ] **Content-Type対応**:
  - `application/x-www-form-urlencoded`（本命）
  - `application/json`（将来用）
- [ ] **必須フィールド検証**（`400`）:
  - `user_id`, `mail`, `plan`, `amount`, `status`, `ts`
- [ ] **plan/amount矛盾チェック**（`400`）

**受け入れ条件**:
- token違い → `401 Unauthorized`
- 欠落 → `400 Bad Request`

#### 2-2. 冪等（dedupe）

- [ ] `dedupe_key` 生成（固定ルール）
- [ ] `billing_events` へINSERT（重複は吸収）
- [ ] `billing_accounts` へUPSERT（`last_event_ts` 更新）

**受け入れ条件**:
- 同一 `dedupe_key` を2回POST → 2回目は `already_processed=true` で `200` 返す（DB増えない）

---

### **Epic 3：表示（本体未完成でも確認できる状態）**

#### 3-1. Organizer画面に「プラン状態」表示

- [ ] API追加: `GET /api/billing/me`（ログイン必須）
- [ ] フロント: `/settings/billing` に表示（plan/status/updated_at）

**受け入れ条件**:
- MyASPからPOST → 数秒後に画面で反映が見える

---

### **Epic 4：本体への"接続点"だけ先に作る（負債ゼロ）**

#### 4-1. Gate（実行系だけ止める）

- [ ] サーバ側関数: `canExecute(userId, action)`（仮実装）
- [ ] **実行系**を止める（提案は止めない）:
  - `action` 例: `thread_create`, `send_invite`, `finalize`, `calendar_sync`
- [ ] 判定: `billing_accounts.status` のみ
  - `status=2/4` → 実行系禁止（`403/402` エラー）
  - `status=1/3` → 許可

**受け入れ条件**:
- 「提案→確認」までは動く
- confirmでPOSTしようとした時だけ `403/402`（メッセージ付き）

**重要**: 本体のentitlementsが未完成でも、ここを先に作ると後から安全に拡張できる

---

### **Epic 5：MyASP側の設定（運用タスク）**

- [ ] MyASP「外部システムへの連動登録」にURL設定
- [ ] `data[User][...]` をコピペ（`MYASP_ADMIN_SETUP.md` 参照）
- [ ] plan変更/停止/復活/解約も同じURLへPOST
- [ ] サンクスページ → アプリTOPへリダイレクト

**受け入れ条件**:
- 登録/停止/復活/解約のいずれかをMyASPで実行すると tomonowa側DBに記録が残る

---

### **テスト（最小）**

#### API単体（curl）
- [ ] 登録 `status=1`
- [ ] 停止 `status=2`
- [ ] 復活 `status=3`
- [ ] 解約 `status=4`
- [ ] 同一payload 2回（冪等）

#### UI
- [ ] `/settings/billing` で plan/status が見える

---

### **重要：本体未完成でも破綻しない進め方**

**今回のスコープ**:
- 課金同期の受け皿 + 見える化 + 実行ゲート までで止める
- 本体機能が固まったら、あとで entitlements（Link数/参加人数/同時進行数）を足していく
- **つまり**: 「止められる」「見える」「監査できる」だけ。これが負債にならない。

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（Phase Next-11 確定版） | 開発チーム |
| 2026-01-01 | v1.1 | Implementation Checklist 追加（実装順序・受け入れ条件） | 開発チーム |
