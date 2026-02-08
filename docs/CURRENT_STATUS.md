# 現在の実装状況

> **最終更新**: 2026-02-08
> **最新コミット**: 262abd2 (main)

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
| **D0 関係性管理** | workmate申請→承諾フロー | PR #112 |
| **G2-A Pool Booking** | 受付プール予約システム | PR #113 |
| **PR-D: Contact Import** | Classifier Chain + CSV Parser + List Operation | PR #115 |
| **PR-D-API-1** | Contact Import API統合 — 事故ゼロ設計 | PR #116 |
| **PR-D-FE-1** | Contact Import フロントUI接続 — pending種別別UI切替 | PR #117 |
| **PR-D-FE-3** | 名刺OCR → Chat UI統合 → pending接続 — 事故ゼロ設計 | PR #118 |

### 🔄 進行中

| 機能 | 説明 | 状況 |
|------|------|------|
| **PR-D-FE-4** | 取り込み完了後 intent 抽出 + 次手チャット分岐（FEのみ） | PR #120 レビュー待ち |
| **pool_booking.create** | 管理者用プール作成executor | 設計済み |

### ❌ 対象外

| 機能 | 理由 |
|------|------|
| **N対N調整** | MVP対象外 |
| **Quest/Squad/Partner** | 複雑機能は除外 |

---

## E2Eテスト状況

### ✅ 全テストグリーン

| テストファイル | テスト数 | 状況 |
|---------------|----------|------|
| `relationships.spec.ts` (D0-R1) | 6 | ✅ Pass |
| `pools-booking.smoke.spec.ts` (G2-A) | 7 | ✅ Pass |
| `smoke.smoke.spec.ts` | - | ✅ Pass |
| `critical-path.spec.ts` | - | ✅ Pass |

### テスト実行コマンド

```bash
# D0 関係性テスト
cd frontend && npx playwright test e2e/relationships.spec.ts --grep D0-R1

# G2-A Pool Booking テスト  
cd frontend && npx playwright test e2e/pools-booking.smoke.spec.ts --grep "G2-A Pool Booking API"
```

---

## 最近のPRマージ履歴

| PR | タイトル | マージ日 |
|----|----------|----------|
| #113 | feat(frontend): Add G2-A pool_booking.book executor | 2026-02-05 |
| #112 | feat(frontend): Add D0 relation executors | 2026-02-05 |
| #110 | feat(g2-a): Add inbox notifications for Pool Booking | 2026-02-04 |

---

## ディレクトリ構造

```
tomoniwaproject/
├── apps/
│   └── api/
│       └── src/
│           ├── routes/           # APIルート
│           │   ├── threads.ts
│           │   ├── pools.ts      # G2-A Pool Booking
│           │   ├── relationships.ts  # D0 関係性
│           │   ├── oneOnOne.ts   # 1対1調整
│           │   └── ...
│           ├── repositories/     # データアクセス
│           └── middleware/       # 認証等
├── frontend/
│   └── src/
│       └── core/
│           ├── api/              # APIクライアント
│           │   ├── pools.ts      # G2-A
│           │   ├── relationships.ts  # D0
│           │   └── ...
│           └── chat/
│               ├── classifier/   # Intent分類
│               │   ├── pool.ts   # G2-A
│               │   ├── relation.ts   # D0
│               │   └── ...
│               └── executors/    # 実行ロジック
│                   ├── pool/     # G2-A
│                   ├── relation/ # D0
│                   └── ...
├── db/
│   └── migrations/               # DBマイグレーション
├── docs/                         # ドキュメント
│   ├── specs/                    # 仕様書
│   └── ADR/                      # アーキテクチャ決定記録
├── packages/
│   └── shared/                   # 共有型定義
└── tests/                        # テスト
```

---

## 主要ファイル一覧

### バックエンド (apps/api/src/)

| ファイル | 説明 | 行数目安 |
|----------|------|----------|
| `routes/threads.ts` | スレッドCRUD | ~800 |
| `routes/pools.ts` | Pool Booking API | ~1200 |
| `routes/relationships.ts` | 関係性管理API | ~400 |
| `routes/oneOnOne.ts` | 1対1調整API | ~300 |
| `routes/pendingActions.ts` | 確認フローAPI | ~400 |
| `repositories/poolsRepository.ts` | Pool DB操作 | ~800 |

### フロントエンド (frontend/src/core/)

| ファイル | 説明 | 行数目安 |
|----------|------|----------|
| `chat/apiExecutor.ts` | Intent実行 | ~600 |
| `chat/classifier/index.ts` | Intent分類統合 | ~200 |
| `chat/executors/pool/book.ts` | Pool予約executor | ~550 |
| `chat/executors/relation/*.ts` | 関係性executor | ~400 |
| `api/pools.ts` | Pool APIクライアント | ~400 |
| `api/relationships.ts` | 関係性APIクライアント | ~300 |

### データベース (db/migrations/)

| マイグレーション | 説明 |
|------------------|------|
| `0088_create_pool_booking.sql` | Pool Booking基本テーブル |
| `0089_add_last_assigned_member_id.sql` | Round-Robin用 |
| `0090_create_blocks_and_pool_public_links.sql` | ブロック+公開リンク |

---

## 次のステップ

1. **pool_booking.create executor** - 管理者がチャットでプール作成
2. **Block API テスト修正** - D0 Block テストの500エラー対応
3. **Conflict テスト修正** - 重複予約テストの修正

---

## 関連ドキュメント

- [日程調整パターン・ルール](./specs/SCHEDULING_PATTERNS_AND_RULES.md)
- [セットアップ・依存関係](./SETUP_AND_DEPENDENCIES.md)
- [README](../README.md)

---

*このドキュメントは主要な変更時に更新されます。*
