# AI Secretary Scheduler (Tomoniwao)

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

## 📊 現在の状況（2026-01-10）

### ✅ Beta A 完了項目

#### チャット → メール送信フロー
- **Intent 分類**: メールアドレス入力を `invite.prepare.emails` として認識
- **prepare API**: `/api/threads/prepare-send` でサマリ提示 + `pending_actions` 生成
- **3語決定フロー**: 「送る」「キャンセル」「別スレッドで」の3語固定コマンド
- **メール送信**: Cloudflare Queue 経由で招待メール送信
- **メール本文**: 日本語で丁寧な文面、正しいリンク（app.tomoniwao.jp）

#### 回答フロー
- **回答ページ**: `/i/:token` で日程選択可能
- **カード更新**: 回答後にリアルタイムでカード反映

### 🔄 進行中・次の予定

| 優先度 | 項目 | 状況 |
|--------|------|------|
| P0 | デフォルト3人削除 | 保留（現状維持でOK） |
| P1 | リスト5コマンド テスト | 未着手 |
| P1 | 確定通知フロー テスト | 未着手 |
| P2 | apiExecutor 分割（2235行→6ファイル） | 設計済み・未実装 |
| P2 | intentClassifier 分割（662行→5ファイル） | 設計済み・未実装 |
| P2 | Zustand 状態管理 | 一時ロールバック |

### 🐛 解決済みの問題

| 問題 | 原因 | 解決策 |
|------|------|--------|
| FOREIGN KEY constraint failed | 本番DBに `ws-default` ワークスペースが存在しなかった | `INSERT INTO workspaces` で作成 |
| メールリンクが app.example.com | emailConsumer.ts にハードコード | `app.tomoniwao.jp` に修正 |
| Intent が unknown | デバッグ済み、正常動作確認 | - |
| React Error #185 | Zustand 導入時の無限ループ | ロールバックで解決 |

---

## 🔗 本番環境 URL

| サービス | URL |
|----------|-----|
| **フロントエンド** | https://app.tomoniwao.jp |
| **API** | https://webapp.snsrilarc.workers.dev |
| **ヘルスチェック** | https://app.tomoniwao.jp/health |

---

## 📂 主要ファイル構成

### フロントエンド (`frontend/src/`)
```
core/
├── api/client.ts          # API クライアント（認証付き）
├── auth/index.ts          # 認証管理（sessionStorage）
├── chat/
│   ├── intentClassifier.ts  # Intent 分類（662行）
│   └── apiExecutor.ts       # API 実行（2235行）★技術負債
└── models/index.ts        # 型定義

components/chat/
├── ChatLayout.tsx         # 3カラムレイアウト（529行）
├── ChatPane.tsx           # チャット入力・表示
├── CardsPane.tsx          # 右カード表示
└── ThreadsList.tsx        # スレッド一覧
```

### バックエンド (`apps/api/src/`)
```
routes/
├── threads.ts             # スレッド CRUD + prepare-send
├── pendingActions.ts      # Beta A: 確認→実行フロー
├── auth.ts                # Google OAuth + セッション
└── invite.ts              # 招待トークン処理

queue/
└── emailConsumer.ts       # メール送信 Queue Consumer

middleware/
└── auth.ts                # 認証ミドルウェア（ws-default）
```

### データベース (`db/migrations/`)
```
0065_create_pending_actions.sql   # Beta A: 送信確認テーブル
0066_create_invite_deliveries.sql # 配信追跡テーブル
```

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
cd frontend && npm install

# DB Migration 適用（ローカル）
npm run db:migrate:local

# 開発サーバー起動
npm run dev:sandbox
```

### 本番デプロイ

```bash
# バックエンド
npx wrangler deploy

# フロントエンド
cd frontend && npm run build
npx wrangler pages deploy dist --project-name webapp
```

---

## 📋 主要 API エンドポイント

### Beta A フロー

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/threads/prepare-send` | 新規スレッド + 招待準備 |
| POST | `/api/threads/:id/invites/prepare` | 既存スレッドへ追加招待準備 |
| POST | `/api/pending-actions/:token/decide` | 3語決定（送る/キャンセル/別スレッドで） |
| POST | `/api/pending-actions/:token/execute` | 実行（メール送信） |

### 認証

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/auth/google/start` | Google OAuth 開始 |
| GET | `/auth/google/callback` | OAuth コールバック |
| POST | `/auth/token` | Cookie → Bearer トークン変換 |
| GET | `/auth/me` | 現在のユーザー情報 |

---

## 📝 設計ドキュメント

- `docs/architecture/FRONTEND_REFACTOR_PLAN.md` - フロントエンドリファクタリング計画
- `docs/STATUS.md` - 実装状況
- `docs/ADR/` - アーキテクチャ決定記録

---

## 👤 開発者

関屋紘之（モギモギ）
- Location: Dubai
- X: @aitanoshimu
- Vision: 「まだ見たことのない欲しかったを形にする」

---

## 📝 ライセンス

Private
