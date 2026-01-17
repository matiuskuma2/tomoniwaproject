# Tomoniwao - プロジェクト完全ドキュメント

**最終更新**: 2026-01-17  
**コミット**: 2d7f7f0  
**ステータス**: P1-3 キャッシュ改善完了、次は contactsCache

---

## 📊 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [技術スタック・アーキテクチャ](#2-技術スタックアーキテクチャ)
3. [データベース設計](#3-データベース設計)
4. [API構造](#4-api構造)
5. [フロントエンド構造](#5-フロントエンド構造)
6. [キャッシュレイヤー設計](#6-キャッシュレイヤー設計)
7. [完了済み実装](#7-完了済み実装)
8. [次のステップ](#8-次のステップ)
9. [開発環境セットアップ](#9-開発環境セットアップ)

---

## 1. プロジェクト概要

### 製品名
**Tomoniwao** - AI秘書スケジューラー

### ミッション
「まだ見たことのない欲しかったを形にする」

### 主要機能
- チャットベースのスケジュール調整
- 外部招待（メールリンク経由）
- Google Calendar / Meet 連携
- リスト管理・一括招待
- タイムゾーン対応

### 本番URL
- **Frontend**: https://app.tomoniwao.jp
- **API**: https://webapp.snsrilarc.workers.dev
- **最新デプロイ**: https://81d266ba.webapp-6t3.pages.dev

---

## 2. 技術スタック・アーキテクチャ

### 技術スタック

| レイヤー | 技術 | 備考 |
|---------|------|------|
| Frontend | Cloudflare Pages | React + TypeScript |
| API | Cloudflare Workers | Hono フレームワーク |
| Database | Cloudflare D1 | SQLite ベース |
| Storage | Cloudflare KV/R2 | セッション/ファイル |
| Queue | Cloudflare Queues | メール送信用 |
| Email | Resend | トランザクションメール |
| AI | Gemini / OpenAI | Intent分類・候補生成 |

### ディレクトリ構造

```
tomoniwaproject/
├── apps/
│   └── api/                    # Backend (Cloudflare Workers)
│       └── src/
│           ├── routes/         # API エンドポイント
│           ├── services/       # ビジネスロジック
│           ├── repositories/   # データアクセス
│           ├── middleware/     # 認証・CORS等
│           └── utils/          # ユーティリティ
├── frontend/                   # Frontend (Cloudflare Pages)
│   └── src/
│       ├── core/              # コアロジック
│       │   ├── api/           # APIクライアント
│       │   ├── cache/         # キャッシュレイヤー ★P1-3
│       │   ├── chat/          # チャットIntent/Executor
│       │   ├── hooks/         # カスタムフック
│       │   └── refresh/       # リフレッシュマップ
│       ├── components/        # UIコンポーネント
│       ├── pages/             # ページコンポーネント
│       └── utils/             # ユーティリティ
├── db/
│   └── migrations/            # D1 マイグレーション (0001-0073)
└── docs/                      # ドキュメント
```

---

## 3. データベース設計

### マイグレーション履歴

**最新**: 0073_backfill_thread_timezone.sql  
**総数**: 62ファイル

### 主要テーブル一覧

#### コアテーブル
| テーブル | 説明 | マイグレーション |
|---------|------|----------------|
| `users` | ユーザー情報 | 0001 |
| `google_accounts` | Google OAuth | 0001 |
| `sessions` | セッション管理 | 0027 |
| `workspaces` | ワークスペース | 0001 |

#### スケジュール調整テーブル
| テーブル | 説明 | マイグレーション |
|---------|------|----------------|
| `scheduling_threads` | 調整スレッド | 0026 |
| `thread_invites` | 招待リンク | 0026 |
| `thread_participants` | 参加者 | 0026 |
| `scheduling_slots` | 候補日時 | 0034 |
| `thread_selections` | 選択結果 | 0035 |
| `thread_finalize` | 確定情報 | 0036 |
| `thread_attendance_rules` | 出欠ルール | 0033 |

#### Beta A 追加テーブル
| テーブル | 説明 | マイグレーション |
|---------|------|----------------|
| `pending_actions` | 送信確認 | 0065 |
| `invite_deliveries` | 配信追跡 | 0066 |

#### Phase 2 追加カラム
| 変更 | 説明 | マイグレーション |
|------|------|----------------|
| `proposal_version` | 提案バージョン | 0067-0069 |
| `additional_propose_count` | 追加提案回数 | 0067 |
| `timezone` | スレッドTZ | 0072-0073 |

#### 連絡先・リストテーブル
| テーブル | 説明 | マイグレーション |
|---------|------|----------------|
| `contacts` | 連絡先 | 0041 |
| `lists` | リスト | 0042 |
| `list_members` | リストメンバー | 0043, 0052 |
| `business_cards` | 名刺 | 0045 |
| `contact_touchpoints` | 接点履歴 | 0046 |
| `contact_channels` | 連絡チャネル | 0054 |

### ER図（主要関係）

```
users
  ├── google_accounts (1:n)
  ├── sessions (1:n)
  ├── contacts (1:n)
  │     └── list_members (n:m via lists)
  └── scheduling_threads (1:n)
        ├── thread_invites (1:n)
        │     └── invite_deliveries (1:n)
        ├── scheduling_slots (1:n)
        │     └── thread_selections (n:m)
        ├── thread_attendance_rules (1:n)
        ├── thread_finalize (1:1)
        └── pending_actions (1:n)
```

### 重要なインデックス

```sql
-- スレッド検索
CREATE INDEX idx_scheduling_threads_user_workspace 
  ON scheduling_threads(user_id, workspace_id, status);

-- 招待トークン検索
CREATE UNIQUE INDEX idx_thread_invites_token 
  ON thread_invites(token);

-- pending_actions トークン検索
CREATE UNIQUE INDEX idx_pending_actions_confirm_token 
  ON pending_actions(confirm_token);
```

---

## 4. API構造

### 認証

**開発環境**: `x-user-id` ヘッダー  
**本番環境**: Cookie/Bearer Token (セッションベース)

### エンドポイント一覧

#### 認証 (auth.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/auth/google` | Google OAuth開始 |
| GET | `/auth/google/callback` | OAuth コールバック |
| POST | `/auth/token` | トークン検証 |
| POST | `/auth/logout` | ログアウト |

#### ユーザー (usersMe.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/users/me` | 自分の情報取得 |
| PATCH | `/api/users/me` | プロフィール更新 |
| PATCH | `/api/users/me/timezone` | タイムゾーン更新 |

#### スレッド (threads.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/threads` | スレッド一覧 |
| POST | `/api/threads` | スレッド作成 |
| GET | `/api/threads/:id` | スレッド詳細 |
| GET | `/api/threads/:id/status` | ステータス取得 |
| POST | `/api/threads/:id/invites/prepare` | 招待準備 |
| POST | `/api/threads/:id/proposals/prepare` | 候補追加準備 |
| POST | `/api/threads/:id/finalize` | 日程確定 |

#### Pending Actions (pendingActions.ts)
| Method | Path | 説明 |
|--------|------|------|
| POST | `/api/pending-actions/:token/decide` | 決定（送る/キャンセル/別スレッド） |
| POST | `/api/pending-actions/:token/execute` | 実行 |

#### 外部招待 (invite.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/i/:token` | 招待ページ表示 |
| GET | `/api/invites/:token` | 招待情報取得 |
| POST | `/api/invites/:token/respond` | 回答送信 |

#### リスト (lists.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/lists` | リスト一覧 |
| POST | `/api/lists` | リスト作成 |
| GET | `/api/lists/:id` | リスト詳細 |
| DELETE | `/api/lists/:id` | リスト削除 |
| GET | `/api/lists/:id/members` | メンバー一覧 |
| POST | `/api/lists/:id/members` | メンバー追加 |

#### 連絡先 (contacts.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/contacts` | 連絡先一覧 |
| POST | `/api/contacts` | 連絡先作成 |
| GET | `/api/contacts/:id` | 連絡先詳細 |
| PATCH | `/api/contacts/:id` | 連絡先更新 |

#### 受信箱 (inbox.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/inbox` | 受信箱一覧 |
| PATCH | `/api/inbox/:id/read` | 既読マーク |

#### カレンダー (calendar.ts)
| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/calendar/events` | イベント一覧 |
| GET | `/api/calendar/freebusy` | 空き時間検索 |

---

## 5. フロントエンド構造

### API クライアント (frontend/src/core/api/)

| ファイル | 対象API |
|---------|--------|
| `threads.ts` | /api/threads |
| `contacts.ts` | /api/contacts |
| `lists.ts` | /api/lists |
| `inbox.ts` | /api/inbox |
| `calendar.ts` | /api/calendar |
| `pendingActions.ts` | /api/pending-actions |
| `usersMe.ts` | /api/users/me |

### Chat Executor 構造 (frontend/src/core/chat/)

```
chat/
├── intentClassifier.ts     # Intent分類エントリ
├── apiExecutor.ts          # メインExecutor（巨大、分割中）
├── pendingTypes.ts         # Pending Action型定義
├── classifier/             # Intent分類ロジック
└── executors/              # 分割済みExecutor ★P1-1
    ├── index.ts            # エクスポート集約
    ├── types.ts            # ExecutionResult型
    ├── calendar.ts         # schedule.today, week, freebusy
    ├── list.ts             # list.create, list, members, add_member ★P1-3
    └── thread.ts           # schedule.create, status, finalize
```

### Intent → Executor マッピング

| Intent | Executor | キャッシュ更新 |
|--------|----------|--------------|
| `list.create` | `executeListCreate` | `refreshLists()` |
| `list.list` | `executeListList` | - |
| `list.members` | `executeListMembers` | - |
| `list.add_member` | `executeListAddMember` | `refreshLists()` |
| `schedule.create` | `executeCreate` | `refreshThreadsList()` |
| `schedule.status` | `executeStatusCheck` | - |
| `schedule.finalize` | `executeFinalize` | `refreshStatus()` |

---

## 6. キャッシュレイヤー設計

### P1-3 完了: キャッシュ改善

#### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Components                            │
│  (ChatLayout, CardsPane, ThreadDetailPage, etc.)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ useXxx hooks / direct import
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cache Layer                               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │  meCache     │ │ listsCache   │ │ threadStatusCache    │ │
│  │  TTL: 60s    │ │ TTL: 60s     │ │ TTL: 15s per thread  │ │
│  │  inflight共有│ │ inflight共有 │ │ inflight共有         │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐                          │
│  │ inboxCache   │ │threadsListCa │                          │
│  │  TTL: 30s    │ │ TTL: 30s     │                          │
│  └──────────────┘ └──────────────┘                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ subscribe / notify
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Refresh Layer                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    runRefresh.ts                        │ │
│  │  • refreshStatus(threadId)                              │ │
│  │  • refreshThreadsList()                                 │ │
│  │  • refreshInbox()                                       │ │
│  │  • refreshMe() ★NEW                                     │ │
│  │  • refreshLists() ★NEW                                  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ getRefreshActions(WriteOp)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Refresh Map                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   refreshMap.ts                         │ │
│  │  WriteOp → RefreshAction[]                              │ │
│  │  • THREAD_CREATE → [STATUS, THREADS_LIST]               │ │
│  │  • USERS_ME_UPDATE_TZ → [ME]                            │ │
│  │  • LIST_CREATE → [LISTS]                                │ │
│  │  • LIST_ADD_MEMBER → [LISTS]                            │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ execute
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Executors                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │  list.ts     │ │  thread.ts   │ │  calendar.ts         │ │
│  │  ★refreshLi  │ │  refresh...  │ │                      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### キャッシュ実装ファイル

| ファイル | 対象 | TTL | 主要関数 |
|---------|------|-----|---------|
| `meCache.ts` | `/api/users/me` | 60s | getMe, refreshMe, setMe, subscribeMe |
| `listsCache.ts` | `/api/lists` | 60s | getLists, refreshLists, setLists, subscribeLists |
| `threadStatusCache.ts` | `/api/threads/:id/status` | 15s | getStatus, refreshStatus, subscribe |
| `threadsListCache.ts` | `/api/threads` | 30s | getThreadsList, refreshThreadsList |
| `inboxCache.ts` | `/api/inbox` | 30s | getInbox, refreshInbox |

#### 各キャッシュの共通パターン

```typescript
// 1. getXxx(): キャッシュHIT → inflight共有 → fetch
export async function getXxx(): Promise<T> {
  if (cache && !isExpired(cache)) return cache.data;  // HIT
  if (inflight) return inflight.promise;               // INFLIGHT共有
  // MISS: fetch → cache → notify
}

// 2. refreshXxx(): 強制更新（TTL無視）
export async function refreshXxx(): Promise<T> {
  cache = null;
  await fetch();
  notifyListeners();
}

// 3. subscribeXxx(): 変更通知購読
export function subscribeXxx(listener): () => void {
  listeners.add(listener);
  log.cacheDebug('SUBSCRIBE', { listenerCount });
  return () => {
    listeners.delete(listener);
    log.cacheDebug('UNSUBSCRIBE', { listenerCount });
  };
}
```

### useViewerTimezone フック

```typescript
// frontend/src/core/hooks/useViewerTimezone.ts
export function useViewerTimezone(): string {
  // 1. キャッシュから同期取得
  // 2. getMe() で非同期取得
  // 3. subscribeMe() で変更を購読
  // → 設定変更が即座にUI全体に反映
}
```

---

## 7. 完了済み実装

### P1-3 キャッシュ改善（2026-01完了）

#### 実装ファイル

| ファイル | ステータス | 内容 |
|---------|----------|------|
| `frontend/src/core/cache/meCache.ts` | ✅ NEW | ユーザー情報キャッシュ |
| `frontend/src/core/cache/listsCache.ts` | ✅ NEW | リスト一覧キャッシュ |
| `frontend/src/core/hooks/useViewerTimezone.ts` | ✅ NEW | TZフック |
| `frontend/src/core/cache/index.ts` | ✅ MODIFIED | exports追加 |
| `frontend/src/core/refresh/runRefresh.ts` | ✅ MODIFIED | ME/LISTS refresh |
| `frontend/src/core/chat/executors/list.ts` | ✅ MODIFIED | refreshLists() 呼び出し |

#### 変更点まとめ

**A) meCache.ts**
- TTL 60秒
- inflight sharing（同時リクエスト統合）
- `getMe()`, `refreshMe()`, `invalidateMe()`, `setMe()`, `subscribeMe()`
- subscribe/unsubscribeログ追加

**B) listsCache.ts**
- TTL 60秒
- inflight sharing
- `getLists()`, `refreshLists()`, `invalidateLists()`, `setLists()`, `subscribeLists()`
- subscribe/unsubscribeログ追加

**C) useViewerTimezone.ts**
- `getCachedMe()` で同期初期値
- `getMe()` で非同期更新
- `subscribeMe()` で設定変更を即時反映

**D) runRefresh.ts**
```typescript
case 'ME':
  await refreshMeCache();
  break;
case 'LISTS':
  await refreshListsCache();
  break;
```

**E) executors/list.ts バグ修正**
```typescript
// list.create 実行後
await refreshLists();

// list.add_member 実行後（ループ外で一括）
if (addedCount > 0) {
  await refreshLists();
}
```

### Beta A 実装済み機能

| 機能 | ステータス | 説明 |
|------|----------|------|
| Intent分類 | ✅ | Gemini/GPT-4o-mini |
| 3語決定フロー | ✅ | 送る/キャンセル/別スレッドで |
| メール送信 | ✅ | キュー経由、日本語本文 |
| 外部招待回答 | ✅ | /i/:token |
| カード更新 | ✅ | リアルタイム反映 |
| 確定通知 | ✅ | Inbox + メール |
| リスト5コマンド | ✅ | 作成/一覧/メンバー表示/追加/招待 |

### Phase 2 実装済み機能

| 機能 | ステータス | 説明 |
|------|----------|------|
| 追加候補提案 | ✅ | proposal_version管理 |
| pending_actions | ✅ | 確認フロー |
| invite_deliveries | ✅ | 配信追跡 |
| タイムゾーン | ✅ | スレッド/ユーザーTZ |

---

## 8. 次のステップ

### 優先順位: 1 → 2 → 3

#### 1. contactsCache 実装 🔴 最優先

**リスク**: 連絡先操作は招待・リスト・メール送信に波及するため、運用事故リスク最高

**実装内容**:
```typescript
// frontend/src/core/cache/contactsCache.ts (NEW)
export async function getContacts(options?): Promise<Contact[]>;
export async function refreshContacts(): Promise<Contact[]>;
export function invalidateContacts(): void;
export function setContacts(contacts: Contact[]): void;
export function subscribeContacts(listener): () => void;
```

**関連 Executor 修正**:
- 連絡先作成時: `refreshContacts()`
- 招待追加時: `refreshContacts()`
- リストメンバー追加時: `refreshContacts()` + `refreshLists()`

**refreshMap.ts 追加**:
```typescript
export type WriteOp =
  | ...
  | 'CONTACT_CREATE'
  | 'CONTACT_UPDATE';

export type RefreshAction =
  | ...
  | { type: 'CONTACTS' };

case 'CONTACT_CREATE':
case 'CONTACT_UPDATE':
  return [{ type: 'CONTACTS' }];
```

#### 2. 回帰テスト拡張

**目的**: WriteOp差し込み漏れをテストで検知

**テスト項目**:
- [ ] list.create → listsCache更新確認
- [ ] list.add_member → listsCache更新確認
- [ ] contact.create → contactsCache更新確認
- [ ] users/me/timezone → meCache更新確認
- [ ] thread.finalize → threadStatusCache更新確認

#### 3. 次フェーズ機能（1完了後）

- リマインダー機能強化
- 一括招待バッチ処理最適化
- E2Eテスト追加

---

## 9. 開発環境セットアップ

### 前提条件

- Node.js 18+
- npm 9+
- Cloudflare Wrangler CLI

### セットアップ手順

```bash
# 1. リポジトリクローン
git clone <repo-url>
cd tomoniwaproject

# 2. 依存関係インストール
npm install
cd frontend && npm install && cd ..

# 3. D1データベースセットアップ（ローカル）
npm run db:migrate:local
npm run db:seed:local

# 4. 開発サーバー起動
# Backend
cd apps/api && npm run dev

# Frontend（別ターミナル）
cd frontend && npm run dev
```

### 本番デプロイ

```bash
# 1. マイグレーション適用
npm run db:migrate:prod

# 2. API デプロイ
cd apps/api && npm run deploy

# 3. Frontend デプロイ
cd frontend && npm run deploy
```

### 環境変数

**Backend (apps/api/wrangler.toml)**:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `RESEND_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

**Frontend (frontend/.env)**:
- `VITE_API_BASE_URL`

---

## 📎 関連ドキュメント

- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) - テーブル詳細
- [API_REFERENCE.md](./API_REFERENCE.md) - API仕様
- [MIGRATION_HISTORY.md](./MIGRATION_HISTORY.md) - マイグレーション履歴
- [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) - フロントエンド設計
- [FRONTEND_REFRESH_MAP.md](./FRONTEND_REFRESH_MAP.md) - リフレッシュマップ

---

**ドキュメント作成**: 2026-01-17  
**作成者**: AI Assistant  
**レビュー**: 関屋紘之（モギモギ）
