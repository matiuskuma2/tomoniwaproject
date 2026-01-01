# Sprint Week1: MyASP課金同期＋実行Gate（5営業日）

**Sprint Goal**: 課金状態で実行を止められる（本体未完成でもOK）  
**期間**: 5営業日（Day1-5）  
**優先度**: P0（最優先・後戻りしない境界）

---

## 📋 Sprint Backlog（Jira起票用）

### **Epic: MyASP課金同期＋実行Gate**

---

## Day1-2: DB + 受信API（2日）

### **Story 1-1: billing_events テーブル作成**
**担当**: Backend Engineer  
**工数**: 2SP (0.5日)

#### タスク
- [ ] migration作成: `billing_events`
  - `id`, `myasp_user_id`, `email`, `plan`, `amount`, `status`, `ts`, `dedupe_key` UNIQUE, `raw_payload_json`, `received_at`
- [ ] index作成: `(myasp_user_id, received_at)`
- [ ] migration実行（ローカル）

#### 受け入れ条件
- [ ] `npm run migrate` が通る
- [ ] 同じ `dedupe_key` で2回insertしても2回目はエラーにならない（UNIQUE制約）

---

### **Story 1-2: billing_accounts テーブル作成**
**担当**: Backend Engineer  
**工数**: 2SP (0.5日)

#### タスク
- [ ] migration作成: `billing_accounts`
  - `id`, `myasp_user_id` UNIQUE, `email`, `plan`, `amount`, `status`, `last_event_ts`, `updated_at`
- [ ] index作成: `(status, updated_at)`
- [ ] migration実行（ローカル）

#### 受け入れ条件
- [ ] `npm run migrate` が通る
- [ ] upsert（ON CONFLICT）が動作する

---

### **Story 1-3: POST /api/billing/myasp/sync/:token 実装**
**担当**: Backend Engineer  
**工数**: 5SP (1日)

#### タスク
- [ ] ルート追加: `POST /api/billing/myasp/sync/:token`
- [ ] token認証（`env.MYASP_SYNC_TOKEN` と比較）
- [ ] Content-Type対応: `application/x-www-form-urlencoded`, `application/json`
- [ ] 必須フィールド検証: `user_id`, `mail`, `plan`, `amount`, `status`, `ts`
- [ ] plan/amount矛盾チェック
- [ ] `dedupe_key` 生成: `user_id|ts|status|plan`
- [ ] `billing_events` insert（ON CONFLICT DO NOTHING）
- [ ] `billing_accounts` upsert
- [ ] レスポンス: `{ "success": true }`

#### curl テスト
```bash
# 成功ケース（登録 status=1）
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

# 冪等テスト（同じPOSTを2回）
curl -X POST "http://localhost:3000/api/billing/myasp/sync/test_token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "data[User][user_id]=12345" \
  --data-urlencode "data[User][mail]=test@example.com" \
  --data-urlencode "data[User][plan]=3" \
  --data-urlencode "data[User][amount]=15000" \
  --data-urlencode "data[User][status]=1" \
  --data-urlencode "data[User][ts]=2026-01-01 12:00:00"
# 2回目も200が返る
```

#### 受け入れ条件
- [ ] token違い → `401 Unauthorized`
- [ ] 欠落 → `400 Bad Request`
- [ ] plan/amount矛盾 → `400 Bad Request`
- [ ] 成功時 → `200 OK` + `{"success": true}`
- [ ] 同一 `dedupe_key` を2回POST → 2回目も `200 OK`（DB増えない）

---

## Day3: 表示（1日）

### **Story 2-1: GET /api/billing/me 実装**
**担当**: Backend Engineer  
**工数**: 3SP (0.5日)

#### タスク
- [ ] ルート追加: `GET /api/billing/me`（ログイン必須）
- [ ] `billing_accounts` から現在の plan/status を取得
- [ ] レスポンス: `{ "plan": 3, "status": 1, "amount": 15000, "updated_at": "..." }`

#### 受け入れ条件
- [ ] ログインユーザーの plan/status が取得できる
- [ ] billing_accounts にレコードがない場合は `404` or `null`

---

### **Story 2-2: /settings/billing 画面実装**
**担当**: Frontend Engineer  
**工数**: 3SP (0.5日)

#### タスク
- [ ] `/settings/billing` ページ追加
- [ ] `GET /api/billing/me` で plan/status を取得
- [ ] 表示内容:
  - 現在プラン（plan 1/2/3 → ライト/スタンダード/プロ）
  - 状態（status 1=有効, 2=停止, 4=解約）
  - 月額（amount）
  - 最終更新日（updated_at）
- [ ] MyASP管理画面へのリンク（任意）

#### 受け入れ条件
- [ ] MyASPからPOST → 数秒後に `/settings/billing` で反映が見える
- [ ] スマホ表示確認（iPhone / Android）

---

## Day4: Gate（実行制御）（1日）

### **Story 3-1: canExecute 関数実装**
**担当**: Backend Engineer  
**工数**: 3SP (0.5日)

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

#### 受け入れ条件
- [ ] `status=1/3` → `allowed: true`
- [ ] `status=2/4` → `allowed: false`
- [ ] 実行系以外のアクション → `allowed: true`

---

### **Story 3-2: 実行系API に gate 追加**
**担当**: Backend Engineer  
**工数**: 3SP (0.5日)

#### タスク
- [ ] `POST /api/threads` に gate check 追加
- [ ] `POST /api/threads/:id/finalize` に gate check 追加
- [ ] `POST /api/threads/:id/calendar/sync` に gate check 追加
- [ ] エラーレスポンス: `403 Forbidden` + `{ "error": "billing_suspended", "message": "..." }`

#### 受け入れ条件
- [ ] 「提案→確認」までは動く（status=2でも）
- [ ] confirmでPOSTしようとした時だけ `403`（メッセージ付き）

---

## Day5: E2E（1日）

### **Story 4-1: E2Eテスト（MyASP→反映→停止）**
**担当**: QA / Backend Engineer  
**工数**: 5SP (1日)

#### テストシナリオ

##### シナリオ1: 登録（status=1）
1. [ ] MyASPからPOST（`status=1`, `plan=3`, `amount=15000`）
2. [ ] `billing_accounts` にレコードが追加される
3. [ ] `/settings/billing` で「プロプラン（有効）」が表示される
4. [ ] `POST /api/threads` が成功する（実行系OK）

##### シナリオ2: 停止（status=2）
1. [ ] MyASPからPOST（`status=2`）
2. [ ] `billing_accounts` が更新される
3. [ ] `/settings/billing` で「停止」が表示される
4. [ ] `POST /api/threads` が `403` で失敗する（実行系NG）
5. [ ] Thread一覧は見える（提案は止まらない）

##### シナリオ3: 復活（status=3）
1. [ ] MyASPからPOST（`status=3`）
2. [ ] `billing_accounts` が更新される
3. [ ] `/settings/billing` で「有効」が表示される
4. [ ] `POST /api/threads` が成功する（実行系OK）

##### シナリオ4: 解約（status=4）
1. [ ] MyASPからPOST（`status=4`）
2. [ ] `billing_accounts` が更新される
3. [ ] `/settings/billing` で「解約」が表示される
4. [ ] `POST /api/threads` が `403` で失敗する（実行系NG）

##### シナリオ5: 冪等性
1. [ ] 同じPOSTを2回送信
2. [ ] 2回目も `200 OK`
3. [ ] `billing_events` は1レコードのみ

#### 受け入れ条件
- [ ] 全シナリオがPASS
- [ ] スマホ表示確認（iPhone / Android）
- [ ] エラーメッセージが分かりやすい

---

### **Story 4-2: スマホ表示確認**
**担当**: Frontend Engineer  
**工数**: 2SP (0.5日)

#### タスク
- [ ] iPhone Safari で `/settings/billing` 確認
- [ ] Android Chrome で `/settings/billing` 確認
- [ ] レイアウト崩れがないか確認
- [ ] エラーメッセージが見やすいか確認

#### 受け入れ条件
- [ ] iPhone / Android で正常に表示される
- [ ] エラーメッセージが読める

---

## 📊 Sprint Summary

### **工数見積**
| Day | Story | 工数 | 担当 |
|-----|-------|------|------|
| Day1-2 | DB + 受信API | 9SP (2日) | Backend |
| Day3 | 表示 | 6SP (1日) | Backend + Frontend |
| Day4 | Gate | 6SP (1日) | Backend |
| Day5 | E2E | 7SP (1日) | QA + Backend + Frontend |
| **合計** | - | **28SP (5日)** | - |

### **リスク**
- MyASPからのPOST形式が想定と異なる可能性 → 早めにテストPOSTを受け取る
- token認証の環境変数設定漏れ → Day1に `.env` 設定を確認

### **成功基準**
- [ ] MyASP→POST→反映→停止で実行止まる（30秒で確認可能）
- [ ] スマホ表示が崩れない
- [ ] エラーメッセージが分かりやすい

---

## 🚀 次のSprint（Week2）

### **Phase 2: Relationship/Consent（Next-8 Day1）**
- `relationships`, `consents`, `audit_logs` テーブル
- API: relationship変更、consent付与/撤回
- UI: Contact詳細に距離感変更＋同意ダイアログ

---

## 📚 参照文書

- [MYASP_INTEGRATION_SPEC.md](./MYASP_INTEGRATION_SPEC.md): 実装仕様書
- [MYASP_IMPLEMENTATION_CHECKLIST.md](./MYASP_IMPLEMENTATION_CHECKLIST.md): 実装チェックリスト
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md): Phase Next-11

---

**END OF SPRINT**
