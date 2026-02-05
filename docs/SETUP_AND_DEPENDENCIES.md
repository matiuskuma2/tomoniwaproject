# セットアップ・依存関係ガイド

> **最終更新**: 2026-02-05
> **対象**: 新規開発者・サンドボックス復旧時

---

## 目次

1. [必要な外部サービス](#1-必要な外部サービス)
2. [ローカル開発環境セットアップ](#2-ローカル開発環境セットアップ)
3. [環境変数一覧](#3-環境変数一覧)
4. [npm依存関係](#4-npm依存関係)
5. [データベースセットアップ](#5-データベースセットアップ)
6. [本番デプロイ手順](#6-本番デプロイ手順)
7. [トラブルシューティング](#7-トラブルシューティング)

---

## 1. 必要な外部サービス

### 必須

| サービス | 用途 | 取得場所 |
|----------|------|----------|
| **Cloudflare** | Workers, Pages, D1, KV, R2 | https://dash.cloudflare.com |
| **Google Cloud** | OAuth, Calendar API, Meet | https://console.cloud.google.com |
| **OpenAI** | AI応答 (nlRouter) | https://platform.openai.com |
| **Resend** | メール送信 | https://resend.com |

### オプション

| サービス | 用途 | 取得場所 |
|----------|------|----------|
| **Sentry** | エラー追跡 | https://sentry.io |

---

## 2. ローカル開発環境セットアップ

### 前提条件

```bash
# Node.js 18+
node --version  # v18.x.x 以上

# npm
npm --version

# Git
git --version

# Wrangler CLI
npm install -g wrangler
wrangler --version
```

### クイックスタート

```bash
# 1. リポジトリクローン
git clone https://github.com/matiuskuma2/tomoniwaproject.git
cd tomoniwaproject

# 2. 依存関係インストール
npm install
cd frontend && npm install && cd ..

# 3. 環境変数設定
cp .dev.vars.example .dev.vars
# .dev.vars を編集して必要な値を設定

# 4. ローカルDB初期化
npm run db:reset:local

# 5. 開発サーバー起動
npm run build
pm2 start ecosystem.config.cjs

# 6. 動作確認
curl http://localhost:3000/api/health
```

### PM2 コマンド

```bash
pm2 list                    # 一覧
pm2 logs webapp --nostream  # ログ確認
pm2 restart webapp          # 再起動
pm2 delete webapp           # 停止・削除
```

---

## 3. 環境変数一覧

### .dev.vars (ローカル開発用)

```bash
# ========================================
# 認証・OAuth
# ========================================
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# ========================================
# AI / OpenAI
# ========================================
OPENAI_API_KEY=sk-...

# ========================================
# メール送信 (Resend)
# ========================================
RESEND_API_KEY=re_...

# ========================================
# 公開URL
# ========================================
PUBLIC_URL=http://localhost:3000
APP_URL=http://localhost:5173

# ========================================
# セキュリティ
# ========================================
JWT_SECRET=your-jwt-secret-at-least-32-chars

# ========================================
# オプション
# ========================================
LOG_LEVEL=debug
```

### wrangler.jsonc (本番用)

```jsonc
{
  "name": "webapp",
  "main": "apps/api/src/index.ts",
  "compatibility_date": "2024-01-01",
  "compatibility_flags": ["nodejs_compat"],
  
  // D1 データベース
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tomoniwao-production",
      "database_id": "xxx"
    }
  ],
  
  // KV (OTP, Rate Limiting)
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "xxx"
    }
  ],
  
  // Queues (メール送信)
  "queues": {
    "producers": [
      { "binding": "EMAIL_QUEUE", "queue": "email-queue" }
    ],
    "consumers": [
      { "queue": "email-queue", "max_batch_size": 10 }
    ]
  },
  
  // R2 (ファイルストレージ)
  "r2_buckets": [
    {
      "binding": "R2",
      "bucket_name": "tomoniwao-storage"
    }
  ]
}
```

### GitHub Secrets (CI/CD用)

| Secret | 説明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Wrangler デプロイ用 |
| `E2E_BASE_URL` | E2Eテスト用URL |
| `E2E_AUTH_TOKEN` | E2Eテスト用認証トークン |

---

## 4. npm依存関係

### ルート (apps/api)

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "jose": "^5.0.0",
    "@hono/zod-validator": "^0.2.0",
    "zod": "^3.22.0",
    "date-fns": "^2.30.0",
    "date-fns-tz": "^2.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "wrangler": "^3.78.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### フロントエンド (frontend)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0",
    "typescript": "^5.0.0",
    "@playwright/test": "^1.40.0",
    "tailwindcss": "^3.4.0"
  }
}
```

### 依存関係更新

```bash
# 脆弱性チェック
npm audit

# 更新
npm update

# 特定パッケージ更新
npm update wrangler
```

---

## 5. データベースセットアップ

### ローカル開発

```bash
# 全マイグレーション適用 + シードデータ
npm run db:reset:local

# マイグレーションのみ
npm run db:migrate:local

# 特定のSQLファイル実行
npx wrangler d1 execute DB --local --file=./db/migrations/xxxx.sql
```

### 本番

```bash
# マイグレーション適用
npm run db:migrate:prod

# または
npx wrangler d1 migrations apply DB --remote
```

### マイグレーションファイル構造

```
db/migrations/
├── 0001_initial_schema.sql
├── 0002_xxx.sql
├── ...
├── 0088_create_pool_booking.sql
├── 0089_add_last_assigned_member_id_to_pools.sql
└── 0090_create_blocks_and_pool_public_links.sql
```

### ローカルDBリセット

```bash
# .wrangler/state/v3/d1 を削除してリセット
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local
```

---

## 6. 本番デプロイ手順

### API (Cloudflare Workers)

```bash
# 1. ビルド確認
npm run build

# 2. デプロイ
npx wrangler deploy

# 3. 確認
curl https://webapp.snsrilarc.workers.dev/health
```

### フロントエンド (Cloudflare Pages)

```bash
# 1. ビルド
cd frontend
npm run build

# 2. デプロイ
npx wrangler pages deploy dist --project-name tomoniwao-frontend

# 3. 確認
curl https://app.tomoniwao.jp/version.json
```

### データベースマイグレーション

```bash
# 本番DBにマイグレーション適用
npx wrangler d1 migrations apply DB --remote
```

### デプロイチェックリスト

- [ ] `npm run build` が成功
- [ ] `npm test` が成功
- [ ] ローカルで動作確認済み
- [ ] マイグレーションファイルが最新
- [ ] 環境変数・Secretsが設定済み
- [ ] デプロイ後のヘルスチェック

---

## 7. トラブルシューティング

### ローカル開発でAPIが起動しない

```bash
# ポート使用中
fuser -k 3000/tcp

# PM2プロセス確認
pm2 list
pm2 delete all

# 再起動
npm run build
pm2 start ecosystem.config.cjs
```

### D1データベースエラー

```bash
# ローカルDBリセット
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local

# マイグレーション確認
npx wrangler d1 migrations list DB --local
```

### TypeScriptエラー

```bash
# 型チェック
npx tsc --noEmit

# よくある原因
# - 環境変数の型定義: packages/shared/src/types/env.ts
# - import/export のズレ
```

### E2Eテスト失敗

```bash
# 認証情報確認
echo $E2E_AUTH_TOKEN

# APIヘルスチェック
curl http://localhost:3000/api/health

# テスト個別実行
cd frontend
npx playwright test e2e/smoke.smoke.spec.ts --debug
```

### 本番デプロイ失敗

```bash
# Wrangler認証確認
npx wrangler whoami

# デプロイログ確認
npx wrangler deploy --dry-run
```

---

## 付録: よく使うコマンド

```bash
# === 開発 ===
npm run build                    # ビルド
npm run dev:sandbox              # 開発サーバー
pm2 restart webapp               # API再起動

# === データベース ===
npm run db:reset:local           # ローカルDBリセット
npm run db:migrate:local         # マイグレーション適用
npm run db:migrate:prod          # 本番マイグレーション

# === テスト ===
npm test                         # 全テスト
npm run test:e2e                 # E2Eテスト
npx playwright test --debug      # デバッグモード

# === デプロイ ===
npx wrangler deploy              # API デプロイ
npx wrangler pages deploy dist   # Frontend デプロイ

# === 確認 ===
curl http://localhost:3000/api/health  # ローカル
curl https://webapp.snsrilarc.workers.dev/health  # 本番API
curl https://app.tomoniwao.jp/version.json  # 本番Frontend
```

---

*このドキュメントは定期的に更新されます。*
