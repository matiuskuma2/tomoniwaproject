# OAuth同意画面 審査申請資料

## 📋 概要

このドキュメントは、Google OAuth同意画面の審査申請に必要な情報をまとめたものです。

**アプリ名**: Tomoniwao  
**アプリURL**: https://webapp.snsrilarc.workers.dev  
**プライバシーポリシーURL**: （準備中）  
**利用規約URL**: （準備中）

---

## 🔐 使用スコープ

### 基本スコープ（機密性：低）
- `openid` - ユーザー認証
- `email` - メールアドレス取得
- `profile` - プロフィール情報取得

### 機密性の高いスコープ
- `https://www.googleapis.com/auth/calendar.events` - カレンダーイベント作成・更新

---

## 📝 スコープの使用方法と理由（審査申請用テキスト）

**以下をGoogle Cloud Consoleの「スコープの使用方法と理由」欄にコピペしてください:**

```
使用スコープ

• openid / email / profile：ユーザー本人確認とアカウント紐付けのため
• https://www.googleapis.com/auth/calendar.events：日程確定時に、主催者のGoogleカレンダーへイベントを作成し、Google Meetリンク（conferenceData）を自動生成するため

利用タイミング

1. ユーザーが当サービスにGoogleでログイン（openid/email/profile）
2. 日程調整が確定（/api/threads/:id/finalize もしくは auto-finalize）したタイミングで、主催者のカレンダーにイベントを作成（calendar.events）
3. 作成されたイベントのMeet URL（hangoutLink/conferenceData）を、確定通知（メール/inbox/APIレスポンス）に含める

最小権限である理由

Google MeetのURLはカレンダーイベント作成時に生成されるため、イベント作成権限（calendar.events）が必要です。読み取り専用スコープではMeet生成ができません。
当面は主催者本人のカレンダーに作成するのみで、参加者招待（attendees追加）は将来フェーズで実装予定です。

データの扱い

取得したアクセストークンは期限付きで、更新にはrefresh_tokenを使用します。作成したイベントID/Meet URLのみをDBに保存し、不要なカレンダーデータは保持しません。
```

---

## 📱 アプリに関する最終的な詳細（審査申請用テキスト）

**以下をGoogle Cloud Consoleの「アプリに関する最終的な詳細」欄にコピペしてください:**

```
アプリ概要

本アプリ（Tomoniwao）は、外部招待リンクで日程調整を行い、確定時に主催者のGoogleカレンダーへイベントを自動作成し、Google Meetリンクを生成して通知するサービスです。

再現手順（審査用）

1. https://webapp.snsrilarc.workers.dev/auth/google/start へアクセスし、Googleログイン（同意画面で calendar.events を許可）
2. ログイン後、ブラウザのコンソール（F12 → Console）で以下を実行してaccess_tokenを取得:
   ```
   fetch('/auth/token', { 
     method: 'POST', 
     credentials: 'include' 
   }).then(r => r.json()).then(d => console.log('TOKEN:', d.access_token))
   ```
3. 取得したTOKENを使って、以下のcurlコマンドを実行（PowerShellの場合はInvoke-RestMethodを使用）

   スレッド作成:
   ```
   curl -X POST https://webapp.snsrilarc.workers.dev/api/threads \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"title":"審査用テスト","description":"Google Meet生成テスト"}'
   ```
   
   レスポンスから thread.id をコピー

4. スロット情報取得:
   ```
   curl https://webapp.snsrilarc.workers.dev/api/threads/THREAD_ID/status \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```
   
   レスポンスから slots[0].slot_id をコピー

5. 日程確定（Google Meet生成）:
   ```
   curl -X POST https://webapp.snsrilarc.workers.dev/api/threads/THREAD_ID/finalize \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"selected_slot_id":"SLOT_ID"}'
   ```
   
   レスポンスの meeting.url に Meet URL、calendar_event_id に作成イベントIDが返ります

6. Google Calendar（主催者アカウント）でイベントが作成され、Meetリンクとリマインダー（24h email + 1h popup）が入っていることを確認できます

テストユーザー

審査用テストユーザーが必要な場合は、指定のメールアドレスをテストユーザーとして追加します。

補足（動画について）

現時点では審査用動画は未作成です。代替として、上記手順に沿ったスクリーンショット一式を共有します（同意画面／APIレスポンス／カレンダーイベント詳細）。

スクリーンショット共有: （Google Driveリンクをここに追加予定）
```

---

## 📸 必要なスクリーンショット（5枚）

### 1. OAuth同意画面（calendar.eventsスコープが見える）
**撮影タイミング**: `/auth/google/start` にアクセスした時のGoogle同意画面

**含めるべき内容**:
- アプリ名: Tomoniwao
- スコープ: 「Googleカレンダーのイベントを管理」または「calendar.events」が表示されている
- ログインボタン/許可ボタン

---

### 2. Token取得成功（Console）
**撮影タイミング**: ブラウザConsoleで `/auth/token` を実行した結果

**含めるべき内容**:
```javascript
{
  "access_token": "eyJhbG...",
  "user": {
    "id": "user-xxx",
    "email": "your@email.com"
  }
}
```

---

### 3. Thread作成成功（API Response）
**撮影タイミング**: `POST /api/threads` のレスポンス

**含めるべき内容**:
```json
{
  "thread": {
    "id": "thread-xxx",
    "title": "審査用テスト",
    "status": "draft"
  }
}
```

---

### 4. Finalize成功（Google Meet URL含む）
**撮影タイミング**: `POST /api/threads/:id/finalize` のレスポンス

**含めるべき内容**:
```json
{
  "finalized": true,
  "meeting": {
    "provider": "google_meet",
    "url": "https://meet.google.com/xxx-yyyy-zzz",
    "calendar_event_id": "event_id_here"
  }
}
```

---

### 5. Google Calendarイベント詳細
**撮影タイミング**: Google Calendarでイベントを開いた画面

**含めるべき内容**:
- ✅ イベントタイトル: 「審査用テスト」
- ✅ Google Meetリンク: `https://meet.google.com/xxx-yyyy-zzz`
- ✅ 参加者: 自分（主催者）が含まれている
- ✅ リマインダー: 
  - 24時間前（メール）
  - 1時間前（ポップアップ）

---

## 🚀 審査申請手順（ステップバイステップ）

### Step 1: Google Cloud Consoleへアクセス
1. https://console.cloud.google.com/ にログイン
2. プロジェクトを選択（Tomoniwao用のプロジェクト）
3. 左メニュー → 「APIとサービス」 → 「OAuth同意画面」

---

### Step 2: スコープの確認
1. 「機密性の高いスコープ」セクションで `calendar.events` が表示されているか確認
2. 表示されていない場合:
   - 「スコープを追加または削除」をクリック
   - `https://www.googleapis.com/auth/calendar.events` を検索して追加

---

### Step 3: 審査申請資料の入力

#### 「スコープの使用方法と理由」欄
上記の「スコープの使用方法と理由（審査申請用テキスト）」をコピペ

#### 「アプリに関する最終的な詳細」欄
上記の「アプリに関する最終的な詳細（審査申請用テキスト）」をコピペ

#### 動画のリンク（オプション）
- 動画がある場合: YouTube/Google Driveのリンクを貼る
- 動画がない場合: 「動画は未作成。代わりにスクリーンショット一式を共有リンクで提供」と記載

---

### Step 4: スクリーンショットの準備
1. 上記の「必要なスクリーンショット（5枚）」を撮影
2. Google Driveに共有可能な形でアップロード
3. 共有リンクを取得（「リンクを知っている全員が閲覧可能」に設定）
4. 「アプリに関する最終的な詳細」の最後に追記:
   ```
   スクリーンショット共有: https://drive.google.com/drive/folders/xxx
   ```

---

### Step 5: 審査申請を送信
1. 全ての項目を入力後、「保存」をクリック
2. 「確認のため送信」ボタンが表示されたらクリック
3. 審査が開始される（通常1-3営業日）

---

## ⚠️ よくある質問

### Q1: refresh_token が取得できません
**A**: `access_type=offline` と `prompt=consent` が必要です。現在のコード（auth.ts 67-68行目）では正しく設定されています。

### Q2: Meet URLが生成されません
**A**: 
1. Google accountに `calendar.events` スコープが許可されているか確認
2. Token有効期限が切れていないか確認
3. `google_accounts` テーブルに `refresh_token_enc` が保存されているか確認

### Q3: 審査に落ちた場合は？
**A**: 
- 審査結果のフィードバックを確認
- 不足している情報や改善点を追加
- 必要に応じてスクリーンショットを追加撮影
- 再申請

---

## 📚 関連ドキュメント

- Phase 0B仕様: `docs/GOOGLE_MEET_PHASE0B_SPEC.md`
- Phase 0B完了チェックリスト: `docs/PHASE_0B_COMPLETION_CHECKLIST.md`
- 検証SQL: `scripts/verify-phase0b.sql`

---

## 📝 メモ

**作成日**: 2025-12-27  
**ステータス**: 審査申請準備中  
**次のアクション**: スクリーンショット撮影 → Google Drive共有 → 審査申請送信
