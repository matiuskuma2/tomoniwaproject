# OAuth審査申請 - 作業サマリー

## ✅ 完了した改善

### 1. Provider表記の統一
- **Before**: `"google meet"`（スペース）の可能性
- **After**: `MEETING_PROVIDER.GOOGLE_MEET = "google_meet"`（アンダースコア）
- **実装**:
  - 型定義: `packages/shared/src/types/meeting.ts`
  - 定数化: `MEETING_PROVIDER` enum
  - Type safety確保: `MeetingProvider` type, `Meeting` interface
- **Commit**: `7bc32df`

### 2. OAuth審査申請用ドキュメント整備
- **作成ファイル**:
  - `docs/OAUTH_CONSENT_SCREEN_APPLICATION.md` - 審査申請ガイド（コピペ可能）
  - `docs/PHASE_0B_COMPLETION_CHECKLIST.md` - Phase 0B完了チェックリスト
  - `scripts/verify-phase0b.sql` - DB検証SQL
  - `scripts/oauth-verification-test.sh` - 自動検証（Bash）
  - `scripts/oauth-verification-test.ps1` - 自動検証（PowerShell）
- **Commit**: `6016f22`, `b495145`

---

## 📋 OAuth審査申請 - やることリスト

### ✅ 開発側（完了）

1. ✅ Provider表記を`google_meet`に統一
2. ✅ 型定義追加（Type safety）
3. ✅ 審査申請用テンプレート作成
4. ✅ 検証スクリプト作成（Bash + PowerShell）
5. ✅ ドキュメント整備
6. ✅ Git commit & push準備

---

### 📸 モギモギさんがやること（次のステップ）

#### Step 1: Google Cloud Console設定

1. **Google Cloud Console** にアクセス: https://console.cloud.google.com/
2. プロジェクト選択（Tomoniwao用）
3. 左メニュー → 「APIとサービス」 → 「OAuth同意画面」
4. 「機密性の高いスコープ」で `calendar.events` を確認/追加

---

#### Step 2: 審査申請テキストの入力

**「スコープの使用方法と理由」欄**に以下をコピペ:

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

**「アプリに関する最終的な詳細」欄**に以下をコピペ:

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

#### Step 3: スクリーンショット撮影（5枚）

##### 1. OAuth同意画面
- **URL**: https://webapp.snsrilarc.workers.dev/auth/google/start
- **含める内容**: calendar.eventsスコープが見える

##### 2. Token取得（Console）
- **F12** → Console → `fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json())`
- **含める内容**: `access_token` が返ってくる

##### 3. Thread作成
- **curl or 検証スクリプト実行**
- **含める内容**: `thread.id` が返ってくる

##### 4. Finalize（Meet生成）
- **curl or 検証スクリプト実行**
- **含める内容**: `meeting.url`, `calendar_event_id` が返ってくる

##### 5. Google Calendarイベント
- **Google Calendar** でイベント詳細を開く
- **含める内容**:
  - Meet URL埋め込み
  - 主催者が参加者に含まれる
  - リマインダー設定（24h + 1h）

---

#### Step 4: スクリーンショットをGoogle Driveで共有

1. Google Driveにフォルダ作成（例: "OAuth Review Screenshots"）
2. 5枚のスクショをアップロード
3. 共有設定: 「リンクを知っている全員が閲覧可能」
4. 共有リンクをコピー
5. 「アプリに関する最終的な詳細」の最後に追記:
   ```
   スクリーンショット共有: https://drive.google.com/drive/folders/xxx
   ```

---

#### Step 5: 審査申請送信

1. 全ての項目を入力
2. 「保存」をクリック
3. 「確認のため送信」ボタンをクリック
4. 審査開始（通常1-3営業日）

---

## 🎯 必要なスコープ（確定版）

### OAuth Scopes
- `openid` - ユーザー認証
- `email` - メールアドレス取得
- `profile` - プロフィール情報
- `https://www.googleapis.com/auth/calendar.events` - **機密性の高いスコープ**

### Authorization Parameters（スコープではない）
- `access_type=offline` - refresh token取得
- `prompt=consent` - 再同意を促す（refresh token取得のため）

---

## 📚 関連ファイル

### ドキュメント
- `docs/OAUTH_CONSENT_SCREEN_APPLICATION.md` - **メインガイド**
- `docs/GOOGLE_MEET_PHASE0B_SPEC.md` - Phase 0B仕様
- `docs/PHASE_0B_COMPLETION_CHECKLIST.md` - 完了チェックリスト

### スクリプト
- `scripts/oauth-verification-test.sh` - 自動検証（Bash）
- `scripts/oauth-verification-test.ps1` - 自動検証（PowerShell）
- `scripts/verify-phase0b.sql` - DB検証SQL

### コード
- `apps/api/src/routes/auth.ts` - OAuth実装
- `apps/api/src/routes/threadsFinalize.ts` - Meet生成
- `apps/api/src/services/googleCalendar.ts` - Calendar API
- `packages/shared/src/types/meeting.ts` - Meeting型定義

---

## 🔧 検証スクリプトの使い方

### Bash（Mac/Linux）
```bash
# 1. ログイン
open https://webapp.snsrilarc.workers.dev/auth/google/start

# 2. Token取得（Consoleで実行）
fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json()).then(d=>console.log('TOKEN:', d.access_token))

# 3. Token設定
export TOKEN="your_token_here"

# 4. スクリプト実行
bash scripts/oauth-verification-test.sh
```

### PowerShell（Windows）
```powershell
# 1. ログイン
Start-Process "https://webapp.snsrilarc.workers.dev/auth/google/start"

# 2. Token取得（Consoleで実行）
fetch('/auth/token', {method:'POST', credentials:'include'}).then(r=>r.json()).then(d=>console.log('TOKEN:', d.access_token))

# 3. Token設定
$env:TOKEN = "your_token_here"

# 4. スクリプト実行
.\scripts\oauth-verification-test.ps1
```

---

## ⚠️ トラブルシューティング

### Q: Token取得で401エラー
**A**: Cookieが設定されていない可能性があります。ログイン後にConsoleで実行してください。

### Q: Meet URL が null
**A**: 
1. Google accountが連携されているか確認（`/auth/google/start`）
2. `calendar.events` スコープが許可されているか確認
3. Token有効期限を確認（期限切れの場合は再ログイン）

### Q: スクリプトが動かない
**A**: 
- Bash: `chmod +x scripts/oauth-verification-test.sh`
- PowerShell: 実行ポリシー確認 `Get-ExecutionPolicy`

---

## 📝 チェックリスト（最終確認）

### Phase 0B動作確認
- [ ] API ResponseでMeet URL返却
- [ ] DBに`meeting_provider='google_meet'`保存
- [ ] Google Calendarにイベント登録
- [ ] Attendeesに主催者含まれる
- [ ] リマインダー設定（24h + 1h）

### OAuth審査申請準備
- [ ] Google Cloud Consoleでスコープ確認
- [ ] 「スコープの使用方法と理由」入力
- [ ] 「アプリに関する最終的な詳細」入力
- [ ] スクリーンショット5枚撮影
- [ ] Google Drive共有リンク取得
- [ ] 審査申請送信

---

**作成日**: 2025-12-27  
**ステータス**: 審査申請準備完了  
**次のアクション**: スクリーンショット撮影 → Google Drive共有 → 審査申請
