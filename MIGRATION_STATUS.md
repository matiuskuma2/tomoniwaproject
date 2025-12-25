# 📊 DB Migration Status Report

## ✅ 適用済みマイグレーション（17ファイル）

### Phase 1: Core Tables (0001-0006)
- **0001_init_core.sql**: Users, relationships, scheduling threads, work items
- **0002_team_lists_events.sql**: Workspaces, rooms, quests, lists, hosted events
- **0003_admin.sql**: Admin users, workspace access, audit logs
- **0004_indexes.sql**: Core performance indexes
- **0005_ai_costs.sql**: AI usage tracking, provider settings/keys
- **0006_indexes_ai_costs.sql**: AI cost indexes

### Phase 2: Extended Features (0008-0010)
- **0008_relationship_requests.sql**: Family/partner invitation system
- **0009_log_summaries.sql**: AI/invite/broadcast daily summaries, retention jobs
- **0010_relationships_unique_pair.sql**: UNIQUE(user_a_id, user_b_id) constraint

### Phase 3: Admin & Import (0014)
- **0014_admin_import_sessions.sql**: Bulk member import sessions

### Phase 4: System Configuration (0015-0018)
- **0015_system_settings.sql**: Global system settings
- **0016_ai_provider_settings_unique_provider.sql**: UNIQUE(provider) constraint
- **0017_ai_provider_keys_masked_preview.sql**: Add masked_preview column
- **0018_ai_provider_keys_index.sql**: AI provider keys indexes

### Phase 5: Scheduling Communication (0021-0022)
- **0021_list_member_delivery_prefs.sql**: Delivery preferences for list members
- **0022_thread_messages.sql**: Thread messages and deliveries

---

## ❌ 欠番マイグレーション（理由）

- **0007**: 不要（機能重複）
- **0011**: 不要（機能重複）
- **0012**: **削除済み**（`admin_workspace_access`は0003で作成済み）
- **0013**: 不要（機能重複）
- **0019**: 不要（機能重複）
- **0020**: **削除済み**（`work_items.visibility`は0001で作成済み）

---

## 🔧 適用時の修正内容

### 0010_relationships_unique_pair.sql
**問題**: 既存スキーマが`user_id`/`related_user_id`だが、新スキーマは`user_a_id`/`user_b_id`  
**対応**: マイグレーション時に列名をマッピング
```sql
CASE WHEN r.user_id < r.related_user_id 
  THEN r.user_id ELSE r.related_user_id END AS user_a_id
```

### 0021_list_member_delivery_prefs.sql
**問題**: `list_members`テーブルに`status`カラムが存在しない  
**対応**: インデックス作成を削除

---

## 📋 完全なテーブル一覧（17マイグレーション適用後）

### Core Tables (0001-0002)
1. `users` - PWAユーザー
2. `google_accounts` - Google OAuth連携
3. `work_items` - タスク・予定（**visibility列あり**）
4. `work_item_dependencies` - タスク依存関係
5. `relationships` - ユーザー間関係（**UNIQUE(user_a_id, user_b_id)制約あり**）
6. `scheduling_threads` - 調整スレッド
7. `scheduling_candidates` - 候補日時
8. `external_invites` - 外部招待
9. `inbox_items` - inbox通知
10. `workspaces` - ワークスペース
11. `rooms` - 共有ルーム
12. `room_members` - ルームメンバー
13. `quests` - プロジェクト
14. `squads` - チーム
15. `squad_members` - チームメンバー
16. `lists` - リスト
17. `list_members` - リストメンバー（**delivery_preferences_json列あり**）
18. `hosted_events` - イベント配信
19. `event_deliveries` - 配信状況

### Admin Tables (0003)
20. `admin_users` - 管理者
21. `admin_workspace_access` - 管理者ワークスペースアクセス
22. `audit_logs` - 監査ログ
23. `abuse_reports` - 不正報告

### AI Tables (0005)
24. `ai_usage_logs` - AI使用ログ
25. `ai_provider_settings` - AI Provider設定（**UNIQUE(provider)制約あり**）
26. `ai_provider_keys` - AI Providerキー（**masked_preview列あり**）

### Extended Tables (0008-0022)
27. `relationship_requests` - 関係性リクエスト
28. `ai_daily_summary` - AI日次サマリー
29. `invite_daily_summary` - 招待日次サマリー
30. `broadcast_daily_summary` - 配信日次サマリー
31. `retention_jobs` - データ保持ジョブ
32. `import_sessions` - インポートセッション
33. `system_settings` - システム設定
34. `thread_messages` - スレッドメッセージ
35. `thread_message_deliveries` - メッセージ配信

---

## ✅ 検証結果

### ローカル環境
```bash
npx wrangler d1 migrations apply webapp-production --local
```
**結果**: 17マイグレーション全て成功 ✅

### 本番環境
```bash
npx wrangler d1 migrations apply webapp-production --remote
```
**結果**: 17マイグレーション全て成功 ✅

---

## 🎯 次の実装に必要なテーブル確認

### Ticket 04 (RateLimiter)
- ✅ KV Namespace使用（マイグレーション不要）

### Ticket 05 (OTP Service)
- ✅ KV Namespace使用（マイグレーション不要）

### Ticket 06 (Email Queue)
- ✅ Queue使用（マイグレーション不要）

### Ticket 07 (WorkItems API)
- ✅ `work_items.visibility` - **0001で作成済み**
- ✅ `work_items` 関連テーブル全て存在

### Ticket 08 (/voice/execute)
- ✅ `ai_usage_logs` - 0005で作成済み
- ✅ `work_items` - 0001で作成済み
- ✅ `ai_provider_settings` - 0005で作成済み

### Ticket 09 (共有提案カード)
- ✅ `work_items` - 0001で作成済み
- ✅ `rooms` - 0002で作成済み
- ✅ `audit_logs` - 0003で作成済み

### Ticket 10 (スケジュール調整)
- ✅ `scheduling_threads` - 0001で作成済み
- ✅ `scheduling_candidates` - 0001で作成済み
- ✅ `external_invites` - 0001で作成済み
- ✅ `inbox_items` - 0001で作成済み
- ✅ `thread_messages` - **0022で作成済み**
- ✅ `thread_message_deliveries` - **0022で作成済み**

---

**全てのテーブルが揃っています！Ticket 04-10の実装が可能です。** ✅
