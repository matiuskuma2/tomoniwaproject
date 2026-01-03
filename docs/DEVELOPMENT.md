# 開発環境セットアップ

最終更新: **2026-01-03**

---

## 🚀 クイックスタート

### 前提条件
- Node.js 18+
- npm
- Git

### セットアップ

```bash
# 1. リポジトリクローン
git clone https://github.com/matiuskuma2/tomoniwaproject.git
cd tomoniwaproject

# 2. 依存関係インストール
npm install

# 3. ローカル DB セットアップ
npm run db:reset:local

# 4. 開発サーバー起動
npm run dev:sandbox
```

### 動作確認

```bash
# 別ターミナルで
curl http://localhost:3000/health
```

---

## 📂 プロジェクト構成

```
tomoniwaproject/
├── apps/
│   └── api/
│       └── src/
│           ├── index.ts           # エントリーポイント
│           ├── routes/            # API ルート
│           ├── repositories/      # DB アクセス層
│           ├── services/          # ビジネスロジック
│           ├── middleware/        # 認証・ログ等
│           └── utils/             # ユーティリティ
├── db/
│   ├── migrations/                # DB Migration
│   └── seeds/                     # Seed データ
├── docs/                          # ドキュメント
├── scripts/                       # スクリプト
│   └── p0/                        # P0 チェックスクリプト
├── wrangler.jsonc                 # Cloudflare 設定
├── package.json                   # 依存関係
└── README.md                      # プロジェクト概要
```

---

## 🛠️ 開発ワークフロー

### 1. ブランチ作成

```bash
git checkout -b feature/your-feature-name
```

### 2. 開発

```bash
# 開発サーバー起動（PM2 使用）
npm run dev:sandbox

# ログ確認（非ブロッキング）
pm2 logs --nostream

# サービス再起動（ポートクリーン → 再起動）
fuser -k 3000/tcp 2>/dev/null || true
npm run dev:sandbox
```

### 3. テスト

```bash
# TypeScript チェック
npm run build

# P0 チェック（OFFSET 禁止）
./scripts/p0/check-no-offset.sh

# P0 チェック（Migration 不変性）
./scripts/p0/check-migration-immutable.sh

# Tenant Isolation チェック
./scripts/p0/tenant-isolation-sql-check.sh
```

### 4. コミット

```bash
# ステージング
git add .

# コミット
git commit -m "feat: your feature description"

# プッシュ
git push origin feature/your-feature-name
```

---

## 🗄️ データベース

### ローカル DB 管理

```bash
# DB リセット（Migration のみ）
npm run db:reset:local

# DB リセット（Migration + Seed）
npm run db:reset:local:with-seed

# Migration 適用
npm run db:migrate:local

# Seed データ投入
npm run db:seed:local

# SQL 実行
npx wrangler d1 execute webapp-production --local --command="SELECT * FROM users LIMIT 5"
```

### Migration 作成

```bash
# 1. Migration ファイル作成
# db/migrations/0063_your_migration_name.sql

# 2. SQL 記述
-- db/migrations/0063_add_new_column.sql
ALTER TABLE users ADD COLUMN new_column TEXT;

# 3. ローカルで適用
npm run db:migrate:local

# 4. 動作確認
npx wrangler d1 execute webapp-production --local --command="PRAGMA table_info(users)"
```

**重要**:
- ✅ 過去の Migration は絶対に編集しない
- ✅ 失敗時は新しい fix migration を作成
- ✅ NOT NULL 列は DEFAULT 値を設定

---

## 🧪 テスト

### 手動テスト

```bash
# API テスト
curl http://localhost:3000/api/threads \
  -H "Authorization: Bearer test-token"

# 詳細ログ付き
curl -v http://localhost:3000/api/threads
```

### CI チェック

```bash
# 全チェック実行
npm run build
./scripts/p0/check-no-offset.sh
./scripts/p0/check-migration-immutable.sh
./scripts/p0/tenant-isolation-sql-check.sh
```

---

## 🔧 トラブルシューティング

### ポート 3000 が使用中

```bash
# ポートクリーン
npm run clean-port

# または
fuser -k 3000/tcp 2>/dev/null || true
```

### PM2 が動かない

```bash
# PM2 リスト確認
pm2 list

# PM2 再起動
pm2 restart webapp

# PM2 削除して再起動
pm2 delete webapp
npm run dev:sandbox
```

### DB Migration エラー

```bash
# DB リセット
npm run db:reset:local

# Migration ファイル確認
ls -la db/migrations/

# エラーログ確認
cat ~/.config/.wrangler/logs/wrangler-*.log
```

### TypeScript エラー

```bash
# TypeScript チェック
npm run build

# エラー詳細表示
npx tsc --noEmit
```

---

## 📊 開発ツール

### Wrangler

```bash
# バージョン確認
npx wrangler --version

# ヘルプ
npx wrangler --help

# D1 コマンド
npx wrangler d1 --help
```

### PM2

```bash
# サービス一覧
pm2 list

# ログ確認
pm2 logs webapp --nostream

# サービス削除
pm2 delete webapp
```

### Git

```bash
# 状態確認
npm run git:status

# ログ確認
npm run git:log

# コミット
npm run git:commit "message"
```

---

## 🎨 コーディング規約

### TypeScript
- strict mode 有効
- `any` は使わない（`unknown` を使用）
- 型定義は明示的に

### API Route
- 必ず `getTenant(c)` を呼ぶ
- エラーは適切な HTTP ステータスコードを返す
- ログに `request_id` を含める

### SQL
- WHERE 条件に `workspace_id` と `owner_user_id` を含める
- OFFSET 禁止（cursor pagination のみ）
- インデックスを活用

### Migration
- 過去の Migration は編集しない
- 失敗時は新しい fix migration を作成
- NOT NULL 列は DEFAULT 値を設定

---

## 🔗 関連リンク

- TypeScript: https://www.typescriptlang.org/
- Hono: https://hono.dev/
- Wrangler: https://developers.cloudflare.com/workers/wrangler/
- PM2: https://pm2.keymetrics.io/

---

## 📞 サポート

質問や問題がある場合:
1. `docs/KNOWN_ISSUES.md` を確認
2. `docs/STATUS.md` で現在の状況を確認
3. GitHub Issues で報告
