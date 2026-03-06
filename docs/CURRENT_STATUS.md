# 現在の実装状況

> **最終更新**: 2026-03-06
> **最新コミット**: PR-UX-9 — BUG-1/1b/3 会話オーケストレーション修正 + Google Calendar権限ガイダンス
> **前回コミット**: PR-UX-8 — スケジューリング会話コンテキスト保持 + 敬称一貫性 + clarification follow-up

---

## 概要

Tomoniwaoは、チャットベースの日程調整AIアシスタントです。

### 本番URL

| サービス | URL |
|----------|-----|
| **フロントエンド** | https://app.tomoniwao.jp |
| **API** | https://webapp.snsrilarc.workers.dev |
| **GitHub** | https://github.com/matiuskuma2/tomoniwaproject |

---

## 機能実装状況

### ✅ 完了済み

| 機能 | 説明 | PR/コミット |
|------|------|-------------|
| **Beta A** | チャット→メール送信フロー | - |
| **リスト5コマンド** | 作成・一覧・メンバー・追加・招待 | - |
| **追加候補** | 回答集まらない時の候補追加 | - |
| **1対1 Fixed** | 確定日時での1対1調整 | - |
| **1対1 Candidates** | 候補日提示での1対1調整 | - |
| **1対1 Freebusy** | 空き時間自動検出 | - |
| **1対1 Open Slots** | TimeRex型公開枠 | b5ce1f8 |
| **D0 関係性管理** | workmate申請→承諾フロー | PR #112 |
| **G2-A Pool Booking** | 受付プール予約システム | PR #113 |
| **PR-D: Contact Import** | Classifier Chain + CSV Parser + List Operation | PR #115 |
| **PR-D-API-1** | Contact Import API統合 — 事故ゼロ設計 | PR #116 |
| **PR-D-FE-1** | Contact Import フロントUI接続 — pending種別別UI切替 | PR #117 |
| **PR-D-FE-3** | 名刺OCR → Chat UI統合 → pending接続 — 事故ゼロ設計 | PR #118 |
| **PR-D-FE-4** | Intent抽出 + 次手チャット分岐 | PR #120 |
| **FE-4.5** | Open Slots intent→apiExecutor wiring修正 | b5ce1f8 |
| **FE-5** | Post-Import Auto-Connect Bridge | 46d5a2f |
| **FE-6** | 1対N チャット直接スケジューリング (classifier + executor) | 6f926c2 |
| **FE-6b** | ホストFreeBusy → スロット生成統合 | c162ae4 |
| **PR-B6 逆アベイラビリティ Phase 1** | 目上の相手にご都合を伺うモード（手動候補選択） | b847769 |
| **PR-B6 Phase 2 ゲストOAuth** | ゲストOAuth → FreeBusy自動取得 → 空きスロットのみ表示 | - |
| **PR-UX-3** | prop名 loading→initialLoading 統一（ChatPane/CardsPane/ChatLayout） | 6e540df |
| **PR-UX-4** | 二重 refresh 根絶（onThreadUpdate 削除、executor 経路に一本化） | aaeb213 |
| **PR-UX-5** | スレッド切替スピナー根絶 — hasLoadedOnce ガード + refreshing 安全タイムアウト + ChatPane/CardsPane 条件強化 | 086376d |
| **PR-UX-6** | skeleton 常設型 UI — early return spinner 全廃、hasLoadedOnceRef 削除（pure data fetch）、pane は常に描画し中身だけ skeleton | PR-UX-6 |
| **PR-UX-7** | ThreadsList skeleton 常設型 + BUG-1 TRIGGER_WORDS 拡張（「調整したい」「調整して」系を追加、oneOnOne/oneToMany 両方） | PR-UX-7 |
| **PR-UX-8** | スケジューリング会話コンテキスト保持 + 敬称一貫性 + clarification follow-up（BUG-1b: pending.scheduling.clarification, person.suffix） | PR-UX-8 |
| **PR-UX-9** | BUG-1/1b/3 会話オーケストレーション完全修正 — executor validation を clarification 形式に変更、Google Calendar権限不足時の会話型ガイダンス + 再開案内、敬称一貫性の全executor対応 | PR-UX-9 |
| **PR-FE7-a** | Mode Chip classifier override + Unit tests FE7-1〜FE7-12 (types, oneOnOne, reverseAvailability) | PR-FE7-a |

### 🔄 進行中

| 機能 | 説明 | 状況 |
|------|------|------|
| **FE-7 Mode Chip UI** | チャット入力上部のモード選択チップ（Auto/Fixed/候補/空き/公開枠/ご都合伺い） | PR-FE7-a + PR-FE7-b 完了 |

### 📋 FE-7: Mode Chip UI (PRD確定)

| ID | タスク | 状況 | PR |
|----|--------|------|----|
| FE7-T1 | `types.ts` に `SchedulingMode` + `IntentContext.preferredMode` | ✅ | PR-FE7-a |
| FE7-T2 | `oneOnOne.ts` に override ロジック (`buildForcedModeResult`) | ✅ | PR-FE7-a |
| FE7-T3 | `reverseAvailability.ts` に keyword スキップ | ✅ | PR-FE7-a |
| FE7-T4 | Unit tests: FE7-1〜FE7-12 (modeChip.test.ts) | ✅ | PR-FE7-a |
| FE7-T5 | 回帰テスト（417/417 pass維持） | ✅ | PR-FE7-a |
| FE7-T6 | `ModeChip.tsx` UI コンポーネント | ✅ | PR-FE7-b |
| FE7-T7 | `useChatReducer.ts` に selectedMode state + SET_MODE | ✅ | PR-FE7-b |
| FE7-T8 | ChatLayout / ChatPane / classifyIntent 統合 | ✅ | PR-FE7-b |
| FE7-T9 | Component tests (FE7-C1〜C4) + ドキュメント更新 | ✅ | PR-FE7-b |

### PR-B6: 逆アベイラビリティ Phase 1 (完了)

| ID | タスク | 状況 |
|----|--------|------|
| B6-1 | DBマイグレーション (0093_create_reverse_availability.sql) | ✅ |
| B6-2 | API: POST /api/reverse-availability/prepare | ✅ |
| B6-3 | API: POST /api/reverse-availability/:id/finalize | ✅ |
| B6-4 | ゲストページ: GET /ra/:token (時間枠選択UI) | ✅ |
| B6-5 | ゲスト送信: POST /ra/:token/respond | ✅ |
| B6-6 | サンキューページ: GET /ra/:token/thank-you | ✅ |
| B6-7 | Classifier: classifyReverseAvailability (11テスト) | ✅ |
| B6-8 | Executor: executeReverseAvailability + Finalize (9テスト) | ✅ |
| B6-9 | classifier/index.ts 統合 (#8) + types.ts intent追加 | ✅ |
| B6-10 | apiExecutor.ts case追加 | ✅ |
| B6-11 | apps/api/src/index.ts ルーティング登録 | ✅ |
| B6-12 | TypeScript全通過 + テスト 398/398 pass | ✅ |

### PR-B6: 逆アベイラビリティ Phase 2 (完了)

| ID | タスク | 状況 |
|----|--------|------|
| B6P2-1 | DBマイグレーション (0094_add_guest_oauth_for_reverse_availability.sql) | ✅ |
| B6P2-2 | OAuth start: GET /ra/:token/oauth/start | ✅ |
| B6P2-3 | OAuth callback: GET /api/ra-oauth/callback (固定URI) | ✅ |
| B6P2-4 | OAuth skip: POST /ra/:token/oauth/skip | ✅ |
| B6P2-5 | FreeBusy取得 + busy除外スロット計算 (generateFreeBusyFilteredSlots) | ✅ |
| B6P2-6 | ゲストページUI改修（OAuth案内 + 自動スロット表示 + フォールバック） | ✅ |
| B6P2-7 | index.ts ルート登録 (raOAuth public + callback) | ✅ |
| B6P2-8 | Unit tests: 12/12 pass (raOAuth.test.ts) | ✅ |
| B6P2-9 | 回帰テスト: 410/410 pass (0 regression from Phase 1) | ✅ |

### 📋 将来の計画

| 機能 | フェーズ | 計画書 |
|------|----------|--------|
| **PR-B6 逆アベイラビリティ（ご都合伺いモード）** | Phase 1-2 | ✅ Phase 1 & Phase 2 完了 |
| **UI モード選択** | Phase 1 | [FE-7 PRD](./plans/FE-7-MODE-CHIP-UI.md) — PRD確定 |
| **プロダクトヘルスチェック** | - | [2026-03 スナップショット](./PRODUCT_HEALTH_CHECK_2026_03.md) |
| **Slack/Chatwork 自動チャンネル** | Phase 1 | - |
| **N対N 調整** | Phase 2 | - |
| **音声入力** | Phase 1 | - |
| **AI スロット生成** | Phase 2 | - |
| **OCR 高度化** | Phase 2 | - |
| **ネイティブアプリ** | Phase 3 | - |

---

## スケジューリングモード一覧

### 1対1 (4モード完了)

| モード | Intent | 説明 | ルーティング |
|--------|--------|------|-------------|
| **Fixed** | `schedule.1on1.fixed` | 確定日時で招待 | 日時+名前で発動 |
| **Candidates3** | `schedule.1on1.candidates3` | 候補3つ提示 | デフォルト(制約なし) |
| **FreeBusy** | `schedule.1on1.freebusy` | カレンダー空き時間検出 | 制約あり時 |
| **Open Slots** | `schedule.1on1.open_slots` | 相手に選んでもらう公開枠 | 明示的指定時 |
| **Reverse Availability** | `schedule.1on1.reverse_availability` | ✅ 相手の空きから候補（Phase 1: 手動 / Phase 2: OAuth自動） | PR-B6 Phase 1&2 完了 |

### 1対N (FE-5 + FE-6 完了)

| 経路 | 説明 | 実装 |
|------|------|------|
| **Post-Import Bridge (FE-5)** | Contact Import後の自動接続 | `postImportBridge.ts` |
| **Chat Direct (FE-6)** | NL入力→直接1対N調整 | `classifier/oneToMany.ts` + `executors/oneToMany.ts` |
| **FreeBusy統合 (FE-6b)** | 主催者カレンダー空き時間ベースでスロット生成 | `generateSlotsWithFreeBusy()` in `postImportBridge.ts` |

---

## テスト状況

### ✅ 全テストグリーン (2026-03-05)

| カテゴリ | テストファイル数 | テスト数 | 状況 |
|----------|-----------------|----------|------|
| **Unit Tests (vitest)** | 22 | 458 | ✅ All Pass |
| **TypeScript** | - | - | ✅ No Errors |

### テスト内訳

| テストファイル | テスト数 | 説明 |
|---------------|----------|------|
| `intentClassifier.regression.test.ts` | 42 | TD-003 intent分類回帰テスト |
| `intentClassifier.golden.test.ts` | 52 | TD-003 ゴールデンファイルテスト |
| `post-import-next-step.test.ts` | 42 | FE-4/FE-5 取込後次手テスト |
| `refreshMap.test.ts` | 52 | リフレッシュマップテスト |
| `resolveChannel.test.ts` | 25 | チャンネル解決テスト |
| `postImportBridge.test.ts` | 20 | FE-5 ブリッジテスト |
| `generateSlotsWithFreeBusy.test.ts` | 15 | FE-6b FreeBusy統合テスト |
| `resolveContact.test.ts` | 19 | 連絡先解決テスト |
| `oneToMany.test.ts (classifier)` | 15 | FE-6 classifier テスト |
| `executorRefresh.test.ts` | 15 | executor リフレッシュテスト |
| `oneOnOne.regression.test.ts` | 26 | 1対1回帰テスト + BUG-1b (suffix/clarification) |
| `batch.test.ts` | 12 | P2-B1 バッチテスト |
| `contact-import-fe1.test.ts` | 11 | 連絡先取込FEテスト |
| `remind.test.ts` | 11 | リマインドテスト |
| `oneToMany.test.ts (executor)` | 10 | FE-6 executor テスト |
| `business-card-chat-ui.test.ts` | 9 | 名刺チャットUIテスト |
| `business-card-scan-fe.test.ts` | 6 | 名刺スキャンテスト |
| `reverseAvailability.test.ts (classifier)` | 11 | PR-B6 classifier テスト |
| `reverseAvailability.test.ts (executor)` | 9 | PR-B6 executor テスト |
| `raOAuth.test.ts` | 12 | PR-B6 Phase 2 OAuth + FreeBusy filtering テスト |
| `modeChip.test.ts` | 27 | FE-7 Mode Chip classifier override テスト (FE7-1〜FE7-12) |
| `ModeChip.component.test.ts` | 16 | FE-7 Mode Chip UI コンポーネントテスト (FE7-C1〜C4) |

---

## Classifier Chain (分類器チェーン)

| 順序 | 分類器 | Intent | ファイル |
|------|--------|--------|---------|
| 1 | pendingDecision | `pending.action.decide` | `pendingDecision.ts` |
| 2 | contactImport | `contact.import.*` | `contactImport.ts` |
| 3 | confirmCancel | confirm/cancel系 | `confirmCancel.ts` |
| 4 | lists | `list.*` | `lists.ts` |
| 5 | calendar | `schedule.today/week/freebusy` | `calendar.ts` |
| 6 | preference | `preference.*` | `preference.ts` |
| 7 | **oneToMany (FE-6)** | `schedule.1toN.prepare` | `oneToMany.ts` |
| 8 | **reverseAvailability (PR-B6)** | `schedule.1on1.reverse_availability` | `reverseAvailability.ts` |
| 9 | oneOnOne | `schedule.1on1.*` | `oneOnOne.ts` |
| 10 | propose | `schedule.auto_propose` | `propose.ts` |
| 11 | remind | `schedule.remind.*` | `remind.ts` |
| 12 | relation | `relation.*` | `relation.ts` |
| 13 | pool | `pool_booking.*` | `pool.ts` |
| 14 | thread | `thread.*` | `thread.ts` |

---

## FE-5/FE-6 タスク完了状況

### FE-5: Post-Import Auto-Connect (完了)

| ID | タスク | 状況 | コミット |
|----|--------|------|---------|
| T1 | postImportBridge.ts 作成 | ✅ | 46d5a2f |
| T2 | executors/index.ts re-export | ✅ | 46d5a2f |
| T3 | useChatReducer.ts handler更新 | ✅ | 46d5a2f |
| T4 | TypeScript type check | ✅ | 46d5a2f |
| T5 | Unit tests (20件) | ✅ | 今回 |
| T6 | E2E tests (FE-6と統合) | ✅ | - |
| T7 | Regression check (354/354 pass) | ✅ | 今回 |
| T8 | PRD v2.0 更新 | ✅ | 986a73b |

### FE-6: OneToMany Chat Direct (完了)

| ID | タスク | 状況 |
|----|--------|------|
| 1 | classifier/oneToMany.ts 作成 | ✅ |
| 2 | executors/oneToMany.ts 作成 | ✅ |
| 3 | classifier/index.ts 統合 (#7) | ✅ |
| 4 | executors/index.ts re-export | ✅ |
| 5 | classifier/types.ts に `schedule.1toN.prepare` 追加 | ✅ |
| 6 | apiExecutor.ts に case 追加 | ✅ |
| 7 | classifier テスト (15件) | ✅ |
| 8 | executor テスト (10件) | ✅ |
| 9 | TypeScript全通過 + 全テスト pass (354/354) | ✅ |

### FE-6b: Host FreeBusy Integration (完了)

| ID | タスク | 状況 |
|----|--------|------|
| 1 | `generateSlotsWithFreeBusy()` 作成 — calendarApi.getFreeBusy 統合 | ✅ |
| 2 | `postImportBridge.ts` の oneToMany フロー FreeBusy 切替 | ✅ |
| 3 | `oneToMany.ts` executor FreeBusy 切替 | ✅ |
| 4 | FreeBusy テスト 15件 (FB-1〜FB-15) | ✅ |
| 5 | 既存テスト回帰確認 (370/370 pass) | ✅ |

---

## ディレクトリ構造 (主要)

```
tomoniwaproject/
├── apps/api/src/
│   ├── routes/
│   │   ├── threads.ts          # スレッドCRUD
│   │   ├── pools.ts            # G2-A Pool Booking
│   │   ├── relationships.ts    # D0 関係性
│   │   ├── oneOnOne.ts         # 1対1調整API
│   │   ├── oneToMany.ts        # 1対N調整API
│   │   ├── reverseAvailability.ts # PR-B6: 逆アベイラビリティAPI ★NEW
│   │   ├── invite.ts           # 招待API
│   │   └── pendingActions.ts   # 確認フローAPI
│   ├── repositories/
│   └── middleware/
├── frontend/src/
│   ├── core/
│   │   ├── api/
│   │   │   ├── oneToMany.ts    # 1対N APIクライアント
│   │   │   ├── pools.ts
│   │   │   └── relationships.ts
│   │   └── chat/
│   │       ├── classifier/
│   │       │   ├── index.ts        # 統合チェーン (14分類器)
│   │       │   ├── oneToMany.ts    # FE-6: 1対N分類器
│   │       │   ├── reverseAvailability.ts # PR-B6: 逆アベイラビリティ分類器 ★NEW
│   │       │   ├── oneOnOne.ts     # 1対1分類器
│   │       │   ├── contactImport.ts
│   │       │   └── ...
│   │       ├── executors/
│   │       │   ├── index.ts        # 統合エクスポート
│   │       │   ├── oneToMany.ts    # FE-6: 1対Nexecutor
│   │       │   ├── reverseAvailability.ts # PR-B6: 逆アベイラビリティexecutor ★NEW
│   │       │   ├── postImportBridge.ts # FE-5: 自動接続ブリッジ
│   │       │   └── ...
│   │       └── apiExecutor.ts      # Intent→実行ルーター
│   └── components/chat/
│       └── useChatReducer.ts       # Reducer + FE-5 handler
├── db/migrations/
│   ├── 0085_add_scheduling_thread_kind.sql
│   ├── 0086_add_one_to_many_support.sql
│   └── ...
├── docs/
│   ├── CURRENT_STATUS.md           # ← このファイル
│   ├── ARCHITECTURE_OVERVIEW_2026_02.md
│   ├── DATABASE_SCHEMA.md
│   ├── MIGRATION_HISTORY.md
│   ├── SCHEDULING_PATTERNS_AND_RULES.md
│   └── PRD-FE-5-post-import-auto-connect.md
└── packages/shared/
```

---

## DBマイグレーション (主要)

| マイグレーション | 説明 |
|------------------|------|
| `0085_add_scheduling_thread_kind.sql` | kind カラム追加 |
| `0086_add_one_to_many_support.sql` | topology, group_policy_json, thread_responses |
| `0088_create_pool_booking.sql` | Pool Booking基本テーブル |
| `0089_add_last_assigned_member_id.sql` | Round-Robin用 |
| `0090_create_blocks_and_pool_public_links.sql` | ブロック+公開リンク |
| `0092_extend_pending_actions.sql` | Contact Import用 pending拡張 |
| `0093_create_reverse_availability.sql` | PR-B6: reverse_availability + responses テーブル |

---

## ロードマップ

| フェーズ | 期間 | 内容 | 状況 |
|----------|------|------|------|
| **Phase 0B** | ~2026-01 | MVP完了 | ✅ |
| **Phase 1** | Jan-Mar 2026 | PWA、音声、UI改善 | 🔄 |
| **Phase 2** | Apr-Jun 2026 | AIスロット生成、OCR高度化 | 📋 |
| **Phase 3** | Jul-Sep 2026 | ネイティブアプリ | 📋 |

---

## 次のステップ

1. **BUG-3**: Google Calendar権限エラー時の会話内自然なガイダンス提供
2. **BUG-2**: スケジュール開始時にスレッドが作成されない問題
3. **モバイルUI**: メッセージ後の大きな空白エリア（スクロール/高さ管理）修正
4. **TD-10/TD-11 リファクタ**: apiExecutor.ts 分割 + ExecutionResultData 重複解消
5. **E2E テスト基盤**: Playwright 導入、フルフロー統合テスト

---

## 関連ドキュメント

- [日程調整パターン・ルール](./SCHEDULING_PATTERNS_AND_RULES.md)
- [アーキテクチャ概要](./ARCHITECTURE_OVERVIEW_2026_02.md)
- [データベーススキーマ](./DATABASE_SCHEMA.md)
- [マイグレーション履歴](./MIGRATION_HISTORY.md)
- [FE-5 PRD](./PRD-FE-5-post-import-auto-connect.md)

---

*このドキュメントは主要な変更時に更新されます。*
