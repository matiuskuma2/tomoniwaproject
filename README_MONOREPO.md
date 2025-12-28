# ToMoniWao - AI秘書スケジューラー（Monorepo）

AI秘書スケジューラー - 音声指示で予定調整を自動化するPWA

---

## 📁 プロジェクト構成（Monorepo）

```
tomoniwaproject/
├── apps/                    # Backend API (Cloudflare Workers)
│   └── api/                 # Hono API
├── frontend/                # Frontend SPA (React + Vite)
│   ├── src/
│   │   ├── core/           # Core layer (API client, Auth, Models)
│   │   ├── pages/          # UI Pages (Login, Dashboard, Threads, etc.)
│   │   └── components/     # Reusable UI components
│   └── dist/               # Build output
├── packages/                # Shared packages
│   └── shared/             # Shared types and utilities
├── db/                      # Database migrations
│   └── migrations/
├── wrangler.jsonc           # Cloudflare Workers config
└── README.md                # This file
```

---

## 🎯 アーキテクチャ

### Backend（Cloudflare Workers）
- **役割**: API、認証、DB、Queue、Cron、Meet生成
- **技術**: Hono + TypeScript
- **データ**: D1 (SQLite), KV, R2, Queue
- **デプロイ**: `npx wrangler deploy`

### Frontend（Cloudflare Pages）
- **役割**: UI（画面表示 + API呼び出し）
- **技術**: React 19 + Vite 7 + TypeScript + Tailwind CSS
- **Core Layer**: ネイティブ移行対応（API client、Auth、Models分離）
- **デプロイ**: `npx wrangler pages deploy frontend/dist --project-name=webapp`

### 同一オリジン設計（Cookie/Session対応）
```
app.tomoniwao.jp/
├── /*                 → Pages (Frontend)
├── /api/*             → Workers (Backend API)
├── /auth/*            → Workers (OAuth)
└── /i/:token          → Workers (外部招待ページ)
```

---

## 🚀 クイックスタート

### 1. 環境構築

```bash
# Dependencies
npm install

# Frontend dependencies
cd frontend
npm install
cd ..
```

### 2. ローカル開発

```bash
# Backend (Workers)
npm run dev:local
# → http://localhost:3000

# Frontend (React)
cd frontend
npm run dev
# → http://localhost:5173
```

### 3. ビルド

```bash
# Backend
npm run build

# Frontend
cd frontend
npm run build
cd ..
```

### 4. デプロイ

```bash
# Backend (Workers)
npm run deploy

# Frontend (Pages) - 既存webapp Pagesを上書き
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=webapp
cd ..
```

---

## 📱 ネイティブアプリ対応

### Web Shell設計
Frontend（React SPA）は **Web Shell** として設計されています。

**Core Layer分離**:
- `frontend/src/core/api/` - API client（fetch wrapper）
- `frontend/src/core/auth/` - Token管理
- `frontend/src/core/models/` - 型定義

**ネイティブ移行時**:
- iOS/Android: Capacitor or React Native
- Core Layer: そのまま再利用
- Backend API: 変更なし

---

## 🔧 主要コマンド

### Backend

```bash
# ローカル開発（D1含む）
npm run dev:local

# 本番デプロイ
npm run deploy

# D1マイグレーション
npm run db:migrate:local   # ローカル
npm run db:migrate:prod    # 本番

# ログ確認
npm run logs
```

### Frontend

```bash
cd frontend

# 開発サーバー
npm run dev

# ビルド
npm run build

# Pages デプロイ
npm run deploy
```

---

## 🌐 URL構成

### 開発環境
- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`

### 本番環境
- Production: `https://app.tomoniwao.jp`
- Workers API: `https://webapp.snsrilarc.workers.dev` (fallback)
- Pages: `https://webapp-6t3.pages.dev` (fallback)

---

## 📊 データベーススキーマ

主要テーブル：
- `users` - ユーザー
- `google_accounts` - Google連携（refresh_token保存）
- `sessions` - セッション管理
- `threads` - スケジュール調整スレッド
- `thread_invites` - 招待トークン（/i/:token）
- `contacts` - 連絡先
- `lists` / `list_members` - リスト管理
- `business_cards` - 名刺情報

詳細: `db/migrations/`

---

## 🔐 認証フロー

1. `/auth/google/start` → Google OAuth開始
2. Google → `/auth/google/callback` (Workers)
   - `Cookie: session=<token>` をセット
   - `/` にリダイレクト
3. `POST /auth/token` （Cookie必須）
   - access_token返却
   - フロントはsessionStorage保存
4. 以降全API: `Authorization: Bearer <token>`

---

## 📝 開発ガイドライン

### Git運用
```bash
# コミット前に確認
git status
git diff

# コミット
git add .
git commit -m "feat: 機能追加の説明"

# プッシュ
git push origin main
```

### フロントエンド開発
- **Core Layer**: API/Auth/Models（ネイティブ移行対応）
- **Pages**: 薄いUI、ビジネスロジックは全てAPI側
- **State管理**: Zustand（最小限）
- **スタイル**: Tailwind CSS

### バックエンド開発
- **Hono**: 軽量Webフレームワーク
- **Repository Pattern**: DB操作の抽象化
- **Middleware**: 認証、CORS、Rate Limiting

---

## 🆘 トラブルシューティング

### Cookie/Session問題
- 同一オリジン（app.tomoniwao.jp）で運用
- Workers Routesが正しく設定されているか確認

### Build失敗
```bash
# キャッシュクリア
rm -rf node_modules package-lock.json
npm install

# Frontend
cd frontend
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

### デプロイ失敗
```bash
# Wrangler認証確認
npx wrangler whoami

# 再認証（必要な場合）
npx wrangler login
```

---

## 📚 詳細ドキュメント

- [Backend詳細](./apps/api/README.md)
- [Frontend詳細](./frontend/README.md)
- [Migration履歴](./MIGRATION_STATUS.md)
- [セットアップ完了](./SETUP_COMPLETE.md)

---

**最終更新**: 2025-12-28  
**ステータス**: Monorepo統合完了、Pages上書き準備完了
