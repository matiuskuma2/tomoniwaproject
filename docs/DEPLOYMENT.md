# デプロイ手順

最終更新: **2026-01-03**

---

## 🚀 本番デプロイ

### 前提条件
- Cloudflare アカウント
- Cloudflare API Key（Global API Key または API Token）
- Wrangler CLI インストール済み

---

## 📋 デプロイ手順

### 1. Cloudflare API Key 設定

#### Global API Key の場合
```bash
# ~/.wrangler/config/default.toml を作成
mkdir -p ~/.wrangler/config
cat > ~/.wrangler/config/default.toml << 'EOF'
[auth]
email = "your-email@example.com"
api_key = "your-global-api-key"
EOF
```

#### 認証確認
```bash
npx wrangler whoami
# 出力: You are logged in with an Global API Key, associated with the email ...
```

---

### 2. プロジェクト名確認

```bash
# wrangler.jsonc の name を確認
cat wrangler.jsonc | grep '"name"'
# 出力: "name": "webapp",
```

---

### 3. ビルド

```bash
npm run build
# TypeScript チェックのみ（vite build ではない）
```

---

### 4. 本番 DB Migration 適用（初回 or 新規 Migration 時）

```bash
# Migration 状態確認
npx wrangler d1 migrations list webapp-production --remote

# Migration 適用
npx wrangler d1 migrations apply webapp-production --remote
```

**注意**:
- Migration は1回のみ実行
- 適用前に必ず状態確認
- 失敗時はロールバック不可（fix migration を作成）

---

### 5. デプロイ実行

```bash
npx wrangler deploy
```

**出力例**:
```
Total Upload: 223.14 KiB / gzip: 59.89 KiB
Worker Startup Time: 17 ms
Your Worker has access to the following bindings:
...
Deployed webapp triggers (2.13 sec)
  https://webapp.snsrilarc.workers.dev
  schedule: 0 2 * * *
  schedule: 0 * * * *
Current Version ID: 1a100603-ae81-4a10-9e8f-1328900f9b15
```

---

### 6. 動作確認

#### Health Check
```bash
curl https://webapp.snsrilarc.workers.dev/health
```

#### API 確認（要認証）
```bash
curl https://webapp.snsrilarc.workers.dev/api/threads \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🔧 環境変数設定

### Secrets 設定

```bash
# API Key など機密情報は wrangler secret で設定
npx wrangler secret put RESEND_API_KEY --project-name webapp
# 入力: [secret value]

# 確認
npx wrangler secret list --project-name webapp
```

### 環境変数（wrangler.jsonc）

```jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "LOG_LEVEL": "info",
    "CORS_ORIGINS": "*",
    "AI_FALLBACK_ENABLED": "false"
  }
}
```

---

## 🗄️ D1 Database 管理

### Database 作成（初回のみ）

```bash
npx wrangler d1 create webapp-production
# 出力: database_id をコピーして wrangler.jsonc に貼り付け
```

### Migration 管理

```bash
# ローカル Migration 適用
npm run db:migrate:local

# 本番 Migration 適用
npm run db:migrate:prod

# Migration 状態確認（本番）
npx wrangler d1 migrations list webapp-production --remote

# SQL 実行（本番）
npx wrangler d1 execute webapp-production --remote --command="SELECT COUNT(*) FROM users"
```

---

## 📊 ログ確認

### Wrangler Tail

```bash
# リアルタイムログ
npx wrangler tail

# フィルター
npx wrangler tail --status error
```

### Cloudflare Dashboard

1. Cloudflare Dashboard にログイン
2. Workers & Pages → webapp
3. Logs タブ

---

## 🔄 ロールバック

### コードロールバック

```bash
# 以前のバージョンに戻す（Cloudflare Dashboard から）
# Workers & Pages → webapp → Deployments → [Previous Version] → Rollback
```

### Migration ロールバック

**注意**: D1 は Migration ロールバックをサポートしていません。

**対処法**:
1. 新しい fix migration を作成
2. 失敗した migration の逆操作を記述
3. 適用

例:
```sql
-- 0063_rollback_0062.sql
-- 0062 で追加した列を削除
ALTER TABLE thread_participants DROP COLUMN contact_id;
```

---

## 🚨 トラブルシューティング

### エラー: "ENOENT: no such file or directory, scandir 'dist'"
- **原因**: Vite ビルドが実行されていない
- **対処**: `npm run build` は TypeScript チェックのみ。Cloudflare Workers は Wrangler が自動ビルド。

### エラー: "Authentication failed"
- **原因**: API Key が設定されていない
- **対処**: `~/.wrangler/config/default.toml` を確認

### エラー: "Database not found"
- **原因**: wrangler.jsonc の database_id が間違っている
- **対処**: `npx wrangler d1 create` で作成し、database_id をコピー

### エラー: "Migration failed"
- **原因**: SQL エラー or 既に適用済み
- **対処**: 
  - エラーログ確認
  - 既に適用済みなら skip
  - SQL エラーなら fix migration 作成

---

## 📈 パフォーマンス最適化

### Bundle Size 削減
- 不要な依存関係を削除
- Tree shaking を活用
- Wrangler の minify を有効化（wrangler.jsonc）

### Cold Start 削減
- Worker Startup Time を監視
- 重い初期化処理を避ける
- lazy import を活用

---

## 🔐 セキュリティ

### Secrets 管理
- **絶対に** Git にコミットしない
- `wrangler secret put` を使用
- `.env` ファイルは `.gitignore` に追加

### CORS 設定
- 本番環境では CORS_ORIGINS を制限
- `wrangler.jsonc` の `vars.CORS_ORIGINS` を編集

---

## 📅 定期メンテナンス

### 毎週
- ✅ ログ確認
- ✅ エラー率確認
- ✅ パフォーマンス確認

### 毎月
- ✅ 依存関係更新
- ✅ セキュリティパッチ適用
- ✅ DB 容量確認

---

## 🔗 関連リンク

- Cloudflare Dashboard: https://dash.cloudflare.com
- Wrangler Docs: https://developers.cloudflare.com/workers/wrangler/
- D1 Docs: https://developers.cloudflare.com/d1/
