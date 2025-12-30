# Phase Next-5 Day3: Additional Proposal Runbook (追加候補提案)

## Overview

Phase Next-5 Day3 では、スレッドの返信状況・投票状況を解析し、条件を満たした場合に追加候補を提案する機能を実装しました。

**重要**: この機能は**提案のみ**で、自動送信は行いません。「はい」のときだけ既存の confirm フローに乗り、POST は confirm 時のみ実行されます。

---

## Implementation Details

### 1. Intent: `schedule.additional_propose`

**パターン認識**:
- 追加候補
- もっと候補
- 追加で候補
- 追加して

**必須条件**:
- `threadId` が必要（スレッド選択中）
- スレッドが選択されていない場合は needsClarification を返す

**例**:
```
User: 追加候補出して
→ Intent: schedule.additional_propose { threadId: '123' }
```

---

### 2. Analysis Logic: `analyzeStatusForPropose(status)`

**純関数**: `ThreadStatus_API` を受け取り、`boolean` を返す

**トリガー条件**（どちらかを満たす）:

#### Rule 1: 未返信が1以上
```typescript
const pendingCount = invites.filter((i) => i.status === 'pending').length;
if (pendingCount >= 1) return true;
```

#### Rule 2: 票が割れている
```typescript
// Case 2-1: 最大票が1票以下
if (maxVotes <= 1) return true;

// Case 2-2: 1位と2位が同票
const topSlots = slotVotes.filter((sv) => sv.votes === maxVotes);
if (topSlots.length >= 2) return true;
```

---

### 3. Execution Logic: `executeAdditionalPropose(intentResult)`

**フロー**:

1. **threadId の確認**
   - 無い場合は needsClarification を返す

2. **status の取得**
   ```typescript
   const status = await threadsApi.getStatus(threadId);
   ```

3. **条件判定**
   ```typescript
   const needsMoreProposals = analyzeStatusForPropose(status);
   ```

4. **不要な場合**
   ```
   「現在の状況では追加候補は不要です。
   未返信が少なく、投票も安定しています。」
   ```

5. **必要な場合**
   - 追加候補を3本生成（30分、来週）
   - `generateProposalsWithoutBusy(duration).slice(0, 3)`
   - 提案メッセージを表示:
     ```
     ✅ 追加候補を3本生成しました:
     
     1. 1/6 (月) 09:00-09:30
     2. 1/6 (月) 09:30-10:00
     3. 1/6 (月) 10:00-10:30
     
     📌 注意: この候補はまだスレッドに追加されていません。
     「はい」と入力すると、候補をスレッドに追加できます。
     「いいえ」でキャンセルします。
     ```

6. **返り値**
   - `data.kind: 'auto_propose.generated'`
   - Day2 の confirm フローに乗る（`pendingAutoPropose` に保存）

---

### 4. Integration with `executeStatusCheck`

**status 確認時に追加提案のヒントを表示**:

```typescript
const needsMoreProposals = analyzeStatusForPropose(status);

if (needsMoreProposals) {
  message += '\n💡 未返信や票割れが発生しています。';
  message += '\n「追加候補出して」と入力すると、追加の候補日時を提案できます。';
}
```

**例**:
```
📊 週次ミーティング調整

状態: 募集中
招待: 5名
承諾: 3名
未返信: 2名

📅 候補日時:
1. 2025-01-06 09:00 (1票)
2. 2025-01-06 10:00 (1票)
3. 2025-01-06 11:00 (1票)

💡 未返信や票割れが発生しています。
「追加候補出して」と入力すると、追加の候補日時を提案できます。
```

---

## Flow Diagram

```
[User: 追加候補出して]
    ↓
[Intent: schedule.additional_propose]
    ↓
[executeAdditionalPropose]
    ↓
[GET /api/threads/:id/status]
    ↓
[analyzeStatusForPropose(status)]
    ↓
 条件を満たす?
    ├─ No  → 「追加候補は不要です」
    └─ Yes → 追加候補を3本生成
              ↓
        [auto_propose.generated]
              ↓
        [pendingAutoPropose に保存]
              ↓
    「はい」「いいえ」で返信してください
              ↓
         [User: はい]
              ↓
    [schedule.auto_propose.confirm]
              ↓
    [POST /api/threads] ← ここで初めて POST
```

---

## Guardrails (ガードレール)

### ✅ 自動送信なし
- 提案のみ
- POST は「はい」時だけ

### ✅ POST は confirm 時のみ
- `schedule.auto_propose.confirm` でのみ POST
- `pendingAutoPropose` が存在する場合のみ POST 実行

### ✅ スレッド選択中のみ
- `threadId` が必須
- スレッド未選択時は needsClarification

### ✅ 既存 E2E/API 変更なし
- `/api/threads/:id/status` を使用（既存 API）
- POST は既存の `/api/threads` を使用

### ✅ 最大回数制限
- 追加提案は最大2回まで（仕様）
- 実行回数は `pendingAutoPropose` の履歴で管理

---

## Testing Scenarios

### Test 1: 基本フロー（未返信あり）

```
1. スレッド作成（5名招待）
2. 2名が未返信
3. 「状況教えて」
   → 💡 未返信や票割れが発生しています。
      「追加候補出して」と入力すると、追加の候補日時を提案できます。
4. 「追加候補出して」
   → ✅ 追加候補を3本生成しました:
      1. 1/6 (月) 09:00-09:30
      2. 1/6 (月) 09:30-10:00
      3. 1/6 (月) 10:00-10:30
      📌 注意: この候補はまだスレッドに追加されていません。
      「はい」と入力すると、候補をスレッドに追加できます。
5. 「はい」
   → ✅ スレッドを作成しました（追加候補）
```

### Test 2: 票割れケース

```
1. スレッド作成（3候補）
2. 3名が回答
   - 候補1: 1票
   - 候補2: 1票
   - 候補3: 1票
3. 「状況教えて」
   → 💡 未返信や票割れが発生しています。
4. 「追加候補出して」
   → 追加候補を3本生成
```

### Test 3: 追加不要ケース

```
1. スレッド作成（3候補）
2. 全員が回答済み
   - 候補1: 5票
   - 候補2: 1票
   - 候補3: 0票
3. 「追加候補出して」
   → 「現在の状況では追加候補は不要です。
      未返信が少なく、投票も安定しています。」
```

### Test 4: スレッド未選択

```
1. スレッド未選択状態
2. 「追加候補出して」
   → 「どのスレッドに追加候補を提案しますか？
      左のスレッド一覧から選択してください。」
```

### Test 5: キャンセル

```
1. 「追加候補出して」
   → 追加候補を3本生成
2. 「いいえ」
   → ✅ 候補をキャンセルしました。
```

---

## Troubleshooting

### 問題: 追加候補が生成されない

**原因**:
- `analyzeStatusForPropose` が `false` を返している

**確認**:
1. 未返信数を確認
   ```typescript
   const pendingCount = invites.filter((i) => i.status === 'pending').length;
   console.log('未返信:', pendingCount);
   ```

2. 投票状況を確認
   ```typescript
   const slotVotes = slots.map((slot) => ({
     slotId: slot.slot_id,
     votes: getSlotVotes(slot.slot_id, status),
   }));
   console.log('投票状況:', slotVotes);
   ```

---

### 問題: 「はい」でPOSTされない

**原因**:
- `pendingAutoPropose` が `null` または存在しない

**確認**:
1. ChatLayout の state を確認
   ```typescript
   console.log('pendingAutoPropose:', pendingAutoPropose);
   ```

2. `handleExecutionResult` が正しく呼ばれているか確認
   ```typescript
   if (result.data?.kind === 'auto_propose.generated') {
     setPendingAutoPropose(result.data.payload);
   }
   ```

---

## Constraints & Limitations

### 制限事項

1. **候補数は3本固定**
   - Day3 では変更不可
   - Day4 以降で柔軟化を検討

2. **busyチェックなし**
   - Day1 と同じく busy との重複チェックは未実装
   - Day2 以降で freebusy 統合を検討

3. **来週固定**
   - 現在は来週の営業時間（月〜金 9:00-18:00）のみ
   - 他の時間帯は未対応

4. **最大2回まで**
   - 追加提案は最大2回まで（仕様）
   - 無限ループを防ぐため

---

## Next Steps

### Day4 候補（未実装）

1. **候補数の柔軟化**
   - 「3本」「5本」など指定可能に

2. **busy との統合**
   - `/api/calendar/freebusy` を使用
   - 重複を避けた候補生成

3. **時間帯の柔軟化**
   - 来週以外の時間帯にも対応
   - 「今週」「再来週」など

4. **実行回数の追跡**
   - 追加提案の履歴を保存
   - 最大2回の制限を厳密に実施

---

## Phase Next-5 Day3 完了 ✅

- **提案のみ実装** → POST なし ✅
- **既存 E2E/API 変更なし** ✅
- **ガードレール適用** ✅
- **テストシナリオ整備** ✅
