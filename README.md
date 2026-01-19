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

## 🔧 CI/E2E テスト状況（2026-01-19 更新）

### ✅ 全 CI/テスト グリーン達成

| ワークフロー | 状態 | 説明 |
|-------------|------|------|
| **CI (ci.yml)** | ✅ グリーン | lint + typecheck |
| **Unit Tests** | ✅ グリーン | 単体テスト |
| **TypeScript Check** | ✅ グリーン | 型チェック |
| **E2E Smoke Tests** | ✅ グリーン | 認証なし基本動作確認 |
| **E2E Authenticated Tests** | ✅ グリーン | 認証ありテスト（Step 1 のみ有効） |
| **Phase2 E2E** | ✅ グリーン | 追加候補・NeedResponse 等 8ケース |
| **P0 Guardrails** | ✅ グリーン | テナント分離・マイグレーション安全性 |

### 📁 E2E テストファイル構成

```
tests/e2e/
├── phase2_additional_slots.sh  # Phase2 E2E: 追加候補 + 各種ガード
├── phase2_need_response.sh     # Phase2 E2E: NeedResponse 検証
└── (CI で実行)

frontend/e2e/
├── auth/auth.setup.ts          # Playwright: 認証セットアップ
├── critical-path.spec.ts       # Playwright: 認証済みテスト (Step 1 有効, 2-5 skip)
├── smoke.smoke.spec.ts         # Playwright: Smoke テスト
└── helpers/test-helpers.ts     # E2E ヘルパー関数
```

### 🔧 技術負債（意識的に管理中）

| 負債 | 状態 | 撤去計画 |
|------|------|----------|
| SQL workaround (status='sent') | Phase2 E2E 内 | バックエンド修正後に撤去 |
| Critical Path Step 2-5 skip | 一時 skip | アプリ動作確認後に有効化 |

**SQL workaround の詳細**:
- 場所: `tests/e2e/phase2_additional_slots.sh` の `create_sent_thread_via_pending_send()`
- 原因: `pending-actions/execute` 後に `scheduling_threads.status` が `draft` のまま
- 対策: E2E 内で `UPDATE scheduling_threads SET status='sent'` を実行
- 撤去条件: バックエンドで execute 後に status 更新を実装

### 🔑 E2E 認証設定

**GitHub Secrets に必要な設定**:
- `E2E_BASE_URL`: staging 環境の URL
- `E2E_AUTH_TOKEN`: E2E 用認証トークン

**フロントエンド認証方式**:
- `sessionStorage` に `tomoniwao_token` と `tomoniwao_user` を保存
- Playwright の `storageState` は sessionStorage を保存しないため、`beforeEach` で設定

### 🔗 CI/Actions リンク

- **GitHub Actions**: https://github.com/matiuskuma2/tomoniwaproject/actions
- **Test Workflow**: `.github/workflows/test.yml`
- **CI Workflow**: `.github/workflows/ci.yml`

---

## 📊 現在の状況（2026-01-11）- Beta A 完了

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

#### 確定通知フロー
- **Inbox通知**: 日本語で「【確定】スレッドタイトル」
- **メール通知**: 日本語で確定日時 + Google Meet リンク（任意）

#### リスト5コマンド（実装完了）

| コマンド | 例文 | 説明 |
|----------|------|------|
| **リスト作成** | 「営業部リストを作って」 | 新しいリストを作成 |
| **リスト一覧** | 「リスト見せて」「リスト」 | 全リストを表示 |
| **メンバー表示** | 「営業部リストのメンバー」 | リスト内のメンバーを表示 |
| **メンバー追加** | 「tanaka@example.comを営業部リストに追加」 | メールアドレスをリストに追加 |
| **リスト招待** | 「営業部リストに招待」 | リスト全員に招待を送信 |

**リスト機能の使い方（ゼロからの流れ）**:
1. 「テストリストを作って」→ 空のリストが作成される
2. 「tanaka@example.comをテストリストに追加」→ メンバーが追加される
3. 「テストリストのメンバー」→ メンバー一覧を確認
4. 「テストリストに招待」→ リスト全員に招待メールを送信

### 🔄 Phase 2 実装（Sprint 2-A 完了）

#### 追加候補機能（実装完了）

| 項目 | 状況 |
|------|------|
| DB: proposal_version / additional_propose_count | ✅ 完了 |
| DB: slots.proposal_version / location_id | ✅ 完了 |
| DB: selections.proposal_version_at_response | ✅ 完了 |
| API: POST /threads/:id/proposals/prepare | ✅ 完了 |
| API: POST /pending-actions/:token/execute (add_slots) | ✅ 完了 |
| 通知: Email + Inbox（declined除外） | ✅ 完了 |
| Frontend: 「追加/キャンセル」2語決定フロー | ✅ 完了 |

**安全装置**:
- collecting (status = 'sent') のみ追加候補可
- 最大2回まで
- 既存回答は消さない（絶対条件）
- 重複候補は除外（同一 start_at/end_at）

**使い方**:
1. スレッドを選択して「追加候補を出して」
2. 候補が生成される（3件、30分、既存と重複除外）
3. 「追加」で候補をスレッドに追加 → 全員に再通知
4. 「キャンセル」でキャンセル

### 🔜 Phase 2-B / 2-C の予定

| 優先度 | 項目 | 状況 |
|--------|------|------|
| P1 | E2E テスト（8本） | 未着手 |
| P2 | apiExecutor 分割（2235行→6ファイル） | 設計済み・未実装 |
| P2 | intentClassifier 分割（662行→5ファイル） | 設計済み・未実装 |
| P2 | Zustand 状態管理 | 一時ロールバック |
| P2 | マルチテナント対応 | 未着手 |

### 🐛 解決済みの問題

| 問題 | 原因 | 解決策 |
|------|------|--------|
| FOREIGN KEY constraint failed | 本番DBに `ws-default` ワークスペースが存在しなかった | `INSERT INTO workspaces` で作成 |
| メールリンクが app.example.com | emailConsumer.ts にハードコード | `app.tomoniwao.jp` に修正 |
| Intent が unknown | デバッグ済み、正常動作確認 | - |
| React Error #185 | Zustand 導入時の無限ループ | ロールバックで解決 |
| lists/members API レスポンス | バックエンドは `lists`/`members` を返すがフロントは `items` を期待 | フォールバック追加 |
| 「リスト見せて」が unknown | 正規表現の終端 `$` が空白に反応 | trim() + 正規表現修正 |
| 「テストリストのメンバー」→「テスト」 | リスト名抽出ロジックの不備 | 「リスト」サフィックス保持ロジック追加 |
| 追加候補で既存回答が消える | 新規スレッド作成していた | スロット追加API新設 + source フラグ分岐 |

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
# E2E Test Trigger
