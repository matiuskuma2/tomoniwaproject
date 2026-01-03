# ADR-0002: Cursor Pagination 設計

## Status
**Accepted** (2026-01-02)

---

## Context

大量データのページネーション実装で、スケール時のパフォーマンスとデータ整合性が問題。

### 問題
- OFFSET pagination は大量データで遅い（10万行で OFFSET 90000 → 全行スキャン）
- 並行アクセス時にデータがずれる（1ページ目と2ページ目の間に INSERT があるとずれる）
- スケール前提（10万ユーザー × 1000 リスト = 1億行）では使えない

---

## Decision

### 1. OFFSET 完全禁止
- 全 API で cursor pagination を使用
- CI で OFFSET 検知して落とす
- 例外なし（admin 系も含む）

### 2. Cursor 形式
```typescript
// cursor.ts
export type Cursor = {
  timestamp: string; // ISO8601 or datetime string
  id: string;        // UUID
};

export function encodeCursor(c: Cursor): string {
  const raw = `${c.timestamp}|${c.id}`;
  return encodeURIComponent(raw);
}

export function decodeCursor(cursor: string): Cursor | null {
  try {
    const raw = decodeURIComponent(cursor);
    const [timestamp, id] = raw.split('|');
    if (!timestamp || !id) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}
```

### 3. SQL パターン
```sql
-- 初回
SELECT * FROM threads
WHERE workspace_id = ? AND organizer_user_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 51  -- limit + 1 で has_more 判定

-- 2回目以降（cursor あり）
SELECT * FROM threads
WHERE workspace_id = ? AND organizer_user_id = ?
  AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC
LIMIT 51
```

### 4. インデックス
```sql
CREATE INDEX IF NOT EXISTS idx_threads_ws_owner_created 
ON scheduling_threads(workspace_id, organizer_user_id, created_at DESC, id DESC);
```

---

## Implementation

### API Response
```typescript
{
  "threads": [...],  // 最大 50 件
  "pagination": {
    "limit": 50,
    "cursor": "2026-01-03T10%3A00%3A00.000Z%7Cabc-123",  // next cursor
    "has_more": true
  }
}
```

### クライアント側
```typescript
// 初回
GET /api/threads?limit=50

// 2回目以降
GET /api/threads?limit=50&cursor=2026-01-03T10%3A00%3A00.000Z%7Cabc-123
```

---

## Consequences

### Positive
- ✅ スケール時のパフォーマンス確保（1億行でも高速）
- ✅ データ整合性確保（並行アクセスでもずれない）
- ✅ インデックスで高速化
- ✅ CI で OFFSET 禁止を強制

### Negative
- ⚠️ total 件数が取得できない（別途 COUNT が必要）
- ⚠️ ランダムアクセス不可（ページ番号でのジャンプ不可）
- ⚠️ 既存 API の書き換えが必要

### Risks
- cursor の URL エンコード/デコードエラー
- created_at + id の組み合わせの一意性

---

## Alternatives Considered

### Alternative 1: OFFSET + LIMIT
- スケールしない
- → 却下

### Alternative 2: Keyset Pagination（id のみ）
- created_at が同じ場合に順序が不安定
- → id も含める形に改善

### Alternative 3: GraphQL Relay Cursor
- オーバースペック
- → シンプルな形式を採用

---

## Related Decisions

- ADR-0001: Tenant Isolation（WHERE 条件との組み合わせ）

---

## References

- Implementation: `apps/api/src/utils/cursor.ts`
- CI: `scripts/p0/check-no-offset.sh`
- Doc: `docs/P0_STABILIZATION_RULES.md`
- Migration: インデックス追加 Migration

---

## Notes

### total 件数の扱い
- 1億件で COUNT(*) は重い
- has_more + cursor で十分なケースが多い
- 必要な場合は別途集計 API を用意
