# セキュリティチェックリスト

## 🔴 S0: クリティカル（即座に対応）

### S0-1: Tenant Isolation（越境アクセス防止）
**リスク**: 他のユーザーのデータにアクセスできる

**チェック項目**:
- [ ] 全てのSELECT/UPDATE/DELETEに `WHERE workspace_id = ? AND owner_user_id = ?` を含める
- [ ] `getWorkspaceContext(c)` を必ず使う（ハードコード禁止）
- [ ] API の先頭で `validateResourceOwnership()` を呼ぶ

**テスト方法**:
```bash
# ユーザーAでlist作成
curl -X POST http://localhost:3000/api/lists \
  -H "x-user-id: user-a" \
  -H "Content-Type: application/json" \
  -d '{"name": "My List"}'

# レスポンス: {"list_id": "abc-123", ...}

# ユーザーBで同じlist_idにアクセス（403であるべき）
curl http://localhost:3000/api/lists/abc-123 \
  -H "x-user-id: user-b"

# 期待結果: 403 Forbidden
```

---

### S0-2: SQL Injection防止
**リスク**: 任意のSQLが実行される

**チェック項目**:
- [ ] 全てのクエリで `bind()` を使用
- [ ] 文字列連結でSQLを構築しない
- [ ] ユーザー入力を直接SQLに埋め込まない

```typescript
// ❌ 危険（SQL injection脆弱性）
const sql = `SELECT * FROM lists WHERE name = '${userName}'`
await db.prepare(sql).all()

// ✅ 安全
const sql = `SELECT * FROM lists WHERE name = ?`
await db.prepare(sql).bind(userName).all()
```

---

### S0-3: 認証バイパス防止
**リスク**: 未認証でAPIにアクセスできる

**チェック項目**:
- [ ] 全ての保護されたAPIに `requireAuth` middleware を適用
- [ ] `userId` が空の場合は 401 を返す
- [ ] トークン検証を必ず行う

```typescript
// ✅ 正しい例
app.use('/api/*', requireAuth)

function mustUserId(c: any): string {
  const userId = c.get('userId')
  if (!userId) {
    throw new Error('unauthorized')
  }
  return userId
}
```

---

## 🟡 S1: 重要（計画的に対応）

### S1-1: レートリミット
**リスク**: DoS攻撃 / リソース枯渇

**チェック項目**:
- [ ] Batch操作: 1000件/リクエストまで
- [ ] API呼び出し: 100req/min/user
- [ ] Cloudflare Workers Rate Limitingを使用

```typescript
// ✅ Batch操作の上限
if (contactIds.length > 1000) {
  return c.json({ error: 'too_many_contacts', max: 1000 }, 400)
}
```

---

### S1-2: 入力検証・サニタイズ
**リスク**: XSS / データ破損

**チェック項目**:
- [ ] Email: `trim()` + `toLowerCase()` + 形式チェック
- [ ] 文字列長制限: title (200文字), note (10KB)
- [ ] HTML/Script タグのエスケープ

```typescript
// ✅ 入力正規化
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function validateTitle(title: string): boolean {
  return title.length > 0 && title.length <= 200
}
```

---

### S1-3: エラーメッセージの情報漏洩防止
**リスク**: 内部構造の露出

**チェック項目**:
- [ ] エラーメッセージに詳細情報を含めない
- [ ] スタックトレースは本番環境で出さない
- [ ] `request_id` のみを返す

```typescript
// ❌ 危険（内部情報を漏洩）
return c.json({
  error: 'Database query failed: SELECT * FROM lists WHERE id = abc-123',
  stack: e.stack
}, 500)

// ✅ 安全
console.error('[listMembers.get]', requestId, e)
return c.json({
  error: 'internal_error',
  request_id: requestId
}, 500)
```

---

## 🔵 S2: 推奨（リスク低減）

### S2-1: 監査ログ（不正アクセス検知）
**目的**: セキュリティインシデントの追跡

**チェック項目**:
- [ ] 全ての操作（成功/失敗）をログに記録
- [ ] `actor_user_id` / `target_id` / `action` を含める
- [ ] 越境アクセス試行を検知

```typescript
// ✅ 失敗時のログ
if (!listRow) {
  await writeLedgerAudit(db, {
    workspaceId,
    ownerUserId,
    actorUserId: userId,
    targetType: 'list',
    targetId: listId,
    action: 'access_denied',
    payloadJson: JSON.stringify({ reason: 'list_not_found' }),
    requestId,
    sourceIp: c.req.header('cf-connecting-ip') ?? 'unknown',
    userAgent: c.req.header('user-agent') ?? 'unknown'
  })
  return c.json({ error: 'list_not_found', request_id }, 404)
}
```

---

### S2-2: CORS設定
**リスク**: 許可されていないドメインからのアクセス

```typescript
import { cors } from 'hono/cors'

app.use('/api/*', cors({
  origin: ['https://app.tomonowa.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-user-id'],
  maxAge: 86400
}))
```

---

### S2-3: HTTPS強制 / セキュアヘッダー
```typescript
app.use('*', async (c, next) => {
  // HTTPS強制（本番環境のみ）
  if (c.env.ENVIRONMENT === 'production' && c.req.header('x-forwarded-proto') !== 'https') {
    return c.redirect(`https://${c.req.header('host')}${c.req.url}`, 301)
  }

  // セキュリティヘッダー
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-XSS-Protection', '1; mode=block')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

  await next()
})
```

---

## 📋 セキュリティテスト手順

### 1. 越境アクセステスト
```bash
# ユーザーAでリソース作成
curl -X POST http://localhost:3000/api/lists \
  -H "x-user-id: user-a" \
  -d '{"name": "List A"}'

# ユーザーBでアクセス試行（403であるべき）
curl http://localhost:3000/api/lists/{list_id} \
  -H "x-user-id: user-b"

# 期待: 403 Forbidden
```

### 2. SQL Injectionテスト
```bash
# 悪意のある入力
curl -X POST http://localhost:3000/api/lists \
  -H "x-user-id: user-a" \
  -d '{"name": "test'\'' OR 1=1--"}'

# 期待: 正常にエスケープされて保存される
```

### 3. 認証バイパステスト
```bash
# 認証ヘッダーなしでアクセス
curl http://localhost:3000/api/lists

# 期待: 401 Unauthorized
```

### 4. レートリミットテスト
```bash
# 1001件のbatch追加
curl -X POST http://localhost:3000/api/lists/{list_id}/members/batch \
  -H "x-user-id: user-a" \
  -d '{"contact_ids": [...1001個...]}'

# 期待: 400 Bad Request (too_many_contacts)
```

---

## 🚨 セキュリティインシデント対応

### 越境アクセスが検知された場合
1. **即座に該当APIを無効化**
   ```typescript
   app.get('/api/lists/:id', async (c) => {
     return c.json({ error: 'temporarily_disabled' }, 503)
   })
   ```

2. **監査ログから影響範囲を特定**
   ```sql
   SELECT * FROM ledger_audit_events
   WHERE action = 'access_denied'
     AND created_at > datetime('now', '-1 day')
   ORDER BY created_at DESC
   ```

3. **修正パッチを適用**
   - P0-1の修正を適用
   - 全APIで `validateResourceOwnership()` を呼ぶ

4. **ユーザーに通知**
   - 影響を受けたユーザーにメール送信
   - パスワードリセットを推奨

---

## 📊 セキュリティメトリクス

### 監視項目
- [ ] 認証失敗率（401エラー）: 5%未満
- [ ] 越境アクセス試行（403エラー）: 0件/日
- [ ] レートリミット発動（429エラー）: 10件/日未満
- [ ] SQL Injection試行（検知ログ）: 0件/日

### アラート条件
- 403エラーが1時間で10件以上 → Slack通知
- 401エラーが1時間で100件以上 → Slack通知
- 同一IPから1分で10回以上のアクセス → 自動ブロック

---

## ✅ リリース前チェック

新しいAPIをリリースする前に:

- [ ] S0-1: Tenant isolation 実装済み
- [ ] S0-2: SQL injection対策済み
- [ ] S0-3: 認証・認可 実装済み
- [ ] S1-1: レートリミット 実装済み
- [ ] S1-2: 入力検証 実装済み
- [ ] S1-3: エラーメッセージ 安全化済み
- [ ] S2-1: 監査ログ 実装済み
- [ ] セキュリティテスト実施済み
- [ ] コードレビュー完了
- [ ] ペネトレーションテスト完了（本番前）
