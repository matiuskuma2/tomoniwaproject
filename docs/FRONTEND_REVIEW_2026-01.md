# Frontend Code Review（2026-01）

> ChatLayout / ChatPane / CardsPane / ThreadDetailPage 周辺のコードレビュー
> 技術負債・運用インシデント・ネイティブ化・1万人同時接続の観点

## 📋 レビュー概要

### レビュー対象
- `ChatLayout.tsx` - 3カラムレイアウト + 状態管理
- `useChatReducer.ts` - 集約されたstate管理
- `ChatPane.tsx` - チャット表示 + 入力
- `CardsPane.tsx` - ステータスカード表示
- `apiExecutor.ts` - Intent実行エンジン
- `intentClassifier.ts` - Intent分類器
- `cache/` - キャッシュ層

### レビュー観点
1. 運用インシデント（P0）
2. 1万人同時接続の速度（P0-P2）
3. ネイティブアプリ化（P1）
4. コード保守性（P2）

---

## 🔴 運用インシデント（P0）

### P0-1: Pending系 State の正規化 ⚠️ 要改善

**問題**: 「はい/いいえが別スレッドに効く」系の事故リスク

**現状の危険パターン**:
```typescript
// useChatReducer.ts - 複数の pending が混在
pendingAutoPropose: PendingAutoPropose | null;  // グローバル
pendingAction: PendingActionState | null;        // グローバル
pendingRemindByThreadId: Record<string, PendingRemind | null>;  // per-thread
pendingNotifyByThreadId: Record<string, PendingNotify | null>;  // per-thread
pendingSplitByThreadId: Record<string, PendingSplit | null>;    // per-thread
```

**問題点**:
- グローバルとper-threadが混在
- 「どのpendingが今有効か」の判定が複雑
- スレッド切り替え時にグローバルpendingが残る

**推奨構造**:
```typescript
// 単一辞書に正規化
type PendingState = 
  | { type: 'auto_propose'; data: PendingAutoPropose }
  | { type: 'action'; data: PendingActionState }
  | { type: 'remind'; data: PendingRemind }
  | { type: 'notify'; data: PendingNotify }
  | { type: 'split'; data: PendingSplit }
  | { type: 'remind_need_response'; data: PendingRemindNeedResponse };

// threadId必須の単一辞書
pendingByThreadId: Record<string, PendingState | null>;
```

**改修チケット**: [pending-state-normalization]
- 工数: 4時間
- リスク: 中（既存の判定ロジック変更）
- 効果: 事故防止（confirm系の誤爆を根絶）

---

### P0-2: Statusキャッシュの正しさルール ⚠️ 要ドキュメント化

**問題**: 「キャッシュが効きすぎて古い状態を表示」リスク

**現状**:
- TTL 10秒のキャッシュ実装済み
- 強制refreshは一部のみ実装
- ルールが明文化されていない

**ルール固定（必須）**:

| 用途 | キャッシュ | 理由 |
|------|-----------|------|
| UI表示（カード/サマリ） | TTL 10s OK | 体感速度優先 |
| 操作系（確定/リマインド） | 強制refresh必須 | 最新データ必須 |
| Write後 | 強制refresh必須 | 整合性保証 |
| エラー時 | stale + revalidate | ユーザー体験維持 |

**改修チケット**: [cache-correctness-rules]
- 工数: 2時間
- リスク: 低（ドキュメント + 規約追加）
- 効果: 将来の事故防止

---

## 🟡 1万人同時接続の速度（P0-P2）

### PERF-S1: Status取得キャッシュ ✅ 完了

**実装済み**:
- TTL 10秒
- inflight共有
- 強制refresh
- optimistic update
- キャッシュ購読

**効果**:
- 同一threadIdの連続getStatusを抑制
- 同時リクエストを1本化
- サーバー負荷軽減

---

### PERF-S2: DOM肥大化防止 ✅ 完了

**実装済み**:
- メッセージ表示上限（50件）
- localStorage保存上限（100件/thread、20 threads）
- 省略メッセージ表示

**効果**:
- 長いチャットでもスクロールが死なない
- localStorage 5MB上限を超えない

---

### PERF-S3: Threads List / Inbox キャッシュ ⏳ 未着手

**目標**:
- `threadsApi.list()` をキャッシュ化（TTL 30秒）
- `inboxApi.list()` をキャッシュ化（TTL 30秒）
- inflight共有

**改修チケット**: [threads-list-cache]
- 工数: 2時間
- リスク: 低
- 効果: API呼び出し削減

---

### PERF-S4: AbortController導入 ⏳ 未着手

**問題**: スレッド切り替え連打で古いレスポンスが勝つ

**改修チケット**: [abort-controller]
- 工数: 2時間
- リスク: 低
- 効果: 連打事故防止

---

### PERF-S5: 仮想スクロール ⏳ 保留

**条件**: 表示上限で体感が改善しない場合のみ

**改修チケット**: [virtual-scroll]
- 工数: 1日
- リスク: 中（react-virtual導入）
- 効果: 表示上限撤廃可能

---

## 🟡 ネイティブアプリ化（P1）

### P1-C: Platform Adapters ✅ 完了

**実装済み**:
- `storage.ts` - localStorage抽象化
- `navigation.ts` - react-router抽象化
- `index.ts` - エクスポート

---

### P1-D: 追加Adapters ⏳ 未着手

**必要なAdapter**:
- `env.ts` - プラットフォーム判定
- `log.ts` - ログレベル + PII制御
- `clipboard.ts` - クリップボード
- `share.ts` - 共有機能
- `notifications.ts` - プッシュ通知

**改修チケット**: [platform-adapters-additional]
- 工数: 1日
- リスク: 低
- 効果: ネイティブ移行コスト削減

---

## 🟢 コード保守性（P2）

### TD-002: apiExecutor.ts 分割 🔄 進行中

**進捗**:
- `executors/calendar.ts` ✅ 完了（215行）
- `executors/list.ts` ✅ 完了（261行）
- `executors/thread.ts` ✅ 完了（484行）
- `executors/types.ts` ✅ 完了（162行）
- `apiExecutor.ts`: 2732→1852行（32%削減）

**残り**:
- remind系（executeRemindPending, executeRemindNeedResponse等）
- pending系（executePendingDecision, executeAutoPropose等）

**改修チケット**: [apiexecutor-split-phase2]
- 工数: 4時間
- リスク: 低
- 効果: 保守性向上

---

### TD-003: intentClassifier.ts 分割 ⏳ 未着手

**現状**: 763行の巨大ファイル

**分割案**:
- `classifiers/calendar.ts` - カレンダー系Intent
- `classifiers/thread.ts` - スレッド系Intent
- `classifiers/confirm.ts` - 確認系Intent
- `classifiers/list.ts` - リスト系Intent
- `classifiers/priority.ts` - 優先順位表

**改修チケット**: [intentclassifier-split]
- 工数: 1日
- リスク: 中（Intent判定ロジック変更リスク）
- 効果: 保守性向上 + Intent衝突防止

---

### TD-004: ChatLayout useReducer化 ✅ 完了

**実装済み**:
- `useChatReducer.ts` 作成（635行）
- `ChatLayout.tsx` 短縮（637→289行、54%削減）
- 15個の useState → 1個の useReducer

**効果**:
- 状態遷移が明確
- デバッグしやすい
- ネイティブ移行しやすい

---

## 📊 総評

### 良い方向

| 項目 | 評価 | 備考 |
|------|------|------|
| 状態のreducer集約 | ✅ | 運用事故に強い |
| Statusキャッシュ | ✅ | 1万人対策の第一歩 |
| toLocaleString禁止 | ✅ | TZ事故を潰す |
| Platform Adapter | ✅ | ネイティブ準備 |
| Executor分割 | ✅ | 保守性向上 |

### 危険ポイント（今後の主戦場）

| 項目 | 危険度 | 対策 |
|------|--------|------|
| Pending系正規化 | 🔴 高 | 単一辞書化必須 |
| キャッシュ正しさルール | 🟡 中 | ドキュメント化必須 |
| apiExecutor肥大 | 🟡 中 | 分割継続 |
| intentClassifier肥大 | 🟡 中 | 優先順位表固定 |

---

## 📋 改修チケット一覧（優先順）

### P0（運用事故防止）

| ID | 内容 | 工数 | 効果 |
|----|------|------|------|
| pending-state-normalization | Pending系正規化 | 4h | 事故防止 |
| cache-correctness-rules | キャッシュルール明文化 | 2h | 事故防止 |

### P1（1万人体感 / ネイティブ）

| ID | 内容 | 工数 | 効果 |
|----|------|------|------|
| threads-list-cache | スレッド一覧キャッシュ | 2h | API削減 |
| abort-controller | AbortController導入 | 2h | 連打事故防止 |
| platform-adapters-additional | 追加Adapter | 1d | ネイティブ準備 |

### P2（保守性）

| ID | 内容 | 工数 | 効果 |
|----|------|------|------|
| apiexecutor-split-phase2 | apiExecutor残り分割 | 4h | 保守性 |
| intentclassifier-split | intentClassifier分割 | 1d | 保守性 |

---

## 📝 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-14 | 初版作成 |

---

## 関連ドキュメント

- [FRONTEND_REFRESH_MAP.md](./FRONTEND_REFRESH_MAP.md) - Write→Refresh一覧
- [FRONTEND_PERF_PLAN.md](./FRONTEND_PERF_PLAN.md) - 1万人対応計画
- [FRONTEND_NATIVE_PREP.md](./FRONTEND_NATIVE_PREP.md) - ネイティブ化準備
- [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) - 全体設計
