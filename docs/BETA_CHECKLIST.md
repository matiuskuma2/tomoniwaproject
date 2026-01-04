# Beta 公開準備チェックリスト

最終更新: 2026-01-04

---

## 🎯 目的

未公開から Beta 公開に向けて、主導線（招待メール → 返答 → 確定）が正常に動作するか確認する。

---

## ✅ 事前準備

### 1. 環境確認
- [ ] 本番環境デプロイ済み: https://webapp.snsrilarc.workers.dev
- [ ] フロントエンド確認: https://app.tomoniwao.jp
- [ ] DB Migration 適用済み（0001-0064）
- [ ] Scheduled Tasks 設定済み（Daily cleanup）

### 2. テストアカウント準備
- [ ] テストユーザーA（招待者）のメールアドレス
- [ ] テストユーザーB（招待される人）のメールアドレス
- [ ] メール受信確認用の環境

---

## 📋 E2E テストシナリオ

### Scenario 1: スレッド作成 → 招待メール送信

#### 1-1. ログイン
- [ ] https://app.tomoniwao.jp にアクセス
- [ ] テストユーザーA でログイン成功
- [ ] ダッシュボード表示確認

#### 1-2. スレッド作成
- [ ] 「新規スレッド作成」ボタンをクリック
- [ ] タイトル入力: "Beta テスト - 1on1 ミーティング"
- [ ] 説明入力: "Beta 公開前の動作確認"
- [ ] （オプション）リストから招待を選択
- [ ] 「作成」ボタンをクリック

**期待結果**:
- [ ] スレッド作成成功（HTTP 201）
- [ ] スレッド一覧にタイトル表示
- [ ] スレッド詳細画面に遷移

**エラー時**:
- [ ] エラーメッセージが表示される
- [ ] request_id が含まれている
- [ ] Network タブで HTTP ステータス確認

#### 1-3. 招待メール送信確認
- [ ] スレッド詳細画面で「候補者」リスト確認
- [ ] テストユーザーB のメールアドレス確認
- [ ] （システム側）EMAIL_QUEUE に送信ジョブが追加されたか確認

**期待結果**:
- [ ] 候補者リストに表示
- [ ] メールキュー登録成功

**確認方法（開発者）**:
```bash
# Cloudflare Workers ログで確認
wrangler tail --format=pretty

# または DB で確認
wrangler d1 execute webapp-production --remote \
  --command="SELECT * FROM thread_invites ORDER BY created_at DESC LIMIT 5"
```

---

### Scenario 2: 招待メール受信 → 返答

#### 2-1. メール受信確認
- [ ] テストユーザーB のメールボックス確認
- [ ] 件名: "Beta テスト - 1on1 ミーティング - You're invited to join a conversation"
- [ ] 本文に招待リンク含まれているか確認

**期待結果**:
- [ ] メール受信（送信後 5分以内）
- [ ] 招待リンクが有効（token 付き）

**エラー時**:
- [ ] メールが届かない場合、EMAIL_QUEUE の Consumer ログ確認
- [ ] DLQ（Dead Letter Queue）にエラーがないか確認

#### 2-2. 招待リンククリック
- [ ] メール内の招待リンクをクリック
- [ ] 招待受付画面が表示されるか確認

**期待結果**:
- [ ] 招待受付画面表示
- [ ] スレッドタイトル・説明が表示
- [ ] 「参加する」ボタン表示

**エラー時**:
- [ ] Token 期限切れエラー（72時間）
- [ ] Token 無効エラー
- [ ] 404 エラー

#### 2-3. スケジュール候補選択
- [ ] カレンダーから候補日時を選択
- [ ] 複数候補選択可能か確認
- [ ] 「送信」ボタンをクリック

**期待結果**:
- [ ] 候補日時送信成功
- [ ] 確認メッセージ表示
- [ ] thread_invites の status が 'accepted' に更新

---

### Scenario 3: スケジュール確定

#### 3-1. 招待者が確定を実行
- [ ] テストユーザーA で再ログイン
- [ ] スレッド詳細画面を開く
- [ ] 「確定」ボタンをクリック
- [ ] 候補日時から最適な時間を選択
- [ ] 「確定する」ボタンをクリック

**期待結果**:
- [ ] スケジュール確定成功（HTTP 200）
- [ ] スレッドステータスが 'confirmed' に更新
- [ ] 確定通知メール送信

**エラー時（Billing Gate）**:
- [ ] status=2/4 の場合、HTTP 402 返却
- [ ] reason フィールドが含まれている
- [ ] エラーメッセージ表示

#### 3-2. 確定メール受信確認
- [ ] テストユーザーB のメールボックス確認
- [ ] 件名: "スケジュールが確定しました"
- [ ] 本文に確定日時が含まれているか確認

**期待結果**:
- [ ] メール受信（確定後 5分以内）
- [ ] カレンダーリンク含まれている（Google Calendar など）

---

## 🔥 エラーハンドリング確認

### 1. Billing Gate（402 エラー）
- [ ] status=2 のユーザーで finalize → 402 返却
- [ ] reason: 'billing_blocked' 含まれている
- [ ] フロント側で「課金が停止されています」メッセージ表示

### 2. 認証エラー（401 エラー）
- [ ] 未ログイン状態で API アクセス → 401 返却
- [ ] ログイン画面にリダイレクト

### 3. 権限エラー（404 エラー）
- [ ] 他人のスレッドに GET /api/threads/:id → 404 返却
- [ ] 「見つかりません」メッセージ表示（越境アクセスを隠蔽）

### 4. バッチ処理エラー
- [ ] 1000件超の contact_ids で POST /api/lists/:listId/members/batch → 400 返却
- [ ] エラーメッセージ: "List size exceeds 1000 contacts"

---

## 🎯 パフォーマンス確認

### 1. バッチ処理速度
- [ ] 100件の list_members 追加 → 3秒以内
- [ ] 1000件の thread_invites 作成 → 5秒以内

### 2. Worker Startup Time
- [ ] Cold Start: 50ms 以内
- [ ] Warm Start: 15ms 以内

### 3. DB クエリ
- [ ] GET /api/threads: 100ms 以内
- [ ] POST /api/threads: 500ms 以内（招待メール送信含む）

---

## 📊 監視項目

### 1. Cloudflare Workers ログ
- [ ] エラーログがないか確認
- [ ] 402 reason の内訳確認（billing_blocked / user_not_found / db_error）

### 2. EMAIL_QUEUE
- [ ] 送信成功率 > 95%
- [ ] DLQ にエラーがないか確認

### 3. Scheduled Tasks
- [ ] Daily cleanup (0 2 * * *) が実行されているか確認
- [ ] prune 結果のログ確認（deleted rows）

### 4. DB
- [ ] ledger_audit_events のサイズ確認
- [ ] payload_json が 8KB 以内か確認
- [ ] access_denied logs の増加率確認

---

## ✅ 完了条件

### 必須
- [ ] E2E シナリオ 1〜3 が全て成功
- [ ] エラーハンドリングが正常動作
- [ ] パフォーマンスが基準内

### 推奨
- [ ] 監視項目が正常範囲内
- [ ] フロント側の UI/UX が許容範囲内

---

## 🚀 Beta 公開後の対応

### 1. 初期ユーザーへの案内
- [ ] 招待メール送信
- [ ] 使い方ガイドの共有
- [ ] フィードバック収集フォームの準備

### 2. 問題発生時の対応
- [ ] request_id でログ追跡
- [ ] エラー内容の分析
- [ ] 緊急度判定（即時対応 or 後回し）

### 3. モニタリング
- [ ] 1日1回のログ確認
- [ ] 402 エラーの発生状況確認
- [ ] ユーザーフィードバックの収集

---

## 📞 問い合わせ先

- **API**: https://webapp.snsrilarc.workers.dev
- **Health Check**: https://webapp.snsrilarc.workers.dev/health
- **フロントエンド**: https://app.tomoniwao.jp
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject

---

## 📝 メモ

- 未公開フェーズでは「主導線の疎通」が最優先
- UI の細部は Beta 公開後にまとめて調整
- エラーログは request_id で追跡可能
