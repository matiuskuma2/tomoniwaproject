# Beta A 実装チケット（Jira/Notion用）

**作成日**: 2026-01-09  
**最終更新**: 2026-01-09 (実装完了版)  
**ステータス**: チケットB完了  
**対象リポジトリ**: tomoniwaproject (Migration 0065〜)  

---

## 概要

Beta Aの実装を4つのチケット（A〜D）に分解。  
**確認済み方針**:
- 送信確認は「送る/キャンセル/別スレッドで」の3語固定
- 追加招待はデフォで許容
- アプリユーザー判定はメール一致
- リスト5コマンドをチャットで完走

---

## チケット A: DB Migration (0065/0066)

### A-1. 基本情報

| 項目 | 値 |
|------|-----|
| **チケットID** | BETA-A-001 |
| **タイトル** | DB Migration: pending_actions / invite_deliveries |
| **見積もり** | 2h |
| **優先度** | P0 (ブロッカー) |
| **担当** | Backend |

### A-2. 目的

1. 送信確認をDBで必須化（pending_actions）
2. 配信状況を追跡可能に（invite_deliveries）
3. 将来の配信チャネル追加にも対応可能な構造

### A-3. 成果物

```
db/migrations/
├── 0065_create_pending_actions.sql  ✅ 作成済み (4.3KB)
└── 0066_create_invite_deliveries.sql  ✅ 作成済み (4.7KB)

packages/shared/src/types/
├── pendingAction.ts  ✅ 作成済み (型定義)
└── inviteDelivery.ts  ✅ 作成済み (型定義)
```

### A-4. DoD（完了条件）

- [ ] ローカル: `npm run db:migrate:local` PASS
- [ ] 本番: `wrangler d1 migrations apply tomoniwao-production` PASS
- [ ] pending_actions への INSERT 可能
- [ ] invite_deliveries への INSERT 可能
- [ ] 既存機能が壊れていない（threads/invites/inbox）

### A-5. 適用手順

```bash
# 1. ローカル適用
cd /home/user/tomoniwaproject
npm run db:migrate:local

# 2. 確認
wrangler d1 execute tomoniwao-local --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pending%' OR name LIKE 'invite_del%';"

# 3. 本番適用（慎重に）
wrangler d1 migrations apply tomoniwao-production

# 4. 本番確認
wrangler d1 execute tomoniwao-production --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pending%' OR name LIKE 'invite_del%';"
```

### A-6. リスク/注意点

| リスク | 対策 |
|--------|------|
| payload_json肥大化 | 8KB制限をAPIで検証 |
| confirm_token衝突 | UNIQUE制約 + 32文字ランダム |
| FK失敗 | workspace_id/owner_user_id は既存レコード必須 |

---

## チケット B: バックエンドAPI (prepare → confirm → execute)

### B-1. 基本情報

| 項目 | 値 |
|------|-----|
| **チケットID** | BETA-A-002 |
| **タイトル** | API実装: 送信確認フロー (prepare/confirm/execute) |
| **見積もり** | 8h |
| **優先度** | P0 (ブロッカー) |
| **担当** | Backend |
| **依存** | BETA-A-001 (Migration) |

### B-2. 目的

メール/リスト入力 → サマリ → 送信/キャンセル/別スレッドで → 実行をチャットテキストだけで完結。

### B-3. 新規API一覧

#### B-3-1. POST /api/threads/prepare-send（新規スレッド準備）

**リクエスト:**
```typescript
{
  source_type: 'emails' | 'list';
  emails?: string[];      // source_type='emails' の場合
  list_id?: string;       // source_type='list' の場合
  thread_title?: string;  // 任意（デフォルト: "新規日程調整"）
}
```

**レスポンス:**
```typescript
{
  confirm_token: string;          // 32文字
  expires_at: string;             // ISO8601 (15分後)
  expires_in_seconds: number;     // 900
  summary: {
    total_count: number;
    valid_count: number;
    skipped_count: number;
    skipped_reasons: Array<{
      reason: 'invalid_email' | 'duplicate_input' | 'missing_email';
      count: number;
    }>;
    preview: Array<{              // 最大5件
      email: string;
      display_name?: string;
      is_app_user: boolean;
    }>;
    source_label: string;         // "3件のメールアドレス" or "営業部リスト"
  };
  default_decision: 'send';
  message: string;                // "3名に招待を送信しますか？"
}
```

**処理フロー:**
1. emails/list_id からメールリスト取得
2. normalizeEmail(trim/lower)、重複除去、無効メール除外
3. アプリユーザー判定（users.email一致）
4. pending_actions INSERT
5. confirm_token + summary 返却

#### B-3-2. POST /api/threads/:threadId/invites/prepare（追加招待準備）

**リクエスト:** 同上

**レスポンス:** 同上 + `thread_id` 付与

**追加処理:**
- already_invited チェック（thread_invites.email 重複）

#### B-3-3. POST /api/pending-actions/:confirmToken/confirm（確認決定）

**リクエスト:**
```typescript
{
  decision: 'send' | 'cancel' | 'new_thread';
}
```

**レスポンス:**
```typescript
{
  status: 'confirmed_send' | 'confirmed_cancel' | 'confirmed_new_thread';
  decision: string;
  message: string;           // "送信を確定しました" / "キャンセルしました" / "別スレッドで送信を確定しました"
  can_execute: boolean;      // true (send/new_thread) / false (cancel)
}
```

**処理フロー:**
1. confirm_token で pending_actions 検索
2. status='pending' かつ expires_at > now 検証
3. status 更新 + confirmed_at 記録
4. can_execute フラグ返却

#### B-3-4. POST /api/pending-actions/:confirmToken/execute（送信実行）

**リクエスト:**
```typescript
{
  request_id?: string;  // 冪等性用（任意）
}
```

**レスポンス:**
```typescript
{
  success: boolean;
  thread_id: string;
  result: {
    inserted: number;
    skipped: number;
    failed: number;
    deliveries: {
      email_queued: number;
      in_app_created: number;
    };
  };
  message: string;
  request_id: string;
}
```

**処理フロー:**
1. confirm_token で pending_actions 検索
2. status が confirmed_send/confirmed_new_thread 検証
3. request_id 重複チェック（冪等性）
4. **new_thread の場合**: scheduling_threads INSERT
5. thread_invites バッチ INSERT（200件チャンク）
6. EMAIL_QUEUE 投入 + invite_deliveries(email) 作成
7. アプリユーザーには inbox_items + invite_deliveries(in_app) 作成
8. pending_actions.status='executed' + executed_at 更新

### B-4. 既存API修正

#### B-4-1. POST /api/threads/:id/finalize（確定通知必須化）

**追加処理:**
1. thread_finalize 作成後、全参加者に確定通知
2. invite_deliveries(finalized_notice) 作成
3. メール: EMAIL_QUEUE投入
4. in_app: inbox_items 作成

### B-5. ファイル構成

```
apps/api/src/
├── routes/
│   ├── pendingActions.ts      # ✅ 実装完了: confirm/execute
│   └── threads.ts             # ✅ 修正完了: prepare-send/invites/prepare追加
├── repositories/
│   ├── pendingActionsRepository.ts  # ✅ 実装完了
│   └── inviteDeliveriesRepository.ts  # ✅ 実装完了
├── utils/
│   └── emailNormalizer.ts     # ✅ 実装完了: trim/lower/validation
└── index.ts                   # ✅ 修正完了: pendingActionsRoutes登録
```

### B-6. DoD（完了条件）

- [x] `POST /api/threads/prepare-send` で pending_actions 作成 ✅ 実装済み
- [x] `POST /api/threads/:id/invites/prepare` で追加招待準備 ✅ 実装済み
- [x] `POST /api/pending-actions/:token/confirm` で status 更新 ✅ 実装済み
- [x] `POST /api/pending-actions/:token/execute` で invite + delivery 作成 ✅ 実装済み
- [x] request_id による冪等性（二重実行で同じ結果）✅ 実装済み
- [x] 期限切れ（410 Gone）エラー返却 ✅ 実装済み
- [x] 認証なし（401）エラー返却 ✅ 実装済み
- [ ] **Migration適用後にローカルテスト完了（チケットA依存）**

### B-7. エラーコード

| HTTP | コード | 説明 |
|------|--------|------|
| 400 | INVALID_PAYLOAD | payload_json が 8KB 超過 |
| 401 | UNAUTHORIZED | 認証なし |
| 404 | NOT_FOUND | confirm_token/thread_id 不明 |
| 409 | ALREADY_EXECUTED | 既に execute 済み |
| 410 | EXPIRED | confirm_token 期限切れ |
| 422 | INVALID_STATUS | confirm/execute 不可なステータス |

---

## チケット C: フロントエンド (Intent/Executor/リスト5コマンド)

### C-1. 基本情報

| 項目 | 値 |
|------|-----|
| **チケットID** | BETA-A-003 |
| **タイトル** | フロント実装: Intent解析 + Executor + リスト5コマンド |
| **見積もり** | 6h |
| **優先度** | P0 (ブロッカー) |
| **担当** | Frontend |
| **依存** | BETA-A-002 (API) |

### C-2. 目的

UIはカード補助、チャットテキストのみで完結。送信確認は3語固定。

### C-3. Intent一覧（ルールベース）

| 入力パターン | Intent | API呼び出し |
|--------------|--------|-------------|
| メールアドレス含む（thread未選択） | `thread.send.prepare` | POST /threads/prepare-send |
| メールアドレス含む（thread選択中） | `thread.invite.prepare.add` | POST /threads/:id/invites/prepare |
| 「〇〇リストに招待」（thread未選択） | `thread.send.prepare.list` | POST /threads/prepare-send (list_id) |
| 「〇〇リストに招待」（thread選択中） | `thread.invite.prepare.add.list` | POST /threads/:id/invites/prepare (list_id) |
| 「送る」 | `pending.confirm.send` | POST /pending-actions/:token/confirm + execute |
| 「キャンセル」 | `pending.confirm.cancel` | POST /pending-actions/:token/confirm |
| 「別スレッドで」 | `pending.confirm.new_thread` | POST /pending-actions/:token/confirm + execute |

### C-4. リスト5コマンド

| コマンド | Intent | API |
|----------|--------|-----|
| 「〇〇リストを作って」 | `lists.create` | POST /api/lists |
| 「リスト見せて」 | `lists.list` | GET /api/lists |
| 「〇〇リストのメンバー」 | `listMembers.list` | GET /api/lists/:id/members |
| 「〇〇を〇〇リストに追加」 | `contacts.upsert` + `listMembers.add` | POST /contacts + POST /lists/:id/members |
| 「〇〇リストに招待」 | `thread.send.prepare.list` | (上記参照) |

### C-5. 状態管理

```typescript
interface ChatState {
  // 現在選択中のスレッド（null = 新規作成モード）
  selectedThreadId: string | null;
  
  // 確認待ちの pending_action
  pendingAction: {
    confirm_token: string;
    expires_at: string;
    summary: PendingActionSummary;
  } | null;
}
```

### C-6. UI表示

#### サマリカード（prepare レスポンス後）

```
┌─────────────────────────────────────┐
│ 📨 送信確認                          │
├─────────────────────────────────────┤
│ 3名に招待を送信します:               │
│                                     │
│ • tanaka@example.com               │
│ • suzuki@example.com (アプリユーザー) │
│ • yamada@example.com               │
│                                     │
│ ⚠️ 1件スキップ（無効なメール形式）    │
├─────────────────────────────────────┤
│ [送る] [キャンセル] [別スレッドで]    │
└─────────────────────────────────────┘
```

### C-7. DoD（完了条件）

- [ ] メール入力 → prepare → サマリ表示
- [ ] 「送る」→ confirm + execute → 成功メッセージ
- [ ] 「キャンセル」→ confirm → キャンセルメッセージ
- [ ] 「別スレッドで」→ confirm + execute → 新規thread作成
- [ ] リスト5コマンドがチャットで動作
- [ ] thread選択中/未選択で正しく分岐

---

## チケット D: E2E テスト + 監視

### D-1. 基本情報

| 項目 | 値 |
|------|-----|
| **チケットID** | BETA-A-004 |
| **タイトル** | E2Eテスト: Beta A 完走確認 |
| **見積もり** | 4h |
| **優先度** | P1 |
| **担当** | QA / Backend |
| **依存** | BETA-A-003 (フロント) |

### D-2. E2Eシナリオ

#### シナリオ1: 新規スレッド（メール入力→送信）

```
1. /chat を開く
2. 「tanaka@example.com, suzuki@example.com」と入力
3. サマリカードが表示される（2名、スキップなし）
4. 「送る」と入力
5. 「2名に招待を送信しました」メッセージ
6. pending_actions.status = 'executed'
7. invite_deliveries に2件（channel='email'）
8. EMAIL_QUEUE にジョブ2件
```

**確認項目:**
- [ ] pending_actions レコード作成
- [ ] confirm_token が32文字
- [ ] expires_at が15分後
- [ ] execute 後に thread_invites 2件
- [ ] invite_deliveries 2件（status='queued'）

#### シナリオ2: 追加招待（スレッド選択中）

```
1. 既存 thread を選択
2. 「yamada@example.com」と入力
3. サマリカード（1名、追加招待）
4. 「送る」
5. thread_invites に1件追加
```

**確認項目:**
- [ ] action_type = 'add_invites'
- [ ] 既存 invite と重複なら skipped

#### シナリオ3: 確定通知（外部回答→主催者確定）

```
1. 外部ユーザーが /i/:token で候補選択
2. 主催者が「1番で確定」
3. Google Calendar + Meet 作成
4. 全員に確定通知
5. 外部ユーザーの結果画面にカレンダー追加ボタン
```

**確認項目:**
- [ ] thread_finalize 作成
- [ ] invite_deliveries(finalized_notice) 作成
- [ ] inbox_items（アプリユーザーのみ）
- [ ] /i/:token/result に Meet リンク表示

### D-3. エッジケーステスト

| ケース | 期待動作 |
|--------|----------|
| 期限切れ confirm_token | 410 Gone |
| 二重 execute (同じ request_id) | 同じ結果を返す（冪等） |
| 無効なメール100件中95件 | 5件だけ送信、95件 skipped |
| 1001件リスト | 400 エラー（上限1000） |
| 認証なしアクセス | 401 Unauthorized |

### D-4. 監視設定

```bash
# Workers logs で確認
wrangler tail --format pretty | grep -E "(pending_action|invite_delivery|EMAIL_QUEUE)"

# DLQ 確認
wrangler queues list
wrangler queues messages EMAIL_DLQ --limit 10
```

### D-5. DoD（完了条件）

- [ ] シナリオ1〜3 が手動で完走
- [ ] エッジケース5件が期待動作
- [ ] request_id で二重送信なし確認
- [ ] Workers logs で pending_action 追跡可能

---

## 実装順序

```
Week 1:
  Day 1-2: チケットA（Migration適用）
  Day 3-5: チケットB（API実装）✅ 完了

Week 2:
  Day 1-3: チケットC（フロント実装）← 次はここ
  Day 4-5: チケットD（E2Eテスト）
```

### 現在のステータス (2026-01-09)

| チケット | ステータス | 備考 |
|----------|-----------|------|
| A: Migration | 🟡 Ready | SQLファイル作成済み、適用待ち |
| B: API | ✅ Done | 全エンドポイント実装完了 |
| C: フロント | 🔴 Not Started | B完了後に開始 |
| D: E2E | 🔴 Not Started | C完了後に開始 |

---

## チェックリスト（全体）

### Migration（チケットA）
- [ ] 0065_create_pending_actions.sql 適用
- [ ] 0066_create_invite_deliveries.sql 適用
- [x] 型定義 pendingAction.ts 確認 ✅
- [x] 型定義 inviteDelivery.ts 確認 ✅

### API（チケットB）✅ 全API実装完了
- [x] POST /api/threads/prepare-send ✅
- [x] POST /api/threads/:id/invites/prepare ✅
- [x] POST /api/pending-actions/:token/confirm ✅
- [x] POST /api/pending-actions/:token/execute ✅
- [ ] POST /api/threads/:id/finalize（確定通知追加）— 次フェーズ

### フロント
- [ ] Intent: メール入力 → prepare
- [ ] Intent: 「送る/キャンセル/別スレッドで」
- [ ] Intent: リスト5コマンド
- [ ] サマリカード表示
- [ ] 状態管理（pendingAction保持）

### E2E
- [ ] シナリオ1: 新規スレッド送信
- [ ] シナリオ2: 追加招待
- [ ] シナリオ3: 確定通知
- [ ] 冪等性確認（二重execute）
- [ ] 期限切れ確認（410）

---

## 関連ドキュメント

- [BETA_A_FINAL_PLAN_V2.md](./BETA_A_FINAL_PLAN_V2.md) - 詳細設計
- [ADR-0006](./ADR/ADR-0006-invite-confirmation.md) - 送信確認フロー
- [ADR-0007](./ADR/ADR-0007-external-viral-flow.md) - 外部ユーザーフロー
- [API_SPECIFICATION.md](./API_SPECIFICATION.md) - API仕様
