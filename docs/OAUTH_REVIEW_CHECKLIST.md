# Google OAuth 審査チェックリスト

**最終更新**: 2026-01-04

---

## 📋 審査前チェックリスト

### 1. デモ動画（📹 必須）

#### 撮影内容
- [ ] **ログイン画面**（0:00-0:30）
  - [ ] アプリURL表示: https://app.tomoniwao.jp
  - [ ] メールアドレス入力
  - [ ] OTP入力
  - [ ] ダッシュボード表示

- [ ] **OAuth 同意画面**（0:30-1:30）★最重要
  - [ ] 「Google Calendar と連携」ボタンクリック
  - [ ] Google アカウント選択画面
  - [ ] **OAuth 同意画面**を明確に表示
    - [ ] アプリ名: "Tomoniwao"
    - [ ] 要求スコープ: `calendar.events`
    - [ ] スコープの説明文が表示される
  - [ ] 「許可」ボタンをクリック
  - [ ] 連携完了メッセージ

- [ ] **Calendar API 使用**（1:30-3:00）
  - [ ] スレッド作成画面
  - [ ] 候補日時の自動表示（`calendar.events.list`）
  - [ ] スケジュール確定（`calendar.events.insert`）
  - [ ] Google Meet リンク表示

- [ ] **Google Calendar 確認**（3:00-3:30）
  - [ ] calendar.google.com を開く
  - [ ] 予定が追加されていることを確認
  - [ ] 予定詳細（タイトル、日時、Google Meet リンク）

- [ ] **予定の更新・削除**（3:30-4:30）
  - [ ] リスケジュール（`calendar.events.update`）
  - [ ] キャンセル（`calendar.events.delete`）
  - [ ] Google Calendar で削除確認

#### 動画の要件
- [ ] **長さ**: 4-5分
- [ ] **形式**: MP4, MOV（最大100MB）
- [ ] **解像度**: 720p以上
- [ ] **音声**: あり（操作説明のナレーション推奨）
- [ ] **字幕**: 英語字幕推奨

#### アップロード先
- [ ] YouTube（限定公開）
- [ ] Google Drive（共有リンク）
- [ ] 審査申請フォームに URL を記載

---

### 2. プライバシーポリシー（✅ 必須）

#### 確認項目
- [ ] **公開URL**: https://app.tomoniwao.jp/privacy
- [ ] **アクセス可能**: 誰でも閲覧可能（ログイン不要）
- [ ] **言語**: 英語版あり

#### 記載内容の確認
- [ ] **Google Calendar データの使用目的**
  - [ ] 空き時間の検索
  - [ ] 予定の自動作成
  - [ ] リスケジュール・キャンセル

- [ ] **データの保存範囲**
  - [ ] 保存する: event_id, 日時, Google Meet リンク
  - [ ] 保存しない: 予定の詳細内容

- [ ] **第三者共有**
  - [ ] Google Calendar データを第三者と共有しないことを明記

- [ ] **ユーザーの削除権**
  - [ ] アカウント削除時のデータ削除について明記
  - [ ] Google アカウント設定からアクセス許可を取り消す方法を明記

- [ ] **AI/ML 使用について**（⚠️ 推奨）
  - [ ] AI を使用しているか明記
  - [ ] AI の使用目的を説明
  - [ ] AI によるデータ処理について説明

---

### 3. 利用規約（✅ 必須）

#### 確認項目
- [ ] **公開URL**: https://app.tomoniwao.jp/terms
- [ ] **アクセス可能**: 誰でも閲覧可能（ログイン不要）
- [ ] **言語**: 英語版あり

#### 記載内容の確認
- [ ] **サービスの目的**
- [ ] **ユーザーの責任**
- [ ] **データの取り扱い**
- [ ] **免責事項**

---

### 4. スコープの説明（Cloud Console）

#### 確認項目
- [ ] **Google Cloud Console** → **OAuth 同意画面**
- [ ] **スコープ**: `https://www.googleapis.com/auth/calendar.events`
- [ ] **説明文**: 655文字以内

#### 説明文の内容（英語）
```
This app requires calendar.events scope to provide meeting scheduling features:

1. Find available time slots
   - Read your calendar events to identify when you're free
   - Only access events within the specified date range (e.g., next 7 days)

2. Create calendar events automatically
   - Add confirmed meetings to your calendar
   - Generate Google Meet links for online meetings

3. Update/delete events
   - Reschedule meetings when needed
   - Remove cancelled meetings from your calendar

We do NOT:
- Store detailed event information (titles, descriptions, attendees)
- Access events outside the specified date range
- Share your calendar data with third parties

Only event IDs and timestamps are stored in our database for meeting coordination.
```

#### 説明文の内容（日本語）
```
このアプリは、ミーティングスケジュール機能を提供するため、calendar.events スコープを必要とします：

1. 空き時間の検索
   - カレンダーの予定を読み取り、空いている時間を特定
   - 指定期間内の予定のみにアクセス（例：次の7日間）

2. カレンダー予定の自動作成
   - 確定したミーティングをカレンダーに追加
   - オンラインミーティング用の Google Meet リンクを生成

3. 予定の更新・削除
   - 必要に応じてミーティングをリスケジュール
   - キャンセルされたミーティングをカレンダーから削除

私たちは以下のことを行いません：
- 予定の詳細情報（タイトル、説明、参加者）を保存
- 指定期間外の予定にアクセス
- カレンダーデータを第三者と共有

ミーティング調整のため、予定IDと日時のみをデータベースに保存します。
```

#### 文字数確認
- [ ] **英語**: 655文字以内
- [ ] **日本語**: 655文字以内

---

### 5. テスト環境（❓ 必須）

#### テストアカウント
- [ ] **メールアドレス**: `oauth-review-test@tomoniwao.jp`
- [ ] **パスワード**: 審査申請時に送信
- [ ] **Google Cloud Console** に追加済み

#### テストユーザーの追加手順
1. [ ] Google Cloud Console → **OAuth 同意画面**
2. [ ] **テストユーザー** セクション
3. [ ] 審査チームのメールアドレスを追加
   - [ ] `oauth-review-test@tomoniwao.jp`
   - [ ] 審査チームから送られてきたメールアドレス

#### ログイン手順の確認
- [ ] `docs/OAUTH_TEST_ACCOUNT.md` に詳細手順を記載
- [ ] ログイン → OAuth フロー → Calendar API 使用まで

---

### 6. アプリの基本情報

#### OAuth 同意画面
- [ ] **アプリ名**: Tomoniwao
- [ ] **サポートメール**: support@tomoniwao.jp
- [ ] **アプリのロゴ**: 120x120px 以上
- [ ] **アプリのドメイン**:
  - [ ] アプリのホームページ: https://tomoniwao.jp
  - [ ] プライバシーポリシー: https://app.tomoniwao.jp/privacy
  - [ ] 利用規約: https://app.tomoniwao.jp/terms
- [ ] **承認済みドメイン**: tomoniwao.jp, app.tomoniwao.jp

#### リダイレクト URI
- [ ] **本番**: https://app.tomoniwao.jp/auth/google/callback
- [ ] **開発**: http://localhost:3000/auth/google/callback

---

### 7. セキュリティ確認

#### API の使用状況
- [ ] **calendar.events.list**: 空き時間検索
  - [ ] パラメータ: `timeMin`, `timeMax`, `maxResults`
  - [ ] 期間限定（例: 7日間）

- [ ] **calendar.events.insert**: 予定作成
  - [ ] 必要最小限のフィールドのみ送信
  - [ ] conferenceData で Google Meet リンク生成

- [ ] **calendar.events.update**: 予定更新
  - [ ] イベントID で特定
  - [ ] 日時のみ更新

- [ ] **calendar.events.delete**: 予定削除
  - [ ] イベントID で特定

#### データ保存の制限
- [ ] **DB に保存するもの**:
  - [ ] event_id（Google Calendar の予定ID）
  - [ ] start_time, end_time
  - [ ] google_meet_url

- [ ] **DB に保存しないもの**:
  - [ ] 予定のタイトル
  - [ ] 予定の説明
  - [ ] 参加者情報
  - [ ] その他の詳細情報

---

### 8. AI/ML 使用について（⚠️ 推奨）

#### プライバシーポリシーへの追記
- [ ] **AI の使用目的**を明記
  - [ ] 候補日時の提案
  - [ ] スケジュール最適化

- [ ] **AI によるデータ処理**を説明
  - [ ] Google Calendar データは AI に送信されない
  - [ ] または、AI に送信される場合のデータ範囲を明記

---

## ✅ 審査申請前の最終確認

### 審査申請フォーム
- [ ] **デモ動画URL**: YouTube/Google Drive リンク
- [ ] **プライバシーポリシーURL**: https://app.tomoniwao.jp/privacy
- [ ] **利用規約URL**: https://app.tomoniwao.jp/terms
- [ ] **テストアカウント情報**:
  - [ ] メール: `oauth-review-test@tomoniwao.jp`
  - [ ] パスワード: [記載]
- [ ] **スコープの説明**: 655文字以内で記載済み

### 審査チームへの連絡事項
- [ ] **サポートメール**: support@tomoniwao.jp
- [ ] **レスポンス時間**: 24時間以内

---

## 📊 審査状況トラッキング

| 項目 | 状態 | 期限 | 備考 |
|------|------|------|------|
| デモ動画 | 📹 準備中 | - | OAuth同意画面を含めて撮影 |
| プライバシーポリシー | ✅ 作成済み | - | サイトに反映済み |
| 利用規約 | ✅ 作成済み | - | サイトに反映済み |
| スコープの説明 | ❓ 確認 | - | 655文字以内で記入済みか確認 |
| テスト環境 | ❓ 確認 | - | 審査チームがテストできるか |
| AI/ML声明 | ⚠️ 推奨 | - | プライバシーポリシーに追記済みか |

---

## 🎯 結論

**現在の申請で審査は通る可能性が高いです**

### 必須対応
1. ✅ プライバシーポリシー作成
2. ✅ 利用規約作成
3. ✅ スコープの説明（655文字以内）
4. 📹 デモ動画撮影（OAuth 同意画面を含む）
5. ❓ テストアカウント準備

### 推奨対応
6. ⚠️ AI/ML 使用についてプライバシーポリシーに追記

---

## 📞 審査中の対応

### 審査チームから質問があった場合
1. support@tomoniwao.jp で受信
2. 24時間以内に返信
3. 必要に応じて追加資料を提供

### 審査期間
- **通常**: 2-4週間
- **追加情報が必要な場合**: +1-2週間

---

## 📎 関連ドキュメント

- [OAuth テストアカウント情報](./OAUTH_TEST_ACCOUNT.md)
- [プライバシーポリシー](./PRIVACY_POLICY.md)
- [利用規約](./TERMS_OF_SERVICE.md)
- [Beta 公開準備チェックリスト](./BETA_CHECKLIST.md)
