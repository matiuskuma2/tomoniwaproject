# Tomoniwao - 災害復旧手順書

**最終更新**: 2026-01-17  
**対象**: マイグレーション消失、コード消失、環境再構築

---

## 📋 目次

1. [復旧シナリオ一覧](#1-復旧シナリオ一覧)
2. [GitHubからの完全復旧](#2-githubからの完全復旧)
3. [D1データベース復旧](#3-d1データベース復旧)
4. [Cloudflare Workers/Pages 再デプロイ](#4-cloudflare-workerspages-再デプロイ)
5. [環境変数・シークレット](#5-環境変数シークレット)
6. [重要ファイル一覧](#6-重要ファイル一覧)
7. [連絡先・アカウント情報](#7-連絡先アカウント情報)

---

## 1. 復旧シナリオ一覧

| シナリオ | 対応 | 所要時間 |
|---------|------|---------|
| サンドボックスがリセット | GitHubからクローン | 5分 |
| マイグレーションファイル消失 | GitHubからクローン | 5分 |
| D1データベース破損 | マイグレーション再適用 | 10分 |
| Workers/Pages 設定消失 | wrangler.toml から再デプロイ | 15分 |
| 全環境が消失 | 完全復旧手順実行 | 30分 |

---

## 2. GitHubからの完全復旧

### 2.1 リポジトリ情報

- **リポジトリ**: https://github.com/matiuskuma2/tomoniwaproject
- **ブランチ**: `main`
- **最新コミット**: `27c3363` (2026-01-17)

### 2.2 クローン手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/matiuskuma2/tomoniwaproject.git
cd tomoniwaproject

# 2. 依存関係インストール（ルート）
npm install

# 3. フロントエンド依存関係インストール
cd frontend && npm install && cd ..

# 4. 確認
ls -la
git log --oneline -5
```

### 2.3 ファイル構造確認

```bash
# 主要ディレクトリ確認
ls -la apps/api/src/routes/          # APIルート (27ファイル)
ls -la frontend/src/core/cache/       # キャッシュ (7ファイル)
ls -la frontend/src/core/refresh/     # リフレッシュ (3ファイル)
ls -la db/migrations/                 # マイグレーション (62ファイル)
```

---

## 3. D1データベース復旧

### 3.1 本番データベース情報

- **データベース名**: `webapp-production`
- **リージョン**: Cloudflare D1 (グローバル)

### 3.2 マイグレーション再適用

```bash
# 1. ローカルで確認
npm run db:migrate:local

# 2. 本番に適用
npm run db:migrate:prod

# 3. 確認
npx wrangler d1 execute webapp-production --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

### 3.3 マイグレーションファイル一覧（62ファイル）

```
0001_init_core.sql                          # 基盤テーブル
0002_team_lists_events.sql                  # チーム・リスト・イベント
0003_admin.sql                              # 管理者
0004_indexes.sql                            # インデックス
0005_ai_costs.sql                           # AI コスト
0006_indexes_ai_costs.sql                   # AI コストインデックス
0008_relationship_requests.sql              # 関係リクエスト
0009_log_summaries.sql                      # ログサマリ
0010_relationships_unique_pair.sql          # 関係ユニーク制約
0014_admin_import_sessions.sql              # インポートセッション
0015_system_settings.sql                    # システム設定
0016_ai_provider_settings_unique_provider.sql # AIプロバイダ設定
0017_ai_provider_keys_masked_preview.sql    # APIキーマスク
0018_ai_provider_keys_index.sql             # APIキーインデックス
0021_list_member_delivery_prefs.sql         # 配信設定
0022_thread_messages.sql                    # スレッドメッセージ
0024_work_items_visibility_scope.sql        # 可視性スコープ
0025_admin_workspace_access_v2.sql          # ワークスペースアクセス
0026_threads_and_invites.sql                # スレッド・招待
0027_sessions_table.sql                     # セッション
0028_inbox_table.sql                        # 受信箱
0029_add_user_roles.sql                     # ユーザーロール
0030_deprecate_inbox_items.sql              # 受信箱非推奨
0031_ai_cost_control_settings.sql           # AIコスト制御
0032_add_invitee_key_to_thread_invites.sql  # invitee_key追加
0033_create_thread_attendance_rules.sql     # 出欠ルール
0034_create_scheduling_slots.sql            # スケジューリングスロット
0035_create_thread_selections.sql           # スレッド選択
0036_create_thread_finalize.sql             # スレッド確定
0037_backfill_invitee_keys.sql              # invitee_keyバックフィル
0038_backfill_default_attendance_rules.sql  # 出欠ルールバックフィル
0039_fix_thread_invites_fk_to_scheduling_threads.sql # FK修正
0040_create_remind_log.sql                  # リマインドログ
0041_create_contacts.sql                    # 連絡先
0042_create_lists.sql                       # リスト
0043_create_list_members.sql                # リストメンバー
0044_backfill_contacts_from_users.sql       # 連絡先バックフィル
0045_create_business_cards.sql              # 名刺
0046_create_contact_touchpoints.sql         # 接点履歴
0047_add_meeting_to_thread_finalize.sql     # ミーティング追加
0048_create_billing_events.sql              # 課金イベント
0049_create_billing_accounts.sql            # 課金アカウント
0050_create_list_items.sql                  # リストアイテム
0051_create_list_item_events.sql            # リストアイテムイベント
0052_create_list_members.sql                # リストメンバー（再作成）
0053_add_contact_id_to_thread_participants.sql # contact_id追加
0054_create_contact_channels.sql            # 連絡チャネル
0055_create_ledger_audit_events.sql         # 監査イベント
0060_insert_default_workspace.sql           # デフォルトワークスペース
0061_add_workspace_id_to_scheduling_threads.sql # workspace_id追加
0062_fix_thread_participants_contact_id.sql # contact_id修正
0063_add_audit_created_at_index.sql         # 監査インデックス
0064_add_access_denied_action.sql           # アクセス拒否アクション
0065_create_pending_actions.sql             # 送信確認 (Beta A)
0066_create_invite_deliveries.sql           # 配信追跡 (Beta A)
0067_add_proposal_version_to_threads.sql    # proposal_version (Phase 2)
0068_add_proposal_version_to_slots.sql      # slots版
0069_add_proposal_version_to_selections.sql # selections版
0070_add_additional_slots_action_type.sql   # action_type追加
0071_fix_pending_actions_action_type_check.sql # CHECK修正
0072_add_timezone_to_threads.sql            # タイムゾーン追加
0073_backfill_thread_timezone.sql           # TZバックフィル
```

**欠番**: 0007, 0011-0013, 0019-0020, 0023, 0056-0059 （意図的スキップ）

### 3.4 主要テーブル確認クエリ

```sql
-- テーブル一覧
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;

-- ユーザー数
SELECT COUNT(*) FROM users;

-- スレッド数
SELECT COUNT(*) FROM scheduling_threads;

-- マイグレーション適用状況
SELECT * FROM d1_migrations ORDER BY id DESC LIMIT 10;
```

---

## 4. Cloudflare Workers/Pages 再デプロイ

### 4.1 API (Workers) デプロイ

```bash
cd apps/api

# 1. 設定確認
cat wrangler.toml

# 2. ビルド
npm run build

# 3. デプロイ
npm run deploy

# 4. 確認
curl https://webapp.snsrilarc.workers.dev/health
```

### 4.2 Frontend (Pages) デプロイ

```bash
cd frontend

# 1. ビルド
npm run build

# 2. デプロイ
npm run deploy

# 3. 確認
curl https://app.tomoniwao.jp/
```

### 4.3 wrangler.toml 重要設定

**apps/api/wrangler.toml**:
```toml
name = "webapp"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "webapp-production"
database_id = "<YOUR_DATABASE_ID>"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "<YOUR_KV_ID>"

[[queues.producers]]
queue = "email-queue"
binding = "EMAIL_QUEUE"
```

---

## 5. 環境変数・シークレット

### 5.1 必須シークレット（Workers）

```bash
# 設定コマンド
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

### 5.2 シークレット一覧

| 名前 | 用途 | 取得元 |
|------|------|-------|
| `GOOGLE_CLIENT_ID` | Google OAuth | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | OAuth コールバック | 固定値 |
| `RESEND_API_KEY` | メール送信 | Resend Dashboard |
| `GEMINI_API_KEY` | AI Intent分類 | Google AI Studio |
| `OPENAI_API_KEY` | AI フォールバック | OpenAI Dashboard |
| `SESSION_SECRET` | セッション署名 | 自分で生成 |
| `ENCRYPTION_KEY` | トークン暗号化 | 自分で生成 |

### 5.3 フロントエンド環境変数

**frontend/.env**:
```
VITE_API_BASE_URL=https://webapp.snsrilarc.workers.dev
```

---

## 6. 重要ファイル一覧

### 6.1 コア実装ファイル

| ファイル | 行数 | 役割 |
|---------|------|------|
| `apps/api/src/routes/threads.ts` | 57015 | スレッドAPI（メイン） |
| `apps/api/src/routes/pendingActions.ts` | 24739 | 送信確認API |
| `apps/api/src/routes/invite.ts` | 19711 | 外部招待API |
| `apps/api/src/routes/auth.ts` | 15319 | 認証API |
| `frontend/src/core/chat/apiExecutor.ts` | 63950 | チャットExecutor |

### 6.2 キャッシュ実装ファイル（P1-3）

| ファイル | 行数 | TTL |
|---------|------|-----|
| `frontend/src/core/cache/meCache.ts` | 231 | 60s |
| `frontend/src/core/cache/listsCache.ts` | 236 | 60s |
| `frontend/src/core/cache/threadStatusCache.ts` | 303 | 15s |
| `frontend/src/core/cache/threadsListCache.ts` | 216 | 30s |
| `frontend/src/core/cache/inboxCache.ts` | 216 | 30s |

### 6.3 リフレッシュ実装ファイル

| ファイル | 行数 | 役割 |
|---------|------|------|
| `frontend/src/core/refresh/refreshMap.ts` | 4804 | WriteOp → RefreshAction マッピング |
| `frontend/src/core/refresh/runRefresh.ts` | 3448 | リフレッシュ実行 |

### 6.4 Executor分割ファイル

| ファイル | 行数 | Intent |
|---------|------|--------|
| `frontend/src/core/chat/executors/list.ts` | 8367 | list.* |
| `frontend/src/core/chat/executors/thread.ts` | 14935 | schedule.*, thread.* |
| `frontend/src/core/chat/executors/calendar.ts` | 5858 | schedule.today/week/freebusy |

---

## 7. 連絡先・アカウント情報

### 7.1 開発者

- **名前**: 関屋紘之（モギモギ）
- **X**: @aitanoshimu
- **居住地**: ドバイ

### 7.2 サービスアカウント

| サービス | 用途 | 管理 |
|---------|------|------|
| GitHub | ソースコード | matiuskuma2 |
| Cloudflare | インフラ | メインアカウント |
| Google Cloud | OAuth/AI | プロジェクト設定 |
| Resend | メール | API管理 |
| OpenAI | AI | API管理 |

### 7.3 本番URL

| サービス | URL |
|---------|-----|
| Frontend | https://app.tomoniwao.jp |
| API | https://webapp.snsrilarc.workers.dev |
| Health Check | https://webapp.snsrilarc.workers.dev/health |

---

## 🔄 完全復旧チェックリスト

```
□ GitHubからクローン完了
□ npm install 完了（ルート）
□ npm install 完了（frontend）
□ マイグレーション確認（62ファイル）
□ D1マイグレーション適用（本番）
□ シークレット設定確認
□ API デプロイ完了
□ Frontend デプロイ完了
□ ヘルスチェック成功
□ ログイン動作確認
```

---

**作成**: 2026-01-17  
**更新**: 必要に応じて
