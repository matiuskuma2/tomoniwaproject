# Authentication Runbook

## 認証の正（Source of Truth）

### **優先順位**
1. **Cookie: `session=<token>`** （同一オリジン、最優先）
2. **Authorization: `Bearer <token>`** （クロスオリジン、補助）
3. **`x-user-id` header** （開発環境のみ）

### **理由**
- Cloudflare Pages + Workers 構成では、カスタムドメイン経由で Authorization ヘッダーが消えることがある
- Cookie は同一オリジンで最も信頼性が高い
- Bearer は API クライアントやクロスオリジンで使用

---

## ミドルウェアの適用方法

### ✅ **正しい適用方法（threads パターン）**

```typescript
// /api/threads と /api/threads/* の両方をカバー
app.use('/api/threads', requireAuth);
app.use('/api/threads/*', requireAuth);
app.route('/api/threads', threadsRoutes);
```

### ❌ **間違った適用方法（動かない）**

```typescript
// ワイルドカード * は /api/threads/today にマッチしない
app.use('/api/threads*', requireAuth);
app.route('/api/threads', threadsRoutes);
```

### **統一ルール**
- すべての保護されたルートは **threads パターン** を使用
- **ワイルドカード `*` は使わない**（Hono のマッチング問題を回避）

---

## 401 エラーの切り分け手順

### **Step 1: 同じ token で threads と問題のエンドポイントを比較**

```javascript
(async () => {
  const t = sessionStorage.getItem('tomoniwao_token');

  const req = (path) => fetch(path, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  }).then(async r => ({ path, status: r.status, body: await r.text() }));

  console.log(await req('/api/threads'));
  console.log(await req('/api/PROBLEM_ENDPOINT'));
})();
```

**判定：**
- `threads=200, PROBLEM=401` → ミドルウェア適用問題（threads パターンを確認）
- `threads=401, PROBLEM=401` → 認証の根本問題（token/session 検証）
- `threads=200, PROBLEM=200` → 再現条件が別（キャッシュ/デプロイ遅延）

### **Step 2: Cookie 認証をテスト**

```javascript
(async () => {
  const req = (path) => fetch(path, { cache: 'no-store' })
    .then(async r => ({ path, status: r.status, body: await r.text() }));

  console.log(await req('/api/threads'));
  console.log(await req('/api/PROBLEM_ENDPOINT'));
})();
```

**判定：**
- `threads=200, PROBLEM=200` → Cookie が正（Bearer の問題）
- `threads=401, PROBLEM=401` → Cookie も正ではない（セッション生成/有効期限）

---

## デバッグフラグの使用条件

### **原則**
- **本番環境ではデバッグフラグを常時無効にする**
- デバッグが必要な場合：
  - **期間限定**（最大30分）
  - **担当者明確**（誰が有効にしたか）
  - **終了後は必ず削除**

### **手順**

#### 1. デバッグフラグを有効化

```jsonc
// wrangler.jsonc
"vars": {
  "AUTH_DEBUG": "1"  // 一時的に追加
}
```

#### 2. Env 型を追加

```typescript
// packages/shared/src/types/env.ts
export interface Env {
  AUTH_DEBUG?: string;  // 一時的に追加
}
```

#### 3. デプロイ

```bash
npx wrangler deploy --config wrangler.jsonc
```

#### 4. テスト

```javascript
// デバッグ情報が返る
fetch('/api/calendar/today', {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json()).then(console.log);
```

#### 5. **必ず削除**

```bash
# wrangler.jsonc から AUTH_DEBUG を削除
# env.ts から AUTH_DEBUG を削除
npm run build
npx wrangler deploy --config wrangler.jsonc
git add -A
git commit -m "cleanup: Remove AUTH_DEBUG"
git push origin main
```

---

## よくある問題と解決策

### **問題1: `/api/ENDPOINT` が 401 を返すが `/api/threads` は 200**

**原因:** ミドルウェアが適用されていない

**解決策:**
```typescript
// index.ts で threads パターンを使用
app.use('/api/ENDPOINT', requireAuth);
app.use('/api/ENDPOINT/*', requireAuth);
app.route('/api/ENDPOINT', endpointRoutes);
```

### **問題2: Bearer token を送っているのに 401**

**原因:** sessionStorage の token が古い/無効

**解決策:**
1. Cookie で認証されているか確認（Step 2 のテスト）
2. Cookie で成功 → sessionStorage の token を更新
3. Cookie でも失敗 → 再ログイン

### **問題3: Cloudflare Pages で /api が HTML を返す**

**原因:** `_routes.json` が反映されていない

**解決策:**
- Cloudflare Pages は `_routes.json` を無視する（Functions がない場合）
- **推奨:** API を別サブドメインに分ける（`api.tomoniwao.jp`）

---

## メンテナンス記録

| 日付 | 担当者 | 変更内容 | 理由 |
|------|--------|---------|------|
| 2025-12-30 | System | AUTH_RUNBOOK.md 作成 | Day2 完了、再発防止 |
| 2025-12-30 | System | calendar ミドルウェア修正 | Hono パターンマッチング問題 |
| 2025-12-30 | System | AUTH_DEBUG 削除 | 技術的負債の削除 |
