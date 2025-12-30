# Routing Rules - 保護ルートの統一パターン

**最終更新**: 2025-12-30  
**目的**: Hono ミドルウェア適用パターンの統一による認証バグ再発防止

---

## 🚨 **必須ルール（絶対厳守）**

### **Rule 1: 保護ルートは必ず2本書く**

```typescript
// ✅ 正しいパターン（threads 方式）
app.use('/api/calendar', requireAuth);      // Base path
app.use('/api/calendar/*', requireAuth);    // Sub-paths
app.route('/api/calendar', calendarRoutes);

// ❌ 間違ったパターン（抜け穴がある）
app.use('/api/calendar*', requireAuth);     // ワイルドカードは禁止
app.route('/api/calendar', calendarRoutes);
```

**理由**: Hono のパターンマッチングで `/api/calendar*` は `/api/calendar/today` に正しく適用されないケースがある。

---

### **Rule 2: ワイルドカード `*` は絶対に使わない**

```typescript
// ❌ 禁止パターン
app.use('/api/calendar*', requireAuth);
app.use('/api/inbox*', requireAuth);

// ✅ 正しいパターン
app.use('/api/calendar', requireAuth);
app.use('/api/calendar/*', requireAuth);
```

---

## ✅ **現在の保護ルート一覧（2025-12-30）**

すべて threads パターンに統一済み：

```typescript
// Admin routes
app.use('/admin/system', requireAdmin);
app.use('/admin/system/*', requireAdmin);

app.use('/admin/ai', requireAdmin);
app.use('/admin/ai/*', requireAdmin);

app.use('/admin/dashboard', requireAdmin);
app.use('/admin/dashboard/*', requireAdmin);

// API routes
app.use('/api/work-items', requireAuth);
app.use('/api/work-items/*', requireAuth);

app.use('/api/voice', requireAuth);
app.use('/api/voice/*', requireAuth);

app.use('/api/threads', requireAuth);
app.use('/api/threads/*', requireAuth);

app.use('/api/inbox', requireAuth);
app.use('/api/inbox/*', requireAuth);

app.use('/api/rooms', requireAuth);
app.use('/api/rooms/*', requireAuth);

app.use('/api/contacts', requireAuth);
app.use('/api/contacts/*', requireAuth);

app.use('/api/lists', requireAuth);
app.use('/api/lists/*', requireAuth);

app.use('/api/business-cards', requireAuth);
app.use('/api/business-cards/*', requireAuth);

app.use('/api/calendar', requireAuth);
app.use('/api/calendar/*', requireAuth);
```

---

## 🔍 **新規ルート追加時のチェックリスト**

新しい保護ルートを追加する際は、以下を必ず確認：

- [ ] Base path と Sub-paths の2本を記述したか？
- [ ] ワイルドカード `*` を使っていないか？
- [ ] `app.route()` の前に `app.use()` を記述したか？
- [ ] requireAuth または requireAdmin を適用したか？

---

## 🧪 **検証方法**

### **A. 手動テスト（最小）**

```bash
# 未ログイン → 401 を確認
curl -s https://app.tomoniwao.jp/api/calendar/today | jq .

# ログイン済み → 200 を確認
curl -s https://app.tomoniwao.jp/api/calendar/today \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .
```

### **B. 自動テスト（推奨）**

```bash
# scripts/test-auth.sh を実行
npm run test:auth
```

---

## 📝 **PR レビュー時のチェック項目**

新規ルート追加の PR では、以下を必ず確認：

1. **パターン確認**: `/api/xxx` と `/api/xxx/*` の2本が存在するか？
2. **ワイルドカード禁止**: `*` が単独で使われていないか？
3. **認証ミドルウェア**: `requireAuth` または `requireAdmin` が適用されているか？
4. **テスト実施**: 未ログイン時に 401 が返ることを確認したか？

---

## 🚨 **過去の事故事例（参考）**

### **事例1: Wildcard パターンによる認証抜け（2025-12-30）**

**問題コード**:
```typescript
app.use('/api/calendar*', requireAuth);
app.route('/api/calendar', calendarRoutes);
```

**現象**:
- `/api/calendar` → 200 OK（認証なし）
- `/api/calendar/today` → 401 Unauthorized（認証あり）

**原因**: Hono のパターンマッチングで `/api/calendar*` が `/api/calendar/today` には適用されるが、`/api/calendar` には適用されないケースが発生。

**修正**:
```typescript
app.use('/api/calendar', requireAuth);
app.use('/api/calendar/*', requireAuth);
app.route('/api/calendar', calendarRoutes);
```

**結果**: すべてのパスで認証が正しく適用される。

---

## 🔄 **定期メンテナンス**

- **頻度**: 新規ルート追加時 + 月次レビュー
- **確認項目**:
  - [ ] すべての保護ルートが threads パターンに従っているか？
  - [ ] ワイルドカード `*` が使われていないか？
  - [ ] 自動テストが通っているか？

---

## 📚 **関連ドキュメント**

- [AUTH_RUNBOOK.md](./AUTH_RUNBOOK.md) - 認証トラブルシューティング
- [API_REFERENCE.md](./API_REFERENCE.md) - API エンドポイント一覧
- [PHASE_IMPLEMENTATION.md](./PHASE_IMPLEMENTATION.md) - 実装フェーズ管理

---

**最終更新**: 2025-12-30  
**担当**: System  
**レビュー**: Required for all routing changes
