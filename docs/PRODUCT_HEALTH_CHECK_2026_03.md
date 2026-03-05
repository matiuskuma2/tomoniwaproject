# 🏥 プロダクトヘルスチェック & ドキュメントパッケージ
## Tomoniwao — 2026-03-05 スナップショット

> **作成者**: モギモギ（関屋紘之）
> **目的**: PR-B6 Phase 2 完了時点の全体像を一枚絵で把握。
> 技術的負債・UX課題・パフォーマンス・テスト状況を棚卸しし、
> 次の投資判断を下すための材料にする。

---

## 📊 1. 現在の製品状態サマリ

| カテゴリ | 状態 | コメント |
|----------|------|---------|
| **コア機能** | ✅ 完成域 | 1対1×5モード + 1対N + NL分類 + RA Phase 2 |
| **テスト** | ✅ 410/410 green | 0 regression |
| **TypeScript** | ✅ strict 全通過 | - |
| **本番稼働** | ✅ Cloudflare Pages | app.tomoniwao.jp |
| **認証** | ✅ Google OAuth | 本番scope承認済み |
| **事故件数** | ✅ 0件 | Phase 1開始以来ゼロ |
| **DB migration** | ✅ 0094まで適用 | 94ファイル clean |

---

## 🎨 2. UI/UX 現状マトリクス

### 2.1 チャットUI

| 要素 | 実装状態 | 課題 | 優先度 |
|------|----------|------|--------|
| **テキスト入力** | ✅ 動作 | - | - |
| **メッセージ表示** | ✅ 動作 | 最大50件表示制限（PERF-S2） | Low |
| **スレッド一覧** | ✅ 動作 | モバイルで切替が必要（3タブ） | Medium |
| **カレンダー表示** | ✅ 動作 | today/week/freebusy のみ | Low |
| **モード選択UI** | ❌ 未実装 | **FE-7で対応予定** | **High** |
| **音声入力** | ❌ 未実装 | Web Speech API制約あり | Medium |
| **通知表示** | ✅ 動作 | Inbox通知バッジ | Low |
| **名刺スキャン** | ✅ 動作 | カメラ + OCR + Chat統合 | - |
| **レスポンシブ** | ⚠️ 基本対応 | SP横スクロール一部未対応 | Medium |

### 2.2 ゲスト向けUI（外部招待者）

| ページ | 実装状態 | 課題 |
|--------|----------|------|
| **招待ページ** (`/i/:token`) | ✅ | Tailwind CSS |
| **RA ご都合伺いページ** (`/ra/:token`) | ✅ | Phase 2 OAuth統合済み |
| **Open Slots ページ** (`/s/:token`) | ✅ | - |
| **サンキューページ** | ✅ | - |

### 2.3 "spinning" 問題の分析

「spinning」= ユーザーの操作が空転する状態。現時点で以下を確認：

| 症状 | 原因 | 状態 | 対策 |
|------|------|------|------|
| **チャット入力 → 応答なし** | NL が unknown → chatApi フォールバック → 500 | ⚠️ 潜在 | chatApi のエラーハンドリング改善 |
| **スレッド選択 → ステータス取得遅延** | D1 cold start (初回600ms) | ⚠️ 潜在 | キャッシュ改善済み(PERF-S1) |
| **送信ボタン連打** | 二重送信防止なし | ⚠️ 潜在 | disabled during execution |
| **pending.action 期限切れ** | 5分後に送る/キャンセルが効かなくなる | ✅ 対応済み | expiry警告表示 |
| **OAuth リダイレクト後の白画面** | callback URL ミス | ✅ 対応済み | 固定URI + CSRF |
| **モバイルでボタン反応なし** | touch-action / z-index 問題 | ⚠️ 潜在 | CSS見直し必要 |

**結論**: 致命的な spinning はないが、NL unknown 時のフォールバックとモバイルタッチの2点は改善余地あり。

---

## 🏗️ 3. 技術的負債リスト

### 3.1 High Priority（次スプリントで対応推奨）

| ID | 負債 | 影響 | 対策 |
|----|------|------|------|
| TD-10 | **apiExecutor.ts が 1,476行** | 変更時の事故リスク | さらなる executor 分割（done: 80%、残: reschedule, notify） |
| TD-11 | **ExecutionResultData 重複定義** | `apiExecutor.ts` と `executors/types.ts` に同一型が二重定義 | types.ts に一本化 + re-export |
| TD-12 | **classifyOneOnOne.ts 740行** | 複雑な分岐、テスト困難 | helper関数は分離済み、FE-7でoverride追加時にリファクタ機会 |
| TD-13 | **localStorage 永続化がブラウザ依存** | Safari ITP で消える可能性 | storage adapter 実装済み（将来 IndexedDB 移行） |

### 3.2 Medium Priority

| ID | 負債 | 影響 | 対策 |
|----|------|------|------|
| TD-20 | pending.action の種別が多い (13種) | useChatReducer のhandleExecutionResult が827行 | PendingState union は維持、handler を分割 |
| TD-21 | docs/ に163ファイル | 古いドキュメントが残存 | archive/ に移動するクリーンアップ |
| TD-22 | E2E テストなし | 統合テストが unit のみ | Playwright E2E を後続で導入 |
| TD-23 | classifier パターン文字列がハードコード | 日本語キーワード追加時に毎回コード変更 | 設定ファイル化（Phase 2） |

### 3.3 Low Priority（将来対応）

| ID | 負債 |
|----|------|
| TD-30 | Vite 5 → 6 アップグレード |
| TD-31 | Hono 4 → 最新追従 |
| TD-32 | wrangler 3 → 4 移行準備 |
| TD-33 | Node.js 型定義 (`@cloudflare/workers-types`) 定期更新 |

---

## 📋 4. 観察チェックリスト

### 4.1 毎リリース確認事項

- [ ] **テスト**: `npx vitest run` → 全 pass（現在 410）
- [ ] **TypeScript**: `npx tsc --noEmit` → 0 errors
- [ ] **ビルド**: `npm run build` → dist/ 生成成功
- [ ] **ローカル動作**: `wrangler pages dev dist --local` → localhost:3000 応答
- [ ] **本番デプロイ**: `wrangler pages deploy dist` → pages.dev 応答
- [ ] **回帰**: 既存テストに regression なし

### 4.2 週次パフォーマンスチェック

- [ ] **D1 レスポンス**: SELECT 平均 < 50ms
- [ ] **API レスポンス**: P95 < 500ms
- [ ] **FE バンドルサイズ**: dist/ < 2MB
- [ ] **localStorage 使用量**: < 3MB
- [ ] **エラーログ**: Cloudflare Dashboard でエラー率 < 0.1%

### 4.3 優先度チェック（新機能判断用）

```
価値スコア = (ユーザー価値 × 頻度) / (実装コスト × 事故リスク)

スコア > 2.0 → 即着手
スコア 1.0-2.0 → 次スプリント候補
スコア < 1.0 → バックログ
```

| 候補機能 | ユーザー価値 | 頻度 | 実装コスト | 事故リスク | スコア | 判定 |
|----------|-------------|------|-----------|-----------|--------|------|
| **FE-7 Mode Chip** | 4 | 5 | 2 | 1 | **10.0** | ★ 即着手 |
| E2E テスト | 2 | 1 | 3 | 1 | 0.7 | バックログ |
| Phase 3 FreeBusy交差 | 3 | 3 | 4 | 2 | 1.1 | 次スプリント |

---

## 🔔 5. 通知・メール処理状況

| 通知種別 | 実装 | チャネル |
|----------|------|---------|
| **招待メール** | ✅ | EmailQueueService → Worker |
| **リマインドメール** | ✅ | 同上 |
| **確定通知メール** | ✅ | 同上 |
| **RA ご都合伺いメール** | ✅ | 同上 |
| **Inbox 通知** | ✅ | workspace_notifications テーブル |
| **Push 通知** | ❌ 未実装 | 将来 (Service Worker) |
| **Slack/Chatwork** | ❌ 未実装 | 将来 (Webhook) |

---

## 👥 6. People Hub / 連絡先管理状況

| 機能 | 実装 | 備考 |
|------|------|------|
| **連絡先CRUD** | ✅ | contacts テーブル |
| **名刺OCRスキャン** | ✅ | business_cards テーブル + Vision API |
| **CSV一括取込** | ✅ | contactImport executor |
| **テキスト取込** | ✅ | NL → parse → preview → confirm |
| **曖昧一致解決** | ✅ | person_select ステップ |
| **リスト管理** | ✅ | lists + list_members テーブル |
| **関係性管理** | ✅ | relationships テーブル (workmate) |
| **連絡先検索** | ⚠️ 基本のみ | 名前/メールの前方一致、全文検索なし |
| **連絡先マージ** | ❌ 未実装 | 重複連絡先の統合 |
| **Google Contacts同期** | ❌ 未実装 | 将来 (People API) |

---

## 🔗 7. リンク管理・URL体系

| URL パス | 用途 | 認証 |
|----------|------|------|
| `/` | メインチャットUI | ✅ 要ログイン |
| `/chat/:threadId` | スレッド詳細 | ✅ 要ログイン |
| `/i/:token` | 招待ページ（外部） | ❌ 公開 |
| `/i/:token/respond` | 回答送信 | ❌ 公開 |
| `/s/:token` | Open Slots選択ページ | ❌ 公開 |
| `/ra/:token` | RA ご都合伺いページ | ❌ 公開 |
| `/ra/:token/oauth/start` | RA ゲストOAuth開始 | ❌ 公開 |
| `/api/ra-oauth/callback` | RA OAuth callback（固定） | ❌ 公開 |
| `/api/*` | 内部API | ✅ Bearer token |
| `/auth/google/start` | ホストOAuth開始 | ❌ 公開 |
| `/auth/google/callback` | ホストOAuth callback | ❌ 公開 |

---

## 📈 8. テストカバレッジ詳細

### 8.1 カバー済み領域

| 領域 | テスト数 | カバレッジ |
|------|----------|-----------|
| **Intent分類 (classifier)** | 107 (42+52+13) | ✅ 高 |
| **Executor ロジック** | 約120 | ✅ 高 |
| **FreeBusy統合** | 15 | ✅ 高 |
| **1対N** | 25 (15+10) | ✅ 高 |
| **Reverse Availability** | 32 (11+9+12) | ✅ 高 |
| **Contact Import** | 11 | ✅ 中 |
| **名刺OCR** | 15 (9+6) | ✅ 中 |
| **Batch処理** | 12 | ✅ 中 |
| **リマインド** | 11 | ✅ 中 |

### 8.2 未カバー領域（リスク順）

| 領域 | リスク | 理由 |
|------|--------|------|
| **E2E フルフロー** | 🔴 High | ブラウザ→API→DB の統合パスが未テスト |
| **OAuth フロー** | 🟡 Medium | Google API mock が複雑 |
| **メール送信** | 🟡 Medium | EmailQueueService の統合テスト未実施 |
| **モバイルUI** | 🟡 Medium | タッチイベントのテストなし |
| **エッジケース（並行操作）** | 🟡 Medium | 同時送信/pending競合 |

---

## 🗺️ 9. 次の3スプリント見通し

| スプリント | 主要タスク | 見積り |
|------------|-----------|--------|
| **Sprint 1 (Now)** | FE-7 Mode Chip UI (PR-FE7-a + PR-FE7-b) | ~8h |
| **Sprint 2** | TD-10/TD-11 リファクタ + E2E テスト基盤 | ~10h |
| **Sprint 3** | Phase 3 FreeBusy交差 or Slack/Chatwork統合 | ~12h |

---

## ✅ 10. アクションアイテム

| # | アクション | 担当 | 期限 |
|---|-----------|------|------|
| 1 | FE-7 PRD 確認 → 実装開始 | 開発 | Sprint 1 |
| 2 | Google Cloud Console: RA callback URI 登録確認 | 運用 | Sprint 1 |
| 3 | `calendar.freebusy` scope を OAuth consent screen に追加 | 運用 | Sprint 1 |
| 4 | docs/ の古いファイルをアーカイブ | 開発 | Sprint 2 |
| 5 | apiExecutor.ts の reschedule/notify 分割 | 開発 | Sprint 2 |

---

*このドキュメントは主要リリース時に更新されます。*
