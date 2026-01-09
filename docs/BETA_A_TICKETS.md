# Beta A 実装チケット（Jira/Notion貼り付け用）

**バージョン**: 1.0  
**最終更新**: 2026-01-09  
**リポジトリ**: tomoniwaproject (migration 0064 → 0065/0066)

---

## 概要

Beta A = 「チャットで日程調整を完走できる」最小体験

**確定ゴール**:
1. 主催者: /chat → メール/リスト指定 → サマリ → 送る/キャンセル/別スレッドで（3語固定） → 送信 → 回答収集 → 確定 → Google Calendar + Meet → 確定通知
2. 外部ユーザー: メールリンク → 回答 → 確定後にMeet/カレンダー追加表示

**設計原則**:
- Relationship（承認モデル）と Delivery（通知チャネル）を分離
- 送信は必ず確認ステップを経る（pending_actions）
- アプリユーザー判定は「メール一致」（Beta A）

---

## A) DB Migration（0065/0066）

### A-1. チケット詳細

**タイトル**: [DB] pending_actions / invite_deliveries テーブル作成

**優先度**: P0（Blocker）

**見積**: 2h

**説明**:
送信確認とデリバリー追跡のコアテーブルを作成する。

**ファイル**:
- `db/migrations/0065_create_pending_actions.sql`
- `db/migrations/0066_create_invite_deliveries.sql`
- `packages/shared/src/types/pendingAction.ts`
- `packages/shared/src/types/inviteDelivery.ts`

**DoD（完了条件）**:
- [ ] ローカル migrate 成功
- [ ] pending_actions に INSERT/SELECT できる
- [ ] invite_deliveries に INSERT/SELECT できる
- [ ] 既存テーブルに影響なし
- [ ] 本番 migrate 成功

### A-2. 適用手順

```bash
# ローカル
cd /home/user/tomoniwaproject
npm run db:migrate:local

# 確認
wrangler d1 execute tomoniwao --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pending_actions', 'invite_deliveries');"

# 本番（十分にテスト後）
wrangler d1 migrations apply tomoniwao
```

### A-3. SQL詳細

**0065_create_pending_actions.sql**:
```sql
CREATE TABLE IF NOT EXISTS pending_actions (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL,
  thread_id         TEXT,  -- 新規時はNULL
  action_type       TEXT NOT NULL CHECK (action_type IN ('send_invites','add_invites','send_finalize_notice')),
  source_type       TEXT NOT NULL CHECK (source_type IN ('emails','list')),
  payload_json      TEXT NOT NULL,
  summary_json      TEXT NOT NULL,
  confirm_token     TEXT UNIQUE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed_send','confirmed_cancel','confirmed_new_thread','executed','expired')),
  expires_at        TEXT NOT NULL,
  confirmed_at      TEXT,
  executed_at       TEXT,
  request_id        TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE SET NULL
);
```

**0066_create_invite_deliveries.sql**:
```sql
CREATE TABLE IF NOT EXISTS invite_deliveries (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  owner_user_id     TEXT NOT NULL,
  thread_id         TEXT NOT NULL,
  invite_id         TEXT,
  delivery_type     TEXT NOT NULL CHECK (delivery_type IN ('invite_sent','finalized_notice','reminder')),
  channel           TEXT NOT NULL CHECK (channel IN ('email','in_app')),
  recipient_email   TEXT,
  recipient_user_id TEXT,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','skipped')),
  provider          TEXT,
  provider_message_id TEXT,
  queue_job_id      TEXT,
  last_error        TEXT,
  retry_count       INTEGER DEFAULT 0,
  queued_at         TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at           TEXT,
  delivered_at      TEXT,
  failed_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (invite_id) REFERENCES thread_invites(id) ON DELETE SET NULL,
  CHECK (recipient_email IS NOT NULL OR recipient_user_id IS NOT NULL)
);
```

---

## B) バックエンドAPI（prepare → confirm → execute）

### B-1. チケット詳細

**タイトル**: [API] 送信確認3段階API（prepare/confirm/execute）

**優先度**: P0（Blocker）

**見積**: 8h

**説明**:
送信確認必須の3段階APIを実装。冪等性・リロード耐性・監査対応。

**ファイル**:
- `apps/api/src/routes/pendingActions.ts` (新規)
- `apps/api/src/repositories/pendingActionsRepository.ts` (新規)
- `apps/api/src/routes/threads.ts` (修正: prepare-send追加)

### B-2. API一覧

#### 1) POST /api/threads/prepare-send
**目的**: 新規スレッド作成＋招待送信の準備（pending_action作成）

**Request**:
```typescript
{
  source_type: 'emails' | 'list';
  emails?: string[];      // source_type='emails' の場合
  list_id?: string;       // source_type='list' の場合
  title?: string;         // スレッドタイトル
  description?: string;
}
```

**Response (200)**:
```typescript
{
  confirm_token: string;      // 40文字
  expires_at: string;         // ISO8601, 15分後
  summary: {
    total_count: number;
    valid_count: number;
    skipped_count: number;
    skipped_reasons: Array<{
      reason: 'invalid_email' | 'duplicate_input' | 'missing_email' | 'already_invited';
      count: number;
      examples?: string[];
    }>;
    preview: Array<{
      email: string;
      name?: string;
      is_app_user: boolean;
    }>;
    source_description: string;
  };
  default_mode: 'new_thread';
  message: string;
}
```

**処理フロー**:
1. emails正規化（trim/lowercase）
2. 重複除去
3. 無効メール除外
4. アプリユーザー判定（メール一致）
5. サマリ生成（preview最大5件）
6. pending_actions INSERT
7. レスポンス返却

#### 2) POST /api/threads/:threadId/invites/prepare
**目的**: 既存スレッドへの追加招待準備

**Request**: 同上

**Response (200)**: 同上（default_mode: 'add_to_thread'）

**追加処理**:
- already_invited チェック（既存inviteとの重複）
- thread所有者検証

#### 3) POST /api/pending-actions/:confirm_token/confirm
**目的**: 確認決定（送る/キャンセル/別スレッドで）

**Request**:
```typescript
{
  decision: 'send' | 'cancel' | 'new_thread';
}
```

**Response (200)**:
```typescript
{
  status: 'confirmed_send' | 'confirmed_cancel' | 'confirmed_new_thread';
  message: string;
  next_action?: 'execute';  // send/new_thread の場合
}
```

**バリデーション**:
- status='pending' のみ許可
- expires_at 未超過
- decision は 3値のみ

#### 4) POST /api/pending-actions/:confirm_token/execute
**目的**: 実際の送信実行（冪等）

**Request**:
```typescript
{
  request_id?: string;  // 冪等性担保用
}
```

**Response (200)**:
```typescript
{
  thread_id: string;
  inserted: number;
  skipped: number;
  failed: number;
  deliveries: {
    email_queued: number;
    in_app_created: number;
  };
  message: string;
  request_id: string;
}
```

**処理フロー（confirmed_send）**:
1. request_id チェック（二重実行防止）
2. thread_id あり → 追加招待 / なし → 新規スレッド作成
3. thread_invites バッチINSERT
4. EMAIL_QUEUE 投入 → invite_deliveries(channel='email') INSERT
5. アプリユーザーには inbox + invite_deliveries(channel='in_app') INSERT
6. pending_actions.status → 'executed'
7. レスポンス返却

**処理フロー（confirmed_new_thread）**:
1. 元スレッドからタイトル継承
2. 新規スレッド作成
3. 以降は confirmed_send と同じ

### B-3. 擬似コード（execute部分）

```typescript
// apps/api/src/routes/pendingActions.ts
app.post('/:confirm_token/execute', async (c) => {
  const { env } = c;
  const { workspaceId, ownerUserId } = getTenant(c);
  const { confirm_token } = c.req.param();
  const { request_id } = await c.req.json();

  const repo = new PendingActionsRepository(env.DB);
  const action = await repo.getByToken(confirm_token);

  // 1. Validation
  if (!action) return c.json({ error: 'Not found' }, 404);
  if (action.workspace_id !== workspaceId) return c.json({ error: 'Access denied' }, 403);
  if (action.status === 'executed') {
    // 冪等性: 既に実行済みなら前回の結果を返す
    return c.json({ 
      thread_id: action.thread_id,
      message: 'Already executed',
      request_id: action.request_id
    });
  }
  if (!['confirmed_send', 'confirmed_new_thread'].includes(action.status)) {
    return c.json({ error: 'Invalid status for execute' }, 409);
  }
  if (isExpired(action.expires_at)) {
    await repo.updateStatus(action.id, 'expired');
    return c.json({ error: 'Expired' }, 410);
  }

  // 2. request_id 二重チェック
  if (request_id && action.request_id && action.request_id !== request_id) {
    return c.json({ error: 'Duplicate request' }, 409);
  }

  // 3. Execute
  const payload = JSON.parse(action.payload_json) as PendingActionPayload;
  const threadsRepo = new ThreadsRepository(env.DB);
  const deliveriesRepo = new InviteDeliveriesRepository(env.DB);

  let threadId = action.thread_id;

  // 新規スレッド作成
  if (!threadId || action.status === 'confirmed_new_thread') {
    const newThread = await threadsRepo.create({
      workspace_id: workspaceId,
      organizer_user_id: ownerUserId,
      title: payload.title || 'New Thread',
      description: payload.description,
      status: 'draft',
    });
    threadId = newThread.id;
    await repo.updateThreadId(action.id, threadId);
  }

  // メール取得
  let emails: string[] = [];
  if (payload.source_type === 'emails') {
    emails = payload.emails;
  } else {
    const members = await listsRepo.getMembers(payload.list_id, workspaceId);
    emails = members.filter(m => m.email).map(m => m.email);
  }

  // Batch invite作成
  const batchResult = await threadsRepo.createInvitesBatch(
    emails.map(email => ({
      thread_id: threadId,
      email,
      expires_in_hours: 72,
    }))
  );

  // Deliveries記録 + EMAIL_QUEUE投入
  let emailQueued = 0;
  let inAppCreated = 0;

  for (const inviteId of batchResult.insertedIds) {
    const invite = await threadsRepo.getInviteById(inviteId);
    const { is_app_user, user_id } = await checkIsAppUser(env.DB, invite.email);

    // Email delivery
    const emailJobId = `invite-${inviteId}`;
    await env.EMAIL_QUEUE.send({
      job_id: emailJobId,
      type: 'invite',
      to: invite.email,
      // ...
    });
    await deliveriesRepo.create({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      thread_id: threadId,
      invite_id: inviteId,
      delivery_type: 'invite_sent',
      channel: 'email',
      recipient_email: invite.email,
      queue_job_id: emailJobId,
    });
    emailQueued++;

    // In-app delivery (app users only)
    if (is_app_user && user_id) {
      await inboxRepo.create({
        user_id,
        type: 'scheduling_invite',
        title: `日程調整の招待`,
        // ...
      });
      await deliveriesRepo.create({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        thread_id: threadId,
        invite_id: inviteId,
        delivery_type: 'invite_sent',
        channel: 'in_app',
        recipient_user_id: user_id,
        provider: 'inbox',
        status: 'delivered',
      });
      inAppCreated++;
    }
  }

  // Update pending_action
  await repo.markExecuted(action.id, request_id || crypto.randomUUID());

  return c.json({
    thread_id: threadId,
    inserted: batchResult.insertedIds.length,
    skipped: batchResult.skipped,
    failed: 0,
    deliveries: {
      email_queued: emailQueued,
      in_app_created: inAppCreated,
    },
    message: `${batchResult.insertedIds.length}名に招待を送信しました。`,
    request_id: action.request_id,
  });
});
```

### B-4. エラーコード

| Code | 条件 | メッセージ |
|------|------|-----------|
| 400 | 入力不正 | `Missing required field: emails or list_id` |
| 401 | 未認証 | `Unauthorized` |
| 403 | 権限なし | `Access denied` |
| 404 | 見つからない | `Pending action not found` |
| 409 | 状態不正 | `Invalid status for this operation` |
| 410 | 期限切れ | `Confirmation expired (15 minutes)` |
| 500 | サーバーエラー | `Internal server error` |

---

## C) フロントエンド（Intent/Executor/リスト5コマンド）

### C-1. チケット詳細

**タイトル**: [Frontend] チャットIntent + 送信確認UI + リスト5コマンド

**優先度**: P0（Blocker）

**見積**: 8h

**ファイル**:
- `frontend/src/services/intentParser.ts` (修正)
- `frontend/src/services/chatExecutor.ts` (修正)
- `frontend/src/components/chat/ConfirmCard.tsx` (新規)

### C-2. Intent一覧（Beta A必須）

| Intent | トリガー | API呼び出し |
|--------|---------|------------|
| `thread.send.prepare` | メール入力 + スレッド未選択 | `POST /threads/prepare-send` |
| `thread.invite.prepare.add` | メール入力 + スレッド選択中 | `POST /threads/:id/invites/prepare` |
| `pending.confirm` | 「送る」「キャンセル」「別スレッドで」 | `POST /pending-actions/:token/confirm` → `execute` |
| `lists.create` | 「〇〇リスト作って」 | `POST /lists` |
| `lists.list` | 「リスト見せて」 | `GET /lists` |
| `listMembers.list` | 「〇〇リストのメンバー」 | `GET /lists/:id/members` |
| `contacts.upsert` + `listMembers.add` | 「〇〇を△△リストに追加」 | `POST /contacts` → `POST /lists/:id/members` |
| `thread.invite.fromList` | 「〇〇リストに招待」 | `prepare` → `confirm` → `execute` |

### C-3. 状態管理

```typescript
// frontend/src/stores/pendingActionStore.ts
interface PendingActionState {
  confirm_token: string | null;
  expires_at: string | null;
  summary: PendingActionSummary | null;
  mode: 'new_thread' | 'add_to_thread' | null;
}

// リロード対策（Beta A任意、Beta B必須）
// localStorage に保存し、15分以内なら復元
```

### C-4. 確認カードUI

```tsx
// frontend/src/components/chat/ConfirmCard.tsx
export function ConfirmCard({ 
  summary, 
  onConfirm 
}: { 
  summary: PendingActionSummary;
  onConfirm: (decision: 'send' | 'cancel' | 'new_thread') => void;
}) {
  return (
    <div className="bg-blue-50 p-4 rounded-lg">
      <h3 className="font-bold">送信確認</h3>
      <p>{summary.source_description}</p>
      <p>{summary.valid_count}名に送信します</p>
      {summary.skipped_count > 0 && (
        <p className="text-yellow-600">
          {summary.skipped_count}件スキップ
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button onClick={() => onConfirm('send')} className="btn-primary">
          送る
        </button>
        <button onClick={() => onConfirm('cancel')} className="btn-secondary">
          キャンセル
        </button>
        <button onClick={() => onConfirm('new_thread')} className="btn-outline">
          別スレッドで
        </button>
      </div>
    </div>
  );
}
```

### C-5. リスト5コマンド実装

```typescript
// Intent: lists.create
// Input: "営業部リスト作って"
async function handleListsCreate(params: { name: string }) {
  const res = await api.post('/lists', { name: params.name });
  return `「${res.data.list.name}」リストを作成しました。`;
}

// Intent: lists.list
// Input: "リスト見せて"
async function handleListsList() {
  const res = await api.get('/lists');
  const names = res.data.lists.map(l => `• ${l.name} (${l.member_count}名)`);
  return `リスト一覧:\n${names.join('\n')}`;
}

// Intent: listMembers.list
// Input: "営業部リストのメンバー"
async function handleListMembersList(params: { list_name: string }) {
  const list = await findListByName(params.list_name);
  const res = await api.get(`/lists/${list.id}/members`);
  const members = res.data.members.map(m => `• ${m.contact_display_name || m.contact_email}`);
  return `${list.name}のメンバー (${res.data.total}名):\n${members.slice(0, 10).join('\n')}`;
}

// Intent: contacts.upsert + listMembers.add
// Input: "tanaka@example.com を営業部リストに追加"
async function handleAddToList(params: { email: string; list_name: string }) {
  const list = await findListByName(params.list_name);
  const contact = await api.post('/contacts', { email: params.email });
  await api.post(`/lists/${list.id}/members`, { contact_id: contact.data.contact.id });
  return `${params.email} を ${list.name} に追加しました。`;
}

// Intent: thread.invite.fromList
// Input: "営業部リストに招待"
async function handleInviteFromList(params: { list_name: string }) {
  const list = await findListByName(params.list_name);
  const res = await api.post('/threads/prepare-send', {
    source_type: 'list',
    list_id: list.id,
  });
  // ConfirmCard表示へ
  setPendingAction(res.data);
  return null; // UIカードで表示
}
```

---

## D) E2E チェックリスト

### D-1. チケット詳細

**タイトル**: [Test] Beta A E2Eシナリオ3本完走

**優先度**: P0（Blocker）

**見積**: 4h

### D-2. シナリオ1: 新規スレッド（メール入力）

```
1. /chat を開く
2. 「alice@example.com, bob@example.com に招待」と入力
3. → サマリカード表示: "2名に送信します"
4. 「送る」をクリック
5. → pending_actions.status = 'executed'
6. → thread_invites に2件INSERT
7. → invite_deliveries に2件INSERT (channel='email')
8. → EMAIL_QUEUE に2件投入
9. → アプリユーザーなら inbox + invite_deliveries(in_app)も
10. → "2名に招待を送信しました" メッセージ表示
```

**確認ポイント**:
- [ ] 二重送信されない（同じconfirm_tokenでexecute 2回 → 同じ結果）
- [ ] 期限切れ後は execute 失敗（410）
- [ ] キャンセル後は execute 不可（409）

### D-3. シナリオ2: 追加招待（スレッド選択中）

```
1. 既存スレッドを選択
2. 「charlie@example.com を追加」と入力
3. → サマリカード表示（既存inviteとの重複チェック含む）
4. 「送る」をクリック
5. → thread_invites に追加INSERT
6. → invite_deliveries 記録
```

**確認ポイント**:
- [ ] 重複メールは skipped_reasons に含まれる
- [ ] 「別スレッドで」選択時は新規スレッド作成

### D-4. シナリオ3: 確定→通知→カレンダー追加

```
1. 外部ユーザーが /i/:token にアクセス
2. 候補を選択 → 回答送信
3. 主催者がチャットで「1番で確定」
4. → Google Calendar + Meet 作成
5. → 確定通知送信（全員）
6. → invite_deliveries (delivery_type='finalized_notice')
7. 外部ユーザーの /i/:token/result 画面
   - Meetリンク表示
   - Google Calendar追加ボタン
   - ICSダウンロード
```

**確認ポイント**:
- [ ] 確定通知が全員に届く（メール＋アプリユーザーはInbox）
- [ ] Meetリンクが正しく表示
- [ ] ICSファイルのUID = `{thread_id}@tomoniwao.com`

### D-5. リスト体験シナリオ

```
1. 「営業部リスト作って」 → リスト作成
2. 「リスト見せて」 → 一覧表示
3. 「tanaka@example.com を営業部に追加」 → メンバー追加
4. 「営業部リストのメンバー」 → メンバー表示
5. 「営業部リストに招待」 → サマリ → 送る → 送信完了
```

### D-6. 監視・デバッグ

```bash
# request_id でログ追跡
wrangler tail | grep "request_id=xxx"

# EMAIL_QUEUE 状況
wrangler queues messages list EMAIL_QUEUE

# invite_deliveries 状態確認
wrangler d1 execute tomoniwao --command="SELECT status, COUNT(*) FROM invite_deliveries GROUP BY status;"

# pending_actions 期限切れチェック
wrangler d1 execute tomoniwao --command="SELECT COUNT(*) FROM pending_actions WHERE status='pending' AND expires_at < datetime('now');"
```

---

## 実装順序

```
Week 1:
├── A-1: Migration 0065/0066 作成・適用 (2h)
├── B-1: prepare-send API (3h)
├── B-2: confirm API (2h)
└── B-3: execute API (3h)

Week 2:
├── C-1: Intent追加 (2h)
├── C-2: ConfirmCard UI (2h)
├── C-3: リスト5コマンド (4h)
└── D-1: E2Eテスト3本 (4h)
```

**合計: 22h**

---

## Beta Aで「やらない」と決めた事項

| 項目 | 理由 | 将来フェーズ |
|------|------|-------------|
| 自然文での送信確認 | 3語固定で事故防止、AI会話化で吸収 | Beta B |
| Slack/Chatwork送信 | Beta Aはメール＋Inboxのみ | Beta C |
| work/family/代理登録 | Relationshipは別軸 | Beta B/C |
| フレンド承認UI | Viral流入後に検討 | 後年 |
| 未読バッジ | Inbox最小仕様で十分 | Beta B |
| リロード復元 | localStorage対応は任意 | Beta B |

---

## 関連ドキュメント

- `docs/ADR/ADR-0006-invite-confirmation.md` (新規作成)
- `docs/ADR/ADR-0007-external-viral-flow.md` (既存更新)
- `docs/EXTERNAL_INVITE_FLOW.md`
- `docs/CALENDAR_INTEGRATION_PLAN.md`

---

## 変更履歴

| 日付 | 変更内容 | 担当 |
|------|----------|------|
| 2026-01-09 | 初版作成 | AI Assistant |
