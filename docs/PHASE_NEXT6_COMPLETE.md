# Phase Next-6 完了報告（正式クローズ）

**Date**: 2025-12-31  
**Phase**: Next-6 - Context-Aware Notifications (リマインド・票割れ・確定通知)  
**Status**: ✅ 完了（全 Day クローズ）

---

## 🎯 Phase Next-6 概要

### 目的
スレッドの状態に応じて、適切な通知提案を自動生成する：
1. **未返信リマインド**: 参加者が返信していない場合にリマインド提案
2. **票割れ検知**: 投票が割れている場合に追加候補提案へ誘導
3. **確定通知**: 日程確定後に参加者への通知を生成

### ガードレール（事故ゼロ設計）
- ✅ **提案のみ**: 勝手に送信しない（POST は確認後のみ）
- ✅ **最大2回制限**: additionalProposeCount / remindCount で制限
- ✅ **スレッド選択必須**: threadId がない場合は動作しない
- ✅ **Context-aware Routing**: split > notify > remind > auto_propose の優先順位

---

## 📦 完了した Day（4本）

### ✅ Day1: 未返信リマインド提案
**Date**: 2025-12-30  
**Document**: `docs/PHASE_NEXT6_DAY1_SUMMARY.md`

**実装内容**:
- Intent: `schedule.remind.pending`, `schedule.remind.confirm`, `schedule.remind.cancel`
- 未返信者検知: `status.invites` で `status !== 'responded'` をフィルタ
- 提案表示: 未返信者リスト + 「はい/いいえ」
- POST なし: 提案のみ、確認後に Day1.5 へ

**DoD結果**:
- ✅ 未返信者が検出される
- ✅ 「はい/いいえ」が表示される
- ✅ POST が発生しない

---

### ✅ Day1.5: リマインド API 実装（A案: 送信用セット返す）
**Date**: 2025-12-30  
**Document**: `docs/PHASE_NEXT6_DAY1.5_COMPLETE.md`

**実装内容**:
- API: `POST /api/threads/:id/remind`
- 入力: `invitee_keys[]`
- 出力: `reminders[]` - 送信用メールセット（送信はしない）
- Frontend: `executeRemindConfirm()` で API 呼び出し
- 結果表示: 「リマインドを作成しました（X件）」+ メール内容プレビュー

**DoD結果**:
- ✅ API がメールセットを返す
- ✅ Frontend が結果を表示
- ✅ 実際の送信はしない（ユーザーが手動送信）

---

### ✅ Day2: 票割れ検知 → Day3 追加候補提案へ誘導
**Date**: 2025-12-31  
**Document**: `docs/PHASE_NEXT6_DAY2_COMPLETE.md`

**実装内容**:
- Intent: `schedule.propose_for_split`, `schedule.propose_for_split.confirm`, `schedule.propose_for_split.cancel`
- 票割れ検知: `analyzeSplitVotes(status)` - `maxVotes <= 1` or `topSlots.length >= 2`
- Backend修正: `threadsStatus.ts` で `slots[].votes` を返す（サーバー側集計）
- Frontend修正: `getSlotVotes()` 削除、`slot.votes` 参照に統一
- 提案表示: 「💡 票が割れています。追加候補を出しますか？」+ 投票状況
- 確認後: Day3 追加候補提案へ内部呼び出し（`executeAdditionalProposeByThreadId()`）

**DoD結果（実機テスト）**:
- ✅ DoD1: 票割れ提案が表示される（投票状況 + はい/いいえ）
- ✅ DoD2: 「はい」で Day3 追加候補3本が表示される
- ✅ DoD3: 「いいえ」でキャンセル（POST なし）

**修正内容**:
- **P0-1**: 票数が常に0 → Backend で `slots[].votes` を返すように修正（負債ゼロ化）
- **P0-3**: チャット履歴が消える → localStorage 永続化 + 二重seed防止
- **P1**: スマホで毎回読み込み → localStorage 保存を 500ms debounce + 失敗時自動OFF

**最新デプロイ**:
- Latest Deploy: https://bff77ecf.webapp-6t3.pages.dev
- Production: https://app.tomoniwao.jp
- Commit: `9f8e9d1` - feat(P1): Debounce localStorage saves (500ms) + auto-disable on failures

---

### ✅ Day3: 確定通知（A案: 送信用セット返す）
**Date**: 2025-12-30  
**Document**: `docs/PHASE_NEXT6_DAY3_COMPLETE.md`

**実装内容**:
- Intent: `schedule.notify.confirmed`, `schedule.notify.confirmed.confirm`, `schedule.notify.confirmed.cancel`
- API: `POST /api/threads/:id/notify/confirmed`
- 入力: `final_slot_id`
- 出力: `notifications[]` - 送信用メールセット（送信はしない）
- Frontend: `executeNotifyConfirmedConfirm()` で API 呼び出し
- 結果表示: 「確定通知を作成しました（X件）」+ メール内容プレビュー

**DoD結果**:
- ✅ API がメールセットを返す
- ✅ Frontend が結果を表示
- ✅ 実際の送信はしない（ユーザーが手動送信）

---

## 🏗️ アーキテクチャ設計

### Context-Aware Routing（優先順位）
```typescript
// intentClassifier.ts
// Priority: split > notify > remind > auto_propose

if (pendingSplit) {
  // Day2: 票割れ提案の「はい/いいえ」
  return yesPattern ? 'schedule.propose_for_split.confirm' : 'schedule.propose_for_split.cancel';
}

if (pendingNotify) {
  // Day3: 確定通知の「はい/いいえ」
  return yesPattern ? 'schedule.notify.confirmed.confirm' : 'schedule.notify.confirmed.cancel';
}

if (pendingRemind) {
  // Day1: リマインド提案の「はい/いいえ」
  return yesPattern ? 'schedule.remind.confirm' : 'schedule.remind.cancel';
}

if (pendingAutoPropose) {
  // Day0: 自動提案の「はい/いいえ」
  return yesPattern ? 'schedule.auto_propose.confirm' : 'schedule.auto_propose.cancel';
}
```

### 状態管理（per-thread）
```typescript
// ChatLayout.tsx
const [pendingSplitByThreadId, setPendingSplitByThreadId] = useState<Record<string, PendingSplit | null>>({});
const [pendingNotifyByThreadId, setPendingNotifyByThreadId] = useState<Record<string, PendingNotify | null>>({});
const [pendingRemindByThreadId, setPendingRemindByThreadId] = useState<Record<string, PendingRemind | null>>({});
const [remindCountByThreadId, setRemindCountByThreadId] = useState<Record<string, number>>({});
```

### 負債ゼロ設計
1. **サーバー側集計**: 票数は Backend で集計して `slots[].votes` で返す
2. **localStorage 永続化**: リロード後も履歴が残る
3. **Debounce**: 500ms で localStorage 保存頻度を削減
4. **自動OFF**: 3回連続失敗で localStorage 永続化を自動無効化
5. **二重seed防止**: `seededThreads` Set でスレッドごとに seed を1回のみ実行

---

## 📱 スマホ前提設計

### 現状（Web版）
- ✅ レスポンシブデザイン（タブ切り替え: スレッド / チャット / カード）
- ✅ タップ操作に最適化
- ✅ localStorage 永続化（リロード対応）
- ✅ Debounce で体感速度改善

### 将来（ネイティブ化）
- 🔜 プッシュ通知
- 🔜 カレンダー同期（Google Calendar / Apple Calendar）
- 🔜 オフライン対応
- 🔜 ネイティブの音声UX（TTS は削除予定）

---

## 🔊 TTS（読み上げ）の扱い

### 現状
- TTS は実装済みだが、**他機能に依存させない**設計
- 表示 / 提案 / confirm のロジックに TTS は絡まない

### 将来
- **削除予定**: ネイティブ化で音声UXは置き換える
- **1フラグでOFF可能**: `FEATURE_TTS_ENABLED` フラグで完全無効化
- **依存禁止**: 新規機能は TTS に依存しない

---

## 🚀 デプロイ情報

### Production
- URL: https://app.tomoniwao.jp
- Branch: `main`

### Latest Deploy
- URL: https://bff77ecf.webapp-6t3.pages.dev
- Commit: `9f8e9d1`

### GitHub Repository
- URL: https://github.com/matiuskuma2/tomoniwaproject

---

## 📊 テスト結果（実機）

### Day1: 未返信リマインド
- ✅ 未返信者検出
- ✅ 「はい/いいえ」表示
- ✅ POST なし

### Day1.5: リマインド API
- ✅ メールセット生成
- ✅ 結果表示
- ✅ 実際の送信なし

### Day2: 票割れ検知
- ✅ 票割れ提案表示（投票状況 + はい/いいえ）
- ✅ 「はい」で Day3 追加候補表示
- ✅ 「いいえ」でキャンセル

### Day3: 確定通知
- ✅ メールセット生成
- ✅ 結果表示
- ✅ 実際の送信なし

---

## 🎓 技術的成果

### 1. Context-Aware Routing の実装
- 優先順位に基づく「はい/いいえ」の自動分岐
- スレッド状態に応じた提案生成

### 2. 負債ゼロのアーキテクチャ
- サーバー側集計（票数）
- localStorage 永続化 + Debounce
- 自動OFF機能（失敗時）

### 3. ガードレール設計
- 提案のみ（POST なし）
- 最大2回制限
- スレッド選択必須

---

## 📝 次のステップ

### Phase Next-7: カレンダー同期（審査待ち）
- **Day0**: 設計のみ（Runbook + API I/F）
- **実装**: 審査完了後
- **スコープ**: 確定後のみ同期、差分更新なし、失敗時は手動案内

### TTS 削除計画
- **Phase**: 未定（ネイティブ化後）
- **方針**: `FEATURE_TTS_ENABLED` フラグで無効化

---

## ✅ 結論

**Phase Next-6 は全 Day（Day1/1.5/2/3）が完了し、正式にクローズしました。**

- ✅ DoD: 全テストPASS（実機確認済み）
- ✅ 負債: ゼロ（サーバー側集計、localStorage永続化、Debounce）
- ✅ ガードレール: 勝手に送信しない、最大2回制限、スレッド選択必須
- ✅ スマホ対応: レスポンシブデザイン、Debounce で体感速度改善

次は **Phase Next-7 Day0（設計のみ）** へ進みます。🚀
