# Tomoniwao Frontend

AI秘書スケジューラー - PWAフロントエンド

## 🎯 プロジェクト概要

このリポジトリは、TomoniwaoのPWAフロントエンドです。バックエンドAPI（Cloudflare Workers）と分離した構成で、将来のネイティブアプリ化（Capacitor/React Native）を見据えた設計になっています。

## 🏗️ アーキテクチャ

### デプロイ構成（A案：同一オリジン）
- **URL**: `app.tomoniwao.jp`
- **Frontend**: Cloudflare Pages（`/*`）
- **Backend**: Cloudflare Workers（`/api/*`）
- **認証**: Cookie session → Bearer token

### ディレクトリ構造（ネイティブ移行対応）
```
src/
├── core/                # ネイティブ移行時も再利用可能
│   ├── api/            # API client（fetch wrapper + token注入）
│   ├── auth/           # Token管理（sessionStorage）
│   └── models/         # 型定義（Thread, Contact, List等）
├── pages/              # 画面（UIのみ、ビジネスロジックはAPI側）
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── ThreadDetailPage.tsx
│   ├── ContactsPage.tsx
│   └── ListsPage.tsx
└── components/         # 共通UI部品（未実装）
```

## 🛠️ 技術スタック

- **Framework**: React 19
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS v3.4.17
- **Router**: React Router v7
- **State**: Zustand（最小利用）
- **HTTP**: fetch（Axios不使用）

## 🚀 開発環境セットアップ

### 必要なもの
- Node.js 18+
- npm

### インストール
```bash
npm install
```

### 開発サーバー起動
```bash
npm run dev
```

デフォルトで `http://localhost:5173` で起動します。

## 📋 MVP機能（5画面）

### 1. Login（Google OAuth）
- `/` - Googleログインボタン
- OAuth callback処理
- Bearer token取得 & sessionStorage保存

### 2. Dashboard（Threads一覧）
- `/dashboard` - スレッド一覧表示
- ステータス表示（draft/active/confirmed/cancelled）
- 新規スレッド作成（将来実装）

### 3. Thread Detail（日程調整詳細）
- `/threads/:threadId` - スレッド詳細
- 進捗状況（未回答/承諾/辞退）
- リマインダー送信
- 日程確定 & Google Meet生成

### 4. Contacts（連絡先管理）
- `/contacts` - 連絡先一覧・検索
- 新規連絡先追加
- 種別・関係性・タグ管理

### 5. Lists（送信セグメント）
- `/lists` - リスト一覧
- リスト作成・メンバー管理
- 一括招待送信（→ Thread作成）

## 🔐 認証フロー

```
1. /auth/google/start → Google OAuth
2. Callback → POST /auth/token（credentials: include）
3. access_token取得 → sessionStorage保存
4. 以降全APIコール → Authorization: Bearer <token>
```

**ポイント**:
- Cookie sessionは `/auth/token` でのみ使用
- 以降は Bearer token認証（ネイティブ移行対応）
- 同一オリジン（A案）なのでCookie問題なし

## 🌐 環境変数

### 開発環境（`.env.development`）
```
VITE_API_BASE_URL=http://localhost:3000
```

### 本番環境（`.env.production`）
```
VITE_API_BASE_URL=
```

本番では同一オリジンなので空文字（相対パス）。

## 📦 ビルド & デプロイ

### ビルド
```bash
npm run build
```

`dist/` ディレクトリに静的ファイルが生成されます。

### Cloudflare Pages デプロイ
```bash
npm run deploy
```

または：
```bash
npx wrangler pages deploy dist --project-name tomoniwao-frontend
```

## 🧪 開発ガイドライン

### Core Layerの原則
1. **API Client**: 全てのAPIコールは `src/core/api/` 経由
2. **Auth**: Token管理は `src/core/auth/` に集約
3. **Models**: 型定義は `src/core/models/` に集約

### Pagesの原則
1. **薄いUI**: データ取得 → 表示 → 操作 → API呼び出しのみ
2. **ビジネスロジック**: 判定・整合チェックは全てAPI側
3. **状態管理**: 最小限（必要なら Zustand）

### ネイティブ移行時
- `src/core/` はそのまま流用
- `src/pages/` & `src/components/` のみ置き換え

## 📚 関連リポジトリ

- **Backend API**: [webapp](https://github.com/matiuskuma2/tomoniwaproject)（Cloudflare Workers）

## 🎨 将来の拡張

### 短期（1-2週間）
- [ ] ナビゲーションメニュー
- [ ] ローディング・エラー統一UI
- [ ] レスポンシブ最適化

### 中期（1ヶ月）
- [ ] shadcn/ui導入
- [ ] Service Worker（PWA化）
- [ ] Offline対応

### 長期（3ヶ月）
- [ ] Capacitor統合（iOS/Android）
- [ ] React Native移行検討

## 📝 開発メモ

- Tailwind v3.4.17に固定（動作確認済み）
- React Router v7使用（ProtectedRoute実装済み）
- TypeScript strict mode有効

---

**作成日**: 2025-12-27  
**ステータス**: MVP完成・動作確認待ち  
**次のステップ**: Cloudflare Pages デプロイ & 本番API接続
