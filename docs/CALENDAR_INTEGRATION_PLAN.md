# Calendar Integration Plan

## Overview

カレンダー統合により、以下の機能を実現します：

1. **空き時間取得**: ホストのカレンダーから空き時間を自動抽出して候補日時を生成
2. **イベント作成**: 確定後、自動的にカレンダーイベントを作成
3. **重複防止**: 既存イベントとの重複を回避
4. **イベント同期**: 更新/キャンセル時にカレンダーも同期

**対応カレンダー**:
- Phase B: Google Calendar（ホストのみ）
- Phase C: Outlook/Microsoft Graph、複数カレンダー同期

---

## Roles and Responsibilities

### Calendar API
- **空き時間取得** (`freebusy` クエリ)
- **イベント作成/更新/削除**
- **会議URL自動生成**（Google Meet）

### Database (tomoniwao)
- **排他制御**: 同時確定による重複防止
- **イベントID保存**: 外部カレンダーとの紐付け
- **タイムゾーン管理**: ユーザーごとのタイムゾーン保持

### Attendance Engine
- **最終決定**: どのSlotを確定するか
- **参加者リスト**: 誰をカレンダー招待に含めるか

### Email/Inbox Service
- **通知**: カレンダーイベント作成後の通知
- **iCal添付**: メールにiCalファイルを添付

---

## Phase B: Google Calendar Only (Host)

### 1. Prerequisites

#### Google Cloud Project Setup
1. Google Cloud Consoleでプロジェクト作成
2. Google Calendar API有効化
3. OAuth 2.0クライアントID作成（Web application）
4. スコープ設定:
   ```
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/calendar.events
   ```

#### Environment Variables
```bash
GOOGLE_CALENDAR_CLIENT_ID=xxx
GOOGLE_CALENDAR_CLIENT_SECRET=xxx
GOOGLE_CALENDAR_REDIRECT_URI=https://your-app.pages.dev/auth/google/callback
```

---

### 2. OAuth Flow (Host Authorization)

#### Step 1: Authorization URL生成
```typescript
// GET /api/calendar/authorize
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${GOOGLE_CALENDAR_CLIENT_ID}` +
  `&redirect_uri=${GOOGLE_CALENDAR_REDIRECT_URI}` +
  `&response_type=code` +
  `&scope=https://www.googleapis.com/auth/calendar.readonly%20https://www.googleapis.com/auth/calendar.events` +
  `&access_type=offline` +
  `&prompt=consent`;

return c.redirect(authUrl);
```

#### Step 2: Callback処理
```typescript
// GET /auth/google/callback?code=xxx
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: c.req.query('code'),
    client_id: GOOGLE_CALENDAR_CLIENT_ID,
    client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
    redirect_uri: GOOGLE_CALENDAR_REDIRECT_URI,
    grant_type: 'authorization_code'
  })
});

const { access_token, refresh_token } = await tokenResponse.json();

// Save to DB (暗号化して保存)
await db.insert(user_calendar_tokens).values({
  user_id,
  provider: 'google',
  access_token: encrypt(access_token),
  refresh_token: encrypt(refresh_token),
  expires_at: new Date(Date.now() + 3600 * 1000)
});
```

#### Step 3: Token Refresh
```typescript
async function refreshGoogleToken(user_id: number) {
  const token = await db.select().from(user_calendar_tokens)
    .where(and(
      eq(user_calendar_tokens.user_id, user_id),
      eq(user_calendar_tokens.provider, 'google')
    ));

  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: JSON.stringify({
      refresh_token: decrypt(token.refresh_token),
      client_id: GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: GOOGLE_CALENDAR_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });

  const { access_token, expires_in } = await refreshResponse.json();

  await db.update(user_calendar_tokens)
    .set({
      access_token: encrypt(access_token),
      expires_at: new Date(Date.now() + expires_in * 1000)
    })
    .where(eq(user_calendar_tokens.id, token.id));

  return access_token;
}
```

---

### 3. Availability Fetch (空き時間取得)

#### API: FreeBusy Query

```typescript
// POST /api/calendar/freebusy
async function getAvailability(
  user_id: number,
  start: Date,
  end: Date
): Promise<AvailabilityResult> {
  const accessToken = await getAccessToken(user_id); // refresh if expired

  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: 'primary' }]
      })
    }
  );

  const data = await response.json();
  return data.calendars.primary.busy; // Array of { start, end }
}
```

#### Response Example
```json
{
  "calendars": {
    "primary": {
      "busy": [
        {
          "start": "2025-12-30T09:00:00Z",
          "end": "2025-12-30T10:00:00Z"
        },
        {
          "start": "2025-12-30T14:00:00Z",
          "end": "2025-12-30T15:00:00Z"
        }
      ]
    }
  }
}
```

#### Slot Generation Logic
```typescript
function generateAvailableSlots(
  busyPeriods: { start: Date; end: Date }[],
  workingHours: { start: number; end: number }, // e.g., { start: 9, end: 18 }
  duration: number, // minutes
  count: number // 候補数
): Slot[] {
  const slots: Slot[] = [];
  let currentDate = new Date();

  for (let day = 0; day < 14; day++) { // 2週間分探索
    const dayStart = new Date(currentDate);
    dayStart.setHours(workingHours.start, 0, 0, 0);
    const dayEnd = new Date(currentDate);
    dayEnd.setHours(workingHours.end, 0, 0, 0);

    let slotStart = dayStart;

    while (slotStart < dayEnd && slots.length < count) {
      const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

      // Check if slot conflicts with busy periods
      const hasConflict = busyPeriods.some(busy =>
        slotStart < new Date(busy.end) && slotEnd > new Date(busy.start)
      );

      if (!hasConflict) {
        slots.push({
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString()
        });
      }

      slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000); // 30分間隔
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return slots.slice(0, count);
}
```

---

### 4. Event Creation (確定時)

#### API: Create Calendar Event

```typescript
async function createCalendarEvent(
  user_id: number,
  thread: Thread,
  slot: Slot,
  participants: Participant[]
): Promise<CalendarEvent> {
  const accessToken = await getAccessToken(user_id);

  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: thread.title,
        description: thread.description || '',
        start: {
          dateTime: slot.start_time,
          timeZone: 'Asia/Tokyo'
        },
        end: {
          dateTime: slot.end_time,
          timeZone: 'Asia/Tokyo'
        },
        attendees: participants.map(p => ({ email: p.email })),
        conferenceData: {
          createRequest: {
            requestId: `thread-${thread.id}-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1日前
            { method: 'popup', minutes: 10 }       // 10分前
          ]
        }
      })
    }
  );

  const event = await response.json();

  // Save event_id to DB
  await db.update(scheduling_threads)
    .set({
      calendar_event_id: event.id,
      calendar_provider: 'google',
      meeting_join_url: event.conferenceData?.entryPoints[0]?.uri
    })
    .where(eq(scheduling_threads.id, thread.id));

  return event;
}
```

---

### 5. Exclusive Locking (重複防止)

#### Problem
複数の招待者が同時に回答し、複数のSlotが同時に確定される可能性がある。

#### Solution: Database Transaction with SELECT FOR UPDATE

```typescript
async function finalizeThreadWithLock(
  thread_id: number,
  slot_id: number
): Promise<FinalizeResult> {
  return await db.transaction(async (tx) => {
    // 1. Lock thread (排他ロック)
    const thread = await tx.select()
      .from(scheduling_threads)
      .where(eq(scheduling_threads.id, thread_id))
      .for('update'); // PostgreSQL/MySQL: FOR UPDATE, SQLite: exclusive lock

    if (thread.status === 'finalized') {
      throw new Error('Thread already finalized');
    }

    // 2. Finalize
    await tx.insert(thread_finalize).values({
      thread_id,
      finalized_slot_id: slot_id,
      finalized_at: new Date()
    });

    await tx.update(scheduling_threads)
      .set({ status: 'finalized' })
      .where(eq(scheduling_threads.id, thread_id));

    // 3. Create calendar event
    const event = await createCalendarEvent(thread, slot, participants);

    return { thread, slot, event };
  });
}
```

**重要**: Cloudflare D1 (SQLite) はトランザクション内の排他ロックをサポートしていますが、`FOR UPDATE` 構文はありません。代わりに、`BEGIN EXCLUSIVE` を使用します。

```sql
BEGIN EXCLUSIVE TRANSACTION;
SELECT * FROM scheduling_threads WHERE id = ?;
-- Check status
UPDATE scheduling_threads SET status = 'finalized' WHERE id = ?;
COMMIT;
```

---

### 6. Event Updates and Cancellations

#### Update Event (日程変更)
```typescript
async function updateCalendarEvent(
  user_id: number,
  thread_id: number,
  new_slot: Slot
): Promise<void> {
  const thread = await db.select().from(scheduling_threads)
    .where(eq(scheduling_threads.id, thread_id));

  if (!thread.calendar_event_id) {
    throw new Error('No calendar event found');
  }

  const accessToken = await getAccessToken(user_id);

  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${thread.calendar_event_id}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        start: {
          dateTime: new_slot.start_time,
          timeZone: 'Asia/Tokyo'
        },
        end: {
          dateTime: new_slot.end_time,
          timeZone: 'Asia/Tokyo'
        }
      })
    }
  );
}
```

#### Cancel Event (キャンセル)
```typescript
async function cancelCalendarEvent(
  user_id: number,
  thread_id: number
): Promise<void> {
  const thread = await db.select().from(scheduling_threads)
    .where(eq(scheduling_threads.id, thread_id));

  if (!thread.calendar_event_id) {
    return; // No event to cancel
  }

  const accessToken = await getAccessToken(user_id);

  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${thread.calendar_event_id}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  await db.update(scheduling_threads)
    .set({ calendar_event_id: null })
    .where(eq(scheduling_threads.id, thread_id));
}
```

---

### 7. Webhook Integration (Phase C)

#### Google Calendar Webhooks
1. **Push Notifications**: カレンダー変更時に通知を受け取る
2. **Sync Token**: 差分同期で効率化

```typescript
// POST /api/webhooks/google-calendar
app.post('/api/webhooks/google-calendar', async (c) => {
  const notification = await c.req.json();

  // Verify webhook signature
  const signature = c.req.header('X-Goog-Channel-ID');

  // Fetch updated events
  const accessToken = await getAccessToken(user_id);
  const events = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?syncToken=${lastSyncToken}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }
  );

  // Update local DB
  for (const event of events.items) {
    await syncCalendarEvent(event);
  }

  return c.json({ success: true });
});
```

---

## Phase C: Multi-Calendar Sync

### 1. Outlook/Microsoft Graph

#### OAuth Flow
```
https://login.microsoftonline.com/common/oauth2/v2.0/authorize?
  client_id=xxx
  &response_type=code
  &redirect_uri=xxx
  &scope=Calendars.ReadWrite
```

#### FreeBusy Query
```typescript
POST https://graph.microsoft.com/v1.0/me/calendar/getSchedule
{
  "schedules": ["user@example.com"],
  "startTime": { "dateTime": "2025-12-30T00:00:00", "timeZone": "Asia/Tokyo" },
  "endTime": { "dateTime": "2025-12-31T23:59:59", "timeZone": "Asia/Tokyo" }
}
```

#### Create Event
```typescript
POST https://graph.microsoft.com/v1.0/me/events
{
  "subject": "プロジェクトキックオフ",
  "start": { "dateTime": "2025-12-30T10:00:00", "timeZone": "Asia/Tokyo" },
  "end": { "dateTime": "2025-12-30T11:00:00", "timeZone": "Asia/Tokyo" },
  "attendees": [
    { "emailAddress": { "address": "participant@example.com" } }
  ]
}
```

---

### 2. Multiple Calendar Sources

#### user_calendar_tokens テーブル拡張
```sql
ALTER TABLE user_calendar_tokens ADD COLUMN calendar_id TEXT DEFAULT 'primary';
ALTER TABLE user_calendar_tokens ADD COLUMN is_default BOOLEAN DEFAULT false;
```

#### Aggregate Availability
```typescript
async function getAggregatedAvailability(
  user_id: number,
  start: Date,
  end: Date
): Promise<AvailabilityResult> {
  const tokens = await db.select().from(user_calendar_tokens)
    .where(eq(user_calendar_tokens.user_id, user_id));

  const allBusyPeriods: BusyPeriod[] = [];

  for (const token of tokens) {
    if (token.provider === 'google') {
      const busy = await getGoogleAvailability(token, start, end);
      allBusyPeriods.push(...busy);
    } else if (token.provider === 'microsoft') {
      const busy = await getMicrosoftAvailability(token, start, end);
      allBusyPeriods.push(...busy);
    }
  }

  // Merge overlapping periods
  return mergeOverlappingPeriods(allBusyPeriods);
}
```

---

## MVP vs Phase C

### MVP (Phase B)
- ✅ Google Calendar統合（ホストのみ）
- ✅ 空き時間取得 → Slot生成
- ✅ 確定時にイベント作成
- ✅ Google Meet自動生成

### Phase C
- ⏳ Outlook/Microsoft Graph統合
- ⏳ 複数カレンダー同期
- ⏳ Webhook統合（リアルタイム同期）
- ⏳ 参加者のカレンダーにも自動登録
- ⏳ タイムゾーン自動変換

---

## Summary

**Phase B (MVP):**
- Google Calendar統合（ホストのみ）
- FreeBusyクエリで空き時間取得
- 確定時に自動でイベント作成
- 排他制御で重複防止

**Phase C:**
- Outlook統合
- 複数カレンダー同期
- Webhook統合
- 参加者カレンダーへの自動登録

**Next Steps:**
1. Google OAuth設定
2. `calendarService.ts` 実装
3. Slot生成ロジック追加
4. 確定フックにイベント作成追加
