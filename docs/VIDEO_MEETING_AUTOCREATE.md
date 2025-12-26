# Video Meeting Auto-Creation Specification

## Overview

日程が確定した際に、自動的にビデオ会議URLを生成する機能の仕様を定義します。

**対応プラットフォーム**:
- Zoom
- Google Meet
- Microsoft Teams（Phase C）

**目標**:
1. Thread確定時に自動でビデオ会議URLを生成
2. 招待者へのメール通知にURL含める
3. カレンダーイベントにURL反映
4. ダッシュボードで会議情報を表示
5. 会議の更新/キャンセルに対応

---

## Roles and Responsibilities

### Product Core (tomoniwao)
- Thread確定時のフック処理
- 会議URL保存（`scheduling_threads` テーブル）
- メール/Inbox通知への会議情報埋め込み
- ダッシュボード表示

### External Services
- **Zoom API**: 会議作成/更新/削除
- **Google Calendar API**: Google Meetリンク生成（カレンダーイベント作成時に自動生成）
- **Microsoft Graph API**: Teams会議作成（Phase C）

---

## Data Model Extensions

### scheduling_threads テーブル拡張

```sql
ALTER TABLE scheduling_threads ADD COLUMN meeting_type TEXT DEFAULT NULL;
ALTER TABLE scheduling_threads ADD COLUMN meeting_provider TEXT DEFAULT NULL;
ALTER TABLE scheduling_threads ADD COLUMN meeting_join_url TEXT DEFAULT NULL;
ALTER TABLE scheduling_threads ADD COLUMN meeting_external_id TEXT DEFAULT NULL;
ALTER TABLE scheduling_threads ADD COLUMN meeting_password TEXT DEFAULT NULL;
ALTER TABLE scheduling_threads ADD COLUMN meeting_created_at DATETIME DEFAULT NULL;

-- Index for external_id lookup
CREATE INDEX idx_threads_meeting_external_id 
ON scheduling_threads(meeting_external_id);
```

### フィールド定義

| フィールド | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `meeting_type` | TEXT | 会議の種類 | `online`, `offline`, `hybrid` |
| `meeting_provider` | TEXT | プロバイダー | `zoom`, `google_meet`, `teams` |
| `meeting_join_url` | TEXT | 参加URL | `https://zoom.us/j/123456789` |
| `meeting_external_id` | TEXT | 外部サービスの会議ID | `123456789` (Zoom), `abc-def-ghi` (Meet) |
| `meeting_password` | TEXT | 会議パスワード | `abc123` (Zoom) |
| `meeting_created_at` | DATETIME | 会議作成日時 | `2025-12-26T12:00:00Z` |

---

## Finalize Hook Sequence

### Phase B (MVP): Thread確定時の処理フロー

```
1. AttendanceEngine.finalizeThread(thread_id, slot_id)
   ↓
2. thread_finalize レコード作成
   ↓
3. scheduling_threads.status = 'finalized' 更新
   ↓
4. ★ Video Meeting Creation (if meeting_type='online')
   ↓
   4.1. Zoom/Meet/Teams API呼び出し
   4.2. meeting_join_url, meeting_external_id 保存
   ↓
5. Calendar Event Creation (Phase C)
   ↓
   5.1. Google Calendar API
   5.2. meeting_join_url をカレンダーに含める
   ↓
6. Email Notification (全招待者へ)
   ↓
   6.1. 確定日時
   6.2. 会議参加URL
   6.3. カレンダー招待 (iCal添付)
   ↓
7. Inbox Notification (登録ユーザーへ)
```

---

## Zoom Integration

### Prerequisites
1. Zoom OAuth App作成（Server-to-Server OAuth）
2. 環境変数設定:
   ```bash
   ZOOM_ACCOUNT_ID=xxx
   ZOOM_CLIENT_ID=xxx
   ZOOM_CLIENT_SECRET=xxx
   ```

### API: Create Meeting

#### Request
```typescript
POST https://api.zoom.us/v2/users/me/meetings
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "topic": "プロジェクトキックオフ",
  "type": 2, // Scheduled meeting
  "start_time": "2025-12-30T10:00:00Z",
  "duration": 60,
  "timezone": "Asia/Tokyo",
  "settings": {
    "host_video": true,
    "participant_video": true,
    "join_before_host": false,
    "mute_upon_entry": false,
    "waiting_room": true,
    "auto_recording": "none"
  }
}
```

#### Response
```json
{
  "id": 123456789,
  "join_url": "https://zoom.us/j/123456789?pwd=abcdef",
  "password": "abc123",
  "start_url": "https://zoom.us/s/123456789?zak=...",
  "host_email": "host@example.com"
}
```

#### Save to DB
```typescript
await db.update(scheduling_threads)
  .set({
    meeting_provider: 'zoom',
    meeting_join_url: response.join_url,
    meeting_external_id: response.id.toString(),
    meeting_password: response.password,
    meeting_created_at: new Date()
  })
  .where(eq(scheduling_threads.id, thread_id));
```

---

## Google Meet Integration

### Prerequisites
1. Google Cloud Project作成
2. Google Calendar API有効化
3. OAuth 2.0認証設定

### API: Create Calendar Event with Meet

Google Meetは**カレンダーイベント作成時に自動生成**されます。

#### Request
```typescript
POST https://www.googleapis.com/calendar/v3/calendars/primary/events
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "summary": "プロジェクトキックオフ",
  "description": "詳細説明",
  "start": {
    "dateTime": "2025-12-30T10:00:00+09:00",
    "timeZone": "Asia/Tokyo"
  },
  "end": {
    "dateTime": "2025-12-30T11:00:00+09:00",
    "timeZone": "Asia/Tokyo"
  },
  "attendees": [
    {"email": "participant1@example.com"},
    {"email": "participant2@example.com"}
  ],
  "conferenceData": {
    "createRequest": {
      "requestId": "unique-request-id",
      "conferenceSolutionKey": {
        "type": "hangoutsMeet"
      }
    }
  }
}
```

**重要**: `?conferenceDataVersion=1` クエリパラメータが必須。

#### Response
```json
{
  "id": "event123",
  "htmlLink": "https://calendar.google.com/event?eid=xxx",
  "conferenceData": {
    "conferenceId": "abc-def-ghi",
    "entryPoints": [
      {
        "entryPointType": "video",
        "uri": "https://meet.google.com/abc-def-ghi",
        "label": "meet.google.com/abc-def-ghi"
      }
    ]
  }
}
```

#### Save to DB
```typescript
const meetUrl = response.conferenceData.entryPoints.find(
  ep => ep.entryPointType === 'video'
)?.uri;

await db.update(scheduling_threads)
  .set({
    meeting_provider: 'google_meet',
    meeting_join_url: meetUrl,
    meeting_external_id: response.conferenceData.conferenceId,
    meeting_created_at: new Date()
  })
  .where(eq(scheduling_threads.id, thread_id));
```

---

## Microsoft Teams Integration (Phase C)

### API: Create Online Meeting

#### Request
```typescript
POST https://graph.microsoft.com/v1.0/me/onlineMeetings
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "startDateTime": "2025-12-30T10:00:00Z",
  "endDateTime": "2025-12-30T11:00:00Z",
  "subject": "プロジェクトキックオフ"
}
```

#### Response
```json
{
  "id": "meeting-id-123",
  "joinWebUrl": "https://teams.microsoft.com/l/meetup-join/...",
  "audioConferencing": {
    "tollNumber": "+81-3-1234-5678",
    "conferenceId": "123456789"
  }
}
```

---

## Email Notification Template

### 確定通知メール（会議URL含む）

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>日程が確定しました</title>
</head>
<body>
  <h2>日程調整が確定しました</h2>
  
  <p>お疲れ様です。以下の日程で確定しました。</p>
  
  <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
    <h3>{{ thread.title }}</h3>
    <p><strong>日時:</strong> {{ finalized_slot.start_time | format_datetime }}</p>
    <p><strong>時間:</strong> {{ finalized_slot.duration }} 分</p>
    
    {% if meeting_join_url %}
    <p><strong>オンライン会議:</strong></p>
    <a href="{{ meeting_join_url }}" 
       style="display: inline-block; background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
      会議に参加
    </a>
    
    {% if meeting_password %}
    <p><small>パスワード: {{ meeting_password }}</small></p>
    {% endif %}
    {% endif %}
  </div>
  
  <p>カレンダーに追加するには、添付のiCalファイルを開いてください。</p>
  
  <p>
    <a href="{{ frontend_url }}/threads/{{ thread.id }}">詳細を見る</a>
  </p>
</body>
</html>
```

---

## Dashboard Display

### Thread詳細画面に会議情報を表示

```typescript
// GET /api/threads/:id
{
  "thread_id": 123,
  "title": "プロジェクトキックオフ",
  "status": "finalized",
  "finalized_slot": {
    "id": 1,
    "start_time": "2025-12-30T10:00:00Z",
    "end_time": "2025-12-30T11:00:00Z"
  },
  "meeting": {
    "type": "online",
    "provider": "zoom",
    "join_url": "https://zoom.us/j/123456789?pwd=abcdef",
    "password": "abc123",
    "created_at": "2025-12-26T12:00:00Z"
  },
  "participants": [
    {"invitee_key": "u:1", "name": "山田太郎"},
    {"invitee_key": "u:2", "name": "佐藤花子"}
  ]
}
```

---

## Meeting Updates and Cancellations

### Update Meeting (日程変更時)
```typescript
// PATCH /api/threads/:id/reschedule
// 1. 既存会議を削除 or 更新
// 2. 新しい日時で再作成
// 3. 招待者に通知

if (meeting_external_id) {
  if (meeting_provider === 'zoom') {
    await zoomApi.deleteMeeting(meeting_external_id);
  }
  // 新規作成
  const newMeeting = await createVideoMeeting(thread, newSlot);
}
```

### Cancel Meeting (キャンセル時)
```typescript
// DELETE /api/threads/:id
// 1. 会議削除
// 2. カレンダーイベント削除
// 3. キャンセル通知送信

if (meeting_external_id) {
  if (meeting_provider === 'zoom') {
    await zoomApi.deleteMeeting(meeting_external_id);
  } else if (meeting_provider === 'google_meet') {
    await googleCalendar.deleteEvent(calendar_event_id);
  }
}
```

---

## MVP vs Phase C

### MVP (Phase B)
- ✅ Zoom統合のみ
- ✅ 確定時に自動作成
- ✅ メール通知にURL含める
- ✅ ダッシュボード表示

### Phase C
- ⏳ Google Meet統合
- ⏳ Microsoft Teams統合
- ⏳ 会議の更新/削除
- ⏳ カレンダー統合と同期
- ⏳ 会議詳細の編集（議題、参加者追加など）

---

## Security Considerations

### 1. OAuth Token Management
- **Zoom/Google/Microsoft OAuth tokens** は環境変数 or Cloudflare Workers Secrets で管理
- `.dev.vars` に保存（ローカル開発用）
- `wrangler secret put` で本番環境に設定

### 2. Meeting URL Access Control
- `meeting_join_url` は確定後にのみアクセス可能
- 未確定時は `null`
- 招待者以外はアクセス不可（権限チェック）

### 3. Password Protection
- Zoom: 必ずパスワード有効化（`waiting_room: true` も推奨）
- Teams: デフォルトでロビー機能有効

---

## Summary

**Phase B (MVP):**
- Zoom統合のみ実装
- Thread確定時に自動で会議URL生成
- メール/Inbox通知にURL含める

**Phase C:**
- Google Meet / Microsoft Teams統合
- カレンダー統合と同期
- 会議の更新/キャンセル対応

**Next Steps:**
1. Zoom OAuth App作成
2. `videoMeetingService.ts` 実装
3. `finalizeThread()` にフック追加
4. メールテンプレート更新
