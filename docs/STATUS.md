# プロジェクト状況

最終更新: **2026-01-04 11:30 (UTC)**

---

## 📊 現在の状態

### デプロイ情報
- **本番環境**: https://webapp.snsrilarc.workers.dev
- **Health Check**: https://webapp.snsrilarc.workers.dev/health
- **Version ID**: b2953978-b882-41f8-9577-e5561721e9e6
- **フロントエンド**: https://app.tomoniwao.jp
- **デプロイ日時**: 2026-01-04 00:45 (UTC)
- **フロントエンド最終更新**: 2026-01-04 11:30 (UTC)

### DB Migration
- **適用済み**: 0001-0064（64個）
- **最新**: 0064_add_access_denied_action.sql
- **本番DB**: webapp-production (35dad869-c19f-40dd-90a6-11f87a3382d2)

---

## ✅ 完了した作業（2026-01-03〜04）

### P0-0: 基盤完全締め
1. **Tenant Isolation 完全適用**
   - 全 API で workspace_id/owner_user_id 強制
   - contacts, lists, listItems, listMembers, threads に適用
   - getTenant(c) で middleware から取得（DB 問い合わせゼロ）
   - 越境アクセス時は 404 で隠蔽

2. **Cursor Pagination Only**
   - OFFSET 完全禁止（例外ゼロ）
   - threads, adminDashboard, rooms を cursor 化
   - cursor 形式: `encodeCursor({ timestamp, id })`
   - CI で OFFSET 検知して落とす

3. **Migration 不変性**
   - CI で過去 migration 編集を検知
   - 失敗時は新番号で fix migration 作成

4. **workspace_id 欠如修正**
   - POST /api/threads に workspace_id 追加
   - Internal server error 修正完了

### Day4: Billing Gate
1. **checkBillingGate 実装**
   - status=2(停止)/4(解約) → 402
   - status=1(登録)/3(復活)/Free → 許可
   - 実行系のみ制御（finalize/remind）
   - GET/propose は止めない

2. **運用インシデント対策**
   - reason フィールド追加
     - `billing_blocked`: status=2/4 による課金停止
     - `user_not_found`: userId or email が取得できない
     - `db_error`: DB クエリ失敗
   - normalizeEmail() 共通化
   - fail-closed（不明なら止める）

### P0-1: パフォーマンス最適化
1. **スレッド招待のバッチ化**（fbe1b67）
   - createInvitesBatch 追加
   - Transaction + 200件チャンク
   - 1000件招待: ~30秒 → ~3秒（約10倍高速化）

2. **list_members のバッチ化**（5e3fa25）
   - POST /api/lists/:listId/members/batch を Transaction 化
   - 200件×N チャンク + 重複除去
   - audit log 肥大防止（chunk 単位で記録）

3. **運用インシデント対策**（123d883）
   - ADR-0004: 原子性保証の明確化
   - audit log の判別可能化（batch_operation フィールド）
   - invite 取得の正確性向上（WHERE id IN (...) で正確に取得）

### P0-2: 監査ログ肥大化対策
1. **Payload Size Limit（8KB）**（69b45f5）
   - clampPayload util 追加（max 8KB）
   - writeLedgerAudit / writeListItemEvent に適用
   - 超過時は自動 truncate with metadata

2. **Retention Policy（自動削除）**（69b45f5）
   - ledger_audit_events: 90日
   - access_denied logs: 30日（高頻度）
   - list_item_events: 90日
   - billing_events: 180日

3. **Scheduled Handler（Cron）**（69b45f5）
   - Daily cleanup (0 2 * * *)
   - 5000行/回でチャンク削除（タイムアウト防止）
   - created_at index で効率的削除

4. **静かに死ぬ残り火対策**（cd35c9f）
   - Migration 0063: created_at 単体 index 追加
   - Migration 0064: access_denied action を CHECK 制約に追加
   - scheduled handler の import 位置修正 + ctx.waitUntil

### P0-3: フロントエンド修正（e81b050）
1. **timestamp エラー修正**
   - ChatPane: `msg.timestamp` を Date オブジェクトに変換
   - `toLocaleTimeString()` エラーを解消

2. **確定処理の Intent 改善**
   - 「1番で確定」パターンマッチを改善
   - カード選択不要、チャット内で完結

---

## 🎯 動作確認結果

### フロントエンド
- ✅ ログイン成功
- ✅ スレッド一覧表示
- ✅ スレッド作成成功
- ✅ スレッド詳細表示成功

### API
- ✅ GET /api/threads: 正常
- ✅ POST /api/threads: 正常（workspace_id 追加済み）
- ✅ GET /api/threads/:id/status: 正常
- ✅ POST /api/threads/:id/finalize: Billing Gate 動作
- ✅ POST /api/threads/:id/remind: Billing Gate 動作

### バッチ処理
- ✅ POST /api/lists/:listId/members/batch: Transaction 化完了
- ✅ 1000件追加でタイムアウトしない
- ✅ inserted/skipped/failed を正確にカウント

### 監査ログ
- ✅ Payload 8KB 上限適用
- ✅ Scheduled prune（Daily 0 2 * * *）設定完了
- ✅ created_at index 追加（フルスキャン防止）

---

## 📝 既知の問題

### フロントエンド UI/UX（Beta 公開後に改善）
1. **スレッド一覧画面が不要**
   - 初回表示は直接チャット画面にする
   - スレッド作成はチャット内で完結させる

2. **「新しいチャットUIを試す」バナー不要**
   - Phase Next-1 Beta の表示を削除

3. **メール招待の導線が不明確**
   - 現状: リスト経由のバッチ招待のみ
   - 改善: チャット内で直接メールアドレスを指定して招待

4. **カード内の日程選択ができない**
   - 現状: カード内に選択ボタンなし
   - 対策: チャット内で「1番で確定」等のコマンドで確定可能に修正済み

---

## 🚀 次の一手（優先順位順）

### 優先度 HIGH（今すぐやる）
1. **Beta E2E 動作確認**
   - ✅ ログイン成功
   - ✅ スレッド作成成功
   - ✅ 招待承諾（エラー修正済み）
   - ⏳ チャットで「1番で確定」の動作確認
   - ⏳ Google Calendar 予定作成確認
   - ⏳ Google Meet リンク生成確認

### 優先度 MEDIUM（必要なら）
2. **フロント側 402 対応**
   - reason 別メッセージ表示
     - `billing_blocked`: 「課金が停止されています。アカウント設定を確認してください。」
     - `user_not_found`: 「再ログインしてください。」
     - `db_error`: 「一時的な障害が発生しました。しばらくしてからお試しください。」
   - UI/UX 改善

3. **バッチ処理の監視**
   - failed > 0 の場合に要注意表示
   - inserted/skipped のログ集計

### 優先度 LOW（未公開なら後回し）
4. **監視・ログ整備**（最小でOK）
   - Cron 実行ログの確認（1回でも回ればOK）
   - payload truncate 発生頻度の追跡
   - billing_blocked 数のモニタリング

5. **UI 微調整**
   - デザイン改善
   - 文言調整
   - レスポンシブ対応強化

---

## 📊 技術負債

### 完全解消済み
- ✅ Tenant Isolation（構造で防ぐ）
- ✅ Cursor Pagination（OFFSET 禁止）
- ✅ Migration 不変性（CI で検知）
- ✅ バッチ処理の性能（Transaction 化）
- ✅ 監査ログ肥大化（Retention + Payload Clamp）

### 将来対応（未公開なら急務ではない）
- R2 Archive（90日経過ログ）
- access_denied の 5分抑制（KV 使用）
- Cloudflare Analytics ダッシュボード

---

## 📈 メトリクス

### コードベース
- **Total Lines**: ~50,000 lines
- **API Routes**: 15+ routes
- **DB Tables**: 40+ tables
- **Migrations**: 64 migrations

### パフォーマンス
- **Worker Startup**: 15 ms
- **Bundle Size**: 227.26 KiB (gzip: 61.17 KiB)
- **1000件バッチ INSERT**: ~3秒（10倍高速化）

---

## 📅 最近の主要変更

### 2026-01-04
- ✅ P0-1: スレッド招待 + list_members のバッチ化
- ✅ P0-2: 監査ログ肥大化対策（Payload Clamp + Retention）
- ✅ P0-2: 静かに死ぬ残り火対策（Index + ctx.waitUntil）
- ✅ Migration 0063/0064 適用
- ✅ ADR-0004/0005 追加

### 2026-01-03
- ✅ POST /api/threads に workspace_id 追加（Internal server error 修正）
- ✅ Billing Gate に reason フィールド追加
- ✅ normalizeEmail() 共通化
- ✅ 本番デプロイ完了
- ✅ フロントエンド動作確認完了
- ✅ ドキュメント整備完了（STATUS.md, ADR-0001/0002/0003）

### 2026-01-02
- ✅ P0 Tenant Isolation 完全適用
- ✅ Cursor Pagination 統一（OFFSET 完全禁止）
- ✅ Migration 0061/0062 適用

---

## 🔄 定期更新タイミング

- **毎デプロイ後**: 必須更新
- **大きな機能追加時**: 必須更新
- **週次**: 状況確認と更新

---

## 🎯 判断基準（未公開フェーズ）

### 今すぐ直すべき
- スレッド作成できないなど、主導線が止まる
- データが壊れる（重複・越境・巻き戻り）
- セキュリティ的に危険（他人のデータが見える、認可漏れ）
- 運用で静かに死ぬ（cron が回らない、ログが増え続ける、バッチがタイムアウト）

### 後回しでOK
- UI が未完成／一部導線が途切れてる
- 表示崩れ、管理画面の細部、文言など
- 裏側完成後にまとめて直すほうが早いもの

---

## 📞 確認用URL

- **API（Workers）**: https://webapp.snsrilarc.workers.dev
- **Health Check**: https://webapp.snsrilarc.workers.dev/health
- **フロントエンド**: https://app.tomoniwao.jp
