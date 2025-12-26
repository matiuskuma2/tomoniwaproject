# Phase B Implementation Readiness - Summary

## ✅ Completed: Documentation Phase

### 1. Core Specifications (Phase A)
- ✅ **ATTENDANCE_RULE_SCHEMA.md**: 5 rule types (ALL, ANY, K_OF_N, REQUIRED_PLUS_QUORUM, GROUP_ANY)
- ✅ **ATTENDANCE_EVAL_ENGINE.md**: Evaluation algorithm and scoring logic
- ✅ **API_REFERENCE_SCHEDULING.md**: Complete API endpoint specifications
- ✅ **EXTERNAL_INVITE_FLOW.md**: External invite UX flow (Spear/TimeRex style)
- ✅ **MIGRATION_PLAN_TO_ATTENDANCE_ENGINE.md**: Phase A/B/C migration plan

### 2. Phase B/C Planning (NEW)
- ✅ **INTENT_TO_ATTENDANCE_RULE.md**: Natural language → AttendanceRule JSON transformation
- ✅ **PHASE_B_API_INTEGRATION.md**: Complete API implementation guide
  - POST /i/:token/respond (RSVP)
  - GET /api/threads/:id/status (progress check)
  - POST /api/threads/:id/remind (remind pending invitees)
  - POST /api/threads/:id/finalize (manual finalization)
- ✅ **VIDEO_MEETING_AUTOCREATE.md**: Zoom/Google Meet/Teams auto-creation
- ✅ **CALENDAR_INTEGRATION_PLAN.md**: Google Calendar/Outlook integration with availability fetch

### 3. Database Schema (Phase A)
- ✅ **thread_invites.invitee_key**: Unified invitee identification (u:/e:/lm:)
- ✅ **thread_attendance_rules**: AttendanceRule JSON storage
- ✅ **scheduling_slots**: Candidate time slots
- ✅ **thread_selections**: RSVP responses (selected/declined/pending)
- ✅ **thread_finalize**: Finalization results
- ✅ **Migrations**: 0032-0038 applied (local + production)

### 4. AttendanceEngine Service
- ✅ **evaluateRule()**: Slot-by-slot evaluation logic skeleton
- ✅ **suggestBestSlot()**: Recommendation logic
- ✅ **finalizeThread()**: Finalization logic skeleton
- ⚠️ **Status**: Implementation skeleton only - requires full logic implementation

---

## 🎯 Next Steps: Phase B Implementation

### Priority 1: Core RSVP API (CRITICAL)

#### 1.1. POST /i/:token/respond
**Location**: `apps/api/src/routes/external/invite.ts`

**Requirements**:
```typescript
- Validate token (expires_at, already_responded)
- Update thread_invites.status = 'accepted'
- Insert into thread_selections (selected/declined)
- Call AttendanceEngine.evaluateRule()
- Auto-finalize if conditions met
- Notify host via inbox
- Return evaluation result
```

**Dependencies**:
- ✅ thread_selections table
- ✅ AttendanceEngine skeleton
- ⏳ Full evaluation logic implementation
- ⏳ Auto-finalize trigger logic

**Estimated Time**: 4-6 hours

---

#### 1.2. GET /api/threads/:id/status
**Location**: `apps/api/src/routes/threads/status.ts`

**Requirements**:
```typescript
- Fetch thread + slots + invites + selections
- Calculate response counts (pending/selected/declined per slot)
- Call AttendanceEngine.evaluateRule()
- Return comprehensive status + recommendations
```

**Dependencies**:
- ✅ All tables ready
- ⏳ Full evaluation logic

**Estimated Time**: 2-3 hours

---

#### 1.3. POST /api/threads/:id/remind
**Location**: `apps/api/src/routes/threads/remind.ts`

**Requirements**:
```typescript
- Fetch pending invites (status='pending')
- Send reminder emails
- Create inbox notifications
- Track reminder history (optional)
```

**Dependencies**:
- ✅ Email service (sendEmail)
- ✅ Inbox service (createInboxItem)
- ⏳ Reminder email template

**Estimated Time**: 2-3 hours

---

#### 1.4. POST /api/threads/:id/finalize
**Location**: `apps/api/src/routes/threads/finalize.ts`

**Requirements**:
```typescript
- Validate slot_id meets attendance rule
- Insert into thread_finalize
- Update scheduling_threads.status = 'finalized'
- Notify all participants
- (Phase C) Create calendar event
- (Phase C) Generate meeting URL
```

**Dependencies**:
- ✅ AttendanceEngine.evaluateRule()
- ✅ Email/Inbox services
- ⏳ Calendar service (Phase C)
- ⏳ Video meeting service (Phase C)

**Estimated Time**: 3-4 hours

---

### Priority 2: AttendanceEngine Full Implementation

**Location**: `apps/api/src/services/attendanceEngine.ts`

**Current Status**: Skeleton only - needs full logic

**Requirements**:
1. **evaluateRule()** - Complete implementation:
   - ALL: All target invitees selected same slot
   - ANY: At least 1 target invitee selected
   - K_OF_N: At least K of N target invitees selected
   - REQUIRED_PLUS_QUORUM: All required + min_additional selected
   - GROUP_ANY: Any group meets min threshold

2. **suggestBestSlot()** - Scoring algorithm:
   - Score = (selected_count / target_count) * weights
   - Tie-breaker: earliest_slot vs highest_score
   - Consider timezone preferences

3. **finalizeThread()** - Complete workflow:
   - Insert thread_finalize record
   - Update scheduling_threads.status
   - Trigger notifications
   - (Phase C) Create calendar/meeting

**Estimated Time**: 6-8 hours

---

### Priority 3: Thread Creation Integration

**Location**: `apps/api/src/routes/threads/create.ts`

**Current Status**: Creates scheduling_threads only

**Requirements**:
```typescript
// POST /api/threads
1. Parse natural language intent (optional: use AI)
2. Generate AttendanceRule JSON
3. Create thread_attendance_rules record
4. Generate candidate slots (3-5 slots)
   - Option A: Manual slot input
   - Option B: Calendar availability fetch (Phase C)
5. Create scheduling_slots records
6. Generate invites with invitee_key
7. Create thread_invites records
8. Send invite emails with /i/:token links
```

**Dependencies**:
- ⏳ Intent parsing logic (INTENT_TO_ATTENDANCE_RULE.md)
- ⏳ Slot generation logic (manual or calendar-based)
- ✅ Email service

**Estimated Time**: 4-6 hours

---

### Priority 4: Frontend Integration

**Location**: `tomoniwao-frontend` (separate repo)

**Requirements**:
1. **External Invite Page** (`/i/:token`):
   - Display thread title, description
   - List candidate slots with timezone conversion
   - Select multiple slots or decline
   - Submit via POST /i/:token/respond
   - Show success/error messages

2. **Thread Status Dashboard** (for hosts):
   - Display progress chart (pending/selected/declined)
   - Show recommended slot
   - Button to manually finalize
   - Button to send reminders

3. **Thread Creation Flow**:
   - Natural language input or structured form
   - Slot generation (manual or calendar-based)
   - Invitee selection (users, emails, lists)
   - Attendance rule configuration

**Estimated Time**: 8-12 hours

---

## 🚧 Known Issues to Fix

### Issue 1: threads vs scheduling_threads Confusion
**Problem**: `ThreadsRepository` references old `threads` table
**Solution**: 
- Option A: Update ThreadsRepository to use `scheduling_threads`
- Option B: Remove ThreadsRepository, use SQL directly
**Priority**: HIGH
**Estimated Time**: 1-2 hours

---

### Issue 2: invitee_key SHA256 Migration
**Problem**: Current backfill uses `e:<email>` (plaintext)
**Solution**: Update backfill to use `e:<sha256_16(lowercase(email))>`
**Priority**: MEDIUM (security concern)
**Estimated Time**: 1 hour

---

### Issue 3: AI Usage Aggregation NULL Safety
**Problem**: Admin dashboard shows 0 for AI usage
**Solution**: Add COALESCE() to aggregation queries
**Priority**: LOW (monitoring only)
**Estimated Time**: 30 minutes

---

## 📊 Implementation Timeline (Estimated)

| Task | Priority | Time | Dependencies |
|------|----------|------|--------------|
| Fix threads/scheduling_threads | HIGH | 2h | None |
| AttendanceEngine full logic | HIGH | 8h | None |
| POST /i/:token/respond | HIGH | 6h | AttendanceEngine |
| GET /api/threads/:id/status | HIGH | 3h | AttendanceEngine |
| POST /api/threads/:id/remind | MEDIUM | 3h | Email templates |
| POST /api/threads/:id/finalize | MEDIUM | 4h | AttendanceEngine |
| Thread creation integration | MEDIUM | 6h | AttendanceEngine |
| invitee_key SHA256 fix | MEDIUM | 1h | None |
| Frontend: External invite page | HIGH | 6h | RSVP API |
| Frontend: Thread status dashboard | MEDIUM | 4h | Status API |
| Frontend: Thread creation flow | LOW | 8h | Thread creation API |
| AI usage aggregation fix | LOW | 0.5h | None |

**Total Estimated Time**: 51.5 hours (≈ 1.5 weeks for 1 developer)

---

## 🎯 Recommended Next Action

### Immediate (Today):
1. ✅ Fix threads/scheduling_threads confusion
2. ✅ Implement full AttendanceEngine logic
3. ✅ Implement POST /i/:token/respond

### Short-term (This Week):
4. Implement GET /api/threads/:id/status
5. Implement POST /api/threads/:id/remind
6. Implement POST /api/threads/:id/finalize
7. Frontend: External invite page

### Medium-term (Next Week):
8. Thread creation integration
9. Frontend: Thread status dashboard
10. invitee_key SHA256 migration

---

## 📚 Documentation Status

| Document | Status | Purpose |
|----------|--------|---------|
| ATTENDANCE_RULE_SCHEMA.md | ✅ Complete | Rule type definitions |
| ATTENDANCE_EVAL_ENGINE.md | ✅ Complete | Evaluation algorithm |
| API_REFERENCE_SCHEDULING.md | ✅ Complete | API specs |
| EXTERNAL_INVITE_FLOW.md | ✅ Complete | UX flow |
| MIGRATION_PLAN_TO_ATTENDANCE_ENGINE.md | ✅ Complete | Migration plan |
| INTENT_TO_ATTENDANCE_RULE.md | ✅ Complete | Natural language parsing |
| PHASE_B_API_INTEGRATION.md | ✅ Complete | Implementation guide |
| VIDEO_MEETING_AUTOCREATE.md | ✅ Complete | Phase C: Video meetings |
| CALENDAR_INTEGRATION_PLAN.md | ✅ Complete | Phase C: Calendar sync |

---

## 🔐 Security Checklist (Before Production)

- ⏳ Implement rate limiting on /i/:token/respond (prevent spam)
- ⏳ Add CSRF protection for authenticated APIs
- ⏳ Encrypt calendar OAuth tokens in database
- ⏳ Implement invitee_key SHA256 hashing
- ⏳ Add audit logging for finalization actions
- ⏳ Set up monitoring for failed email deliveries

---

## 🚀 Deployment Checklist

- ✅ Local migrations applied (0032-0038)
- ✅ Production migrations applied (0032-0038)
- ✅ AttendanceEngine service created
- ⏳ Phase B APIs implemented
- ⏳ Frontend deployed to Cloudflare Pages
- ⏳ Environment variables configured (email, OAuth, etc.)
- ⏳ Monitoring dashboards set up
- ⏳ Error tracking configured (Sentry or similar)

---

## 💡 Questions to Clarify

1. **Slot Generation**: Manual input or calendar-based availability fetch?
   - Manual: Simpler, faster to implement
   - Calendar: Better UX, requires Google OAuth setup

2. **Auto-Finalize Delay**: How long to wait before auto-finalizing?
   - Current default: 3600s (1 hour)
   - Recommendation: Configurable per thread (1h - 24h)

3. **Email Provider**: Which service to use?
   - SendGrid (popular, easy)
   - Resend (modern, good DX)
   - AWS SES (cost-effective for high volume)

4. **Frontend Repository**: Separate repo or monorepo?
   - Separate: Recommended (tomoniwao-frontend)
   - Monorepo: Possible with turborepo/nx

---

## 📞 Next Steps - Your Decision

Please choose which priority to tackle first:

**Option A: Backend-First (Recommended)**
→ Implement AttendanceEngine + RSVP APIs first
→ Then build frontend to consume APIs

**Option B: Full-Stack Feature-by-Feature**
→ Implement RSVP API + External invite page together
→ Then move to next feature

**Option C: Fix Critical Issues First**
→ Fix threads/scheduling_threads confusion
→ Then proceed with Phase B implementation

Which option would you like to proceed with? 🚀
