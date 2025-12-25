# webapp - AI Secretary Scheduler PWA

> **Talk to manage your important relationships and schedules**  
> 大事な人との予定と行動を、話すだけで無理なく整える

## 📋 Project Overview

**51点ゴール（Minimum Viable Product）：**
- チャット中心のWorkItem作成/修正（予定・タスク統合）
- 未登録ユーザーとのURLリンク完結型1対1調整（OTP使用）
- 自動的なcontacts蓄積
- 共有リスト・イベント配信

**プロジェクトの哲学：**
- 時間管理ツールではなく、**関係性整理ツール**
- 距離感に応じた確定フロー分離（親友とStrangerでは違う）
- AIがユーザーの意図を理解し、適切なアクションを提案
- PWA→将来的にiOS/Android展開を考慮したURL/ディープリンク設計

## 🏗️ Architecture

### Tech Stack
- **Frontend**: PWA (Progressive Web App) - レスポンシブUI（スマホ/PC両対応）
- **Backend**: Cloudflare Workers + Hono Framework
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare KV (OTP/Rate Limiting), R2 (Voice/Attachments), Queue (Email)
- **AI**: Gemini 2.0 Flash (優先) → OpenAI GPT-4o-mini (フォールバック)
- **Email**: Resend API
- **Calendar**: Google Calendar API

### Project Structure
```
webapp/
├── apps/
│   ├── api/              # Cloudflare Workers API (Hono)
│   │   ├── src/
│   │   │   ├── routes/   # API route handlers
│   │   │   ├── middleware/ # Auth, CORS, RateLimit
│   │   │   ├── lib/      # Utilities
│   │   │   └── index.ts  # Entry point
│   └── web/              # PWA Frontend
│       ├── public/
│       └── src/
│           ├── components/
│           ├── pages/
│           └── lib/
├── packages/
│   ├── ai/               # AI Provider共通ロジック
│   │   └── src/
│   │       ├── router.ts       # AIProviderRouter (Gemini→OpenAI)
│   │       ├── gemini.ts       # GeminiClient
│   │       ├── openai.ts       # OpenAIClient
│   │       ├── usage-logger.ts # UsageLogger
│   │       └── cost-guard.ts   # CostGuard
│   └── shared/           # 型定義・ユーティリティ
│       └── src/
│           └── types/
├── db/
│   └── migrations/       # D1マイグレーション
│       ├── 0001_init_core.sql
│       ├── 0002_team_lists_events.sql
│       ├── 0003_admin.sql
│       ├── 0004_indexes.sql
│       ├── 0005_ai_costs.sql
│       └── 0006_indexes_ai_costs.sql
├── docs/                 # 仕様ドキュメント
├── wrangler.jsonc        # Cloudflare設定
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs  # PM2設定（開発用）
```

## 🚀 Getting Started

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0
- Cloudflare Account (Workers, D1, KV, R2, Queue)
- Google Cloud Console (OAuth, Calendar API)
- Gemini API Key (Google AI Studio)
- OpenAI API Key (optional, for fallback)
- Resend API Key (Email delivery)

### Installation

1. **Clone and install dependencies:**
```bash
cd /home/user/webapp
npm install
```

2. **Create Cloudflare resources:**
```bash
# D1 Database
npx wrangler d1 create webapp-production
# → Copy database_id to wrangler.jsonc

# KV Namespaces
npm run kv:create
# → Copy KV IDs to wrangler.jsonc

# Queue
npm run queue:create

# R2 Bucket
npm run r2:create
```

3. **Apply D1 migrations (local):**
```bash
npm run db:migrate:local
```

4. **Set up environment variables (.dev.vars):**
```bash
# Create .dev.vars file (never commit!)
cat > .dev.vars << 'EOF'
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
RESEND_API_KEY=your_resend_api_key
ENCRYPTION_KEY=your_32_character_encryption_key
JWT_SECRET=your_jwt_secret
EOF
```

5. **Start development server:**
```bash
# Build first
npm run build

# Start with PM2 (daemon mode)
npm run start:pm2

# Check logs
npm run logs:pm2

# Check status
pm2 list
```

### Database Management

```bash
# Local development
npm run db:migrate:local          # Apply migrations
npm run db:console:local          # SQLite console
npm run db:reset                  # Reset local DB

# Production
npm run db:migrate:prod           # Apply migrations to production
npm run db:console:prod           # Production DB console
```

## 📊 Database Schema

### Core Tables (0001_init_core.sql)
- `users` - PWAユーザー
- `google_accounts` - Google OAuth連携
- `work_items` - 統合型Work Item（予定・タスク）
- `relationships` - ユーザー間の関係性
- `scheduling_threads` - 調整スレッド
- `scheduling_candidates` - 候補時刻
- `external_invites` - 外部招待リンク（OTP対応）
- `inbox_items` - 受信箱アイテム
- `contacts` - 連絡先
- `policies` - AIの判断根拠
- `voice_commands` - 音声コマンドログ
- `audit_logs` - 監査ログ

### Team/Lists/Events (0002_team_lists_events.sql)
- `workspaces` - ワークスペース（テナント境界）
- `rooms` - Room（グループ共有スペース）
- `room_members` - Roomメンバー
- `quests` - Quest（目標・プロジェクト）
- `lists` - リスト（共有可能）
- `hosted_events` - イベント配信（1対N）
- `event_rsvps` - イベント出欠回答
- `broadcasts` - イベント配信通知

### Admin & Subscription (0003_admin.sql)
- `admin_users` - 管理者ユーザー
- `admin_workspace_access` - Admin→Workspace権限境界
- `user_subscriptions` - ユーザーのサブスクリプション
- `rate_limit_logs` - レート制限ログ

### AI Cost Management (0005_ai_costs.sql)
- `ai_provider_settings` - AIプロバイダ設定
- `ai_provider_keys` - 暗号化されたAPIキー
- `ai_usage_logs` - 全てのAI呼び出しログ
- `ai_budgets` - 予算設定
- `ai_budget_alert_events` - アラート発火履歴
- `ai_pricing_table` - コスト推定参照用

## 🤖 AI Provider Strategy

**Gemini優先 → OpenAIフォールバック（二刀流）**

1. **Gemini 2.0 Flash (優先)**
   - **無料枠**: 1,500 RPD（requests per day）
   - **コスト**: 低コスト/無料
   - **用途**: Intent Parse, Candidate Generation, Invite Compose
   - **音声**: 音声理解/要約/文字起こし対応

2. **OpenAI GPT-4o-mini (フォールバック)**
   - **用途**: Gemini失敗時、高精度要求時
   - **コスト**: $0.15/1M input tokens, $0.60/1M output tokens

3. **super_admin による管理**
   - LLM/音声プロバイダ設定
   - 予算/上限/アラート設定
   - API使用量/コスト可視化（プロバイダ別、機能別、ユーザー別、Room別）
   - 緊急スロットル、レート制限、悪用検知

## 🔒 Security & Authentication

### User Authentication (PWA)
- Google OAuth 2.0
- JWT Session Management
- Suspended user check middleware

### Admin Authentication
- `super_admin` - 全権限（AIコスト管理、全Workspace管理）
- `admin` - テナント管理者（自身のWorkspace管理、リスト一括登録、使用量閲覧）

### Rate Limiting (KV-based)
- OTP送信: 5回/15分（IP単位）、10回/時間（メールアドレス単位）
- Voice API: 30回/分（ユーザー単位）
- Invite送信: 10回/時間（ユーザー単位）

## 📮 API Endpoints (Minimum)

### Auth
- `POST /api/auth/google/login` - Google OAuth login
- `POST /api/auth/google/callback` - OAuth callback
- `POST /api/auth/logout` - Logout

### Voice (Core)
- `POST /api/voice/execute` - 音声/テキストコマンド実行（Intent Parse + CRUD）

### WorkItems
- `GET /api/work-items` - Work Items一覧
- `POST /api/work-items` - Work Item作成
- `PATCH /api/work-items/:id` - Work Item更新
- `DELETE /api/work-items/:id` - Work Item削除

### Scheduling (Stranger 1対1)
- `POST /api/scheduling/threads` - 調整スレッド作成
- `GET /api/scheduling/threads/:id` - スレッド詳細
- `POST /api/scheduling/threads/:id/send` - 招待送信

### External Link (OTP)
- `GET /i/:token` - 外部招待ページ（未登録ユーザー向け）
- `POST /i/:token/verify` - OTP検証
- `POST /i/:token/respond` - 候補選択/確定

### Admin (super_admin/admin)
- `GET /api/admin/ai/usage` - AI使用量統計
- `GET /api/admin/ai/costs` - コスト分析
- `GET /api/admin/ai/providers` - プロバイダ設定
- `POST /api/admin/ai/providers` - プロバイダ設定更新
- `GET /api/admin/ai/budgets` - 予算設定
- `POST /api/admin/ai/budgets` - 予算設定作成

## 🎯 Current Status

### ✅ Completed
- プロジェクト構造作成（monorepo）
- D1マイグレーションファイル（0001-0006）
- Cloudflare Workers設定（wrangler.jsonc）
- TypeScript設定
- PM2設定ファイル
- Git初期化

### 🚧 In Progress
- 次フェーズ: AI基盤実装（GeminiClient, AIProviderRouter, UsageLogger, CostGuard）

### ⏳ Pending
- UserAuth/AdminAuth middleware
- RateLimiter (KV)
- OTP Service (KV)
- Email Queue (producer/consumer)
- WorkItems API (GET/POST/PATCH)
- `/voice/execute` (intent_parse + WorkItem CRUD)
- Stranger 1対1調整フロー
- 共有提案カード（share_intent）
- PWA Frontend実装

## 📝 Development Phases

### Phase 0: 基盤整備（完了）
- ✅ 仕様凍結
- ✅ DB設計（D1マイグレーション）
- ✅ プロジェクト初期化

### Phase 1: AI基盤 + 認証（次）
- T-AI-01: GeminiClient実装
- T-AI-02: OpenAIClient実装
- T-AI-03: AIProviderRouter実装
- T-AI-04: UsageLogger実装
- T-AI-05: CostGuard実装
- T02: UserAuth middleware + suspendガード
- T03: AdminAuth middleware + workspace境界ガード
- T04: RateLimiter (KV) 実装
- T05: OTP Service (KV) 実装
- T06: Email Queue実装

### Phase 2: コア機能（MVP）
- T07: WorkItems API実装
- T08: `/voice/execute` (intent_parse) 実装
- T09: 共有提案カード実装
- T10: Stranger 1対1調整実装

### Phase 3: Admin Console + 管理機能
- T-AI-06〜T-AI-12: Admin API実装（プロバイダ設定、使用量、コスト、予算）

### Phase 4: リスト/イベント/チーム拡張
- リスト管理
- イベント配信
- チーム/クエスト機能

## 🔧 Scripts Reference

```bash
# Development
npm run dev                    # Local development (wrangler dev)
npm run build                  # TypeScript build
npm run type-check             # Type checking
npm run lint                   # ESLint
npm run format                 # Prettier

# Database
npm run db:migrate:local       # Apply migrations (local)
npm run db:migrate:prod        # Apply migrations (production)
npm run db:console:local       # SQLite console (local)
npm run db:reset               # Reset local DB

# Resources
npm run setup:resources        # Create all Cloudflare resources

# Deployment
npm run deploy                 # Deploy to Cloudflare
npm run deploy:prod            # Build + Deploy

# PM2 (Development)
npm run start:pm2              # Start with PM2
npm run logs:pm2               # Check logs
pm2 list                       # List processes
pm2 restart webapp             # Restart service
pm2 delete webapp              # Stop and remove

# Git
npm run git:status             # Git status
npm run git:log                # Git log
npm run git:commit "message"   # Commit with message
```

## 📚 Documentation

詳細な仕様は `docs/` ディレクトリを参照してください：
- `docs/11_AI_PROVIDER_GEMINI.md` - Gemini実装仕様
- `docs/12_CHAT_CAPABILITIES.md` - チャット機能定義
- `docs/03_OPENAPI.yaml` - API仕様（OpenAPI）

## 🌐 URLs

- **Production**: (未デプロイ)
- **GitHub**: (未設定)

## 📄 License

Private Project

## 👤 Author

モギモギ（関屋紘之）- ドバイ在住の連続起業家・開発会社経営者

---

**Last Updated**: 2024-12-25
