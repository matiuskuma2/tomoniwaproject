# 現在の実装状況

> **最終更新**: 2026-02-23
> **最新コミット**: (FE-6 oneToMany実装, pending push)
> **前回コミット**: 46d5a2f (FE-5 postImportBridge)

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
| **FE-6** | 1対N チャット直接スケジューリング (classifier + executor) | pending push |

### 🔄 進行中

| 機能 | 説明 | 状況 |
|------|------|------|
| **FE-6b** | ホストカレンダー FreeBusy for 1-to-N | 未着手 |

### 📋 将来の計画

| 機能 | フェーズ | 計画書 |
|------|----------|--------|
| **PR-B6 逆アベイラビリティ（ご都合伺いモード）** | Phase 1-2 | [PR-B6](./plans/PR-B6-REVERSE-AVAILABILITY.md) |
| **UI モード選択** | Phase 1 | - |
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
| **Reverse Availability** | `schedule.1on1.reverse_availability` | 🔜 相手の空きから候補を出してもらう（ご都合伺い） | [PR-B6 計画](./plans/PR-B6-REVERSE-AVAILABILITY.md) |

### 1対N (FE-5 + FE-6 完了)

| 経路 | 説明 | 実装 |
|------|------|------|
| **Post-Import Bridge (FE-5)** | Contact Import後の自動接続 | `postImportBridge.ts` |
| **Chat Direct (FE-6)** | NL入力→直接1対N調整 | `classifier/oneToMany.ts` + `executors/oneToMany.ts` |

---

## テスト状況

### ✅ 全テストグリーン (2026-02-23)

| カテゴリ | テストファイル数 | テスト数 | 状況 |
|----------|-----------------|----------|------|
| **Unit Tests (vitest)** | 16 | 354 | ✅ All Pass |
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
| `resolveContact.test.ts` | 19 | 連絡先解決テスト |
| `oneToMany.test.ts (classifier)` | 15 | FE-6 classifier テスト |
| `executorRefresh.test.ts` | 15 | executor リフレッシュテスト |
| `oneOnOne.regression.test.ts` | 13 | 1対1回帰テスト |
| `batch.test.ts` | 12 | P2-B1 バッチテスト |
| `contact-import-fe1.test.ts` | 11 | 連絡先取込FEテスト |
| `remind.test.ts` | 11 | リマインドテスト |
| `oneToMany.test.ts (executor)` | 10 | FE-6 executor テスト |
| `business-card-chat-ui.test.ts` | 9 | 名刺チャットUIテスト |
| `business-card-scan-fe.test.ts` | 6 | 名刺スキャンテスト |

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
| 8 | oneOnOne | `schedule.1on1.*` | `oneOnOne.ts` |
| 9 | propose | `schedule.auto_propose` | `propose.ts` |
| 10 | remind | `schedule.remind.*` | `remind.ts` |
| 11 | relation | `relation.*` | `relation.ts` |
| 12 | pool | `pool_booking.*` | `pool.ts` |
| 13 | thread | `thread.*` | `thread.ts` |

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
│   │       │   ├── index.ts        # 統合チェーン (13分類器)
│   │       │   ├── oneToMany.ts    # FE-6: 1対N分類器 ★NEW
│   │       │   ├── oneOnOne.ts     # 1対1分類器
│   │       │   ├── contactImport.ts
│   │       │   └── ...
│   │       ├── executors/
│   │       │   ├── index.ts        # 統合エクスポート
│   │       │   ├── oneToMany.ts    # FE-6: 1対Nexecutor ★NEW
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

1. **FE-6b**: ホストカレンダー FreeBusy for 1-to-N (デフォルトスロット→実カレンダー連携)
2. **UI モード選択**: ユーザーが調整モードを明示的に選択可能に
3. **Slack/Chatwork 自動チャンネル**: send_via のプリコンフィグ拡張
4. **E2E テスト拡充**: 1対N フローの統合テスト

---

## 関連ドキュメント

- [日程調整パターン・ルール](./SCHEDULING_PATTERNS_AND_RULES.md)
- [アーキテクチャ概要](./ARCHITECTURE_OVERVIEW_2026_02.md)
- [データベーススキーマ](./DATABASE_SCHEMA.md)
- [マイグレーション履歴](./MIGRATION_HISTORY.md)
- [FE-5 PRD](./PRD-FE-5-post-import-auto-connect.md)

---

*このドキュメントは主要な変更時に更新されます。*
