# Database Schema Documentation

## 🗄️ Overview

**Database Type**: Cloudflare D1 (SQLite-based)  
**Environment**: Production & Local  
**Current Migration**: 0026_threads_and_invites.sql  
**Total Migrations**: 26

---

## 📋 Tables Overview

### Core Tables

| Table | Purpose | Ticket |
|-------|---------|--------|
| `users` | User accounts and profiles | Foundation |
| `workspaces` | Workspace/organization management | Foundation |
| `work_items` | Tasks and scheduled items | Ticket 07 |
| `inbox_items` | User notifications | Foundation |

### Thread & Invite Tables (Ticket 10)

| Table | Purpose |
|-------|---------|
| `threads` | Conversation threads |
| `thread_invites` | Invite tokens for strangers |
| `thread_participants` | Thread membership |

### AI & Monitoring Tables

| Table | Purpose | Ticket |
|-------|---------|--------|
| `ai_usage_logs` | AI API usage tracking | Ticket 08 |
| `ai_provider_settings` | AI provider configuration | Foundation |
| `rate_limit_logs` | Rate limiting history | Ticket 04 |

### Communication Tables

| Table | Purpose |
|-------|---------|
| `thread_messages` | Thread chat messages |
| `thread_message_deliveries` | Message delivery tracking |

---

## 📊 Detailed Schema

### users

**Purpose**: User account and profile management

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  suspended INTEGER NOT NULL DEFAULT 0,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  locale TEXT DEFAULT 'ja',
  timezone TEXT DEFAULT 'Asia/Tokyo',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Key Fields:**
- `id`: UUID primary key
- `email`: Unique email address
- `suspended`: 0=active, 1=suspended
- `onboarding_completed`: 0=pending, 1=completed

**Indexes:**
- `idx_users_email` on `email`

---

### work_items (Ticket 07)

**Purpose**: Tasks and scheduled events

```sql
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  room_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('task', 'scheduled')),
  title TEXT NOT NULL,
  description TEXT,
  start_at TEXT,
  end_at TEXT,
  all_day INTEGER DEFAULT 0,
  recurrence_rule TEXT,
  location TEXT,
  visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'room')),
  visibility_scope TEXT DEFAULT 'private' CHECK (visibility_scope IN ('private', 'room', 'quest', 'squad')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  google_event_id TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);
```

**Key Fields:**
- `type`: 'task' or 'scheduled'
- `status`: 'pending', 'completed', 'cancelled'
- `visibility_scope`: 'private', 'room', 'quest', 'squad'
- `source`: 'manual', 'auto_generated', 'google_calendar'

**Indexes:**
- `idx_work_items_user_id` on `user_id`
- `idx_work_items_room_id` on `room_id`
- `idx_work_items_status` on `status`

---

### threads (Ticket 10)

**Purpose**: Conversation thread management

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);
```

**Key Fields:**
- `user_id`: Thread owner
- `status`: 'active', 'archived', 'deleted'

**Indexes:**
- `idx_threads_user_id` on `user_id`
- `idx_threads_workspace_id` on `workspace_id`
- `idx_threads_status` on `status`

---

### thread_invites (Ticket 10)

**Purpose**: Stranger invite management for /i/:token

```sql
CREATE TABLE thread_invites (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  candidate_reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

**Key Fields:**
- `token`: 32-character random token for /i/:token URL
- `status`: 'pending', 'accepted', 'declined', 'expired'
- `expires_at`: ISO 8601 datetime (default: 72 hours)

**Indexes:**
- `idx_thread_invites_thread_id` on `thread_id`
- `idx_thread_invites_token` on `token` (UNIQUE)
- `idx_thread_invites_email` on `email`
- `idx_thread_invites_status` on `status`

---

### thread_participants (Ticket 10)

**Purpose**: Thread membership tracking

```sql
CREATE TABLE thread_participants (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(thread_id, user_id),
  UNIQUE(thread_id, email)
);
```

**Key Fields:**
- `role`: 'owner' (thread creator), 'member' (invited participant)
- `user_id`: NULL for non-registered users
- `email`: Used for non-registered participants

**Indexes:**
- `idx_thread_participants_thread_id` on `thread_id`
- `idx_thread_participants_user_id` on `user_id`
- `idx_thread_participants_email` on `email`

---

### inbox_items

**Purpose**: User notification center

```sql
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('scheduling_invite', 'work_item_share', 'relationship_request', 'system_message')),
  title TEXT NOT NULL,
  description TEXT,
  action_url TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  dismissed_at TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Key Fields:**
- `type`: Notification type (CHECK constraint)
  - `scheduling_invite`: Thread/event invitations (used for Ticket 10)
  - `work_item_share`: Work item sharing
  - `relationship_request`: Connection requests
  - `system_message`: System announcements
- `related_entity_type`: 'thread', 'work_item', 'room', etc.
- `related_entity_id`: Foreign entity ID

**Usage Example (Ticket 10):**
```typescript
await inboxRepo.create({
  user_id: 'user-alice',
  type: 'scheduling_invite',
  title: 'Alex Johnson accepted your invitation',
  description: 'Alex Johnson has accepted your invitation to join "Production E2E Final"',
  related_entity_type: 'thread',
  related_entity_id: '279cc47b-128f-42aa-b892-a4a5169b9060',
});
```

**Indexes:**
- `idx_inbox_items_user_id` on `user_id`
- `idx_inbox_items_is_read` on `is_read`

---

### ai_usage_logs (Ticket 08)

**Purpose**: Track AI API usage for cost monitoring

```sql
CREATE TABLE ai_usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  room_id TEXT,
  workspace_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openai')),
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  audio_seconds REAL,
  estimated_cost_usd REAL,
  request_metadata_json TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);
```

**Key Fields:**
- `provider`: 'gemini' (primary), 'openai' (fallback)
- `feature`: 'intent_parse', 'candidate_generation', etc.
- `status`: 'success', 'error'
- `estimated_cost_usd`: Cost calculation for billing

**Example Log Entry:**
```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "feature": "intent_parse",
  "status": "success",
  "input_tokens": 401,
  "output_tokens": 83,
  "estimated_cost_usd": 0.0001
}
```

**Indexes:**
- `idx_ai_usage_logs_user_id` on `user_id`
- `idx_ai_usage_logs_provider` on `provider`
- `idx_ai_usage_logs_feature` on `feature`

---

### rate_limit_logs (Ticket 04)

**Purpose**: Rate limiting history and monitoring

```sql
CREATE TABLE rate_limit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  ip_address TEXT,
  endpoint TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  limit_remaining INTEGER,
  reset_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

**Key Fields:**
- `allowed`: 0=blocked, 1=allowed
- `limit_remaining`: Requests remaining in window
- `reset_at`: Unix timestamp for limit reset

**Indexes:**
- `idx_rate_limit_logs_user_id` on `user_id`
- `idx_rate_limit_logs_ip` on `ip_address`
- `idx_rate_limit_logs_endpoint` on `endpoint`

---

## 🔄 Migration History

### Critical Migrations

| Migration | Description | Impact |
|-----------|-------------|--------|
| 0001-0010 | Foundation tables | Users, workspaces, relationships |
| 0015-0018 | AI infrastructure | AI provider settings, usage logs |
| 0024 | Work items visibility | Added `visibility_scope` field |
| 0026 | Threads & invites | Ticket 10 implementation |

**Current State**: All migrations applied to production and local

**View Migrations:**
```bash
# Local
npx wrangler d1 migrations list webapp-production --local

# Production
npx wrangler d1 migrations list webapp-production --remote
```

---

## 📈 Data Flow Examples

### Ticket 08: Voice Command → Work Item

```
1. POST /api/voice/execute { text: "明日の午後2時にミーティング" }
2. IntentParser → AIRouter (Gemini → OpenAI fallback)
3. Intent parsed: { intent: 'create', type: 'scheduled', title: 'ミーティング' }
4. Log to ai_usage_logs (provider, tokens, cost)
5. WorkItemsRepository.create() → work_items table
6. Response: { intent: 'create', work_item: {...} }
```

### Ticket 10: Thread Creation → Invite → Accept

```
1. POST /api/threads { title: "AI Discussion" }
2. ThreadsRepository.create() → threads table
3. CandidateGenerator → 3 fallback candidates
4. ThreadsRepository.createInvite() → thread_invites table (3 rows)
5. EMAIL_QUEUE.send() → Queue producer (3 jobs)
6. Response: { thread, candidates: [{ invite_url: "/i/:token" }] }

--- User clicks /i/:token ---

7. GET /i/:token → ThreadsRepository.getInviteByToken()
8. Display invite page with thread details

--- User clicks Accept ---

9. POST /i/:token/accept
10. ThreadsRepository.acceptInvite() → update thread_invites.status='accepted'
11. ThreadsRepository.addParticipant() → thread_participants table
12. InboxRepository.create() → inbox_items table (notify owner)
13. Response: { success: true, thread: {...} }
```

---

## 🔍 Querying Examples

### Get User's Work Items

```sql
SELECT * FROM work_items 
WHERE user_id = 'user-alice' 
  AND status = 'pending'
ORDER BY created_at DESC 
LIMIT 10;
```

### Check Thread Invites

```sql
SELECT ti.*, t.title 
FROM thread_invites ti
JOIN threads t ON ti.thread_id = t.id
WHERE ti.email = 'alex@example.com'
  AND ti.status = 'pending'
  AND datetime(ti.expires_at) > datetime('now');
```

### AI Usage Cost by User

```sql
SELECT 
  user_id,
  provider,
  COUNT(*) as requests,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(estimated_cost_usd) as total_cost
FROM ai_usage_logs
WHERE created_at > unixepoch('now', '-7 days')
GROUP BY user_id, provider
ORDER BY total_cost DESC;
```

### Rate Limit Status

```sql
SELECT 
  endpoint,
  COUNT(*) as total_requests,
  SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) as blocked_requests
FROM rate_limit_logs
WHERE created_at > unixepoch('now', '-1 hour')
GROUP BY endpoint;
```

---

## 🔧 Maintenance Commands

### Local Database Reset

```bash
# Reset local database (delete .wrangler state)
rm -rf .wrangler/state/v3/d1

# Re-apply migrations
npm run db:migrate:local

# Seed test data (if seed.sql exists)
npx wrangler d1 execute webapp-production --local --file=./seed.sql
```

### Production Database Backup

```bash
# Export production data
npx wrangler d1 export webapp-production --output backup.sql --remote

# Import to local for testing
npx wrangler d1 execute webapp-production --local --file=backup.sql
```

---

## ⚠️ Important Notes

### Foreign Key Constraints

- **Users**: All user-related tables cascade on `ON DELETE CASCADE`
- **Threads**: thread_invites and thread_participants cascade when thread deleted
- **Soft Deletes**: Some tables use `status='deleted'` instead of hard delete

### Data Integrity

- **UUIDs**: All IDs use UUID v4 (generated by `uuid` package)
- **Timestamps**: ISO 8601 format (`datetime('now')`) for most tables
- **CHECK Constraints**: Enforce enum-like values (status, type, etc.)

### Performance Considerations

- **Indexes**: All foreign keys and frequently queried fields are indexed
- **Query Limits**: Most list queries default to LIMIT 10 or 50
- **Pagination**: Use `LIMIT` + `OFFSET` for large result sets

---

**Last Updated**: 2025-12-25  
**Database Version**: Migration 0026
