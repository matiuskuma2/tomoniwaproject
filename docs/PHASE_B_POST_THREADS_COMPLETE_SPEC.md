# Phase B: POST /api/threads 完全統合仕様書

## 0) 前提（DB・列の正確性確認済み）

### データベース構成
- **DB**: D1/SQLite (Cloudflare Workers)
- **統合方針**: 既存テーブルを壊さず、Phase B の新テーブルを中心に統合

### テーブルマッピング（Phase B 確定版）

#### 1. Thread 本体: `scheduling_threads`
```sql
CREATE TABLE scheduling_threads (
  id                  TEXT PRIMARY KEY,     -- UUID
  organizer_user_id   TEXT NOT NULL,        -- 主催者 user_id
  title               TEXT,                 -- スレッドタイトル
  description         TEXT,                 -- 説明
  status              TEXT DEFAULT 'draft', -- active|draft|cancelled|finalized
  mode                TEXT DEFAULT 'one_on_one', -- 将来拡張用
  created_at          TEXT NOT NULL,        -- ISO8601
  updated_at          TEXT NOT NULL         -- ISO8601
);
```

#### 2. Attendance Rule: `thread_attendance_rules`
```sql
CREATE TABLE thread_attendance_rules (
  thread_id         TEXT PRIMARY KEY,  -- scheduling_threads.id
  version           INTEGER NOT NULL DEFAULT 1,
  rule_json         TEXT NOT NULL,     -- JSON: AttendanceRuleV1
  finalize_policy   TEXT NOT NULL DEFAULT 'EARLIEST_VALID',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);
```

#### 3. Scheduling Slots: `scheduling_slots`
```sql
CREATE TABLE scheduling_slots (
  slot_id     TEXT PRIMARY KEY,  -- UUID
  thread_id   TEXT NOT NULL,
  start_at    TEXT NOT NULL,     -- ISO8601 (2026-01-01T14:00:00+09:00)
  end_at      TEXT NOT NULL,     -- ISO8601
  timezone    TEXT NOT NULL,     -- IANA (Asia/Tokyo)
  label       TEXT,              -- オプション表示ラベル
  created_at  TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_scheduling_slots_thread_start 
  ON scheduling_slots(thread_id, start_at);
```

#### 4. Thread Invites: `thread_invites`
```sql
CREATE TABLE thread_invites (
  id                TEXT PRIMARY KEY,  -- UUID
  thread_id         TEXT NOT NULL,
  token             TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL,
  candidate_name    TEXT NOT NULL,
  candidate_reason  TEXT,
  invitee_key       TEXT,              -- Phase B: e:<sha256_16(email)>
  status            TEXT NOT NULL DEFAULT 'pending',
  expires_at        TEXT NOT NULL,
  accepted_at       TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_thread_invites_token ON thread_invites(token);
CREATE INDEX idx_thread_invites_thread ON thread_invites(thread_id);
```

#### 5. Thread Selections: `thread_selections`
```sql
CREATE TABLE thread_selections (
  selection_id      TEXT PRIMARY KEY,  -- UUID
  thread_id         TEXT NOT NULL,
  invitee_key       TEXT NOT NULL,     -- u:<user_id> | e:<sha256> | lm:<id>
  status            TEXT NOT NULL DEFAULT 'pending',
  selected_slot_id  TEXT,              -- scheduling_slots.slot_id
  responded_at      TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_slot_id) REFERENCES scheduling_slots(slot_id) ON DELETE SET NULL,
  UNIQUE(thread_id, invitee_key)
);
```

#### 6. Thread Finalize: `thread_finalize`
```sql
CREATE TABLE thread_finalize (
  thread_id           TEXT PRIMARY KEY,  -- scheduling_threads.id
  selected_slot_id    TEXT NOT NULL,
  finalized_by_user_id TEXT,
  finalized_at        TEXT NOT NULL,
  reason              TEXT,
  auto_finalized      INTEGER DEFAULT 0,
  final_participants  TEXT,              -- JSON array of invitee_keys
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_slot_id) REFERENCES scheduling_slots(slot_id) ON DELETE RESTRICT
);
```

---

## 1) POST /api/threads の完全フロー

### エンドポイント仕様
```
POST /api/threads
Content-Type: application/json
Authorization: Bearer <token> or x-user-id header

Request Body:
{
  "title": string (required),
  "description": string (optional)
}

Response (201):
{
  "thread": {
    "id": string,
    "title": string,
    "description": string,
    "organizer_user_id": string,
    "status": string,
    "created_at": string
  },
  "attendance_rule": {
    "thread_id": string,
    "type": "ANY" | "ALL" | "K_OF_N" | "REQUIRED_PLUS_K" | "GROUP_ANY",
    "rule_json": object,
    "finalize_policy": "EARLIEST_VALID"
  },
  "slots": [
    {
      "slot_id": string,
      "thread_id": string,
      "start_at": string,
      "end_at": string,
      "timezone": string,
      "label": string
    }
  ],
  "candidates": [
    {
      "name": string,
      "email": string,
      "reason": string,
      "invite_token": string,
      "invite_url": string,
      "invitee_key": string
    }
  ],
  "message": string
}

Error Response (400/500):
{
  "error": string,
  "details": string
}
```

### レート制限
- **10リクエスト/分/ユーザー**
- `x-user-id` ヘッダーまたは認証トークンで識別

---

## 2) 実装フロー（原子性保証）

### Step 0: 前提チェック
```typescript
// 入力バリデーション
if (!title || typeof title !== 'string') {
  return c.json({ error: 'Missing or invalid field: title' }, 400);
}

// ユーザーID取得
const userId = await getUserIdLegacy(c);
if (!userId) {
  return c.json({ error: 'Unauthorized' }, 401);
}
```

### Step 1: Thread 作成（最優先・絶対失敗させない）
```typescript
const threadId = crypto.randomUUID();
const now = new Date().toISOString();

await env.DB.prepare(`
  INSERT INTO scheduling_threads 
    (id, organizer_user_id, title, description, status, mode, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'active', 'one_on_one', ?, ?)
`).bind(threadId, userId, title, description || null, now, now).run();

console.log('[Threads] ✅ Created thread:', threadId);
```

**失敗時の挙動**: 500エラー返却、後続処理中止

---

### Step 2: Attendance Rule 作成（MVP: ANY 推奨）
```typescript
// デフォルトルール: ANY (外部招待が成立しやすい)
const defaultRule = {
  version: '1.0',
  type: 'ANY',  // ANY|ALL|K_OF_N|REQUIRED_PLUS_K|GROUP_ANY
  slot_policy: {
    multiple_slots_allowed: true
  },
  invitee_scope: {
    allow_unregistered: true
  },
  rule: {},  // ANY なので空
  finalize_policy: {
    auto_finalize: true,
    policy: 'EARLIEST_VALID'
  }
};

await env.DB.prepare(`
  INSERT INTO thread_attendance_rules (thread_id, rule_json, finalize_policy)
  VALUES (?, ?, ?)
`).bind(threadId, JSON.stringify(defaultRule), 'EARLIEST_VALID').run();

console.log('[Threads] ✅ Created attendance rule: ANY');
```

**失敗時の挙動**: 
- ログに警告出力
- スレッドは作成済みなので継続可能
- 後で手動修正可能（Thread は存在する）

**代替ルールタイプ**:
```typescript
// ALL: 全員が同じスロットを選択する必要がある
const allRule = {
  version: '1.0',
  type: 'ALL',
  participants: [],  // 後でinviteから生成
  // ...
};

// K_OF_N: 最低K人が同意すれば成立
const kOfNRule = {
  version: '1.0',
  type: 'K_OF_N',
  participants: [],
  k: 2,  // 最低2人
  // ...
};

// REQUIRED_PLUS_K: 必須参加者 + quorum人
const requiredPlusKRule = {
  version: '1.0',
  type: 'REQUIRED_PLUS_K',
  required: ['e:abc123'],  // 必須invitee_key
  optional: ['e:def456', 'e:ghi789'],
  quorum: 1,  // optional から最低1人
  // ...
};
```

---

### Step 3: Scheduling Slots 作成（デフォルト3件）
```typescript
// 明日、明後日、3日後の14:00に候補枠を作成
const slotBaseTime = new Date();
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

const slotsToCreate = [
  { offset: 1, label: 'Tomorrow' },
  { offset: 2, label: 'Day After Tomorrow' },
  { offset: 3, label: 'In 3 Days' }
];

const slots = [];

for (const { offset, label } of slotsToCreate) {
  const startDate = new Date(slotBaseTime);
  startDate.setDate(startDate.getDate() + offset);
  startDate.setHours(14, 0, 0, 0); // 14:00
  
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // +1 hour
  
  const slotId = crypto.randomUUID();
  
  await env.DB.prepare(`
    INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    slotId,
    threadId,
    startDate.toISOString(),
    endDate.toISOString(),
    timezone,
    label
  ).run();
  
  slots.push({
    slot_id: slotId,
    thread_id: threadId,
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    timezone,
    label
  });
}

console.log('[Threads] ✅ Created slots:', slots.length);
```

**失敗時の挙動**: 
- 一部失敗しても継続（最低1件あればOK）
- 警告ログ出力
- レスポンスに実際に作成されたslotのみ含める

---

### Step 4: AI Candidate Generation
```typescript
// AI フォールバック設定（無料プランは false）
const allowFallback = env.AI_FALLBACK_ENABLED === 'true';

const aiRouter = new AIRouterService(
  env.GEMINI_API_KEY || '',
  env.OPENAI_API_KEY || '',
  env.DB,
  allowFallback
);

const candidateGen = new CandidateGeneratorService(aiRouter, userId);
const candidates = await candidateGen.generateCandidates(title, description);

console.log('[Threads] ✅ Generated candidates:', candidates.length);
```

**候補者データ構造**:
```typescript
interface Candidate {
  name: string;      // "Raj Patel"
  email: string;     // "raj.patel@example.com"
  reason: string;    // "Tech lead with distributed systems expertise"
}
```

**失敗時の挙動**:
- AIが失敗してもスレッドは作成済み
- 空の候補者配列を返す
- 後で手動で招待を追加可能

---

### Step 5: Create Invites（invitee_key を必ず付与）
```typescript
const threadsRepo = new ThreadsRepository(env.DB);
const invites = [];

for (const candidate of candidates) {
  try {
    const invite = await threadsRepo.createInvite({
      thread_id: threadId,
      email: candidate.email,
      candidate_name: candidate.name,
      candidate_reason: candidate.reason,
      expires_in_hours: 72  // 3日間有効
    });
    
    invites.push(invite);
    console.log('[Threads] ✅ Created invite:', invite.id, 'invitee_key:', invite.invitee_key);
  } catch (error) {
    console.error('[Threads] ⚠️ Failed to create invite for:', candidate.email, error);
    // 失敗しても継続（他の招待は作成する）
  }
}
```

**invitee_key 生成ロジック（ThreadsRepository 内）**:
```typescript
// SHA-256(lowercase(email)) の最初16文字
const encoder = new TextEncoder();
const emailData = encoder.encode(data.email.toLowerCase());
const hashBuffer = await crypto.subtle.digest('SHA-256', emailData);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
const emailHash = hashHex.substring(0, 16);
const inviteeKey = `e:${emailHash}`;  // e: プレフィックス
```

**invitee_key スキーム**:
- `u:<user_id>` - 内部登録ユーザー
- `e:<sha256_16(lowercase(email))>` - 外部Email招待（Phase B）
- `lm:<list_member_id>` - リストメンバー（Phase C）

**失敗時の挙動**:
- 一部の invite が失敗しても継続
- 成功した invite のみレスポンスに含める

---

### Step 6: Queue Email Jobs
```typescript
for (const invite of invites) {
  try {
    const emailJob: EmailJob = {
      job_id: `invite-${invite.id}`,
      type: 'invite',
      to: invite.email,
      subject: `${title} - You're invited to join a conversation`,
      created_at: Date.now(),
      data: {
        token: invite.token,
        inviter_name: 'Tomoniwao',  // 将来的には userId から取得
        relation_type: 'thread_invite',
        thread_title: title
      }
    };
    
    await env.EMAIL_QUEUE.send(emailJob);
    console.log('[Threads] ✅ Queued email:', invite.email);
  } catch (error) {
    console.error('[Threads] ⚠️ Failed to queue email:', invite.email, error);
    // メール送信失敗してもinviteは作成済み（後で再送可能）
  }
}
```

**失敗時の挙動**:
- メール送信失敗しても invite は存在する
- 後で手動で再送可能（/api/threads/:id/remind API で対応予定）

---

### Step 7: レスポンス構築
```typescript
return c.json({
  thread: {
    id: threadId,
    title,
    description,
    organizer_user_id: userId,
    status: 'active',
    created_at: now
  },
  attendance_rule: {
    thread_id: threadId,
    type: defaultRule.type,
    rule_json: defaultRule,
    finalize_policy: 'EARLIEST_VALID'
  },
  slots: slots.map(slot => ({
    slot_id: slot.slot_id,
    thread_id: slot.thread_id,
    start_at: slot.start_at,
    end_at: slot.end_at,
    timezone: slot.timezone,
    label: slot.label
  })),
  candidates: candidates.map((candidate, i) => {
    const invite = invites[i];
    return {
      ...candidate,
      invite_token: invite?.token || null,
      invite_url: invite ? `https://webapp.snsrilarc.workers.dev/i/${invite.token}` : null,
      invitee_key: invite?.invitee_key || null
    };
  }),
  message: `Thread created with ${invites.length} candidate invitations sent`
}, 201);
```

---

## 3) エラーハンドリング方針

### 原子性のレベル
```
Level 1 (CRITICAL): scheduling_threads 作成
  → 失敗したら即座に500エラー、全処理中止

Level 2 (HIGH): thread_attendance_rules, scheduling_slots 作成
  → 失敗しても警告ログ、処理継続
  → Thread は存在するので後で手動修正可能

Level 3 (MEDIUM): thread_invites 作成
  → 一部失敗しても継続
  → 成功した invite のみレスポンスに含める

Level 4 (LOW): Email 送信
  → 失敗してもレスポンス成功
  → 後で /api/threads/:id/remind で再送可能
```

### トランザクション設計
D1 は複数 INSERT を単一トランザクションにまとめる機能が限定的なので、**ステップごとの冪等性** で保証:

1. **thread_attendance_rules**: `thread_id` が PK なので `INSERT OR IGNORE` 可能
2. **scheduling_slots**: `slot_id` が UUID なので重複しない
3. **thread_invites**: `token` が UNIQUE なので重複しない

```typescript
// 冪等性の例
await env.DB.prepare(`
  INSERT OR IGNORE INTO thread_attendance_rules (thread_id, rule_json, finalize_policy)
  VALUES (?, ?, ?)
`).bind(threadId, JSON.stringify(defaultRule), 'EARLIEST_VALID').run();
```

---

## 4) E2E テスト用 SQL

### 4.1 Thread 本体確認
```sql
SELECT 
  id, 
  organizer_user_id, 
  title, 
  description, 
  status, 
  mode, 
  created_at, 
  updated_at
FROM scheduling_threads 
WHERE id = '<threadId>';
```

### 4.2 Attendance Rule 確認
```sql
SELECT 
  thread_id, 
  version, 
  rule_json, 
  finalize_policy, 
  created_at, 
  updated_at
FROM thread_attendance_rules 
WHERE thread_id = '<threadId>';
```

### 4.3 Slots 確認
```sql
SELECT 
  slot_id, 
  thread_id, 
  start_at, 
  end_at, 
  timezone, 
  label, 
  created_at
FROM scheduling_slots 
WHERE thread_id = '<threadId>'
ORDER BY start_at ASC;
```

### 4.4 Invites 確認
```sql
SELECT 
  id, 
  token, 
  email, 
  candidate_name, 
  candidate_reason, 
  invitee_key, 
  status, 
  expires_at, 
  accepted_at, 
  created_at
FROM thread_invites 
WHERE thread_id = '<threadId>'
ORDER BY created_at DESC;
```

### 4.5 完全な Thread 状態確認（JOIN版）
```sql
SELECT 
  st.id AS thread_id,
  st.title,
  st.status AS thread_status,
  tar.rule_json,
  tar.finalize_policy,
  COUNT(DISTINCT ss.slot_id) AS slot_count,
  COUNT(DISTINCT ti.id) AS invite_count,
  COUNT(DISTINCT CASE WHEN ti.status = 'accepted' THEN ti.id END) AS accepted_count,
  COUNT(DISTINCT CASE WHEN ti.status = 'pending' THEN ti.id END) AS pending_count
FROM scheduling_threads st
LEFT JOIN thread_attendance_rules tar ON tar.thread_id = st.id
LEFT JOIN scheduling_slots ss ON ss.thread_id = st.id
LEFT JOIN thread_invites ti ON ti.thread_id = st.id
WHERE st.id = '<threadId>'
GROUP BY st.id, st.title, st.status, tar.rule_json, tar.finalize_policy;
```

---

## 5) Orphan Cleanup SQL（既存DB掃除）

### 5.1 orphan invites の検出
```sql
-- thread_id が scheduling_threads に存在しない invites
SELECT 
  ti.id, 
  ti.thread_id, 
  ti.email, 
  ti.status, 
  ti.created_at
FROM thread_invites ti
LEFT JOIN scheduling_threads st ON st.id = ti.thread_id
WHERE st.id IS NULL
ORDER BY ti.created_at DESC;
```

### 5.2 orphan invites の削除
```sql
DELETE FROM thread_invites
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);
```

### 5.3 orphan slots の検出
```sql
SELECT 
  ss.slot_id, 
  ss.thread_id, 
  ss.start_at, 
  ss.created_at
FROM scheduling_slots ss
LEFT JOIN scheduling_threads st ON st.id = ss.thread_id
WHERE st.id IS NULL
ORDER BY ss.created_at DESC;
```

### 5.4 orphan slots の削除
```sql
DELETE FROM scheduling_slots
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);
```

### 5.5 orphan rules の検出
```sql
SELECT 
  tar.thread_id, 
  tar.rule_json, 
  tar.created_at
FROM thread_attendance_rules tar
LEFT JOIN scheduling_threads st ON st.id = tar.thread_id
WHERE st.id IS NULL;
```

### 5.6 orphan rules の削除
```sql
DELETE FROM thread_attendance_rules
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);
```

### 5.7 完全クリーンアップ（一括実行）
```sql
-- Phase 1: thread_invites
DELETE FROM thread_invites
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);

-- Phase 2: scheduling_slots
DELETE FROM scheduling_slots
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);

-- Phase 3: thread_attendance_rules
DELETE FROM thread_attendance_rules
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);

-- Phase 4: thread_selections
DELETE FROM thread_selections
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);

-- Phase 5: thread_finalize
DELETE FROM thread_finalize
WHERE thread_id NOT IN (SELECT id FROM scheduling_threads);

-- 結果確認
SELECT 
  (SELECT COUNT(*) FROM thread_invites WHERE thread_id NOT IN (SELECT id FROM scheduling_threads)) AS orphan_invites,
  (SELECT COUNT(*) FROM scheduling_slots WHERE thread_id NOT IN (SELECT id FROM scheduling_threads)) AS orphan_slots,
  (SELECT COUNT(*) FROM thread_attendance_rules WHERE thread_id NOT IN (SELECT id FROM scheduling_threads)) AS orphan_rules,
  (SELECT COUNT(*) FROM thread_selections WHERE thread_id NOT IN (SELECT id FROM scheduling_threads)) AS orphan_selections,
  (SELECT COUNT(*) FROM thread_finalize WHERE thread_id NOT IN (SELECT id FROM scheduling_threads)) AS orphan_finalizes;
```

---

## 6) 次のアクション（Phase B 残りAPI）

### 優先度順
1. ✅ **POST /api/threads** - 完了（本仕様書）
2. ✅ **POST /i/:token/respond** - 実装済み（AttendanceEngine統合）
3. ⏳ **GET /api/threads/:id/status** - 未実装（次の優先事項）
4. ⏳ **POST /api/threads/:id/remind** - 未実装
5. ⏳ **POST /api/threads/:id/finalize** - 未実装

### GET /api/threads/:id/status 仕様（次実装）
```
GET /api/threads/:id/status

Response:
{
  "thread": { ... },
  "rule": { ... },
  "slots": [ ... ],
  "invites": [
    {
      "id": string,
      "email": string,
      "invitee_key": string,
      "status": "pending" | "accepted" | "declined" | "expired",
      "responded_at": string | null
    }
  ],
  "selections": [
    {
      "invitee_key": string,
      "status": "pending" | "selected" | "declined",
      "selected_slot_id": string | null,
      "responded_at": string | null
    }
  ],
  "evaluation": {
    "finalized": boolean,
    "final_slot_id": string | null,
    "reason": string,
    "final_participants": string[]
  }
}
```

---

## 7) まとめ

### 完了事項
- ✅ scheduling_threads への正しい INSERT
- ✅ thread_attendance_rules のデフォルト作成（ANY推奨）
- ✅ scheduling_slots の3件デフォルト作成
- ✅ thread_invites への invitee_key 付与
- ✅ カラム名統一（slot_id, start_at, end_at）
- ✅ 原子性レベルの明確化
- ✅ エラーハンドリング方針確定
- ✅ E2E テスト用SQL完備
- ✅ Orphan cleanup SQL完備

### 次のステップ
1. **本番DB Cleanup**: Orphan データを削除
2. **E2E テスト実行**: curl で POST /api/threads を実行
3. **レスポンス検証**: slots, invites, invitee_key を確認
4. **POST /i/:token/respond テスト**: 外部招待フローの確認
5. **GET /api/threads/:id/status 実装**: 次の Phase B API

---

## 付録A: curl テスト例

### Thread 作成
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/threads \
  -H "Content-Type: application/json" \
  -H "x-user-id: user123" \
  -d '{
    "title": "AI Development Discussion",
    "description": "Discuss the future of AI development tools"
  }'
```

### Thread 状態確認（DB直接）
```bash
# Thread 本体
npx wrangler d1 execute webapp-production --remote \
  --command="SELECT * FROM scheduling_threads WHERE id='<threadId>'"

# Attendance Rule
npx wrangler d1 execute webapp-production --remote \
  --command="SELECT * FROM thread_attendance_rules WHERE thread_id='<threadId>'"

# Slots
npx wrangler d1 execute webapp-production --remote \
  --command="SELECT * FROM scheduling_slots WHERE thread_id='<threadId>'"

# Invites
npx wrangler d1 execute webapp-production --remote \
  --command="SELECT id, email, invitee_key, status FROM thread_invites WHERE thread_id='<threadId>'"
```

### 招待ページアクセス
```bash
# HTMLページとして表示
curl https://webapp.snsrilarc.workers.dev/i/<token>
```

### 招待への回答（Phase B）
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/i/<token>/respond \
  -H "Content-Type: application/json" \
  -d '{
    "status": "selected",
    "selected_slot_id": "<slotId>"
  }'
```

---

## 付録B: AttendanceRule JSON 例

### ANY（デフォルト・MVP推奨）
```json
{
  "version": "1.0",
  "type": "ANY",
  "slot_policy": {
    "multiple_slots_allowed": true
  },
  "invitee_scope": {
    "allow_unregistered": true
  },
  "rule": {},
  "finalize_policy": {
    "auto_finalize": true,
    "policy": "EARLIEST_VALID"
  }
}
```

### ALL（全員一致）
```json
{
  "version": "1.0",
  "type": "ALL",
  "participants": ["e:abc123def456", "e:789ghi012jkl"],
  "slot_policy": {
    "multiple_slots_allowed": false
  },
  "invitee_scope": {
    "allow_unregistered": true
  },
  "rule": {},
  "finalize_policy": {
    "auto_finalize": true,
    "policy": "EARLIEST_VALID"
  }
}
```

### K_OF_N（最低K人）
```json
{
  "version": "1.0",
  "type": "K_OF_N",
  "participants": ["e:abc123", "e:def456", "e:ghi789"],
  "k": 2,
  "slot_policy": {
    "multiple_slots_allowed": true
  },
  "invitee_scope": {
    "allow_unregistered": true
  },
  "rule": {
    "k": 2,
    "n": 3
  },
  "finalize_policy": {
    "auto_finalize": true,
    "policy": "EARLIEST_VALID"
  }
}
```

### REQUIRED_PLUS_K（必須+定足数）
```json
{
  "version": "1.0",
  "type": "REQUIRED_PLUS_K",
  "required": ["e:abc123"],
  "optional": ["e:def456", "e:ghi789", "e:jkl012"],
  "quorum": 2,
  "slot_policy": {
    "multiple_slots_allowed": true
  },
  "invitee_scope": {
    "allow_unregistered": true
  },
  "rule": {
    "required_count": 1,
    "optional_quorum": 2
  },
  "finalize_policy": {
    "auto_finalize": true,
    "policy": "EARLIEST_VALID"
  }
}
```

---

**ドキュメントバージョン**: Phase B v1.0 - 完全統合仕様書  
**最終更新**: 2025-12-26  
**関連ドキュメント**:
- INTENT_TO_ATTENDANCE_RULE.md
- PHASE_B_API_INTEGRATION.md
- PHASE_B_CRITICAL_FIX_COMPLETE.md
- PHASE_B_STATUS_RESPOND_IMPLEMENTED.md
