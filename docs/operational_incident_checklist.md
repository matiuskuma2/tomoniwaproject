# 運用インシデント防止チェックリスト (P0~P1)

## 🔴 P0: 必ず守る（運用停止リスク）

### P0-1: Tenant Isolation（越境アクセス防止）
- [ ] 全てのクエリに `WHERE workspace_id = ? AND owner_user_id = ?` を含める
- [ ] `getWorkspaceContext(c)` を使って `workspace_id` と `owner_user_id` を取得
- [ ] ハードコード禁止: `workspace_id = 'ws-default'` は移行期のみ許可
- [ ] API の先頭で `validateResourceOwnership()` を呼ぶ（list_id / contact_id の検証）

```typescript
// ✅ 正しい例
const ctx = getWorkspaceContext(c)
const sql = `
  SELECT * FROM list_members
  WHERE workspace_id = ? AND owner_user_id = ? AND list_id = ?
`
await db.prepare(sql).bind(ctx.workspaceId, ctx.ownerUserId, listId).all()

// ❌ 間違い例
const sql = `SELECT * FROM list_members WHERE list_id = ?`
await db.prepare(sql).bind(listId).all()
```

---

### P0-2: 参照整合性（FK代替チェック）
- [ ] `list_id` が存在し、かつ同じ workspace に属するか検証
- [ ] `contact_id` が存在し、かつ同じ workspace に属するか検証
- [ ] Batch操作では全IDを事前検証
- [ ] 不正なIDは明確なエラーメッセージで返す

```typescript
// ✅ list_id の検証
const listRow = await db.prepare(
  `SELECT id FROM lists WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
).bind(listId, workspaceId, ownerUserId).first()

if (!listRow) {
  return c.json({ error: 'list_not_found_or_no_access', request_id }, 404)
}

// ✅ contact_ids の一括検証
const contactCheckSql = `
  SELECT id FROM contacts 
  WHERE workspace_id = ? AND owner_user_id = ? AND id IN (${contactIds.map(() => '?').join(',')})
`
const contactRows = await db.prepare(contactCheckSql)
  .bind(workspaceId, ownerUserId, ...contactIds)
  .all<{ id: string }>()

const validIds = new Set(contactRows.results.map(r => r.id))
const invalidIds = contactIds.filter(id => !validIds.has(id))

if (invalidIds.length > 0) {
  return c.json({ error: 'invalid_contacts', invalid_ids: invalidIds, request_id }, 400)
}
```

---

### P0-3: Migration運用（番号重複/削除禁止）
- [ ] Migration番号は増やすだけ（過去ファイルを編集/削除しない）
- [ ] 失敗時は新しい番号で修正migration作成
- [ ] CI/CDで `npm run db:migrate:local` を実行
- [ ] 本番適用前にローカルで必ずテスト

詳細: [migration_checklist.md](./migration_checklist.md)

---

### P0-4: INSERT OR IGNORE の正確な判定
- [ ] `result.meta.changes` をチェック（D1の場合）
- [ ] `changes > 0` なら挿入成功、`changes = 0` なら既存レコード
- [ ] レスポンスに `inserted_count` と `skipped_count` を含める

```typescript
// ✅ 正しい例
const result = await db.prepare(
  `INSERT OR IGNORE INTO list_members (id, workspace_id, owner_user_id, list_id, contact_id, added_by)
   VALUES (?, ?, ?, ?, ?, ?)`
).bind(memberId, workspaceId, ownerUserId, listId, contactId, userId).run()

if (result.meta.changes > 0) {
  inserted.push(contactId)  // 新規挿入
} else {
  skipped.push(contactId)   // 既存レコード
}
```

---

### P0-5: Cursor Pagination（offset禁止）
- [ ] `ORDER BY created_at DESC, id DESC` を必ず指定
- [ ] Cursor条件: `(created_at < ?) OR (created_at = ? AND id < ?)`
- [ ] `encodeURIComponent` / `decodeURIComponent` を使用（Workers安全）
- [ ] 無効なcursorは無視して先頭から返す

```typescript
// ✅ 正しいCursor条件
let sql = `
  SELECT * FROM list_members
  WHERE workspace_id = ? AND owner_user_id = ? AND list_id = ?
`
const params: any[] = [workspaceId, ownerUserId, listId]

if (cur) {
  sql += ` AND (added_at < ? OR (added_at = ? AND id < ?))`
  params.push(cur.timestamp, cur.timestamp, cur.id)
}

sql += ` ORDER BY added_at DESC, id DESC LIMIT ?`
params.push(limit + 1)

const rows = await db.prepare(sql).bind(...params).all()
```

---

## 🟡 P1: 推奨（技術負債回避）

### P1-1: ドメイン分離（命名の混線防止）
- [ ] タスク管理: `task_lists` / `task_items`
- [ ] 参加者リスト: `contact_lists` / `contact_list_members`
- [ ] 混在させない

---

### P1-2: 監査ログの粒度強化
- [ ] 成功時だけでなく失敗時もログに記録
- [ ] 越境アクセス試行を検知（例: 他人のlist_idにアクセス）
- [ ] `actor_user_id` / `request_id` / `source_ip` / `user_agent` を含める

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
    payloadJson: JSON.stringify({ reason: 'list_not_found_or_no_access' }),
    requestId,
    sourceIp: c.req.header('cf-connecting-ip') ?? 'unknown',
    userAgent: c.req.header('user-agent') ?? 'unknown'
  })
  return c.json({ error: 'list_not_found_or_no_access', request_id }, 404)
}
```

---

### P1-3: レートリミット（DoS防止）
- [ ] Batch操作の上限: 1000件/リクエスト
- [ ] 同一ユーザーのAPI呼び出し: 100req/min
- [ ] Cloudflare Workers Rate Limitingを使用

---

### P1-4: 検索の外部インデックス移行準備
- [ ] Phase 0: SQLite FTS5 または正規索引
- [ ] Phase 1: `search_index` テーブル（非同期更新）
- [ ] Phase 2: Meilisearch / Typesense / Elasticsearch への移行

---

## 🔵 セキュリティチェック

### S1: 認証・認可
- [ ] 全APIで `requireAuth` middleware を適用
- [ ] `userId` が空の場合は 401 Unauthorized
- [ ] `workspace_id` / `owner_user_id` で権限チェック

### S2: 入力検証
- [ ] Email: `trim()` + `toLowerCase()`
- [ ] Slack: `trim()` + `toLowerCase()`
- [ ] Chatwork: `trim()` + 整形
- [ ] SQL injection防止: 全てのクエリで `bind()` を使用

### S3: レスポンス
- [ ] エラーメッセージに内部情報を含めない
- [ ] `request_id` を必ず返す（追跡可能性）
- [ ] スタックトレースは本番環境で出さない

---

## 📊 スケールチェック（1億行前提）

### SC1: Index設計
- [ ] 複合インデックス: `(workspace_id, owner_user_id, list_id, created_at DESC, id DESC)`
- [ ] Covering Index を優先（SELECT対象カラムを全て含める）
- [ ] `WHERE deleted_at IS NULL` を使う場合はPartial Indexを作成

### SC2: クエリ最適化
- [ ] `LIMIT` を必ず指定（最大50件）
- [ ] `COUNT(*)` を避ける（代わりに `has_more` フラグ）
- [ ] N+1問題を避ける（JOINまたは一括取得）

### SC3: 非同期処理
- [ ] Bulk操作は1000件まで同期、それ以上はジョブ化
- [ ] 検索インデックス更新は非同期
- [ ] RAG要約生成は非同期

---

## 📝 実装前チェック

新しいAPIを作る前に必ず確認:

1. [ ] Tenant isolation: `workspace_id` + `owner_user_id` を含める
2. [ ] 参照整合性: `list_id` / `contact_id` を検証
3. [ ] Cursor pagination: `ORDER BY` + cursor条件
4. [ ] Index: クエリに対応するインデックスを作成
5. [ ] 監査ログ: 成功・失敗両方を記録
6. [ ] エラーハンドリング: `request_id` を必ず返す
7. [ ] TypeScript型安全: `as any` を使わない
8. [ ] Migration: 新しい番号で作成、過去ファイルは触らない

---

## 🚨 緊急時の対応

### 越境アクセスが発生した場合
1. 該当APIを即座に無効化（または認証を強化）
2. 監査ログから影響範囲を特定
3. `ledger_audit_events` で不正アクセスを検索
4. ユーザーに通知 + パスワードリセット推奨

### Migrationが本番で失敗した場合
1. **絶対にファイルを削除しない**
2. 新しい番号でrollback migration作成
3. 正しいmigrationを新番号で作成
4. 詳細: [migration_checklist.md](./migration_checklist.md)

### Performance問題が発生した場合
1. 該当クエリのEXPLAIN QUERY PLANを確認
2. インデックスが使われているか確認
3. Cursor paginationが正しく動いているか確認
4. 必要に応じてPartial Index追加
