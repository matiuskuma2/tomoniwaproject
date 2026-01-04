# OAuth 審査用テストアカウント情報

**最終更新**: 2026-01-04

---

## 🎯 目的

Google OAuth 審査チームがアプリをテストできるよう、テストアカウントと操作手順を提供する。

---

## 👤 テストアカウント情報

### 審査チーム用アカウント

**メールアドレス**: `oauth-review-test@tomoniwao.jp`  
**パスワード**: `[審査申請時に送信]`

**役割**: 一般ユーザー  
**権限**: スレッド作成、招待送信、カレンダー連携

---

## 🚀 ログイン手順

### Step 1: アプリにアクセス
1. ブラウザで https://app.tomoniwao.jp を開く
2. 「ログイン」ボタンをクリック

### Step 2: ログイン
1. メールアドレスを入力: `oauth-review-test@tomoniwao.jp`
2. OTP（ワンタイムパスワード）を入力
   - テスト環境では固定 OTP: `123456`
   - または登録メールアドレスに送信された OTP を入力
3. 「ログイン」ボタンをクリック

### Step 3: ダッシュボード確認
- ログイン成功後、ダッシュボードが表示されます
- スレッド一覧が表示されます（初回は空）

---

## 📅 Google Calendar OAuth フロー（審査対象）

### Scenario 1: 初回カレンダー連携

#### Step 1: カレンダー連携を開始
1. ダッシュボードで「設定」→「カレンダー連携」をクリック
2. 「Google Calendar と連携」ボタンをクリック

#### Step 2: OAuth 同意画面
1. **Google アカウント選択画面**が表示される
   - テストアカウントを選択: `oauth-review-test@tomoniwao.jp`

2. **OAuth 同意画面**が表示される
   - アプリ名: "Tomoniwao"
   - 要求スコープ: 
     ```
     https://www.googleapis.com/auth/calendar.events
     すべてのカレンダーの予定の表示と編集
     ```

3. **アクセス許可の説明**が表示される
   ```
   このアプリは以下の理由で Google Calendar へのアクセスを必要とします：
   
   ✅ 空き時間の検索
      - あなたのカレンダーから空いている時間を自動で探します
   
   ✅ 予定の自動作成
      - ミーティングが確定したら、自動でカレンダーに追加します
   
   ✅ Google Meet リンクの生成
      - オンラインミーティング用のリンクを自動で作成します
   ```

4. 「許可」ボタンをクリック

#### Step 3: 連携完了
1. アプリにリダイレクトされる
2. 「Google Calendar と連携しました」メッセージが表示される
3. カレンダー連携状態: ✅ 連携済み

---

### Scenario 2: スレッド作成 → カレンダー予定作成

#### Step 1: スレッド作成
1. ダッシュボードで「新規スレッド作成」ボタンをクリック
2. 以下を入力:
   - **タイトル**: "OAuth Review Test - Meeting"
   - **説明**: "Google Calendar integration test"
   - **招待する人**: `reviewer@example.com`（審査チーム用メールアドレス）
3. 「作成」ボタンをクリック

#### Step 2: 候補日時の提案（Calendar API 使用）
1. システムが Google Calendar API を呼び出す
   - **API エンドポイント**: `calendar.events.list`
   - **パラメータ**:
     ```json
     {
       "calendarId": "primary",
       "timeMin": "2026-01-05T00:00:00Z",
       "timeMax": "2026-01-12T00:00:00Z",
       "singleEvents": true,
       "orderBy": "startTime"
     }
     ```
   - **目的**: 空き時間スロットの検索

2. 候補日時が自動で表示される
   - 例: 2026-01-06 10:00-11:00, 2026-01-07 14:00-15:00

#### Step 3: スケジュール確定（Calendar API 使用）
1. 候補日時から「2026-01-06 10:00-11:00」を選択
2. 「確定」ボタンをクリック
3. システムが Google Calendar API を呼び出す
   - **API エンドポイント**: `calendar.events.insert`
   - **パラメータ**:
     ```json
     {
       "calendarId": "primary",
       "requestBody": {
         "summary": "OAuth Review Test - Meeting",
         "description": "Google Calendar integration test",
         "start": {
           "dateTime": "2026-01-06T10:00:00+09:00",
           "timeZone": "Asia/Tokyo"
         },
         "end": {
           "dateTime": "2026-01-06T11:00:00+09:00",
           "timeZone": "Asia/Tokyo"
         },
         "attendees": [
           { "email": "reviewer@example.com" }
         ],
         "conferenceData": {
           "createRequest": {
             "requestId": "random-uuid",
             "conferenceSolutionKey": { "type": "hangoutsMeet" }
           }
         }
       }
     }
     ```
   - **目的**: Google Calendar に予定を作成 + Google Meet リンク生成

4. 確定完了メッセージが表示される
   - 「スケジュールを確定しました」
   - Google Meet リンク: `https://meet.google.com/xxx-xxxx-xxx`

#### Step 4: Google Calendar で確認
1. https://calendar.google.com を開く
2. 2026-01-06 10:00 に予定が追加されていることを確認
3. 予定詳細に Google Meet リンクが含まれていることを確認

---

### Scenario 3: 予定の更新・削除（Calendar API 使用）

#### Step 3-1: リスケジュール
1. スレッド詳細画面で「リスケジュール」ボタンをクリック
2. 新しい日時を選択: 2026-01-07 14:00-15:00
3. 「更新」ボタンをクリック
4. システムが Google Calendar API を呼び出す
   - **API エンドポイント**: `calendar.events.update`
   - **パラメータ**:
     ```json
     {
       "calendarId": "primary",
       "eventId": "event-id-from-step2",
       "requestBody": {
         "start": {
           "dateTime": "2026-01-07T14:00:00+09:00"
         },
         "end": {
           "dateTime": "2026-01-07T15:00:00+09:00"
         }
       }
     }
     ```

#### Step 3-2: キャンセル
1. スレッド詳細画面で「キャンセル」ボタンをクリック
2. 確認ダイアログで「はい」をクリック
3. システムが Google Calendar API を呼び出す
   - **API エンドポイント**: `calendar.events.delete`
   - **パラメータ**:
     ```json
     {
       "calendarId": "primary",
       "eventId": "event-id-from-step2"
     }
     ```

---

## 🔒 セキュリティとプライバシー

### 1. データの保存範囲
- ✅ **保存する**: event_id, 日時, Google Meet リンク
- ❌ **保存しない**: 予定の詳細内容（タイトル、参加者、メモなど）

### 2. アクセス範囲
- ✅ **アクセスする**: 指定期間内の予定のみ（例: 1週間）
- ❌ **アクセスしない**: 全予定、過去の予定

### 3. 第三者共有
- ❌ Google Calendar データを第三者と共有しません

---

## 🎥 デモ動画の撮影ポイント

### 撮影すべきシーン

1. **ログイン（0:00-0:30）**
   - アプリURL入力
   - メール入力
   - OTP入力
   - ダッシュボード表示

2. **OAuth 同意画面（0:30-1:30）**
   - 「Google Calendar と連携」ボタンクリック
   - Google アカウント選択
   - **OAuth 同意画面**（審査で最重要）
     - アプリ名
     - 要求スコープ
     - アクセス許可の説明
   - 「許可」ボタンクリック
   - 連携完了メッセージ

3. **Calendar API 使用（1:30-3:00）**
   - スレッド作成
   - 候補日時の自動表示（`calendar.events.list` 使用）
   - スケジュール確定（`calendar.events.insert` 使用）
   - Google Meet リンク表示

4. **Google Calendar 確認（3:00-3:30）**
   - calendar.google.com を開く
   - 予定が追加されていることを確認
   - Google Meet リンクを確認

5. **予定の更新・削除（3:30-4:30）**
   - リスケジュール（`calendar.events.update` 使用）
   - キャンセル（`calendar.events.delete` 使用）
   - Google Calendar で削除確認

---

## 📝 審査チームへの注意事項

### 1. テスト環境の制限
- テストアカウントは審査期間のみ有効
- 審査完了後、アカウントは無効化されます

### 2. 既知の制限事項
- OTP は固定値（`123456`）またはメール送信
- テストデータはダミーデータです

### 3. サポート連絡先
- **Email**: support@tomoniwao.jp
- **Response Time**: 24時間以内

---

## 🔧 トラブルシューティング

### OAuth 同意画面が表示されない
**原因**: テストアカウントが Google Cloud Console に追加されていない  
**対応**: テストユーザーとして追加済みか確認

### Calendar API エラー
**原因**: スコープが不足している  
**対応**: `calendar.events` スコープが承認されているか確認

### 予定が作成されない
**原因**: API リクエストが失敗している  
**対応**: Network タブでエラーログを確認

---

## ✅ 審査前チェックリスト

- [ ] テストアカウント作成完了
- [ ] テストアカウントを Google Cloud Console のテストユーザーに追加
- [ ] ログイン手順の動作確認
- [ ] OAuth フローの動作確認
- [ ] Calendar API の動作確認（list, insert, update, delete）
- [ ] デモ動画の撮影完了
- [ ] プライバシーポリシーの確認
- [ ] スコープの説明（655文字以内）の確認

---

## 📎 関連ドキュメント

- [プライバシーポリシー](./PRIVACY_POLICY.md)
- [利用規約](./TERMS_OF_SERVICE.md)
- [OAuth 審査申請ガイド](./OAUTH_REVIEW_GUIDE.md)
