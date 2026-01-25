# apiExecutor.ts リファクタリング計画

## 概要

`frontend/src/core/chat/apiExecutor.ts` は肥大化し（2085行）、保守性が低下していたため、
責務ごとに `executors/` ディレクトリに分割するリファクタリングを実施。

## Phase 1: apiExecutor 分割（完了）

### 目的
- apiExecutor.ts を薄くして "壊れにくい構造" を作る
- 責務ごとにファイルを分割し、依存関係を明確化
- 共通ヘルパーを `shared/` に集約

### 実績

| Phase | PR | 内容 | 行数変化 | 累計削減 |
|-------|-----|------|----------|----------|
| 1-1 | #8 | invite executors 分離 | 2085→1796 (-289) | -289 (14%) |
| 1-2 | #9 | pending executor 分離 | 1796→1648 (-148) | -437 (21%) |
| 1-3a | #10 | autoPropose executors 分離 | 1648→1193 (-455) | -892 (43%) |
| 1-3b | #11 | buildPrepareMessage shared化 | 1193→1193 (0) | -892 (43%) |

### executors ディレクトリ構成（Phase 1 完了時点）

```
frontend/src/core/chat/executors/
├── shared/
│   ├── cache.ts          # getStatusWithCache
│   ├── refresh.ts        # refreshAfterWrite
│   └── prepareMessage.ts # buildPrepareMessage
├── autoPropose.ts        # Phase 1-3a: auto_propose, additional_propose, split_propose
├── pending.ts            # Phase 1-2: pending.action.decide
├── invite.ts             # Phase 1-1: invite.prepare.emails, invite.prepare.list
├── calendar.ts           # schedule.today, schedule.week, schedule.freebusy
├── list.ts               # list.create, list.list, list.members, list.add_member
├── thread.ts             # thread.create, schedule.status, schedule.finalize
├── remind.ts             # remind.pending, remind.need_response, remind.responded
├── batch.ts              # batch処理最適化
├── preference.ts         # P3-PREF: 好み設定
├── types.ts              # ExecutionResult, ExecutionContext 型定義
└── index.ts              # re-export（外部I/Fとして必要なもののみ）
```

### 設計原則

1. **apiExecutor.ts は呼び出しのみ**
   - switch-case で適切な executor を呼ぶだけ
   - ビジネスロジックは executors/ に移動

2. **shared/ は内部共有のみ**
   - `executors/index.ts` からは export しない
   - 各 executor が直接 import

3. **出力文字列の互換性維持**
   - `buildPrepareMessage` 等のメッセージ生成関数は1文字も変えない
   - E2E/運用の互換性を保証

### DoD チェックリスト（Phase 1）

- [x] npm run build OK
- [x] npm run lint OK (warnings only)
- [x] npm test OK (170 tests passed)
- [x] apiExecutor.ts 43%削減 (2085→1193)
- [x] 循環依存なし
- [x] 外部I/F維持（ExecutionResult format）

---

## Phase 2: threads.ts 分割（計画中）

### 目的
- `apps/api/src/threads.ts` の分割
- invite, proposals, votes 等を責務ごとに分離

### 計画
（Phase 2 開始時に詳細化）

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-25 | Phase 1 完了（PR #8, #9, #10, #11） |
