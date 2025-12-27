# Phase 0B Completion Checklist

## 🎯 目的
主催者のGoogle Calendarにイベントを完全登録し、Google Meetリンクを自動生成する機能の動作確認。

---

## ✅ 完了確認項目

### 1. API Response確認（✅ 完了）

**実行したリクエスト:**
- Thread ID: `ffaf1c4-2320-4eb0-85ba-a372e32ec8dd`
- Slot ID: `2944784f-e45a-4e75-b3d4-31b48cea3e08`
- Endpoint: `POST /api/threads/:id/finalize`

**受領したレスポンス:**
```json
{
  "meeting": {
    "provider": "google_meet",
    "url": "https://meet.google.com/hrs-trnm-hco",
    "calendar_event_id": "lcq33g6r9ti8n285gdfuvqb48"
  }
}
```

**判定:**
- ✅ Meet URLが返っている → Calendar Event作成成功
- ✅ calendar_event_idが返っている → 後で更新/キャンセル可能
- ✅ meeting:null ではない → refresh token / scope / token refresh が正常動作

---

### 2. Database保存確認（要確認）

**確認SQL:**
```bash
# 本番環境で実行
cd /home/user/webapp
npx wrangler d1 execute webapp-production --file=scripts/verify-phase0b.sql
```

**期待される結果:**
```
thread_id: ffaf1c4-2320-4eb0-85ba-a372e32ec8dd
meeting_provider: google_meet  (← アンダースコア！)
meeting_url: https://meet.google.com/hrs-trnm-hco
calendar_event_id: lcq33g6r9ti8n285gdfuvqb48
```

**チェック項目:**
- [ ] `meeting_provider` が `google_meet`（アンダースコア）で保存されている
- [ ] `meeting_url` が正しく保存されている
- [ ] `calendar_event_id` が正しく保存されている

---

### 3. Google Calendar UI確認（要目視確認）

**手順:**
1. Google Calendarを開く: https://calendar.google.com
2. イベントID `lcq33g6r9ti8n285gdfuvqb48` のイベントを検索
3. イベントを開いて以下を確認

**チェック項目:**
- [ ] **Google Meetリンク**がイベントに埋め込まれている
  - リンク: `https://meet.google.com/hrs-trnm-hco`
- [ ] **参加者（Attendees）**に主催者自身が含まれている
  - 主催者のメールアドレスが表示されているか
- [ ] **リマインダー**が以下のように設定されている
  - 24時間前（メール）
  - 1時間前（ポップアップ）

**スクショ推奨:**
- イベント詳細画面のスクショを撮っておくと後で確認しやすい

---

### 4. Inbox通知確認（要確認）

**確認方法:**
```bash
# Inbox APIで確認
curl -X GET "https://webapp.snsrilarc.workers.dev/api/inbox" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.items[] | select(.message | contains("meet.google.com"))'
```

**期待される内容:**
- タイトル: `Thread finalized: [スレッドタイトル]`
- メッセージ: Google Meet URLが含まれている
- 優先度: HIGH

**チェック項目:**
- [ ] Inbox通知が届いている
- [ ] Meet URLが通知に含まれている

---

### 5. Email通知確認（要確認）

**確認方法:**
- 主催者のメールボックスをチェック
- 件名: `Confirmed: [スレッドタイトル]`

**期待される内容:**
```
Your scheduling has been confirmed.

Time: [start_at] - [end_at]

Google Meet: https://meet.google.com/hrs-trnm-hco
```

**チェック項目:**
- [ ] メールが届いている
- [ ] Meet URLがメールに含まれている

---

### 6. Token Refresh動作確認（オプション）

**確認方法:**
```sql
-- Token有効期限を確認
SELECT 
  user_id,
  token_expires_at,
  CASE 
    WHEN token_expires_at > datetime('now') THEN 'Valid'
    ELSE 'Expired'
  END as status
FROM google_accounts
WHERE user_id = '[ORGANIZER_USER_ID]';
```

**チェック項目:**
- [ ] Token有効期限が5分以内の場合、自動更新される
- [ ] 更新後のtokenがDBに保存される

---

## 🎉 Phase 0B完了判定

以下を**全て**クリアした場合、Phase 0Bは完了とみなす：

1. ✅ API ResponseでMeet URLが返る
2. [ ] DBに`meeting_provider='google_meet'`で保存されている
3. [ ] Google Calendarにイベントが登録されている
4. [ ] Attendeesに主催者が含まれている
5. [ ] リマインダーが正しく設定されている（24h + 1h）
6. [ ] Inbox通知にMeet URLが含まれている
7. [ ] Email通知にMeet URLが含まれている

---

## 🔧 今回の改善内容

### Provider表記の統一（✅ 完了）
- **修正前**: `"google meet"`（スペース）の可能性
- **修正後**: `MEETING_PROVIDER.GOOGLE_MEET` = `"google_meet"`（アンダースコア）
- **実装内容**:
  - 型定義追加: `packages/shared/src/types/meeting.ts`
  - 定数化: `MEETING_PROVIDER.GOOGLE_MEET`
  - Type safety確保

**Commit:** `7bc32df - fix(meeting): Standardize meeting provider to 'google_meet' with type safety`

---

## 📌 次のフェーズ（Phase 1）

Phase 0Bが完了したら、次は**Phase 1: 外部参加者招待**：

### Phase 1の実装内容
1. `thread_finalize.final_participants_json` を解析
2. 外部参加者（`e:xxx`）のメールアドレスを取得
3. Google Calendar Event の `attendees` に追加
4. Calendar Inviteを送信（Google側が自動送信）
5. RSVP（出欠確認）の管理

### 注意事項
- 外部参加者へのメール招待は**Google Calendar Invite**で代替可能
- Tomoniwao側のメール送信は補助的な役割
- OAuth consent審査・運用ポリシーに注意

---

## 📝 メモ

**実行日時:** 2025-12-27  
**Thread ID:** ffaf1c4-2320-4eb0-85ba-a372e32ec8dd  
**Slot ID:** 2944784f-e45a-4e75-b3d4-31b48cea3e08  
**Meet URL:** https://meet.google.com/hrs-trnm-hco  
**Calendar Event ID:** lcq33g6r9ti8n285gdfuvqb48

---

**Phase 0B Status:** 🟡 動作確認中（API Response ✅ / DB・UI確認待ち）
