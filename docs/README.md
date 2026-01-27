# Tomoniwao Project - Technical Documentation

## 📋 Project Overview

**Project Name**: Tomoniwao (共庭)  
**Code Name**: `webapp`  
**Description**: AI-powered scheduling assistant with voice commands, stranger 1-to-1 matching, and collaborative work item management.

**Production URL**: https://webapp.snsrilarc.workers.dev  
**GitHub Repository**: https://github.com/matiuskuma2/tomoniwaproject  
**Deployment Platform**: Cloudflare Workers + Pages

---

## 🏗️ Architecture

### Technology Stack

**Runtime & Framework:**
- **Cloudflare Workers** - Serverless edge runtime
- **Hono** - Lightweight web framework for Cloudflare Workers
- **TypeScript** - Type-safe development

**Data Storage:**
- **Cloudflare D1** - SQLite-based distributed SQL database
- **Cloudflare KV** - Key-value store (Rate limiting, OTP storage)
- **Cloudflare R2** - Object storage (File attachments, exports)
- **Cloudflare Queues** - Message queue (Email sending)

**External Services:**
- **Resend API** - Email delivery (`tomoniwao.jp` domain)
- **OpenAI API** - GPT-4o-mini for intent parsing (fallback)
- **Google Gemini API** - Gemini-2.0-flash-exp for intent parsing (primary)

**Development Tools:**
- **Wrangler** - Cloudflare Workers CLI
- **PM2** - Local development server manager
- **Git** - Version control
- **GitHub Actions** - CI/CD (auto-deploy on push to main)

---

## 📁 Project Structure

```
webapp/
├── apps/
│   └── api/
│       └── src/
│           ├── index.ts                    # Main entry point
│           ├── middleware/
│           │   ├── auth.ts                 # Authentication (x-user-id dev, Bearer prod)
│           │   └── rateLimit.ts            # Rate limiting middleware
│           ├── routes/
│           │   ├── adminSystem.ts          # System settings management
│           │   ├── adminAi.ts              # AI cost center management
│           │   ├── otp.ts                  # OTP send/verify (Ticket 05)
│           │   ├── workItems.ts            # Work items CRUD (Ticket 07)
│           │   ├── voice.ts                # Voice commands (Ticket 08)
│           │   ├── threads.ts              # Thread creation API (Ticket 10)
│           │   └── invite.ts               # External invite /i/:token (Ticket 10)
│           ├── repositories/
│           │   ├── workItemsRepository.ts  # Work items data access
│           │   ├── threadsRepository.ts    # Threads data access
│           │   └── inboxRepository.ts      # Inbox notifications
│           ├── services/
│           │   ├── rateLimiter.ts          # Rate limiter (Ticket 04)
│           │   ├── otpService.ts           # OTP generation/validation (Ticket 05)
│           │   ├── emailQueue.ts           # Email queue producer (Ticket 06)
│           │   ├── aiRouter.ts             # AI provider router (Ticket 08)
│           │   ├── intentParser.ts         # Intent parser service (Ticket 08)
│           │   └── candidateGenerator.ts   # AI candidate generation (Ticket 10)
│           └── queue/
│               └── emailConsumer.ts        # Email queue consumer (Ticket 06)
├── db/
│   └── migrations/                         # D1 database migrations (0001-0026)
├── packages/
│   └── shared/
│       └── src/
│           └── types/
│               └── env.ts                  # Environment type definitions
├── docs/                                   # Project documentation
├── wrangler.jsonc                          # Cloudflare Workers configuration
├── package.json                            # Dependencies and scripts
├── tsconfig.json                           # TypeScript configuration
└── ecosystem.config.cjs                    # PM2 configuration (local dev)
```

---

## 🔧 Configuration Files

### wrangler.jsonc

```jsonc
{
  "name": "webapp",
  "main": "apps/api/src/index.ts",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],
  
  "d1_databases": [{
    "binding": "DB",
    "database_name": "webapp-production",
    "database_id": "35dad869-c19f-40dd-90a6-11f87a3382d2",
    "migrations_dir": "db/migrations"
  }],
  
  "kv_namespaces": [
    { "binding": "RATE_LIMIT", "id": "5f0feea9940643ed93ef9ca1a682f264" },
    { "binding": "OTP_STORE", "id": "9ad0e9b7e8bf4efa96b9fdb8ab89b176" }
  ],
  
  "r2_buckets": [{
    "binding": "STORAGE",
    "bucket_name": "webapp-storage"
  }],
  
  "queues": {
    "producers": [{ "binding": "EMAIL_QUEUE", "queue": "email-queue" }],
    "consumers": [{
      "queue": "email-queue",
      "max_batch_size": 1,
      "max_batch_timeout": 30,
      "max_retries": 3,
      "dead_letter_queue": "email-dlq"
    }]
  },
  
  "vars": {
    "ENVIRONMENT": "development",
    "LOG_LEVEL": "info",
    "CORS_ORIGINS": "*"
  },
  
  "triggers": {
    "crons": ["0 2 * * *", "0 * * * *"]
  },
  
  "analytics_engine_datasets": [{ "binding": "ANALYTICS" }]
}
```

### package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "dev:sandbox": "wrangler pages dev dist --ip 0.0.0.0 --port 3000",
    "build": "tsc --noEmit && echo 'Build check passed'",
    "deploy": "npm run build && wrangler deploy",
    "db:migrate:local": "wrangler d1 migrations apply webapp-production --local",
    "db:migrate:prod": "wrangler d1 migrations apply webapp-production",
    "test": "curl http://localhost:3000/health"
  }
}
```

---

## 🔐 Environment Variables & Secrets

### Local Development (.dev.vars)

```bash
ENVIRONMENT=development
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIzaSy...
RESEND_API_KEY=re_...
```

### Production (Cloudflare Secrets)

Managed via `wrangler secret put`:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put RESEND_API_KEY
```

**Current Status:**
- ✅ `OPENAI_API_KEY` - Set
- ✅ `GEMINI_API_KEY` - Set
- ✅ `RESEND_API_KEY` - Set

---

## 📊 Dependencies

### Core Dependencies

```json
{
  "hono": "^4.0.0",
  "uuid": "^11.0.3"
}
```

### Dev Dependencies

```json
{
  "@cloudflare/workers-types": "4.20250705.0",
  "@hono/vite-cloudflare-pages": "^0.4.2",
  "@types/uuid": "^10.0.0",
  "vite": "^5.0.0",
  "wrangler": "^3.114.16",
  "typescript": "^5.0.0"
}
```

**Note:** No heavy Node.js dependencies due to Cloudflare Workers environment restrictions.

---

## 🚀 Development Workflow

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Apply migrations (local)
npm run db:migrate:local

# 3. Start development server with PM2
pm2 start ecosystem.config.cjs

# 4. Test API
curl http://localhost:3000/health
```

### Production Deployment

```bash
# 1. Build check
npm run build

# 2. Apply migrations (production)
npm run db:migrate:prod

# 3. Deploy to Cloudflare Workers
npm run deploy
```

### Git Workflow

```bash
# 1. Commit changes
git add .
git commit -m "feat: description"

# 2. Push to GitHub (triggers auto-deploy)
git push origin main

# 3. Verify deployment
curl https://webapp.snsrilarc.workers.dev/health
```

---

## 🔄 CI/CD

### GitHub Auto-Deploy

**Trigger**: Push to `main` branch  
**Platform**: Cloudflare Workers  
**Status**: ✅ Active

**Deployment Flow:**
1. Code pushed to GitHub
2. Cloudflare detects commit
3. Automatic build & deploy
4. Production URL updated (~60 seconds)

**Manual Deploy (if needed):**
```bash
npx wrangler deploy
```

---

## 📖 Documentation Index

- [Database Schema](./DATABASE_SCHEMA.md) - Complete D1 database structure
- [API Reference](./API_REFERENCE.md) - All API endpoints with examples
- [Migration History](./MIGRATION_HISTORY.md) - Database migration changelog
- [Phase Implementation](./PHASE_IMPLEMENTATION.md) - Development phases & tickets
- **[1対1 AI秘書 差分チェックシート](./ONE_ON_ONE_DIFF_CHECKLIST.md)** - R0(他人)向け Phase B-1〜B-4 実装前計画と対応表

---

## 🔗 Quick Links

- **Production API**: https://webapp.snsrilarc.workers.dev
- **GitHub Repo**: https://github.com/matiuskuma2/tomoniwaproject
- **Cloudflare Dashboard**: https://dash.cloudflare.com/8cdf2ccee6b3bb852caed223cc3fe31e/workers/services/view/webapp

---

## 👥 Contributors

- **Owner**: matiuskuma2 (モギモギ - 関屋紘之)
- **Location**: Dubai, UAE
- **Contact**: snsrilarc@gmail.com

---

**Last Updated**: 2025-12-25  
**Version**: Phase 2 Complete (Tickets 09-10)
