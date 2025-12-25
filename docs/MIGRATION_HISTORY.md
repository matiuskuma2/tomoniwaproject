# Database Migration History

## 📊 Migration Overview

**Total Migrations**: 19  
**Current Version**: 0026_threads_and_invites.sql  
**Database**: Cloudflare D1 (SQLite-based)

---

## 🗂️ Migration List

### Foundation Migrations (0001-0010)

#### 0001_init_core.sql
**Date**: Initial  
**Purpose**: Core foundation tables

**Tables Created:**
- `users` - User accounts
- `workspaces` - Workspace/organization management
- `workspace_members` - Workspace membership
- `rooms` - Chat rooms
- `room_members` - Room membership
- `work_items` - Tasks and scheduled items
- `inbox_items` - User notifications
- `relationships` - User connections

**Key Features:**
- User profile management
- Workspace hierarchy
- Work item types (task, scheduled)
- Basic notification system

---

#### 0002_team_lists_events.sql
**Date**: Initial  
**Purpose**: Team collaboration features

**Tables Created:**
- `lists` - Shared lists
- `list_items` - List entries
- `list_members` - List access control
- `hosted_events` - Public events
- `event_participants` - Event attendance

---

#### 0003_admin.sql
**Date**: Initial  
**Purpose**: Administrative features

**Tables Created:**
- `admin_users` - Admin accounts
- `audit_logs` - System audit trail

---

#### 0004_indexes.sql
**Date**: Initial  
**Purpose**: Performance optimization

**Indexes Added:**
- User lookup indexes (email, display_name)
- Foreign key indexes
- Status and timestamp indexes

---

#### 0005_ai_costs.sql
**Date**: Initial  
**Purpose**: AI cost tracking foundation

**Tables Created:**
- `ai_usage_logs` - AI API usage tracking
- `ai_cost_budgets` - Budget management

---

#### 0006_indexes_ai_costs.sql
**Date**: Initial  
**Purpose**: AI cost query optimization

**Indexes Added:**
- `ai_usage_logs` indexes (user_id, provider, feature)
- `ai_cost_budgets` indexes

---

#### 0008_relationship_requests.sql
**Date**: Initial  
**Purpose**: Friend request system

**Tables Created:**
- `relationship_requests` - Pending connection requests

---

#### 0009_log_summaries.sql
**Date**: Initial  
**Purpose**: Log aggregation for analytics

**Tables Created:**
- `daily_log_summaries` - Daily aggregated logs

---

#### 0010_relationships_unique_pair.sql
**Date**: Initial  
**Purpose**: Fix relationship duplicates

**Changes:**
- Add UNIQUE constraint on (user_id, related_user_id) pairs
- Prevent duplicate connections

---

### Admin & System Migrations (0014-0018)

#### 0014_admin_import_sessions.sql
**Date**: Initial  
**Purpose**: Bulk import tracking

**Tables Created:**
- `admin_import_sessions` - Import job tracking
- `admin_import_errors` - Import error logs

---

#### 0015_system_settings.sql
**Date**: 2025-12-25  
**Purpose**: System configuration

**Tables Created:**
- `system_settings` - Key-value system config

**Key Settings:**
- `maintenance_mode`
- `max_ai_cost_per_user_daily`
- `default_rate_limit`

---

#### 0016_ai_provider_settings_unique_provider.sql
**Date**: 2025-12-25  
**Purpose**: AI provider configuration

**Tables Created:**
- `ai_provider_settings` - Provider config (Gemini, OpenAI)

**Fields:**
- `provider` - 'gemini' or 'openai'
- `is_enabled` - Provider availability
- `default_model` - Default model name
- `fallback_provider` - Backup provider
- `feature_routing_json` - Feature-specific routing

**Related**: Ticket 08 (AI Router)

---

#### 0017_ai_provider_keys_masked_preview.sql
**Date**: 2025-12-25  
**Purpose**: API key management

**Tables Created:**
- `ai_provider_keys` - API key storage

**Fields:**
- `masked_preview` - First/last 4 chars for display (e.g., "sk-...abcd")

---

#### 0018_ai_provider_keys_index.sql
**Date**: 2025-12-25  
**Purpose**: API key lookup optimization

**Indexes Added:**
- `idx_ai_provider_keys_provider` on `provider`

---

### Communication Migrations (0021-0022)

#### 0021_list_member_delivery_prefs.sql
**Date**: 2025-12-25  
**Purpose**: Email notification preferences

**Changes:**
- Add `delivery_preference` to `list_members`
- Values: 'instant', 'daily_digest', 'none'

---

#### 0022_thread_messages.sql
**Date**: 2025-12-25  
**Purpose**: Thread messaging system

**Tables Created:**
- `thread_messages` - Chat messages in threads
- `thread_message_deliveries` - Message delivery tracking

**Features:**
- Message status tracking
- Delivery confirmation
- Read receipts

---

### Work Items & Visibility (0024-0025)

#### 0024_work_items_visibility_scope.sql
**Date**: 2025-12-25  
**Purpose**: Enhanced visibility control (Ticket 07)

**Changes:**
- Add `visibility_scope` to `work_items`
- Values: 'private', 'room', 'quest', 'squad'
- Replaces simple 'private'/'room' visibility

**Impact:**
- Enables fine-grained sharing
- Supports quest/squad collaboration

---

#### 0025_admin_workspace_access_v2.sql
**Date**: 2025-12-25  
**Purpose**: Workspace admin improvements

**Changes:**
- Update workspace access controls
- Improve admin permission system

---

### Ticket 10: Threads & Invites (0026)

#### 0026_threads_and_invites.sql
**Date**: 2025-12-25  
**Purpose**: Stranger 1-to-1 matching system (Ticket 10)

**Tables Created:**

##### threads
- `id` (TEXT PRIMARY KEY)
- `user_id` (TEXT NOT NULL) - Thread owner
- `workspace_id` (TEXT)
- `title` (TEXT NOT NULL)
- `description` (TEXT)
- `status` ('active', 'archived', 'deleted')
- `created_at`, `updated_at`

##### thread_invites
- `id` (TEXT PRIMARY KEY)
- `thread_id` (TEXT NOT NULL)
- `token` (TEXT UNIQUE NOT NULL) - 32-char random token
- `email` (TEXT NOT NULL) - Candidate email
- `candidate_name` (TEXT NOT NULL)
- `candidate_reason` (TEXT) - Why selected
- `status` ('pending', 'accepted', 'declined', 'expired')
- `expires_at` (TEXT NOT NULL) - Default 72 hours
- `accepted_at` (TEXT)
- `created_at`

##### thread_participants
- `id` (TEXT PRIMARY KEY)
- `thread_id` (TEXT NOT NULL)
- `user_id` (TEXT) - NULL for non-registered
- `email` (TEXT)
- `role` ('owner', 'member')
- `joined_at`

**Indexes:**
- `idx_threads_user_id`, `idx_threads_workspace_id`, `idx_threads_status`
- `idx_thread_invites_thread_id`, `idx_thread_invites_token`, `idx_thread_invites_email`, `idx_thread_invites_status`
- `idx_thread_participants_thread_id`, `idx_thread_participants_user_id`, `idx_thread_participants_email`

**Foreign Keys:**
- `threads.user_id` → `users(id)` ON DELETE CASCADE
- `threads.workspace_id` → `workspaces(id)` ON DELETE SET NULL
- `thread_invites.thread_id` → `threads(id)` ON DELETE CASCADE
- `thread_participants.thread_id` → `threads(id)` ON DELETE CASCADE
- `thread_participants.user_id` → `users(id)` ON DELETE SET NULL

**Features:**
- `/i/:token` invite URLs
- AI candidate generation (3 strangers per thread)
- Email invite sending via queue
- Auto-confirmation on acceptance
- Inbox notification to thread owner

**Related APIs:**
- `POST /api/threads` - Create thread
- `GET /i/:token` - View invite page
- `POST /i/:token/accept` - Accept invitation

---

## 🔄 Migration Commands

### Apply Migrations

```bash
# Local development
npx wrangler d1 migrations apply webapp-production --local

# Production
npx wrangler d1 migrations apply webapp-production --remote
```

### List Applied Migrations

```bash
# Local
npx wrangler d1 migrations list webapp-production --local

# Production
npx wrangler d1 migrations list webapp-production --remote
```

### Create New Migration

```bash
# Create new migration file
touch db/migrations/0027_new_feature.sql

# Write SQL
cat > db/migrations/0027_new_feature.sql << 'EOF'
-- Migration 0027: Description
CREATE TABLE new_table (...);
EOF

# Apply locally for testing
npx wrangler d1 migrations apply webapp-production --local

# Apply to production (after testing)
npx wrangler d1 migrations apply webapp-production --remote
```

---

## 📊 Migration Statistics

### Tables by Category

| Category | Tables | Migrations |
|----------|--------|------------|
| Users & Auth | 5 | 0001, 0003 |
| Workspaces | 3 | 0001, 0025 |
| Work Items | 1 | 0001, 0024 |
| Threads & Messages | 5 | 0022, 0026 |
| Lists & Events | 5 | 0002 |
| AI & Monitoring | 5 | 0005, 0006, 0016-0018 |
| Admin | 5 | 0003, 0014 |
| Relationships | 2 | 0008, 0010 |

**Total Tables**: ~30+

### Index Count

Approximate index count: **50+** across all tables

---

## ⚠️ Important Migration Notes

### Breaking Changes

**None in current migrations** - All migrations are additive.

### Data Integrity

- All migrations tested locally before production
- Foreign keys ensure referential integrity
- CHECK constraints validate enum values
- UNIQUE constraints prevent duplicates

### Rollback Strategy

**D1 does not support automatic rollbacks**. If migration fails:

1. **Local**: Delete `.wrangler/state/v3/d1` and re-apply
2. **Production**: Manual SQL to revert (requires backup)

**Best Practice**: Always test migrations locally first.

---

## 🔧 Troubleshooting

### Migration Failed

```bash
# Check migration status
npx wrangler d1 migrations list webapp-production --remote

# View last applied
npx wrangler d1 execute webapp-production \
  --command="SELECT name FROM sqlite_master WHERE type='table'" \
  --remote
```

### Duplicate Migration Number

If migration numbers conflict:
1. Rename file with next available number
2. Update references in code
3. Re-apply migrations

### Foreign Key Errors

If foreign key constraint fails:
1. Check parent table exists
2. Verify parent record exists
3. Ensure ON DELETE/UPDATE clauses are correct

---

## 📈 Future Migrations (Planned)

### Upcoming Features

- **Real-time subscriptions** - WebSocket connections table
- **File attachments** - Attachment metadata table
- **Advanced search** - Full-text search indexes
- **Analytics** - Event tracking tables

---

## 🔍 Migration Validation

### Verify Migration Applied

```bash
# Check table exists
npx wrangler d1 execute webapp-production \
  --command="SELECT sql FROM sqlite_master WHERE name='threads'" \
  --remote

# Verify data
npx wrangler d1 execute webapp-production \
  --command="SELECT COUNT(*) as thread_count FROM threads" \
  --remote
```

### Check Indexes

```bash
npx wrangler d1 execute webapp-production \
  --command="SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='threads'" \
  --remote
```

---

## 📝 Migration Best Practices

1. **Always test locally** before production
2. **One feature per migration** for easy rollback
3. **Add indexes** for frequently queried columns
4. **Use CHECK constraints** for enum validation
5. **Document breaking changes** in migration comments
6. **Backup production data** before major migrations

---

**Last Updated**: 2025-12-25  
**Current Migration**: 0026_threads_and_invites.sql  
**Status**: ✅ All migrations applied (local & production)
