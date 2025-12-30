# Calendar API Runbook

## 概要

Calendar API は Google Calendar との統合を提供します。

- **Day2:** `GET /api/calendar/today`, `GET /api/calendar/week` （events.list）
- **Day3:** `GET /api/calendar/freebusy?range=today|week` （freebusy.query）

---

## API エンドポイント

### **GET /api/calendar/today**
今日の予定を取得（JST 基準）

**レスポンス（成功）：**
```json
{
  "range": "today",
  "timezone": "Asia/Tokyo",
  "events": [
    {
      "id": "event-id",
      "summary": "会議",
      "start": "2025-12-30T01:00:00.000Z",
      "end": "2025-12-30T02:00:00.000Z",
      "meet_url": "https://meet.google.com/xxx-xxxx-xxx"
    }
  ]
}
```

**レスポンス（Google 未連携）：**
```json
{
  "range": "today",
  "timezone": "Asia/Tokyo",
  "events": [],
  "warning": "google_account_not_linked"
}
```

---

### **GET /api/calendar/week**
今週の予定を取得（月曜〜日曜、JST 基準）

**レスポンス形式は `/today` と同じ**

---

### **GET /api/calendar/freebusy?range=today|week**
空き/予定ありの時間枠を取得（Day3: busy のみ）

**クエリパラメータ：**
- `range`: `today` または `week`（デフォルト: `today`）

**レスポンス（成功）：**
```json
{
  "range": "today",
  "timezone": "Asia/Tokyo",
  "busy": [
    {
      "start": "2025-12-30T01:00:00.000Z",
      "end": "2025-12-30T02:00:00.000Z"
    }
  ],
  "warning": null
}
```

**レスポンス（権限不足）：**
```json
{
  "range": "today",
  "timezone": "Asia/Tokyo",
  "busy": [],
  "warning": "google_calendar_permission_missing"
}
```

**UI 側の対応：**
- `warning: "google_calendar_permission_missing"` の場合、`busy: []` として扱う
- ユーザーに「カレンダー権限が不足しています」と表示

---

## 必要な OAuth スコープ

### **現在のスコープ（Day2 時点）**
```typescript
// apps/api/src/routes/auth.ts
const scopes = [
  'https://www.googleapis.com/auth/calendar.events', // events.list 用
];
```

### **FreeBusy API に必要なスコープ**

**Option 1: `calendar.freebusy` スコープ（最小権限）**
```typescript
'https://www.googleapis.com/auth/calendar.freebusy'
```
- FreeBusy 情報のみ取得可能
- 予定の詳細は取得できない

**Option 2: `calendar.readonly` スコープ（推奨）**
```typescript
'https://www.googleapis.com/auth/calendar.readonly'
```
- すべてのカレンダー情報を読み取り可能
- events.list と freebusy の両方をカバー

**Option 3: `calendar` スコープ（フルアクセス）**
```typescript
'https://www.googleapis.com/auth/calendar'
```
- カレンダーの読み取り・編集が可能
- 既に events 作成で使用中

---

## スコープ追加の手順

### **1. auth.ts にスコープを追加**

```typescript
// apps/api/src/routes/auth.ts
const scopes = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy', // 追加
];
```

### **2. 既存ユーザーの再認証**

**スコープを追加した場合、既存ユーザーは再認証が必要です：**
1. ユーザーに「カレンダー権限が不足しています。再連携してください」と表示
2. `/auth/google` へ再度アクセス
3. Google OAuth 同意画面で新しい権限を承認

### **3. Google Cloud Console の設定確認**

**OAuth 同意画面でスコープが有効か確認：**
1. Google Cloud Console → APIs & Services → OAuth consent screen
2. Scopes → Edit
3. `calendar.freebusy` または `calendar.readonly` を追加
4. Save

### **4. 動作確認**

```javascript
(async () => {
  const r = await fetch('/api/calendar/freebusy?range=today', { cache: 'no-store' });
  const body = await r.json();
  console.log('Busy:', body.busy);
  console.log('Warning:', body.warning);
})();
```

**期待結果：**
- `warning: null`
- `busy: [...]` に実データが入る

---

## `google_calendar_permission_missing` が出た時のチェック手順

### **Step 1: OAuth スコープを確認**

```bash
# auth.ts のスコープをチェック
cd /home/user/tomoniwaproject
grep -A5 "const scopes" apps/api/src/routes/auth.ts
```

**必要なスコープ：**
- ✅ `calendar.events` （events.list 用）
- ❌ `calendar.freebusy` または `calendar.readonly` （FreeBusy 用）

### **Step 2: Google Cloud Console でスコープを確認**

1. Google Cloud Console → APIs & Services → Credentials
2. OAuth 2.0 Client IDs → 使用中のクライアント ID をクリック
3. Scopes → `calendar.freebusy` または `calendar.readonly` があるか確認

### **Step 3: アクセストークンをリフレッシュ**

**既存ユーザーのトークンは古いスコープのままです：**
1. ユーザーに再ログインを促す
2. または、`google_accounts` テーブルの `access_token` と `refresh_token` を削除して再認証

### **Step 4: 再テスト**

```javascript
fetch('/api/calendar/freebusy?range=today', { cache: 'no-store' })
  .then(r => r.json())
  .then(console.log);
```

---

## Google OAuth 審査への影響

### **スコープ追加の影響**

**Sensitive スコープを追加する場合、Google OAuth 審査が必要：**
- `calendar.readonly` → **Sensitive スコープ（審査必要）**
- `calendar.freebusy` → **Sensitive スコープ（審査必要）**

### **推奨アプローチ**

**Option A（推奨）：審査を避ける**
- Day3 は「UI 安全な busy stub 確立」で完了
- Day4（UI 側）で `warning` がある場合は「busy 無し扱い」で空き枠 UI を描く
- 機能開発を止めずに前進

**Option B：スコープ追加＋審査申請**
- スコープを追加
- Google OAuth 審査を申請（数週間〜数ヶ月）
- 審査完了後、実データ取得

---

## メンテナンス記録

| 日付 | 担当者 | 変更内容 | 理由 |
|------|--------|---------|------|
| 2025-12-30 | System | CALENDAR_RUNBOOK.md 作成 | Day2/Day3 完了、スコープ運用明確化 |
| 2025-12-30 | System | FreeBusy API 実装（Day3） | busy のみ取得、UI 安全な warning 設計 |
| 2025-12-30 | System | events.list 実装（Day2） | 今日/今週の予定取得、JST 境界修正 |
