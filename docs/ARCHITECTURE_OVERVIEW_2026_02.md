# Tomoniwao プロジェクト包括アーキテクチャ & ステータスレポート
## 2026-02-17 時点

---

## 1. プロジェクト概要

**AI Secretary Scheduler (Tomoniwao)** — チャット中心のスケジューリングシステム。
自然言語でAI秘書に話しかけると、予定調整・招待・リマインドなどを自動実行する。

| 項目 | 値 |
|---|---|
| **プロダクション URL** | `https://app.tomoniwao.jp` (Cloudflare Pages) |
| **API** | Cloudflare Workers (Hono) |
| **DB** | Cloudflare D1 (SQLite), 92 マイグレーション |
| **CI** | GitHub Actions — 全 63 テスト ✅ グリーン |
| **ブランチ戦略** | `main` (直接デプロイ) |

---

## 2. 技術スタック全体図

```
┌──────────────────────────────────────────────────────────────┐
│                     Cloudflare Pages (Frontend)              │
│  React 19 + Vite + Tailwind + Zustand + react-router-dom    │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐   │
│  │ Chat UI    │ │ People Hub   │ │ Settings / Billing   │   │
│  │ (ChatPage) │ │ (PeopleHub)  │ │ (SettingsPage)       │   │
│  └─────┬──────┘ └──────┬───────┘ └──────────┬───────────┘   │
│        │               │                    │                │
│  ┌─────▼───────────────▼────────────────────▼────────────┐  │
│  │           Intent Classifier Chain (12 classifiers)     │  │
│  │  → NL Router (Gemini AI fallback) → Executor Chain     │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼───────────────────────────────────┘
                           │ HTTPS /api/*
┌──────────────────────────▼───────────────────────────────────┐
│                 Cloudflare Workers (API — Hono)               │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Middleware: CORS │ Auth (Bearer/x-user-id) │ RateLimit  ││
│  └──────────────────────────────────────────────────────────┘│
│  ┌────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌──────┐ │
│  │Auth│ │Threads │ │1-on-1  │ │1-to-N│ │Pools   │ │Inbox │ │
│  │OTP │ │Invites │ │Fixed   │ │Group │ │Booking │ │Read  │ │
│  │    │ │Finalize│ │Cand3   │ │Send  │ │Members │ │      │ │
│  │    │ │Remind  │ │FreeBusy│ │Resp  │ │Slots   │ │      │ │
│  │    │ │Status  │ │OpenSlot│ │Final │ │Book    │ │      │ │
│  └────┘ └────────┘ └────────┘ └──────┘ └────────┘ └──────┘ │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────┐ │
│  │Contacts │ │Relations │ │Calendar│ │Chat/NL   │ │People│ │
│  │Import   │ │Block     │ │Today   │ │Router    │ │Hub   │ │
│  │BizCard  │ │Workmate  │ │Week    │ │Prefs     │ │      │ │
│  │         │ │          │ │FreeBusy│ │Assist    │ │      │ │
│  └─────────┘ └──────────┘ └────────┘ └──────────┘ └──────┘ │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────────┐  │
│  │Billing   │ │Workspace │ │Scheduling │ │Admin (System/ │  │
│  │MyASP     │ │Notif     │ │Internal   │ │ AI/Dashboard) │  │
│  └──────────┘ └──────────┘ └───────────┘ └───────────────┘  │
└──────────────────────────────────────────────────────────────┘
           │         │          │            │
    ┌──────▼──┐  ┌───▼───┐  ┌──▼──┐   ┌────▼────┐
    │  D1 DB  │  │  KV   │  │ R2  │   │ Queue   │
    │ SQLite  │  │OTP/RL │  │Store│   │ Email   │
    │ 92 mig  │  │       │  │     │   │ DLQ     │
    └─────────┘  └───────┘  └─────┘   └─────────┘
```

---

## 3. リポジトリ構成

```
webapp/
├── apps/
│   └── api/
│       └── src/
│           ├── index.ts              # メインエントリ (Hono app)
│           ├── routes/               # 46 ルートファイル, 154+ エンドポイント
│           │   ├── auth.ts           # OAuth認証
│           │   ├── otp.ts            # OTPサービス
│           │   ├── threads/          # スレッドCRUD (分割済み: list/create/actions/invites/proposals)
│           │   ├── oneOnOne.ts       # 1対1 (fixed/candidates/freebusy/open-slots)
│           │   ├── oneToMany.ts      # 1対N (prepare/send/respond/finalize/repropose)
│           │   ├── pools.ts          # N対1 Pool Booking
│           │   ├── schedulingInternal.ts  # workmate 社内調整
│           │   ├── contacts.ts       # 連絡先台帳
│           │   ├── contactImport.ts  # CSV/テキスト取り込み
│           │   ├── businessCards.ts  # 名刺OCR
│           │   ├── relationships.ts  # 仕事仲間/ブロック
│           │   ├── inbox.ts          # 通知 (既読/一括既読/未読数)
│           │   ├── nlRouter.ts       # AI自然言語ルーティング
│           │   ├── nlPrefs.ts        # 好み設定抽出
│           │   ├── chat.ts           # AIチャット
│           │   ├── calendar.ts       # Google Calendar連携
│           │   ├── billing/          # MyASP課金連携
│           │   ├── invite.ts         # 外部招待ページ
│           │   ├── groupInvite.ts    # 1対Nグループ招待ページ
│           │   ├── openSlots.ts      # 公開枠選択ページ
│           │   └── ...
│           ├── middleware/           # auth, adminAuth, rateLimit
│           ├── utils/               # email, slotGenerator, slotScorer, nlPrompts, etc.
│           ├── scheduled/           # Cron: pruneAuditLogs, processReminders, processDeadlines
│           └── queue/               # emailConsumer
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # SPA ルーティング (13 routes)
│   │   ├── pages/                   # 17 ページコンポーネント
│   │   ├── components/
│   │   │   ├── cards/               # ThreadCardsSwitch, CalendarCards, SlotsCards etc.
│   │   │   └── chat/                # ChatLayout, ChatPane, CardsPane, NotificationBell
│   │   ├── core/
│   │   │   ├── api/                 # API クライアント (20 モジュール)
│   │   │   ├── auth/                # 認証管理
│   │   │   ├── cache/               # Zustand キャッシュ (7 stores)
│   │   │   ├── chat/
│   │   │   │   ├── classifier/      # Intent Classifier Chain (12 classifiers)
│   │   │   │   ├── executors/       # 40+ executor functions
│   │   │   │   ├── nlRouter/        # NL Router (AI fallback)
│   │   │   │   └── messageFormatter.ts
│   │   │   ├── hooks/               # useMe, useViewerTimezone
│   │   │   ├── models/              # threadViewModel
│   │   │   ├── platform/            # env, log, navigation, storage
│   │   │   └── refresh/             # refreshMap (SSOT更新)
│   │   └── utils/
│   ├── e2e/                         # 32 E2E テストファイル, ~220+ テストケース
│   └── ...
├── packages/
│   ├── ai/                          # AIクラシファイア/パーサー (CSV, Contact Import, List Operation)
│   └── shared/                      # 共有型定義 (Env, Thread, Inbox, etc.)
├── db/
│   └── migrations/                  # 92 SQLマイグレーション
├── docs/                            # 130+ ドキュメント
├── .github/workflows/test.yml       # CI (guardrails, unit, typecheck, e2e-smoke, e2e-auth)
├── wrangler.jsonc                   # Cloudflare Workers設定
└── package.json                     # ルート (API)
```

---

## 4. データモデル（D1 データベース）

### 4.1 コアテーブル群（92 マイグレーション, ~70+ テーブル）

| ドメイン | テーブル | 用途 |
|---|---|---|
| **User** | `users`, `google_accounts`, `sessions` | ユーザー基盤、OAuth、セッション管理 |
| **Work** | `work_items`, `work_item_dependencies` | 統合WorkItem (予定/タスク) |
| **Scheduling** | `scheduling_threads`, `scheduling_candidates`, `scheduling_slots`, `thread_selections`, `thread_finalize`, `thread_attendance_rules`, `thread_failures`, `thread_responses` | 調整スレッドのライフサイクル |
| **Thread** | `threads`, `thread_invites`, `thread_participants`, `thread_messages`, `thread_message_deliveries` | スレッドCRUD + メッセージング |
| **Invite** | `external_invites`, `invite_deliveries` | 外部招待リンク + 配信追跡 |
| **Inbox** | `inbox`, `inbox_items` (deprecated) | 通知管理 |
| **Contacts** | `contacts`, `contact_touchpoints`, `contact_channels`, `contact_import_tokens`, `business_cards` | 連絡先台帳 + OCR |
| **Lists** | `lists`, `list_members`, `list_items`, `list_item_events` | 送信セグメント + タスク管理 |
| **Relations** | `relationships` (v2), `relationship_requests`, `blocks` | 仕事仲間/ブロック |
| **Pool** | `pools`, `pool_members`, `pool_slots`, `pool_slot_reservations`, `pool_bookings`, `pool_public_links` (0090) | N対1 受付プール |
| **Open Slots** | `open_slots`, `open_slot_items` | TimeRex型公開枠 |
| **Calendar** | (Google Calendar API連携) | Today/Week/FreeBusy |
| **Billing** | `billing_events`, `billing_accounts` | MyASP課金 |
| **Remind** | `remind_log`, `scheduled_reminders` | リマインダー |
| **Pending** | `pending_actions` | 送信確認フロー |
| **Chat** | `chat_messages` | AI秘書チャット履歴 |
| **Admin** | `admin_users`, `admin_workspace_access` (v2), `system_settings`, `ai_provider_*`, `ai_budgets`, `ai_usage_logs` | 管理画面 |
| **Workspace** | `workspaces`, `workspace_notification_settings` | ワークスペース設定 |
| **Audit** | `audit_logs`, `ledger_audit_events` | 監査ログ |

### 4.2 重要な設計メモ

- **`workspace_id = 'ws-default'`**: シングルテナント段階。物理テーブルなし (ロジック値)。`workspace_members` テーブルは未作成。
- **`relationships_v2`**: 0084マイグレーションで `workmate` タイプ追加、テーブル再作成。
- **`pending_actions`**: 2回再作成 (0071, 0092) — contact_import対応の`action_type`拡張。

---

## 5. フロントエンド アーキテクチャ

### 5.1 Intent Classifier Chain（ルールベース, 12段階）

```
ユーザー入力
 ↓
1. pendingDecision     ← pending.action 最優先
2. contactImport       ← 取り込みフロー中
3. confirmCancel       ← はい/いいえ系
4. lists               ← リスト操作
5. calendar            ← カレンダー読み取り
6. preference          ← 好み設定
7. oneOnOne            ← 1対1予定調整
8. propose             ← 候補提案
9. remind              ← リマインド
10. relation           ← 仕事仲間管理
11. pool               ← Pool Booking
12. thread             ← スレッド操作
 ↓ (マッチなし)
NL Router (Gemini AI) → Executor Bridge
```

### 5.2 Executor 一覧（40+ 関数）

| カテゴリ | Executor | 状態 |
|---|---|---|
| **Calendar** | executeToday, executeWeek, executeFreeBusy, executeFreeBusyBatch | ✅ 実装済み |
| **List** | executeListCreate, executeListList, executeListMembers, executeListAddMember | ✅ 実装済み |
| **Thread** | executeCreate, executeStatusCheck, executeFinalize, executeThreadCreate, executeInviteList | ✅ 実装済み |
| **Remind** | 13 functions (status, pending, needResponse, responded + confirm/cancel 各種) | ✅ 実装済み |
| **Batch** | executeBatchAddMembers | ✅ 実装済み |
| **Invite** | executeInvitePrepareEmails, executeInvitePrepareList | ✅ 実装済み |
| **Pending** | executePendingDecision | ✅ 実装済み |
| **AutoPropose** | 8 functions (autoPropose, additional, split + confirm/cancel) | ✅ 実装済み |
| **OneOnOne** | executeOneOnOneFixed, executeOneOnOneCandidates, executeOneOnOneFreebusy | ✅ 実装済み |
| **Relation** | executeRelationRequestWorkmate, Approve, Decline | ✅ 実装済み |
| **Pool Book** | executePoolBook, BookingCancel, BookingList | ✅ 実装済み |
| **Pool Create** | executePoolCreate, AddSlots, Finalize, Cancel, MemberSelected | ✅ 実装済み |
| **Contact Import** | Preview, Confirm, Cancel, PersonSelect, BusinessCardScan | ✅ 実装済み |
| **Post Import** | executePostImportNextStepDecide | ✅ 実装済み (FE-4) |
| **Preference** | preference.set, show, clear | ✅ 実装済み |

### 5.3 ページルーティング (SPA)

| Path | Page | 状態 |
|---|---|---|
| `/` | LoginPage | ✅ |
| `/chat`, `/chat/:threadId` | ChatPage (メイン画面) | ✅ |
| `/people` | PeopleHubPage | ✅ |
| `/settings` | SettingsPage | ✅ |
| `/settings/billing` | BillingPage | ✅ |
| `/settings/workspace-notifications` | WorkspaceNotificationsPage | ✅ |
| `/scheduling/:threadId` | SchedulingInternalThreadPage | ✅ |
| `/group`, `/group/new`, `/group/:threadId` | GroupList/New/ThreadPage | ✅ |
| `/threads/new`, `/threads/:threadId` | ThreadCreate/DetailPage | ✅ |
| `/relationships/request` | RelationshipRequestPage | ✅ |
| `/dashboard` | → `/chat` リダイレクト | ✅ |
| `/contacts`, `/lists` | → `/people` リダイレクト | ✅ |

---

## 6. API エンドポイント全体図 (154+ endpoints)

### 6.1 Public (認証不要)

| Path | Methods | 用途 |
|---|---|---|
| `/health`, `/api/health` | GET | ヘルスチェック |
| `/auth/*` | POST | Google OAuth, Token Refresh |
| `/api/otp/send`, `/api/otp/verify` | POST | ワンタイムパスワード |
| `/i/:token` | GET, POST | 外部招待ページ (回答) |
| `/g/:token` | GET, POST | 1対Nグループ招待ページ |
| `/open/:token` | GET, POST | 公開枠選択ページ |
| `/api/billing/myasp/sync/:token` | POST | MyASP Webhook |
| `/test/*` | ALL | テストフィクスチャ (dev環境のみ) |

### 6.2 Protected (Bearer / x-user-id 認証)

| ドメイン | Prefix | 主要エンドポイント | EP数 |
|---|---|---|---|
| **Threads** | `/api/threads` | CRUD, status, remind, finalize, invites/batch, proposals/prepare, slots | ~20 |
| **One-on-One** | `/api/one-on-one` | fixed/prepare, candidates/prepare, freebusy/prepare, open-slots/prepare | 5 |
| **One-to-Many** | `/api/one-to-many` | prepare, send, respond, finalize, repropose, summary | 8 |
| **Pools** | `/api/pools` | CRUD, members, slots, book, bookings, public-link, cancel | 14 |
| **Scheduling Internal** | `/api/scheduling/internal` | prepare, /:threadId, /:threadId/respond | 3 |
| **Contacts** | `/api/contacts` | CRUD, upsert, import, import/confirm | 7 |
| **Contact Import** | `/api/contacts/import` | preview, person-select, confirm, cancel | 4 |
| **Business Cards** | `/api/business-cards` | scan, create, list, image | 4 |
| **Lists** | `/api/lists` | CRUD, members add/remove/list | 8 |
| **List Items** | `/api/list-items` | CRUD (lists/:listId/items) | 4 |
| **Relationships** | `/api/relationships` | request, approve, decline, block, list | ~10 |
| **Inbox** | `/api/inbox` | list, unread-count, /:id/read, mark-all-read | 4 |
| **Calendar** | `/api/calendar` | today, week, freebusy, freebusy/batch, proxy-event | 5 |
| **Chat** | `/api/chat` | message, history | 2 |
| **NL Router** | `/api/nl` | route, assist, multi | 3 |
| **NL Prefs** | `/api/nl/prefs` | extract | 1 |
| **Pending Actions** | `/api/pending-actions` | /:token/confirm, /:token/execute | 2 |
| **People** | `/api/people` | list, audit, /:id | 3 |
| **Users Me** | `/api/users/me` | get, patch, schedule-prefs CRUD | 5 |
| **Workspace Notif** | `/api/workspace/notifications` | CRUD | ~3 |
| **Work Items** | `/api/work-items` | CRUD, share, share-bulk | 7 |
| **Voice** | `/api/voice` | transcribe, process | 2 |
| **Billing** | `/api/billing` | me | 1 |
| **Admin** | `/admin/*` | system settings, AI cost center, dashboard | ~15 |

---

## 7. Cron ジョブ & バックグラウンド処理

| スケジュール | 処理 | 状態 |
|---|---|---|
| `0 2 * * *` (毎日 02:00 UTC) | `pruneAuditLogs` — 監査ログの期限切れデータ削除 | ✅ |
| `0 * * * *` (毎時) | `processReminders` — 前日リマインダーメール送信 | ✅ |
| `0 * * * *` (毎時) | `processDeadlines` — 1対N deadline 到達時の自動確定処理 | ✅ |
| Queue Consumer | `emailConsumer` — Email Queue (3 retries, DLQ) | ✅ |

---

## 8. CI / テスト現況

### 8.1 CI パイプライン (.github/workflows/test.yml)

```
push/PR → main
  ├── Code Guardrails (2s)         ✅
  │     └─ /api/threads/i/* 禁止ガードレール
  ├── TypeScript Check (16s)       ✅
  │     └─ npx tsc -p tsconfig.app.json --noEmit
  ├── Unit Tests (14s)             ✅ (309 tests, 13 files)
  │     └─ vitest
  ├── lint-and-build (44s)         ✅
  │     └─ eslint + tsc
  ├── p0-checks (51s)              ✅
  ├── E2E Smoke Tests (3m)         ✅ (63/63 passed)
  │     ├─ wrangler dev --local (API port 3000)
  │     ├─ vite preview (FE port 4173)
  │     └─ Playwright --project=smoke
  └── E2E Authenticated Tests      ⏭️ (manual trigger / [e2e] tag)
        └─ Playwright --project=setup --project=authenticated
```

### 8.2 テストカバレッジ

| 種別 | ファイル数 | テスト数 | 状態 |
|---|---|---|---|
| **Unit Tests** (vitest) | 13 | 309 | ✅ 全パス |
| **E2E Smoke** (Playwright) | 14 smoke specs | 63 | ✅ 全パス |
| **E2E Authenticated** | 18 auth specs | ~170+ | ⏭️ 手動トリガー |
| **合計** | 45+ | 540+ | |

### 8.3 E2E Smoke テスト内訳

| テストファイル | テスト数 | カバー範囲 |
|---|---|---|
| `smoke.smoke.spec.ts` | 3 | 基本ヘルスチェック |
| `one-on-one.smoke.spec.ts` | 3 | 1対1固定日時 |
| `one-to-many.smoke.spec.ts` | 5 | 1対N準備/送信/回答 |
| `one-to-many-open-slots.smoke.spec.ts` | 14 | 1対N公開枠 |
| `one-to-many.security.smoke.spec.ts` | 17 | 1対Nセキュリティ |
| `r1-internal-scheduling.smoke.spec.ts` | 5 | 社内調整 |
| `pools-booking.smoke.spec.ts` | 13 | Pool Booking + Block |
| `inbox-read.smoke.spec.ts` | 4 | 通知既読 (API-based) |
| `contact-import.smoke.spec.ts` | 5 | 連絡先取り込み |

---

## 9. 現在の進捗ポイント（CI グリーン地点）

### 9.1 完了済み機能一覧

| フェーズ | 機能 | API | FE | E2E | 状態 |
|---|---|---|---|---|---|
| **Core** | Auth (Google OAuth + OTP + Sessions) | ✅ | ✅ | ✅ | 完了 |
| **Core** | Chat UI Shell (ChatPage, ChatPane, CardsPane) | ✅ | ✅ | ✅ | 完了 |
| **Core** | Intent Classifier Chain (12 classifiers) | — | ✅ | ✅ | 完了 |
| **Core** | NL Router (Gemini AI fallback) | ✅ | ✅ | — | 完了 |
| **Sched** | 1対1 Fixed DateTime | ✅ | ✅ | ✅ | 完了 |
| **Sched** | 1対1 Candidates (3候補) | ✅ | ✅ | ✅ | 完了 |
| **Sched** | 1対1 FreeBusy | ✅ | ✅ | ✅ | 完了 |
| **Sched** | 1対1 Open Slots (TimeRex型) | ✅ | ✅ | ✅ | 完了 |
| **Sched** | 1対N Group Scheduling | ✅ | ✅ | ✅ | 完了 |
| **Sched** | 1対N Open Slots | ✅ | ✅ | ✅ | 完了 |
| **Sched** | 1対N Security (権限チェック) | ✅ | — | ✅ | 完了 |
| **Sched** | Internal Scheduling (workmate R1) | ✅ | ✅ | ✅ | 完了 |
| **Pool** | N対1 Pool Booking (CRUD, Round-Robin, Public Link) | ✅ | ✅ | ✅ | 完了 |
| **Contacts** | 連絡先台帳 CRUD | ✅ | ✅ | — | 完了 |
| **Contacts** | CSV/テキスト取り込み | ✅ | ✅ | ✅ | 完了 |
| **Contacts** | 名刺OCR → Chat UI統合 | ✅ | ✅ | — | 完了 |
| **Contacts** | 取り込み後 次手選択 (PR-D-FE-4) | — | ✅ | — | **FE完了, 接続未** |
| **People** | People Hub (連絡先/リスト/つながり統合) | ✅ | ✅ | — | 完了 |
| **Relation** | 仕事仲間申請/承諾/拒否 (D0) | ✅ | ✅ | ✅ | 完了 |
| **Relation** | ブロック | ✅ | — | ✅ | API完了 |
| **Inbox** | 通知 (既読/一括既読/未読数) | ✅ | ✅ | ✅ | 完了 |
| **Calendar** | Today/Week/FreeBusy (Google Calendar連携) | ✅ | ✅ | — | 完了 |
| **Lists** | リスト CRUD + メンバー管理 | ✅ | ✅ | — | 完了 |
| **Remind** | リマインダー (pending/responded/need_response) | ✅ | ✅ | — | 完了 |
| **AutoPropose** | 自動候補提案 + 追加提案 | ✅ | ✅ | — | 完了 |
| **Pending** | 送信確認フロー | ✅ | ✅ | — | 完了 |
| **Preference** | 好み設定 (NL extraction) | ✅ | ✅ | — | 完了 |
| **Billing** | MyASP課金連携 | ✅ | ✅ | — | 完了 |
| **Voice** | 音声入力 (Web Speech API + Whisper) | ✅ | ✅ | — | 完了 |
| **Admin** | System Settings / AI Cost / Dashboard | ✅ | — | — | API完了 |

### 9.2 既知のオープンイシュー

| ID | 内容 | 影響度 | 備考 |
|---|---|---|---|
| **TD-1** | `workspace_members` テーブル未作成 | 低 | シングルテナント前提で `ws-default` ハードコード。マルチテナント移行時に要対応 |
| **TD-2** | `oneToMany.ts:538` TODO: 自動確定処理 | 中 | Cron (`processDeadlines`) が対応しているが、respond時の自動確定は未実装 |
| **TD-3** | `auth.ts:104` CSRF state cookie verification | 低 | OAuth state のcookie検証が未実装 |
| **TD-4** | `invite.ts:1465` slotGenerator with freebusy | 低 | PR-B3-API の将来機能 |
| **TD-5** | `resolveChannel.ts:115` contact_channels API | 低 | Phase 4+ の将来機能 |
| **TD-6** | `storage.ts:248` NativeStorageAdapter | 低 | モバイルアプリ対応時 |

---

## 10. 依存関係マップ & FE-5 の位置づけ

### 10.1 Post-Import Flow 全体図

```
名刺 / CSV / テキスト
       │
       ▼
┌─────────────────┐
│ contact.import   │ PR-D-API-1 ✅
│ (preview/confirm)│ PR-D-FE-1  ✅
└───────┬─────────┘
        │ confirm → contacts 書き込み完了
        ▼
┌─────────────────────────┐
│ Post-Import Next Step    │ PR-D-FE-4 ✅ (FE only)
│ (send_invite / schedule  │
│  / message_only)         │
└───────┬─────────────────┘
        │ selection.action
        ├──── 'send_invite' ──────────► FE-5a: 招待実行 ⭐ 未接続
        ├──── 'schedule' ─────────────► FE-5b: 日程調整実行 ⭐ 未接続
        └──── 'completed' ───────────► ✅ 完了 (pending クリア)
```

### 10.2 FE-5 の依存関係

```
FE-5a (send_invite の実行)
  依存:
  ├── executeInvitePrepareEmails()  ✅ (invite.ts)
  ├── POST /api/threads/prepare-send  ✅ (threads/actions.ts)
  ├── POST /api/threads/:id/invites/prepare  ✅ (threads/invites.ts)
  ├── POST /api/pending-actions/:token/execute  ✅ (pendingActions.ts)
  └── 配信チャネル決定:
      ├── Email (Resend API) ✅
      ├── SMS (Twilio) ✅ 設定済み
      └── In-app (inbox) ✅

FE-5b (schedule の実行)
  依存:
  ├── executeOneOnOneFixed() / executeOneOnOneCandidates() / executeOneOnOneFreebusy()  ✅
  ├── POST /api/one-on-one/fixed/prepare  ✅
  ├── POST /api/one-on-one/candidates/prepare  ✅
  ├── POST /api/one-on-one/freebusy/prepare  ✅
  └── 対象 N>1 の場合:
      ├── POST /api/one-to-many/prepare  ✅
      └── N対N の場合: ⚠️ 未実装 (scope外)
```

---

## 11. 技術的負債 & 運用リスク

### 11.1 技術的負債 (優先度順)

| # | 内容 | 影響 | 推奨対応 |
|---|---|---|---|
| **TD-1** | `workspace_members` テーブル不在 → `relationships.ts` で `ws-default` ハードコード | BLOCK-1 で 500 → 今回の PR#122 で修正済み | マルチテナント時にマイグレーション追加 |
| **TD-2** | `respond` 時の自動確定ロジック未実装 (`oneToMany.ts:538`) | 全員回答後に手動 finalize 必要 | `processDeadlines` Cron と統合 or respond後に条件チェック追加 |
| **TD-3** | ESLint known-fails (PR#121 で excluded) | コード品質 | 段階的に修正 |
| **TD-4** | `contact_channels` API 未実装 (resolveChannel.ts) | チャネル解決がフォールバックのみ | Phase 4+ |
| **TD-5** | `vite preview` (4173) と `wrangler dev` (3000) の二重起動問題 | E2E テスト設計に影響 | Playwright config を統一サーバーに変更 (長期) |
| **TD-6** | CSRF state cookie 未検証 (auth.ts) | セキュリティ低リスク | OAuth フロー見直し時に修正 |

### 11.2 運用リスク

| # | リスク | 重大度 | 対策 |
|---|---|---|---|
| **OR-1** | 単一テナント設計 → マルチテナント移行の複雑性 | 🟡 中 | `workspace_id` は全テーブルに存在。移行時はマイグレーション + ミドルウェア変更 |
| **OR-2** | Gemini API のレート制限 / コスト | 🟡 中 | `AI_FALLBACK_ENABLED=false` + `ai_budgets` テーブルで予算管理 |
| **OR-3** | Email Queue (DLQ) の監視不足 | 🟡 中 | DLQ 監視ダッシュボード + アラート設定推奨 |
| **OR-4** | D1 の 10MB query result limit | 🟢 低 | 現状のデータ量では問題なし。大規模時にページネーション見直し |
| **OR-5** | Workers CPU limit (10ms free / 30ms paid) | 🟢 低 | 重い処理は Queue に分離済み |

---

## 12. 残タスク & 優先度付き実装計画

### 12.1 優先度 P0 — 即対応推奨

| # | タスク | 依存 | 工数 | 備考 |
|---|---|---|---|---|
| **FE-5a** | Post-Import → `send_invite` 実行接続 | invite.ts (✅), threads/actions.ts (✅) | 0.5-1日 | メール送信が最重要パス |
| **FE-5b** | Post-Import → `schedule` 実行接続 | oneOnOne.ts (✅) | 0.5-1日 | 1対1/1対N の分岐ロジック |
| **FE-5c** | `schedule` フロー: デフォルトA/B決定 | — | 設計 0.5日 | A: fixed → B: candidates → C: freebusy |

### 12.2 優先度 P1 — 次スプリント

| # | タスク | 依存 | 工数 | 備考 |
|---|---|---|---|---|
| **P1-1** | `send_invite` 配信媒体の確定 | FE-5a | 設計 0.5日 | Email only? SMS? In-app? |
| **P1-2** | N対1 (複数人に同時招待) のハンドリング | FE-5a | 1日 | 現在は1人ずつ想定 |
| **P1-3** | `respond` 後の自動確定 (TD-2) | oneToMany.ts | 0.5日 | 全員回答時に自動 finalize |
| **P1-4** | E2E: FE-5 の smoke テスト追加 | FE-5a/5b | 1日 | |
| **P1-5** | E2E Authenticated テスト安定化 | — | 1日 | 現在 manual trigger のみ |

### 12.3 優先度 P2 — 中期

| # | タスク | 依存 | 工数 | 備考 |
|---|---|---|---|---|
| **P2-1** | N対N 調整 (scope外だが将来) | — | 大 | 現行 MVP scope 外 |
| **P2-2** | `contact_channels` API 実装 | — | 1-2日 | チャネル解決の正式化 |
| **P2-3** | ESLint known-fails 段階的修正 | — | 1-2日 | コード品質改善 |
| **P2-4** | Vite preview / Wrangler dev 統合 | — | 0.5日 | E2E テスト基盤改善 |
| **P2-5** | DLQ 監視ダッシュボード | — | 0.5日 | 運用安定性 |
| **P2-6** | `workspace_members` マイグレーション (マルチテナント準備) | — | 2-3日 | |

### 12.4 設計決定が必要な項目

| 決定事項 | 選択肢 | 推奨 | 理由 |
|---|---|---|---|
| **FE-5 schedule フロー** | A) fixed → B) candidates → C) freebusy | **B) candidates** | ユーザーに3候補提示が最も使いやすい |
| **send_invite 配信媒体** | Email / SMS / In-app / Mixed | **Email (default) + In-app** | MVP では Email 優先。SMS は opt-in |
| **N対1 ハンドリング** | 個別スレッド / バッチスレッド | **個別スレッド** | 既存 `executeInvitePrepareEmails` と整合 |
| **N対N** | 実装する / scope外 | **scope外 (P2)** | MVP 範囲を守る |

---

## 13. 推奨実装スケジュール

### Week 1: FE-5 実装 (4-5日)

```
Day 1: FE-5 PRD作成 + schedule フロー A/B 設計決定
Day 2: FE-5a — send_invite 接続
  - executePostImportNextStepDecide() で action='send_invite' 時に
    executeInvitePrepareEmails() を自動チェーン
  - pending.action.created → 確認 → execute
Day 3: FE-5b — schedule 接続
  - action='schedule' 時に oneOnOne executor を自動チェーン
  - 対象が複数人の場合は 1-to-N にルーティング
Day 4: E2E テスト追加 (FE-5 smoke tests)
Day 5: コードレビュー + CI グリーン確認 + PR マージ
```

### Week 2: 安定化 + P1 対応 (3-5日)

```
Day 1-2: P1-1 (配信媒体確定) + P1-2 (N対1 ハンドリング)
Day 3: P1-3 (respond 後の自動確定)
Day 4: P1-5 (E2E Authenticated テスト安定化)
Day 5: ドキュメント更新 + バックアップ
```

---

## 14. 環境 & デプロイ情報

| 項目 | 値 |
|---|---|
| **本番 API** | Cloudflare Workers (`webapp`) |
| **本番 FE** | Cloudflare Pages (`app.tomoniwao.jp`) |
| **DB** | Cloudflare D1 (`webapp-production`, ID: `35dad869-...`) |
| **KV** | `RATE_LIMIT`, `OTP_STORE` |
| **R2** | `webapp-storage` |
| **Queue** | `email-queue` (DLQ: `email-dlq`) |
| **Cron** | Daily 02:00 UTC, Hourly |
| **Secrets** | JWT_SECRET, ENCRYPTION_KEY, GOOGLE_*, GEMINI_API_KEY, OPENAI_API_KEY, RESEND_API_KEY, TWILIO_* |
| **CI** | GitHub Actions (main push/PR) |
| **Git** | `main` ブランチ直接デプロイ |

---

## 15. まとめ

### 現在地
- **CI 完全グリーン**: 309 Unit + 63 E2E Smoke = 372 テスト全パス
- **154+ API エンドポイント** 実装済み
- **40+ FE Executor** 実装済み
- **92 DBマイグレーション** 適用済み
- **12段階 Intent Classifier** + NL Router (Gemini AI) 完動

### 次の一手
**FE-5 (Post-Import → 実行接続)** が最重要タスク。
`send_invite` / `schedule` の選択後に実際のAPIを叩く接続ロジックを実装すれば、
名刺取り込み → 招待/日程調整 のエンドツーエンドフローが完成する。

---

*Generated: 2026-02-17 | Branch: main | Commit: df5cead*
