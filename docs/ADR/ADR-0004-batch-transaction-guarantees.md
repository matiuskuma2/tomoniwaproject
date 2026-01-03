# ADR-0004: Batch Transaction Guarantees

**Status**: Accepted  
**Date**: 2026-01-03  
**Context**: P0 Performance Optimization

## Context

大量データの INSERT 処理（list_members, thread_invites）において、以下の課題があった：

1. **パフォーマンス**: 1000件を順次 INSERT すると ~30秒かかる
2. **タイムアウトリスク**: Cloudflare Workers の CPU 時間制限（10ms/30ms）に抵触
3. **Partial Success**: 途中で失敗すると inserted/skipped が不明確

## Decision

### 1. Chunk + Batch による Transaction 化

```typescript
// 200件×N チャンクに分割
const CHUNK_SIZE = 200;

for (let i = 0; i < items.length; i += CHUNK_SIZE) {
  const chunk = items.slice(i, i + CHUNK_SIZE);
  
  // db.batch() で Transaction 実行
  const results = await db.batch(
    chunk.map(item => db.prepare(sql).bind(...params))
  );
  
  // meta.changes で inserted/skipped を判定
  results.forEach((result, idx) => {
    if (result.meta.changes > 0) {
      inserted.push(chunk[idx]);
    } else {
      skipped.push(chunk[idx]);
    }
  });
}
```

### 2. 原子性保証の前提

**D1 の db.batch() の動作**:
- **Cloudflare D1 の仕様**: `db.batch()` は複数の SQL 文を 1 つのトランザクションとして実行
- **原子性**: chunk 内の全 INSERT が成功 or 全失敗（Partial Success なし）
- **エラー時**: chunk 全体が ROLLBACK され、results に error が含まれる

**リスク**:
- D1 の内部実装変更で原子性が崩れる可能性（低い）
- ネットワーク切断で chunk の一部だけ成功する可能性（極低）

**対策**:
1. **failed 配列を返す**: chunk 失敗時は全件を `failed` に追加
2. **audit log に chunk_index を記録**: 復旧時の追跡を可能に
3. **request_id を返す**: フロント/サポートでの問い合わせ対応

### 3. パフォーマンス改善

- **1000件 INSERT**: ~30秒 → ~3秒（約 10 倍高速化）
- **タイムアウトリスク**: chunk 化により大幅に軽減
- **CPU 時間**: 200件/chunk で 10ms 以内に収まる

## Consequences

### ✅ Positive
- タイムアウトリスクが大幅に軽減
- inserted/skipped/failed が正確に追跡可能
- 復旧手順が明確（request_id + chunk_index で特定）

### ⚠️ Negative
- D1 の仕様変更リスク（低い）
- chunk 失敗時に全件 retry が必要（INSERT OR IGNORE で冪等性確保）

### 🔄 Mitigation
- D1 の仕様変更を定期的にモニタリング
- Cloudflare Workers の Release Notes を監視
- Production で failed が発生した場合はアラート

## Alternatives

### Alt 1: BEGIN/COMMIT を明示的に使用
```sql
BEGIN TRANSACTION;
INSERT ...;
INSERT ...;
COMMIT;
```

**却下理由**:
- D1 は `BEGIN/COMMIT` をサポートしていない（Workers API では不要）
- `db.batch()` が推奨される方法

### Alt 2: 1件ずつ INSERT + Retry
**却下理由**:
- パフォーマンスが悪い（~30秒）
- タイムアウトリスクが高い

## Future Work

1. **Monitoring**:
   - failed 件数の推移を Cloudflare Analytics で追跡
   - 閾値超過時にアラート

2. **Retry Logic**:
   - chunk 失敗時の自動 retry（指数バックオフ）
   - 最大 3 回まで retry

3. **Audit Log Analysis**:
   - chunk_index + request_id で復旧手順を自動化
   - failed 件数のダッシュボード化

## References

- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [D1 Batch API](https://developers.cloudflare.com/d1/platform/client-api/#batch-statements)
- ADR-0001: Tenant Isolation
- ADR-0002: Cursor Pagination
- ADR-0003: Billing Gate
