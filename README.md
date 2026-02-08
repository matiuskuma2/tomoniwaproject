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

## 🔧 CI/E2E テスト状況（2026-01-20 更新）

### ✅ 全 CI/テスト グリーン達成（技術負債全回収）

| ワークフロー | 状態 | 説明 |
|-------------|------|------|
| **CI (ci.yml)** | ✅ グリーン | lint + typecheck |
| **Unit Tests** | ✅ グリーン | 単体テスト |
| **TypeScript Check** | ✅ グリーン | 型チェック |
| **E2E Smoke Tests** | ✅ グリーン | 認証なし基本動作確認 |
| **E2E Authenticated Tests** | ✅ グリーン | 認証ありテスト（Step 1-5 全通過） |
| **Phase2 E2E** | ✅ グリーン | 追加候補・NeedResponse 等 8ケース（workaround なし） |
| **P0 Guardrails** | ✅ グリーン | テナント分離・マイグレーション安全性 |

### 📁 E2E テストファイル構成

```
tests/e2e/
├── phase2_additional_slots.sh  # Phase2 E2E: 追加候補 + 各種ガード
├── phase2_need_response.sh     # Phase2 E2E: NeedResponse 検証
└── (CI で実行)

frontend/e2e/
├── auth/auth.setup.ts          # Playwright: 認証セットアップ
├── critical-path.spec.ts       # Playwright: 認証済みテスト (Step 1-5 全有効)
├── smoke.smoke.spec.ts         # Playwright: Smoke テスト
└── helpers/test-helpers.ts     # E2E ヘルパー関数（状態ベース待機）
```

### 🔧 技術負債状況

| 負債 | 状態 | 回収日 |
|------|------|--------|
| SQL workaround (status='sent') | ✅ 撤去完了 | 2026-01-20 |
| Critical Path Step 2-5 skip | ✅ 復活完了 | 2026-01-20 |

**現在の技術負債: なし** - 意図的な負債はすべて回収済み

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
- **`docs/ONE_ON_ONE_DIFF_CHECKLIST.md`** - 1対1 AI秘書（R0: 他人）差分チェックシート（Phase B-1〜B-4 実装前計画）

---

## 👤 開発者

関屋紘之（モギモギ）
- Location: Dubai
- X: @aitanoshimu
- Vision: 「まだ見たことのない欲しかったを形にする」

---

## 📝 ライセンス

Private

---

## 📇 PR-D: 連絡先取り込み（Contact Import）— 2026-02-08 更新

### 概要
チャットから連絡先を取り込む機能。テキスト / CSV / 名刺画像の3入力に対応し、**事故ゼロ設計（Gate 1–4）** を全フローに適用。

### フロー
```
入力（テキスト/CSV/名刺画像）
  → preview（パース結果確認）
  → person-select（曖昧一致解決）
  → confirm（登録実行）
  → post-import next step（次の一手提示）  ← PR-D-FE-4
```

### 事故ゼロ Gate
| Gate | ルール | 実装 |
|------|--------|------|
| Gate-1 | email 欠落 = hard fail | `missing_email: true` → `resolved_action: skip` |
| Gate-2 | 曖昧一致 = 必ず止める | `pending.person.select` で人が選ぶまで待つ |
| Gate-3 | owner_user_id 一致 | `getPendingForUser()` で検証 |
| Gate-4 | confirm 以外の書き込みゼロ | `/confirm` API のみが書き込み |

### PR 進捗

| PR | タイトル | 状態 | 概要 |
|----|---------|------|------|
| #115 | Classifier Chain + CSV Parser | ✅ merged | 分類器チェイン + CSV パーサー |
| #116 | Contact Import API統合 | ✅ merged | 事故ゼロ API（preview/confirm/cancel） |
| #117 | Contact Import フロントUI接続 | ✅ merged | pending 種別別 UI 切替 |
| #118 | 名刺OCR → Chat UI統合 | ✅ merged | Gemini Vision OCR + ChatPane画像添付 |
| #120 | Post-Import Intent + 次手分岐 | 🔄 open | FEのみ。confirm後の「次どうする？」 |

### PR-D-FE-4 (#120): Post-Import Intent Extraction

**変更: FEのみ、DB/API追加なし（+321行、6ファイル）**

アーキテクチャ:
```
confirm 完了 → contact_import_context あり?
  → YES: reducer が pending.post_import.next_step をセット
    → classifier(Case 0) が post_import.next_step.decide を分類
      → executor が parseNextStepSelection で判定
        → selected / cancelled / unclear（ガイダンス再表示）
  → NO: pending クリア（従来通り）
```

Intent 抽出ルール（classifyUploadIntent）:
| 優先度 | Intent | キーワード例 | 例文 |
|--------|--------|-------------|------|
| 1 | send_invite | 招待・案内・送って | 「この人たちに案内送って」 |
| 2 | schedule | 日程・スケジュール・調整 | 「日程調整して」 |
| 3 | message_only | 登録だけ・追加だけ | 「とりあえず登録だけ」 |
| 4 | unknown | 上記なし or 空文字 | 「」「よろしく」 |

テスト: **FE 309 tests (13 files) ALL PASSED** / tsc zero errors

### API エンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| POST | `/api/contacts/import/preview` | テキスト/CSV → パース + 曖昧検出 |
| POST | `/api/contacts/import/confirm` | 登録実行（Gate-4 唯一の書き込み） |
| POST | `/api/contacts/import/cancel` | キャンセル（書き込みゼロ） |
| POST | `/api/business-cards/scan` | 名刺画像 → Gemini OCR → pending |

---

## 🆕 v1.0 AI秘書（1対1予定調整）

### 概要
「人にお願いする感覚で予定調整が完了する」最小構成のAI秘書体験。

**ユーザー体験**
```
ユーザー: 「Aさんと来週木曜17時から1時間、予定調整お願い」
AI: 「了解です。Aさんに共有するリンクを発行しました。このURLをAさんに送ってください: https://app.tomoniwao.jp/i/xxx」
相手: /i/:token で承諾/辞退
AI: 「Aさんとの予定が確定しました！」
```

### 新規API
```
POST /api/one-on-one/fixed/prepare
Authorization: Bearer <token>

{
  "invitee": { "name": "Aさん", "email": "a@example.com" },
  "slot": { "start_at": "2026-01-29T17:00:00+09:00", "end_at": "2026-01-29T18:00:00+09:00" },
  "title": "打ち合わせ"
}
```

### 関連ファイル
- `apps/api/src/routes/oneOnOne.ts` - 1対1 API
- `apps/api/src/routes/invite.ts` - 招待ページ (/i/:token)

---

## 🔧 障害時の一次切り分けフロー（新規参画者向け）

### 0) まず結論：どこが怪しい？

| 症状 | 疑うべき箇所 |
|------|-------------|
| フロントが開かない / 画面が壊れる | Frontend（Pages）|
| APIが401/500/タイムアウト | Workers(API) |
| 招待URLが開けない / 回答できない | `/i/:token`（invite.ts）|
| メールが届かない / カレンダー連携が変 | Resend / Google API |
| AI応答が止まる / 意図判定が変 | OpenAI / nlRouter |

---

### 1) デプロイ状態の確認（最優先）

**Workers（API）**
```bash
curl -s https://webapp.snsrilarc.workers.dev/health | jq .
```

見るべきキー：
- `commit_sha` / `build_time`：**いま動いてるコミット**
- `routes_version`：想定のルータ構成か（例 `threads_split_v2`）
- `log_level`：本番 `warn` になっているか
- `cors_origins`：想定どおりか

**Frontend（Pages）**
```bash
curl -s https://app.tomoniwao.jp/version.json | jq .
```
- `commit` が想定コミットか確認

**判定**
- WorkersとFrontendのcommitがズレてる → **デプロイの同期ズレ**（まず合わせる）
- どちらも最新 → 次へ

---

### 2) CORSが原因か判定（フロントからAPI叩けない時）

```bash
# ✅ 正規Origin
curl -sI -H "Origin: https://app.tomoniwao.jp" \
  https://webapp.snsrilarc.workers.dev/api/health | grep -i access-control

# ✅ Pages preview
curl -sI -H "Origin: https://preview.pages.dev" \
  https://webapp.snsrilarc.workers.dev/api/health | grep -i access-control

# ❌ 不正Origin（ヘッダーなしが正）
curl -sI -H "Origin: https://evil.com" \
  https://webapp.snsrilarc.workers.dev/api/health | grep -i access-control || echo "OK: no CORS"
```

**判定**
- 正規OriginでもCORSヘッダーが出ない → `CORS_ORIGINS` 設定 or middlewareの問題
- 正規OriginはOK / evil.comはヘッダーなし → **CORSは正常**、次へ

---

### 3) 認証境界の確認（401の時）

- `/api/*` は基本 **認証必須**
- 401が出るなら：
  - Bearer token / cookie が付いているか
  - ルートが意図通り `requireAuth` 配下か

**よくあるパターン**
- 「ブラウザでは動くがcurlで401」→ curlに認証を付けてない（正常）
- 「フロントから401」→ セッション切れ / cookie問題 / CORSでcookie送れてない（credentials + allow-origin確認）

---

### 4) 招待フローの切り分け（/i/:token が怪しい時）

- 公開招待は **/i/:token（invite.ts）** が正
- まずURLのtokenが生きてるかを確認（画面が出るか）
- 「承諾/辞退を押しても進まない」場合：
  - invite.ts 内の fetch が叩いてるAPIが落ちてる可能性
  - まず Workers の /health で commit/build_time を確認

---

### 5) 依存サービス（外部）切り分け

- メール不達：Resend（EMAIL_QUEUE / consumer）側
- カレンダー：Google API / OAuth
- AI：OpenAI / nlRouter, chat

ここまでで原因が特定できない時は、**再現手順＋commit_sha＋発生時刻**を揃えてチームに渡す。

---

## 🔴 CIが落ちた時の典型原因（最短で復旧するチェックリスト）

### A) Code Guardrails が落ちた

**症状**: `Guardrail: forbid /api/threads/i/* routes` がFAIL

**原因**: どこかに `/api/threads/i/` が復活（文字列含む）

**対応**
```bash
grep -RIn "/api/threads/i/" apps/ packages/ frontend/ --include="*.ts" --include="*.tsx" --include="*.js"
```
- 公開招待は必ず `/i/:token` に寄せる（invite.ts）

---

### B) TypeScript Check が落ちた

**典型原因**
- Env型に存在しないキー参照（例：`env.APP_URL` など）
- import後未使用
- 型定義が古い（LoggerOptionsなど）

**対応**
- 該当ファイルのエラー行に飛ぶ → **Env型 / import / interface** を確認
- 新しいenvキーを使うなら `packages/shared/src/types/env.ts` を更新

---

### C) lint-and-build が落ちた

**典型原因**
- ビルド時生成ファイルの混入（version.tsの値差分）
- nodeバージョン差・ESM差
- 依存更新でビルド差異

**対応**
- `apps/api/src/version.ts` は値が変わりやすいので、PR差分に混入してないか確認
- ローカルで `npm run build` が通るか確認

---

### D) Unit Tests / E2E Smoke が落ちた

**Unitの典型原因**
- executor分割で import/export がズレた
- 共有関数移動でパスが変わった

**E2Eの典型原因**
- CORSが厳しくなって preview origin が弾かれてる
- `/health` のJSON変更で期待値が壊れた
- 招待周りのUIが変わってセレクタが壊れた

**対応**
- 失敗したテスト名→対象機能を即特定
- /healthの変更は **互換維持**を再確認
- CORSは DoD コマンドで即チェック（上の3パターン）

---

### E) migrate-local が落ちた

**典型原因**
- migration順序不整合 / 既存テーブルとの衝突
- SQLの方言（D1/SQLite互換）

**対応**
- 直近migrationを見て、**IF NOT EXISTS** / 外部キー / index を確認
- ローカルD1で当てて再現する

---

# E2E Test Trigger
