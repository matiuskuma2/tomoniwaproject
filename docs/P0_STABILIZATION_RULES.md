# P0 安定化ルール（運用インシデント防止）

## 🎯 目的

**「10万ユーザー × 1000リスト = 1億行」前提で、技術負債・運用インシデント・セキュリティを構造で防ぐ**

---

## 📋 P0 ルール（絶対厳守）

### 1. Migration 不変性（最重要）

**ルール**:
- ✅ 過去の migration は **絶対に削除・リネーム・編集しない**
- ✅ 失敗したら **新しい番号の fix migration** で修正
- ❌ コメントアウトで通す・NOOP化は **禁止**

**理由**:
- 環境差・再現不能・本番だけ死ぬを防ぐ

**CI で強制**:
- `scripts/p0/check-migration-immutable.sh`
- 過去 migration の D/R/M を検知 → PR ブロック

**例**:
```bash
# ❌ NG: 0053 を編集
# ✅ OK: 0062_fix_0053.sql を作成
```

---

### 2. Cursor Pagination Only（OFFSET 禁止）

**ルール**:
- ✅ すべての一覧取得は **cursor pagination**
- ❌ `LIMIT ? OFFSET ?` は **禁止**

**理由**:
- 1億行で OFFSET は遅延・結果が揺れる

**CI で強制**:
- `scripts/p0/check-no-offset.sh`
- routes に OFFSET が含まれたら → PR ブロック

**実装パターン**:
```sql
-- ✅ Cursor pagination (DESC前提)
WHERE (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC
LIMIT ?

-- ❌ OFFSET pagination（禁止）
ORDER BY created_at DESC
LIMIT ? OFFSET ?
```

**Index 設計**:
```sql
CREATE INDEX idx_threads_cursor 
  ON scheduling_threads(workspace_id, organizer_user_id, created_at DESC, id DESC);
```

---

### 3. Tenant Isolation 完全強制

**ルール**:
- ✅ すべての API で `getTenant(c)` から tenant 取得
- ✅ すべての SQL で `WHERE workspace_id = ? AND (owner_user_id | organizer_user_id) = ?`
- ✅ 越境アクセス時は **404** で存在を隠す（403 ではない）

**理由**:
- 1箇所でも漏れたら情報漏洩

**CI で強制**:
- `scripts/p0/tenant-smoke.sh`
- userA の resource に userB がアクセス → 404 を確認

**Phase1 固定**:
- `workspace_id = 'ws-default'`（論理値、DB に入れない）
- `owner_user_id = userId`（middleware で強制設定）

**threads の例外**:
- threads は `organizer_user_id` を使用（他は `owner_user_id`）
- Phase1 の例外として固定

---

### 4. TypeScript Build 必須

**ルール**:
- ✅ PR マージ前に `npm run build` が通ること
- ❌ `as any` の乱用は禁止

**理由**:
- 型安全を破ると運用事故の種

**CI で強制**:
- `npm run build` が失敗 → PR ブロック

---

### 5. Migration 適用テスト

**ルール**:
- ✅ PR マージ前に `npm run db:migrate:local` が通ること
- ✅ seed は **別実行**（migrate と切り離す）

**理由**:
- migrate が通らないと本番デプロイ不能

**CI で強制**:
- `npm run db:migrate:local` が失敗 → PR ブロック

---

## 🚀 開発フロー

### ローカル開発

```bash
# 1. Migration適用（seedなし）
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local

# 2. サーバー起動
npm run dev

# 3. Tenant smoke test（手動）
./scripts/p0/tenant-smoke.sh
```

### PR 作成前

```bash
# P0チェック（ローカルで事前確認）
./scripts/p0/check-migration-immutable.sh
./scripts/p0/check-no-offset.sh
npm run build
npm run db:migrate:local
```

### CI で自動実行

- `.github/workflows/p0-guardrails.yml`
- すべての P0 チェックが PASS → マージ可能

---

## 📊 スケール前提の設計固定

### 10万ユーザー × 1000リスト = 1億行前提

1. **cursor pagination only**
   - OFFSET は遅延・結果揺れの原因

2. **tenant isolation 完全強制**
   - 1箇所でも漏れたら情報漏洩

3. **index 必須**
   - WHERE/ORDER BY と一致させる

4. **監査ログ**
   - access_denied / request_id / source_ip / user_agent

5. **検索の割り切り**
   - 曖昧全文検索は外部 index（Meilisearch/Typesense）
   - D1 では key 検索と prefix まで

---

## 🔍 監査ログ設計

### 最小要件

```typescript
{
  workspace_id: string;
  actor_user_id: string;
  target_type: 'list' | 'contact' | 'thread' | 'list_member';
  target_id: string;
  action: 'create' | 'update' | 'delete' | 'access_denied';
  request_id: string;  // 追跡用
  source_ip?: string;
  user_agent?: string;
  payload?: {
    invalid_ids?: string[];  // 最大50件まで
    count?: number;
  };
}
```

### ログ肥大防止

- `invalid_ids` は最大 50 件まで
- それ以上は `count` のみ

---

## ⚠️ 注意事項（運用インシデント観点）

### 1. Migration 運用

- 過去 migration は絶対に触らない
- CI で検知 → PR マージ拒否

### 2. threads の例外

- threads は `organizer_user_id` を使用（他は `owner_user_id`）
- Phase1 の例外として固定
- 将来的に統一する場合は別 Migration 必要

### 3. seed 運用

- `npm run db:reset:local` は seed でエラーが出る場合あり
- Migration のみ適用する場合: `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local`

### 4. E2E テスト

- 開発環境のみ実行可能（x-user-id ヘッダー必須）
- 本番環境では session/Bearer token 使用

---

## 📋 チェックリスト（PR レビュー時）

### Migration

- [ ] 過去 migration を編集していないか？
- [ ] 新しい migration は連番か？
- [ ] `npm run db:migrate:local` が通るか？

### Pagination

- [ ] OFFSET を使っていないか？
- [ ] cursor pagination を使っているか？
- [ ] index が WHERE/ORDER BY と一致しているか？

### Tenant Isolation

- [ ] `getTenant(c)` を使っているか？
- [ ] SQL に `WHERE workspace_id = ? AND owner_user_id = ?` があるか？
- [ ] 越境時に 404 を返しているか？

### TypeScript

- [ ] `npm run build` が通るか？
- [ ] `as any` の乱用はないか？

### 監査ログ

- [ ] `request_id` / `source_ip` / `user_agent` を記録しているか？
- [ ] `invalid_ids` は最大 50 件までか？

---

**✅ P0 安定化ルール: これだけ守れば運用インシデント・技術負債を構造で防げる**
