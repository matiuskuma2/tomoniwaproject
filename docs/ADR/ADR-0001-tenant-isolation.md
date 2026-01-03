# ADR-0001: Tenant Isolation 設計

## Status
**Accepted** (2026-01-02)

---

## Context

複数のワークスペース（組織）が同じ DB を共有する SaaS 環境で、データの完全な分離が必要。

### 問題
- 異なるワークスペースのユーザーが他のワークスペースのデータを見られる可能性
- SQL の WHERE 条件に workspace_id を入れ忘れるとデータ漏洩
- スケール時（10万ユーザー × 1000 リスト = 1億行）で越境アクセスが致命的

---

## Decision

### 1. 全テーブルに workspace_id を追加
```sql
workspace_id TEXT NOT NULL DEFAULT 'ws-default'
```

### 2. 全 API で強制適用
- middleware で `workspace_id`, `owner_user_id` を設定
- `getTenant(c)` で Context から取得（DB 問い合わせゼロ）
- 全 SQL の WHERE 条件に必須

### 3. 越境アクセスの隠蔽
- 403 ではなく 404 を返す（リソースの存在を隠す）
- 監査ログに `access_denied` を記録

### 4. CI で検証
- `tenant-isolation-sql-check.sh` で SQL の越境テストを自動実行
- userA のリソースに userB がアクセス → 404

---

## Implementation

### middleware/auth.ts
```typescript
export async function requireAuth(c: Context, next: Next) {
  const userId = await getUserIdFromContext(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Phase1: ws-default 固定
  c.set('userId', userId);
  c.set('workspaceId', 'ws-default');
  c.set('ownerUserId', userId);
  
  await next();
}
```

### utils/workspaceContext.ts
```typescript
export function getTenant(c: Context): { workspaceId: string; ownerUserId: string } {
  const workspaceId = c.get('workspaceId');
  const ownerUserId = c.get('ownerUserId');
  
  if (!workspaceId || !ownerUserId) {
    throw new Error('Tenant context not set');
  }
  
  return { workspaceId, ownerUserId };
}
```

### API Route 例
```typescript
app.get('/', async (c) => {
  const { workspaceId, ownerUserId } = getTenant(c);
  
  const results = await env.DB.prepare(`
    SELECT * FROM threads
    WHERE workspace_id = ? AND organizer_user_id = ?
    ORDER BY created_at DESC
  `).bind(workspaceId, ownerUserId).all();
  
  return c.json({ threads: results });
});
```

---

## Consequences

### Positive
- ✅ データ漏洩の構造的防止
- ✅ スケール時の安全性確保（1億行でも安全）
- ✅ DB 問い合わせゼロ（middleware で設定）
- ✅ CI で自動検証

### Negative
- ⚠️ 全 API に getTenant() を追加する必要がある
- ⚠️ 既存データに workspace_id を追加する Migration が必要

### Risks
- Migration 失敗時のロールバック計画が必要
- Phase1 → Phase2（マルチテナント）への移行計画

---

## Alternatives Considered

### Alternative 1: Row Level Security (RLS)
- SQLite/D1 は RLS をサポートしていない
- → 却下

### Alternative 2: DB を分ける
- 運用コストが高い
- Cloudflare D1 の制限（データベース数）
- → 却下

### Alternative 3: アプリレベルで制御（現在の方式）
- ✅ 採用
- CI で検証可能
- スケール可能

---

## Related Decisions

- ADR-0002: Cursor Pagination（スケール対策）
- ADR-0003: Billing Gate（課金制御）

---

## References

- Migration: `0060_insert_default_workspace.sql`
- Migration: `0061_add_workspace_id_to_scheduling_threads.sql`
- Script: `scripts/p0/tenant-isolation-sql-check.sh`
- Doc: `docs/P0_STABILIZATION_RULES.md`
