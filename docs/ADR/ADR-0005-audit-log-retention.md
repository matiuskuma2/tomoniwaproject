# ADR-0005: Audit Log Retention Policy

**Status**: Accepted  
**Date**: 2026-01-03  
**Context**: P0-2 Log Bloat Prevention

## Context

監査ログ（ledger_audit_events, list_item_events, billing_events）が増え続けると、以下のリスクが発生：

1. **コスト増加**: D1 ストレージコストが直線的に増加
2. **パフォーマンス低下**: テーブルサイズが大きくなると検索が遅くなる
3. **運用負荷**: ログが多すぎて調査が困難になる
4. **D1 逼迫**: ストレージ上限に到達してサービス停止

## Decision

### 1. Retention Policy（保存期間）

| ログテーブル | 保存期間 | 理由 |
|-------------|---------|------|
| ledger_audit_events | 90日 | 運用インシデント調査に十分 |
| access_denied logs | 30日 | 高頻度（攻撃ログ）、短期で十分 |
| list_item_events | 90日 | アイテム履歴追跡 |
| billing_events | 180日 | 会計・コンプライアンス対応 |

### 2. Payload Size Limit（肥大防止）

- **Max 8KB per payload**
- 超過時は自動 truncate with metadata
- `{ _truncated: true, _original_bytes: 12345, _summary: {...} }` 形式

### 3. 自動削除（Cron）

```typescript
// wrangler.jsonc
"triggers": {
  "crons": [
    "0 2 * * *",  // Daily cleanup
    "0 * * * *"   // Hourly budget check
  ]
}

// Scheduled handler
async function scheduled(event, env, ctx) {
  if (event.cron === '0 2 * * *') {
    await pruneAuditLogs(env.DB);
  }
}
```

**削除方式**:
- LIMIT 5000 でチャンク削除（タイムアウト防止）
- created_at < cutoff で古いログから削除
- access_denied のみ 30日（他は 90/180日）

### 4. Implementation Details

#### Payload Clamping
```typescript
// utils/payloadClamp.ts
export function clampPayload(payload: any): ClampResult {
  const jsonString = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(jsonString).length;

  if (bytes <= MAX_PAYLOAD_BYTES) {
    return { payload, truncated: false };
  }

  return {
    payload: {
      _truncated: true,
      _original_bytes: bytes,
      _summary: truncateSummary(payload),
    },
    truncated: true,
    originalBytes: bytes,
  };
}
```

#### Scheduled Pruning
```typescript
// scheduled/pruneAuditLogs.ts
export async function pruneAuditLogs(db: D1Database) {
  const ledgerCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const accessDeniedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Delete in chunks (5000 rows per execution)
  await db.prepare(
    `DELETE FROM ledger_audit_events 
     WHERE created_at < ? AND action != 'access_denied'
     LIMIT 5000`
  ).bind(ledgerCutoff.toISOString()).run();

  await db.prepare(
    `DELETE FROM ledger_audit_events 
     WHERE created_at < ? AND action = 'access_denied'
     LIMIT 5000`
  ).bind(accessDeniedCutoff.toISOString()).run();
}
```

## Consequences

### ✅ Positive
- ストレージコストが一定に保たれる
- 検索パフォーマンスが安定
- 運用インシデント調査が容易（必要な期間のログは残る）
- D1 逼迫リスクが軽減

### ⚠️ Negative
- 90日以前のログは参照不可
- 削除は非可逆（復元不可）

### 🔄 Mitigation
- 重要ログは別途アーカイブ（R2 など）
- Retention 期間は運用状況に応じて調整可能
- 削除前にログサイズをモニタリング

## Alternatives

### Alt 1: 無制限保存
**却下理由**:
- コストが無限に増加
- パフォーマンス劣化
- 運用負荷増

### Alt 2: 外部ログサービス（Datadog, Splunk）
**却下理由**:
- コスト高（未公開フェーズで不要）
- D1 で十分対応可能

### Alt 3: Cold Storage（R2）へアーカイブ
**将来検討**:
- 90日経過ログを R2 に移動
- コスト効率的（R2 は安価）
- 検索は困難（S3 Select など必要）

## Future Work

1. **Monitoring**:
   - 削除ログ数の推移をトラッキング
   - ストレージサイズの推移を可視化

2. **Archive to R2**:
   - 90日経過ログを R2 に移動
   - Parquet 形式で圧縮保存

3. **Alerting**:
   - payload truncate 発生時にアラート
   - 削除失敗時にアラート

## References

- [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- ADR-0004: Batch Transaction Guarantees
