# AI Secretary Scheduler PWA

AI秘書スケジューラー - チャット中心のスケジューリングシステム

## 🎯 プロジェクト概要

### 目標
- **51点ゴール**: チャット中心のWorkItem統合、Stranger 1対1調整（URL完結）、自動contacts、共有リスト
- **MVP範囲**: チャットUI、WorkItemモデル、Google Calendar同期、外部リンク調整
- **除外**: N対N調整、deep機能（Quest/Squad/Partner/Familyの複雑機能）

### 技術スタック
- **Frontend**: Cloudflare Pages (PWA)
- **API**: Cloudflare Workers (Hono)
- **Database**: Cloudflare D1 (SQLite)
- **KV Storage**: Cloudflare KV (OTP, Rate Limiting)
- **Queue**: Cloudflare Queues (Email sending)
- **Storage**: Cloudflare R2 (Voice recordings, exports)

## 📊 実装進捗

### ✅ 完了したチケット

#### チケット1: DB差分マイグレーション適用（0016/0017/0018）
**目的**: ai_provider_settingsのUNIQUE(provider)制約とai_provider_keysのmasked_preview列追加

**実装内容**:
- ✅ `0005_ai_costs.sql`: AIコスト管理テーブル（ai_provider_settings, ai_provider_keys, ai_usage_logs, ai_budgets）
- ✅ `0006_indexes_ai_costs.sql`: AIコスト関連インデックス
- ✅ `0015_system_settings.sql`: システム設定テーブル
- ✅ `0016_ai_provider_settings_unique_provider.sql`: UNIQUE(provider)制約追加（v2テーブル移行方式）
- ✅ `0017_ai_provider_keys_masked_preview.sql`: masked_preview列追加
- ✅ `0018_ai_provider_keys_index.sql`: 追加インデックス

**Repository実装**:
- ✅ `AIProviderSettingsRepository`: ON CONFLICT(provider)によるUPSERT対応
- ✅ `AIProviderKeysRepository`: masked_preview対応、暗号化鍵の安全な管理
- ✅ `SystemSettingsRepository`: key-value store操作

**受け入れ条件**:
- ✅ ai_provider_settingsにprovider=gemini/openaiで1行ずつ存在可能
- ✅ ai_provider_keysにmasked_previewを保存・取得可能（生鍵は返さない）
- ✅ AiProviderSettingsRepo.upsertMany()が例外なく動作
- ✅ SQLite/D1のALTER制限をv2移行方式で回避

---

#### チケット2: /admin/system/settings（GET/PUT）実装
**目的**: super_adminがシステム全体設定を管理（メール送信元、OGP、規約URL）

**実装内容**:
- ✅ `GET /admin/system/settings`: 全設定取得
- ✅ `GET /admin/system/settings/:key`: 特定設定取得
- ✅ `PUT /admin/system/settings`: 一括更新（UPSERT）
- ✅ `DELETE /admin/system/settings/:key`: 設定削除
- ✅ `GET /admin/system/settings/prefix/:prefix`: プレフィックス検索

**Middleware実装**:
- ✅ `adminAuth`: Admin認証（Bearer token検証）
- ✅ `requireRole`: ロールガード（super_admin/admin）
- ✅ `workspaceGuard`: テナント境界管理

**受け入れ条件**:
- ✅ GETで全system_settings返却
- ✅ PUTで複数キーをUPSERT可能（ON CONFLICT(key)）
- ✅ super_admin以外は403
- ✅ 更新操作はaudit_logsに記録

---

#### チケット3: /admin/ai/providers（GET/PUT）実装
**目的**: super_adminがGemini/OpenAIのデフォルト・フォールバック・feature別ルーティングを制御

**実装内容**:
- ✅ `GET /admin/ai/providers`: 全プロバイダ設定取得（admin可）
- ✅ `GET /admin/ai/providers/:provider`: 特定プロバイダ設定取得
- ✅ `PUT /admin/ai/providers`: プロバイダ設定の一括更新（super_adminのみ）
- ✅ `POST /admin/ai/providers/:provider/enable`: 有効/無効切り替え

**受け入れ条件**:
- ✅ GETでgemini/openai設定を返す
- ✅ PUTでproviderごとに上書き更新
- ✅ feature_routing_jsonをobjectとして保存・返却
- ✅ adminはGETのみ、super_adminがPUT可能（403制御）
- ✅ audit_logsに更新記録

---

### 🔄 次のチケット（実装順）

#### フェーズ0: 土台（続き）
- **T04**: RateLimiter（KV）ユーティリティ実装
- **T05**: OTPサービス（KV）+ `/i/:token/verify` 接続
- **T06**: Email Queue（producer/consumer）最小実装

#### フェーズ1: 51点コア
- **T07**: WorkItems API（GET/POST/PATCH）漏洩防止ガード実装
- **T08**: `/voice/execute`（骨格＋intent_parse）テキスト版
- **T09**: 共有提案カード（share_intent）+ `copy_work_item_to_room`
- **T10**: Stranger 1対1調整（`/i/:token`）+ 進捗API

#### フェーズ2: 運用
- Admin import（preview→commit）
- Abuse監視 + suspend
- Cron（budget alert / daily summary / retention / reminders）
- R2 archive

## 🗂️ プロジェクト構成

```
webapp/
├── apps/
│   ├── api/                       # Hono API (Cloudflare Workers)
│   │   └── src/
│   │       ├── index.ts           # メインエントリーポイント
│   │       ├── routes/
│   │       │   ├── adminSystem.ts # システム設定API
│   │       │   └── adminAi.ts     # AIプロバイダAPI
│   │       ├── middleware/
│   │       │   └── adminAuth.ts   # Admin認証・ロールガード
│   │       └── repositories/
│   │           ├── aiProviderSettingsRepo.ts
│   │           ├── aiProviderKeysRepo.ts
│   │           ├── systemSettingsRepo.ts
│   │           └── auditLogRepo.ts
│   └── web/                       # PWA Frontend（未実装）
├── packages/
│   ├── shared/                    # 共有型定義
│   │   └── src/types/
│   │       ├── env.ts             # Cloudflare Workers環境型
│   │       ├── admin.ts           # Admin関連型
│   │       ├── ai.ts              # AI関連型
│   │       └── system.ts          # システム設定型
│   └── ai/                        # AI client packages（未実装）
├── db/
│   ├── migrations/                # D1マイグレーション
│   │   ├── 0001_init_core.sql
│   │   ├── 0002_team_lists_events.sql
│   │   ├── 0003_admin.sql
│   │   ├── 0004_indexes.sql
│   │   ├── 0005_ai_costs.sql
│   │   ├── 0006_indexes_ai_costs.sql
│   │   ├── 0015_system_settings.sql
│   │   ├── 0016_ai_provider_settings_unique_provider.sql
│   │   ├── 0017_ai_provider_keys_masked_preview.sql
│   │   └── 0018_ai_provider_keys_index.sql
│   └── seeds/
│       └── seed-admin-and-settings.sql
├── docs/                          # 仕様書
├── scripts/                       # ユーティリティスクリプト
│   ├── test-migrations.ts
│   └── test-ticket-acceptance.ts
├── wrangler.jsonc                 # Cloudflare設定
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 開発セットアップ

### 必要なもの
- Node.js 18+
- npm or pnpm
- Cloudflare account（Wrangler CLI）

### 初回セットアップ

```bash
# 依存関係インストール
npm install

# D1データベース作成（本番用）
npm run db:create

# マイグレーション適用（ローカル開発）
npm run db:migrate:local

# シードデータ投入
npm run db:seed:local

# TypeScriptビルドチェック
npm run build

# 開発サーバー起動
npm run dev:local
```

### よく使うコマンド

```bash
# 開発
npm run dev:local              # ローカル開発サーバー起動（--local flag）
npm run dev                    # リモート接続開発サーバー

# データベース
npm run db:migrate:local       # マイグレーション適用（ローカル）
npm run db:migrate:prod        # マイグレーション適用（本番）
npm run db:seed:local          # シードデータ投入（ローカル）
npm run db:console:local       # D1コンソール（ローカル）
npm run db:reset:local         # ローカルDB完全リセット＋マイグレーション＋シード

# テスト
npm run test:migrations        # マイグレーションテスト
npm run build                  # TypeScriptビルドチェック

# デプロイ
npm run deploy                 # 本番デプロイ
npm run deploy:prod            # 本番デプロイ（明示的）

# Git
npm run git:status             # git status
npm run git:log                # git log --oneline
npm run git:commit "message"   # git add . && git commit -m "message"
```

## 🔐 環境変数・シークレット

### ローカル開発（.dev.vars）
```bash
# .dev.vars（Gitに含めない）
JWT_SECRET=your-jwt-secret-here
ENCRYPTION_KEY=your-32-byte-encryption-key-here
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GEMINI_API_KEY=your-gemini-api-key
OPENAI_API_KEY=your-openai-api-key
RESEND_API_KEY=your-resend-api-key
```

### 本番環境（wrangler secret）
```bash
# シークレット設定
npx wrangler secret put JWT_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put RESEND_API_KEY

# シークレット一覧
npx wrangler secret list
```

## 📝 API仕様

### 実装済みエンドポイント

#### Health Check
- `GET /health` - ヘルスチェック

#### Admin System Settings（super_admin only）
- `GET /admin/system/settings` - 全設定取得
- `GET /admin/system/settings/:key` - 特定設定取得
- `PUT /admin/system/settings` - 一括更新（UPSERT）
- `DELETE /admin/system/settings/:key` - 設定削除
- `GET /admin/system/settings/prefix/:prefix` - プレフィックス検索

#### Admin AI Providers（GET: admin, PUT: super_admin）
- `GET /admin/ai/providers` - 全プロバイダ設定取得
- `GET /admin/ai/providers/:provider` - 特定プロバイダ設定取得
- `PUT /admin/ai/providers` - プロバイダ設定の一括更新
- `POST /admin/ai/providers/:provider/enable` - 有効/無効切り替え

### 認証

```bash
# Bearer token認証（現在はadmin_idを直接使用、将来JWT化予定）
Authorization: Bearer <admin_id>

# 例
curl http://localhost:3000/admin/system/settings \
  -H "Authorization: Bearer admin-super-001"
```

## 🧪 テスト

### 受け入れテストの実行
```bash
# 受け入れ条件チェック
npm run test:migrations

# 手動テスト: system settings
curl http://localhost:3000/admin/system/settings \
  -H "Authorization: Bearer admin-super-001"

# 手動テスト: AI providers
curl http://localhost:3000/admin/ai/providers \
  -H "Authorization: Bearer admin-super-001"
```

### シードデータ

テスト用のadmin users:
- **super_admin**: `admin-super-001` (email: super@example.com)
- **admin**: `admin-normal-001` (email: admin@example.com)

## 📚 主要ドキュメント

### OAuth & Google Integration
- `docs/OAUTH_CONSENT_SCREEN_APPLICATION.md` - **OAuth審査申請ガイド（重要）**
- `docs/GOOGLE_MEET_PHASE0B_SPEC.md` - Google Meet Phase 0B仕様
- `docs/PHASE_0B_COMPLETION_CHECKLIST.md` - Phase 0B完了チェックリスト
- `scripts/oauth-verification-test.sh` - OAuth検証スクリプト（Bash）
- `scripts/oauth-verification-test.ps1` - OAuth検証スクリプト（PowerShell）
- `scripts/verify-phase0b.sql` - Phase 0B検証SQL

### API & Database
- `docs/31_ACCESS_CONTROL.md` - アクセス制御仕様
- `docs/14_TENANCY_AND_ROLES.md` - テナント・ロール仕様
- `docs/15_EMAIL_OTP_RATE_LIMIT.md` - OTP・レート制限仕様
- `docs/20_EMAIL_QUEUE.md` - メールキュー仕様
- `docs/22_SYSTEM_SETTINGS.md` - システム設定仕様（凍結）
- `docs/23_ABUSE_MONITORING.md` - Abuse監視仕様（凍結）
- `docs/24_SUSPEND_CONTROL.md` - 停止制御仕様（凍結）

## 🎨 AI戦略

### モデル優先度
1. **Gemini 2.0 Flash**: コスト優先（標準）
2. **OpenAI GPT-4o-mini**: 品質・安定性優先（フォールバック）

### 必須ルール
- すべてのAI呼び出しは`ai_usage_logs`に記録
- `AIProviderRouter`経由でルーティング
- super_adminがコスト可視化可能

## 🔒 セキュリティ

### 実装済み
- ✅ Admin認証（Bearer token）
- ✅ ロールベースアクセス制御（super_admin/admin）
- ✅ テナント境界管理（admin_workspace_access）
- ✅ 監査ログ（すべての管理操作を記録）
- ✅ APIキーのマスキング（masked_preview、生鍵は返さない）

### 今後実装予定
- User認証（Google OAuth）
- suspendedユーザーのAPI拒否
- Rate limiting（KV）
- OTP検証（KV）

## 📈 スケーラビリティ

### 設計方針
- D1（SQLite）: トランザクションデータ
- KV: セッション、OTP、レート制限
- R2: 音声録音、大容量ログ
- Queue: 非同期処理（メール送信、重い処理）
- Cron: 定期バッチ処理

### 将来対応
- ログのR2アーカイブ（数十万レコード対応）
- 集計テーブル（日次/月次サマリ）
- KV TTL活用（期限付きデータ）

## 🚀 Phase Next-5: Auto-propose (自動調整) 完了

### Phase Next-5 Day1: 自動候補生成（提案のみ）
- ✅ Intent: `schedule.auto_propose`
- ✅ メール抽出のみ（名前抽出は Day2 以降）
- ✅ 来週の候補を 5 件生成（busyチェックなし）
- ✅ 「はい/いいえ」で確認（POST なし）

### Phase Next-5 Day2: Yes → POST
- ✅ Intent: `schedule.auto_propose.confirm` / `cancel`
- ✅ `pendingAutoPropose` state 管理
- ✅ confirm 時のみ POST `/api/threads`
- ✅ ガードレール: pending なき場合は POST 不発

### Phase Next-5 Day2.1: 技術的負債ゼロ化
- ✅ `ExecutionResult` 型固定化（`as any` 排除）
- ✅ `ExecutionContext` 型定義（`additionalParams` 廃止）
- ✅ `onExecutionResult` で責務分離
- ✅ confirm/cancel のガード強化
- ✅ ドキュメント: `AUTO_PROPOSE_RUNBOOK.md`

### Phase Next-5 Day3: 追加候補提案（提案のみ、POST なし）
- ✅ Intent: `schedule.additional_propose`
- ✅ `analyzeStatusForPropose(status)`: 純関数で判定ロジック
  - 未返信 >= 1
  - 票が割れている（1位と2位が同票、または最大票が1）
- ✅ `executeAdditionalPropose`: 追加候補を3本生成
- ✅ `executeStatusCheck` に判定ロジック追加（「追加候補出して」案内）
- ✅ ガードレール: 提案のみ、POST は confirm 時のみ
- ✅ ドキュメント: `ADDITIONAL_PROPOSE_RUNBOOK.md`

**デプロイ情報**:
- Production: https://app.tomoniwao.jp
- Latest Deploy: https://53dbdb20.webapp-6t3.pages.dev
- Git Commit: ee18c47

---

## 🤝 コントリビューション

このプロジェクトは現在開発中です。実装順序はチケット番号に従ってください。

## 📄 ライセンス

（ライセンス未定）

---

**最終更新**: 2025-12-30  
**バージョン**: 0.2.0  
**ステータス**: Phase Next-5 Day3 完了、T04-T10実装中
