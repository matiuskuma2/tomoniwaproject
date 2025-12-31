# Phase Next-6 Day2: 票割れ通知（Split Vote Detection）完了報告

## 実装日時
- 2025-12-31

## 実装方針
**A案（事故ゼロ＋負債ゼロの最小差分）**
- 内部的に Next-5 Day3 を叩いて"追加候補3本を提案"まで自動
- **提案のみ**実施、POSTは Day3 の既存 confirm 以外では発生しない
- ガードレール: 自動送信なし、POSTははい時のみ、最大2回まで、threadId必須

---

## 実装概要

### 1. Intent定義（intentClassifier.ts）
**新規Intent:**
- `schedule.propose_for_split`: 票割れ提案（POSTなし）
- `schedule.propose_for_split.confirm`: 票割れ提案確定（追加候補へ）
- `schedule.propose_for_split.cancel`: 票割れ提案キャンセル

**Context追加:**
```typescript
pendingSplit?: {
  threadId: string;
} | null;
```

**パターン認識:**
- 票割れ検知: `/(票割れ|割れてる|票が割れて)/` を含む入力
- threadId 未選択時: `needsClarification` でエラーメッセージ
- 「はい/いいえ」の Context-aware routing 優先順位:
  - **split > notify > remind > auto_propose**

---

### 2. 票割れ検知ロジック（apiExecutor.ts）

**analyzeSplitVotes() 実装（純関数）:**
```typescript
function analyzeSplitVotes(status: ThreadStatus_API): {
  shouldPropose: boolean;
  summary: Array<{ label: string; votes: number }>;
}
```

**トリガー条件（2つのみ）:**
1. **maxVotes <= 1**: 誰も票を集められていない
2. **topSlots.length >= 2**: 同点で複数候補が並んでいる

**データ構造:**
```typescript
{
  kind: 'split.propose.generated',
  payload: {
    source: 'split',
    threadId: string,
    voteSummary: Array<{ label: string; votes: number }>
  }
}
```

---

### 3. Executor実装（apiExecutor.ts）

**executeProposeForSplit():**
- 票割れ検知 → 提案メッセージを表示
- 「追加候補を出しますか？（はい/いいえ）」
- POSTなし、提案のみ

**executeProposeForSplitConfirm():**
- **A案**: 内部的に `executeAdditionalPropose()` を呼ぶ
- Next-5 Day3 の追加候補提案フローへ誘導
- POST は Day3 の confirm でのみ発生

**executeProposeForSplitCancel():**
- pendingSplit をクリア
- POSTなし

---

### 4. 状態管理（ChatLayout.tsx）

**新規State:**
```typescript
const [pendingSplitByThreadId, setPendingSplitByThreadId] = useState<
  Record<string, PendingSplit | null>
>({});
```

**handleExecutionResult() 更新:**
- `split.propose.generated`: pendingSplit をセット
- `split.propose.cancelled`: pendingSplit をクリア
- `auto_propose.generated`: Day3 の追加候補が生成されたら split をクリア

---

### 5. Props伝達（ChatPane.tsx）

**新規Props:**
```typescript
pendingSplit?: {
  threadId: string;
} | null;
```

**Context伝達:**
- `classifyIntent()` に pendingSplit を渡す
- `executeIntent()` に pendingSplit を渡す

---

## ガードレール

### 事故ゼロ設計
1. **自動送信なし**: 提案のみ、POSTなし
2. **POST は「はい」時のみ**: confirm でのみ Next-5 Day3 へ
3. **最大2回制限**: additionalProposeCount で制御
4. **threadId必須**: スレッド選択中のみ動作

### Context-aware Routing
- **split > notify > remind > auto_propose** の優先順位
- 複数の pending が同時に存在する場合でも衝突しない

---

## DoD（Definition of Done）

### テスト3本
1. **票割れ検知 → 提案表示**
   - 前提: スレッド選択、status.check 実行後
   - 入力: 「状況教えて」
   - 期待: 票割れ条件を満たす場合「追加候補を出しますか？」表示（POSTなし）

2. **「はい」 → 追加候補提案へ**
   - 前提: テスト1で提案表示
   - 入力: 「はい」
   - 期待: Next-5 Day3 の追加候補3本が生成（POSTなし）

3. **「いいえ」 → キャンセル**
   - 前提: テスト1で提案表示
   - 入力: 「いいえ」
   - 期待: キャンセルメッセージ、POSTなし、pendingSplit クリア

---

## デプロイ情報

### Production URL
- **本番**: https://app.tomoniwao.jp
- **Latest Deploy**: https://65eaa690.webapp-6t3.pages.dev

### Git Commits
- **0da8de5**: feat(Next-6 Day2): Add split vote detection (A案: 追加候補提案へ誘導)

---

## Phase Next-6 の全体進捗

### 完了済み
- ✅ **Day1**: 未返信リマインド提案（POSTなし）
- ✅ **Day1.5**: リマインドAPI実装（A案: 送信用セット返す）
- ✅ **Day3**: 確定通知提案（A案: 送信用セット返す）
- ✅ **Day2**: 票割れ通知（A案: 追加候補提案へ誘導）

### 4つのフロー統合完了
1. **未返信リマインド**: remind.pending → API → 送信用セット
2. **確定通知**: notify.confirmed → API → 送信用セット
3. **票割れ通知**: split.propose → Day3 追加候補 → 提案
4. **自動調整**: auto_propose → 候補生成 → 提案

### Context-aware Routing
- **split > notify > remind > auto_propose** の優先順位
- 4つのフローが衝突せず動作

---

## 設計上の成果

### 事故ゼロ設計
- メール送信なし（A案）
- 手動コピー前提
- POSTは明示的な「はい」のみ

### 負債ゼロ設計
- 既存コードの再利用（Day3 の追加候補フロー）
- 純関数による票割れ検知
- Type-safe な状態管理

### 拡張性
- 新しい pending 追加が容易
- Context-aware routing で優先順位変更が簡単
- 各フローが独立して動作

---

## 次のステップ（推奨）

### Option 1: Next-6 完全クローズ
- **Day2 DoD テスト実施** → 正式クローズ
- Phase Next-6 を完全に終了

### Option 2: Next-7 Day0（設計のみ）
- **カレンダー同期設計**（並行OK）
- 設計・Runbook・I/F確定のみ
- 実装は審査完了後

---

## 次の質問
Phase Next-6 Day2 の DoD テストを実施して正式にクローズしますか？
それとも Next-7 Day0（カレンダー同期設計）を先に固めますか？

---

**Phase Next-6 Day2 完了報告 - 2025-12-31**
