# AI Secretary Scheduler

AI秘書スケジューラー - チャット中心のスケジューリングシステム

---

## 🎯 プロジェクト概要

### ビジョン
「まだ見たことのない欲しかったを形にする」

複数人の日程調整を AI とチャットで完結させる、次世代スケジューリングシステム。

### 目標
- **MVP**: チャット UI、スレッド管理、Google Calendar 同期、外部招待調整
- **51点ゴール**: WorkItem 統合、1対1調整（URL完結）、自動 contacts、共有リスト
- **除外**: N対N 調整、深い機能（Quest/Squad/Partner/Family の複雑機能）

---

## 🚀 技術スタック

### インフラ
- **Frontend**: Cloudflare Pages (PWA)
- **API**: Cloudflare Workers (Hono)
- **Database**: Cloudflare D1 (SQLite)
- **KV Storage**: Cloudflare KV (OTP, Rate Limiting)
- **Queue**: Cloudflare Queues (Email sending)
- **Storage**: Cloudflare R2 (Voice recordings, exports)

### 開発環境
- **Language**: TypeScript
- **Framework**: Hono (Cloudflare Workers)
- **Database**: D1 (SQLite)
- **Tools**: Wrangler, PM2

---

## 📊 現在の状況（2026-01-03）

### ✅ 完了
- **P0 土台固め**:
  - Tenant Isolation（全 API で workspace_id/owner_user_id 強制）
  - Cursor Pagination Only（OFFSET 完全禁止）
  - Migration 不変性（CI で過去 migration 編集を検知）
  - TypeScript Build 必須化
- **Day4 Billing Gate**:
  - checkBillingGate 実装（status=2/4 → 402）
  - 実行系のみ制御（finalize/remind）
  - reason フィールド（運用インシデント切り分け）
  - normalizeEmail 共通化
- **本番環境**:
  - コードデプロイ完了
  - DB Migration 適用完了（0001-0062）
  - フロントエンド正常動作確認

### 🔄 進行中
- ドキュメント整備
- Beta 公開準備

### 📅 次の予定
- Beta ユーザー招待
- UI/UX 改善
- Phase2 マルチテナント対応

---

## 📂 ドキュメント構成

### ルートドキュメント
- `README.md`: プロジェクト全体概要（このファイル）
- `docs/STATUS.md`: 最新の実装状況・次の一手
- `docs/KNOWN_ISSUES.md`: 既知の問題一覧

### 設計ドキュメント（docs/）
- `ARCHITECTURE.md`: システムアーキテクチャ
- `DATABASE_SCHEMA.md`: DB スキーマ設計
- `API_SPECIFICATION.md`: API 仕様
- `P0_STABILIZATION_RULES.md`: P0 安定化ルール

### ADR（Architecture Decision Record）
- `docs/ADR/ADR-0001-tenant-isolation.md`: Tenant Isolation 設計
- `docs/ADR/ADR-0002-cursor-pagination.md`: Cursor Pagination 設計
- `docs/ADR/ADR-0003-billing-gate.md`: Billing Gate 設計

### 運用ドキュメント
- `docs/DEPLOYMENT.md`: デプロイ手順
- `docs/DEVELOPMENT.md`: 開発環境セットアップ

---

## 🚀 クイックスタート

### 前提条件
- Node.js 18+
- npm
- Cloudflare アカウント
- Wrangler CLI

### ローカル開発

```bash
# 依存関係インストール
npm install

# DB Migration 適用（ローカル）
npm run db:reset:local

# 開発サーバー起動
npm run dev:sandbox
```

### 本番デプロイ

```bash
# ビルド
npm run build

# 本番 DB Migration 適用
npm run db:migrate:prod

# デプロイ
npm run deploy:prod
```

---

## 📋 主要コマンド

### 開発
- `npm run dev:sandbox`: PM2 で開発サーバー起動（sandbox 用）
- `npm run build`: TypeScript ビルドチェック
- `npm test`: テスト実行

### データベース
- `npm run db:reset:local`: ローカル DB リセット & Migration 適用
- `npm run db:migrate:local`: ローカル DB Migration 適用
- `npm run db:migrate:prod`: 本番 DB Migration 適用
- `npm run db:seed:local`: ローカル DB Seed データ投入

### デプロイ
- `npm run deploy:prod`: 本番環境デプロイ

### Git
- `npm run git:status`: Git 状態確認
- `npm run git:log`: Git ログ確認

---

## 🔗 リンク

- **本番環境**: https://webapp.snsrilarc.workers.dev
- **フロントエンド**: https://app.tomoniwao.jp
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject

---

## 📝 ライセンス

Private

---

## 👤 開発者

関屋紘之（モギモギ）
- Location: Dubai
- X: @aitanoshimu
- Vision: 「まだ見たことのない欲しかったを形にする」
