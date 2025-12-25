# API Reference Documentation

## 🌐 Base URLs

**Production**: `https://webapp.snsrilarc.workers.dev`  
**Local Development**: `http://localhost:3000`

---

## 🔐 Authentication

### Development Mode (ENVIRONMENT=development)

Uses `x-user-id` header for testing:

```bash
curl -H "x-user-id: user-alice" https://webapp.snsrilarc.workers.dev/api/endpoint
```

### Production Mode (ENVIRONMENT=production)

Uses Bearer token authentication (TODO: JWT implementation):

```bash
curl -H "Authorization: Bearer <token>" https://webapp.snsrilarc.workers.dev/api/endpoint
```

**Current Status**: Production uses development mode (`ENVIRONMENT=development`) for Phase 2 testing.

---

## 📋 API Endpoints

### Health Check

#### GET /health

Check service status.

**Request:**
```bash
curl https://webapp.snsrilarc.workers.dev/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1766662374,
  "environment": "development"
}
```

---

## 🔑 OTP Service (Ticket 05)

### POST /api/otp/send

Send OTP code via email.

**Rate Limit:**
- 3 requests per 10 minutes (by email)
- 10 requests per 10 minutes (by IP)

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/otp/send \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "purpose": "email_verify"
  }'
```

**Parameters:**
- `email` (string, required): Recipient email
- `purpose` (string, required): One of:
  - `email_verify` - Email verification
  - `password_reset` - Password reset
  - `invite_accept` - Accept invitation
  - `login` - Login verification

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "expires_in": 600
}
```

### POST /api/otp/verify

Verify OTP code.

**Rate Limit:** 5 requests per 10 minutes (by email)

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "purpose": "email_verify",
    "code": "123456"
  }'
```

**Response:**
```json
{
  "valid": true,
  "message": "OTP verified successfully"
}
```

**Error Response:**
```json
{
  "valid": false,
  "message": "Invalid or expired OTP"
}
```

---

## 📝 Work Items API (Ticket 07)

### POST /api/work-items

Create a new work item (task or scheduled event).

**Rate Limit:** 50 requests per hour (by user)

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/work-items \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{
    "type": "scheduled",
    "title": "Team Meeting",
    "description": "Weekly sync meeting",
    "start_at": "2025-12-26T14:00:00Z",
    "end_at": "2025-12-26T15:00:00Z",
    "location": "Conference Room A",
    "visibility_scope": "room"
  }'
```

**Parameters:**
- `type` (string, required): 'task' or 'scheduled'
- `title` (string, required): Work item title
- `description` (string, optional): Detailed description
- `start_at` (string, optional): ISO 8601 datetime (required for scheduled)
- `end_at` (string, optional): ISO 8601 datetime
- `location` (string, optional): Location/meeting place
- `visibility_scope` (string, optional): 'private', 'room', 'quest', 'squad' (default: 'private')
- `room_id` (string, optional): Associated room ID

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user-alice",
  "type": "scheduled",
  "title": "Team Meeting",
  "status": "pending",
  "created_at": "2025-12-25T10:00:00Z"
}
```

### GET /api/work-items

List user's work items.

**Request:**
```bash
curl -H "x-user-id: user-alice" \
  "https://webapp.snsrilarc.workers.dev/api/work-items?status=pending&limit=10"
```

**Query Parameters:**
- `status` (string, optional): 'pending', 'completed', 'cancelled'
- `type` (string, optional): 'task', 'scheduled'
- `limit` (number, optional): Default 50, max 100
- `offset` (number, optional): For pagination

**Response:**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "scheduled",
      "title": "Team Meeting",
      "status": "pending",
      "start_at": "2025-12-26T14:00:00Z"
    }
  ],
  "total": 1
}
```

### GET /api/work-items/:id

Get work item details.

**Request:**
```bash
curl -H "x-user-id: user-alice" \
  https://webapp.snsrilarc.workers.dev/api/work-items/550e8400-e29b-41d4-a716-446655440000
```

### PATCH /api/work-items/:id

Update work item.

**Request:**
```bash
curl -X PATCH https://webapp.snsrilarc.workers.dev/api/work-items/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{
    "status": "completed",
    "title": "Updated Title"
  }'
```

### DELETE /api/work-items/:id

Delete work item.

**Request:**
```bash
curl -X DELETE https://webapp.snsrilarc.workers.dev/api/work-items/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-user-id: user-alice"
```

---

## 🎤 Voice Commands API (Ticket 08)

### POST /api/voice/execute

Execute voice command with AI intent parsing.

**Rate Limit:** 20 requests per minute (by user)

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/voice/execute \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{
    "text": "明日の午後2時にチームミーティングをみんなで共有したい"
  }'
```

**Parameters:**
- `text` (string, required): Voice command text (natural language)

**Response:**
```json
{
  "intent": "create",
  "share_intent": "explicit",
  "confidence": 0.9,
  "result": {
    "action": "created",
    "work_item": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "scheduled",
      "title": "チームミーティング",
      "start_at": "2025-12-26T14:00:00Z"
    },
    "message": "Created scheduled: チームミーティング"
  }
}
```

**Supported Intents:**
- `create` - Create new work item
- `modify` - Update work item status
- `undo` - Delete most recent work item
- `query` - List pending work items

**Share Intent Detection:**
- `explicit` - Clear sharing intention ("みんなで", "共有したい")
- `uncertain` - Ambiguous ("どう思う?", "意見を聞きたい")
- `none` - Private task (no sharing keywords)

**AI Processing:**
1. Primary: Gemini-2.0-flash-exp
2. Fallback: GPT-4o-mini (OpenAI)
3. Final Fallback: Pattern matching
4. All attempts logged to `ai_usage_logs`

---

## 💬 Threads API (Ticket 10)

### POST /api/threads

Create conversation thread with AI-generated candidate invitations.

**Rate Limit:** 10 requests per minute (by user)

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/threads \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{
    "title": "AI技術について語りたい",
    "description": "最新のAI技術トレンドや実装事例について意見交換"
  }'
```

**Parameters:**
- `title` (string, required): Thread title
- `description` (string, optional): Thread description

**Response:**
```json
{
  "thread": {
    "id": "279cc47b-128f-42aa-b892-a4a5169b9060",
    "title": "AI技術について語りたい",
    "status": "active",
    "created_at": "2025-12-25T10:00:00Z"
  },
  "candidates": [
    {
      "name": "Alex Johnson",
      "email": "alex.johnson.1766661491364@example.com",
      "reason": "Experienced professional with diverse perspectives on the topic.",
      "invite_token": "3CYaapgjMddvcvQjgbyZKJUP9Tc6rJ0E",
      "invite_url": "https://webapp.snsrilarc.workers.dev/i/3CYaapgjMddvcvQjgbyZKJUP9Tc6rJ0E"
    },
    {
      "name": "Maria Garcia",
      "email": "maria.garcia.1766661491364@example.com",
      "reason": "Creative thinker with international background.",
      "invite_token": "n29UlJZ06nUXjpfsMCVctlKaKb828ofv",
      "invite_url": "https://webapp.snsrilarc.workers.dev/i/n29UlJZ06nUXjpfsMCVctlKaKb828ofv"
    },
    {
      "name": "David Chen",
      "email": "david.chen.1766661491364@example.com",
      "reason": "Technical expert with strong communication skills.",
      "invite_token": "l3dWywPwiElL70iRFfCKUTGr8MnJRrLA",
      "invite_url": "https://webapp.snsrilarc.workers.dev/i/l3dWywPwiElL70iRFfCKUTGr8MnJRrLA"
    }
  ],
  "message": "Thread created with 3 candidate invitations sent"
}
```

**Process:**
1. Create thread in `threads` table
2. Generate 3 candidates (currently fallback, AI integration TODO)
3. Create invite tokens in `thread_invites` table
4. Send invite emails via `email-queue`
5. Return thread details + invite URLs

---

## 🔗 External Invite Routes (Ticket 10)

### GET /i/:token

View invite page (for strangers).

**Request:**
```bash
curl https://webapp.snsrilarc.workers.dev/i/3CYaapgjMddvcvQjgbyZKJUP9Tc6rJ0E
```

**Response:** HTML page with:
- Thread title and description
- Candidate selection reason
- Accept/Decline buttons
- Expiration notice (72 hours)

**Status Handling:**
- 404: Token not found
- Expired: Token past `expires_at`
- Already Processed: Status != 'pending'

### POST /i/:token/accept

Accept invitation.

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/i/3CYaapgjMddvcvQjgbyZKJUP9Tc6rJ0E/accept \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "Invitation accepted",
  "thread": {
    "id": "279cc47b-128f-42aa-b892-a4a5169b9060",
    "title": "AI技術について語りたい"
  }
}
```

**Process:**
1. Validate token (exists, pending, not expired)
2. Update `thread_invites.status = 'accepted'`
3. Add participant to `thread_participants`
4. Create inbox notification for thread owner (`inbox_items` type='scheduling_invite')

---

## 🚦 Rate Limiting

### Rate Limit Headers

All rate-limited endpoints return headers:

```http
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 19
X-RateLimit-Reset: 1766662974
```

### Rate Limit Response (429)

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for otp_send. Try again later.",
  "reset_at": 1766662974
}
```

### Rate Limit Configuration

| Action | Scope | Limit | Window |
|--------|-------|-------|--------|
| `otp_send` | email | 3 | 10 minutes |
| `otp_send_ip` | IP | 10 | 10 minutes |
| `otp_try` | email | 5 | 10 minutes |
| `voice_execute` | user | 20 | 1 minute |
| `thread_create` | user | 10 | 1 minute |
| `work_item_create` | user | 50 | 1 hour |

---

## 📊 Admin Routes

### System Settings (Super Admin Only)

#### GET /admin/system/settings

List all system settings.

#### PUT /admin/system/settings/:key

Update system setting.

### AI Cost Center (Admin Read, Super Admin Write)

#### GET /admin/ai/usage

Get AI usage statistics.

**Query Parameters:**
- `start_date` (string): ISO 8601 date
- `end_date` (string): ISO 8601 date
- `provider` (string): 'gemini' or 'openai'
- `user_id` (string): Filter by user

#### GET /admin/ai/provider-settings

Get AI provider configuration.

---

## 🧪 Test Routes (Development Only)

Available only when `ENVIRONMENT=development`.

### GET /test/rate-limit/check

Test rate limiting.

### POST /test/rate-limit/reset

Reset rate limits.

---

## ❌ Error Responses

### Standard Error Format

```json
{
  "error": "Error Title",
  "message": "Detailed error description",
  "details": "Additional context (dev mode only)"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request (invalid input) |
| 401 | Unauthorized (auth required) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

---

## 🔍 Testing Examples

### Local Testing

```bash
# Health check
curl http://localhost:3000/health

# Create work item
curl -X POST http://localhost:3000/api/work-items \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{"type":"task","title":"Test Task"}'

# Voice command
curl -X POST http://localhost:3000/api/voice/execute \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{"text":"明日の午後2時にミーティング"}'

# Create thread
curl -X POST http://localhost:3000/api/threads \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{"title":"Test Thread"}'
```

### Production Testing

Replace `http://localhost:3000` with `https://webapp.snsrilarc.workers.dev`.

---

## 📝 Request/Response Examples

### Work Item Creation (Full Example)

**Request:**
```bash
curl -X POST https://webapp.snsrilarc.workers.dev/api/work-items \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-alice" \
  -d '{
    "type": "scheduled",
    "title": "Product Launch Meeting",
    "description": "Discuss Q1 product launch strategy and timeline",
    "start_at": "2025-12-26T09:00:00Z",
    "end_at": "2025-12-26T10:30:00Z",
    "location": "Conference Room B",
    "visibility_scope": "squad"
  }'
```

**Response:**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "user_id": "user-alice",
  "room_id": null,
  "type": "scheduled",
  "title": "Product Launch Meeting",
  "description": "Discuss Q1 product launch strategy and timeline",
  "start_at": "2025-12-26T09:00:00Z",
  "end_at": "2025-12-26T10:30:00Z",
  "all_day": 0,
  "recurrence_rule": null,
  "location": "Conference Room B",
  "visibility": "private",
  "visibility_scope": "squad",
  "status": "pending",
  "google_event_id": null,
  "source": "manual",
  "created_at": "2025-12-25T10:00:00.000Z",
  "updated_at": "2025-12-25T10:00:00.000Z"
}
```

---

**Last Updated**: 2025-12-25  
**API Version**: Phase 2 (Tickets 01-10)
