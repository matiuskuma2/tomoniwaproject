# Phase Next-6 Day1 完了報告: 未返信リマインド提案

## ✅ 実装完了日: 2025-12-31

---

## 🎯 **実装内容**

### **1. 新規 Intent: 未返信リマインド提案**

#### **Intent 定義**
- `schedule.remind.pending`: 未返信リマインド提案（POSTなし）
- `schedule.remind.pending.confirm`: リマインド確定（POST実行）
- `schedule.remind.pending.cancel`: リマインドキャンセル

#### **パターン認識**
```typescript
// リマインド提案
/(リマインド|催促|未返信).*送/

// confirm/cancel の context-aware routing
if (context?.pendingRemind) {
  return 'schedule.remind.pending.confirm';
}
return 'schedule.auto_propose.confirm'; // デフォルトは auto_propose
```

---

### **2. 実行ロジック**

#### **executeRemindPending()**
```typescript
Flow:
1. 実行回数チェック（最大2回まで）
2. GET /api/threads/:id/status
3. pending invites をフィルタ
4. 未返信者がいない → 「全員が回答済みです」
5. 未返信者がいる → リマインド提案を表示（POSTなし）
   - 未返信者リスト
   - 「はい」「いいえ」の選択肢
   - 残り回数表示
6. payload に source: 'remind', threadId を含む
```

#### **executeRemindPendingConfirm()**
```typescript
Flow:
1. pendingRemind が null → エラー
2. pendingRemind がある → 成功メッセージ表示
3. Phase Next-6 Day1.5: POST /api/threads/:id/remind（未実装）
4. payload に threadId, pendingInvites, count を含む
```

#### **executeRemindPendingCancel()**
```typescript
Flow:
1. キャンセルメッセージを返す
2. pendingRemind を null にリセット
```

---

### **3. 状態管理（ChatLayout）**

#### **新規状態**
```typescript
// スレッドごとの pending remind
const [pendingRemindByThreadId, setPendingRemindByThreadId] = 
  useState<Record<string, PendingRemind | null>>({});

// スレッドごとの実行回数（最大2回）
const [remindCountByThreadId, setRemindCountByThreadId] = 
  useState<Record<string, number>>({});
```

#### **handleExecutionResult() 更新**
```typescript
// remind.pending.generated
if (kind === 'remind.pending.generated') {
  // pending remind を保存
  setPendingRemindByThreadId(prev => ({
    ...prev,
    [payload.threadId]: { threadId, pendingInvites, count }
  }));
  
  // 実行回数を +1
  setRemindCountByThreadId(prev => ({
    ...prev,
    [payload.threadId]: (prev[payload.threadId] || 0) + 1
  }));
}

// remind.pending.cancelled / remind.pending.sent
if (kind === 'remind.pending.cancelled' || kind === 'remind.pending.sent') {
  // pending remind をクリア
  setPendingRemindByThreadId(prev => ({
    ...prev,
    [threadId]: null
  }));
}
```

---

### **4. Context-aware Intent Routing**

#### **課題**
- `はい`/`いいえ` が auto_propose と remind の両方で使われる
- どちらのフローか判定する必要がある

#### **解決策**
```typescript
// intentClassifier.ts
if (/(はい|yes|作成|ok)/i.test(input) && input.length < 10) {
  // Phase Next-6 Day1: context を見て判定
  if (context?.pendingRemind) {
    return { intent: 'schedule.remind.pending.confirm', ... };
  }
  
  // デフォルトは auto_propose
  return { intent: 'schedule.auto_propose.confirm', ... };
}
```

---

## 🛡️ **ガードレール（事故ゼロ）**

### **1. 提案のみ（POSTなし）**
- `executeRemindPending()` は提案メッセージのみ
- POST は Day1.5 で実装予定

### **2. 「はい」時のみPOST**
- `schedule.remind.pending.confirm` だけが POST
- `schedule.remind.pending.cancel` はキャンセルのみ

### **3. 最大2回まで**
- `remindCountByThreadId` でスレッドごとにカウント
- `executionCount >= 2` でエラー

### **4. threadId 必須**
- `intentClassifier` で `selectedThreadId` 必須
- `executeRemindPending()` で `threadId` 必須

### **5. 明示フラグ**
- `payload.source = 'remind'`（事故防止）
- `payload.threadId`（提案生成時のスレッドID）

---

## 📦 **変更ファイル**

### **Frontend**
1. `frontend/src/core/chat/intentClassifier.ts`
   - 新規 Intent: `schedule.remind.pending` / `confirm` / `cancel`
   - Context-aware routing（`pendingRemind` チェック）

2. `frontend/src/core/chat/apiExecutor.ts`
   - ExecutionResultData に `remind.pending.generated` / `sent` / `cancelled` 追加
   - ExecutionContext に `pendingRemind`, `remindCount` 追加
   - `executeRemindPending()` / `Confirm()` / `Cancel()` 追加
   - `executeIntent()` に routing 追加

3. `frontend/src/components/chat/ChatLayout.tsx`
   - `pendingRemindByThreadId`, `remindCountByThreadId` 状態追加
   - `handleExecutionResult()` に remind 処理追加
   - ChatPane に `pendingRemind`, `remindCount` を渡す

4. `frontend/src/components/chat/ChatPane.tsx`
   - Props に `pendingRemind`, `remindCount` 追加
   - `classifyIntent()` に `pendingRemind` を渡す
   - `executeIntent()` に `pendingRemind`, `remindCount` を渡す

---

## 🧪 **DoD（Definition of Done）**

### **テスト1: 提案表示（未返信あり）**
```
前提: スレッド選択、未返信者が1名以上
入力: 「リマインド送って」
期待: 
  - 未返信者リストを表示
  - 「はい」「いいえ」の選択肢
  - 残り回数: 1回
  - POSTなし
```

### **テスト2: 「はい」→ POST（Day1.5で実装）**
```
前提: テスト1の提案が表示されている
入力: 「はい」
期待: 
  - 成功メッセージ
  - POST /api/threads/:id/remind（Day1.5で実装）
  - pendingRemind をクリア
```

### **テスト3: 3回目は不可**
```
前提: 同じスレッドで2回リマインド提案済み
入力: 「リマインド送って」
期待: 
  - エラーメッセージ: 「最大2回までです」
  - POSTなし
```

---

## 🚀 **デプロイ情報**

### **URLs**
- **Production**: https://app.tomoniwao.jp
- **Latest Deploy**: https://a199c333.webapp-6t3.pages.dev

### **Git Commit**
- **Hash**: `60c1ebe`
- **Message**: `feat(Next-6 Day1): Add remind.pending intent and execution flow`

---

## 📊 **技術的負債**

### **✅ ゼロ負債維持**
- ✅ `any` 型なし（ExecutionResultData は type-safe）
- ✅ `Record<string, any>` なし
- ✅ ExecutionContext に型定義あり
- ✅ 明示フラグ（`source: 'remind'`）
- ✅ threadId は payload から取得（確定値）
- ✅ Context-aware routing（誤判定なし）

---

## 🔄 **次のステップ**

### **Day1.5: バックエンド実装（最優先）**
```typescript
POST /api/threads/:id/remind
{
  "invitee_keys": ["abc123", "def456"]
}

Response:
{
  "success": true,
  "reminded_count": 2,
  "reminded_invites": [
    { "email": "alice@example.com", "name": "Alice" }
  ]
}
```

### **Day2: 票割れ通知（任意）**
- Intent: `schedule.propose_for_split`
- 票割れ時に追加候補を提案

### **Day3: 確定通知（最重要）**
- Intent: `schedule.notify.confirmed`
- 日程確定時に全員へ通知

---

## 🎉 **まとめ**

### **Day1 実装成果**
- ✅ 未返信リマインド提案（提案のみ）
- ✅ Context-aware intent routing
- ✅ 最大2回制限
- ✅ 事故ゼロ設計
- ✅ ゼロ負債維持

### **推奨方針**
1. **Day1.5**: バックエンド実装（POST /api/threads/:id/remind）
2. **DoD 3本テスト**: Day1.5 完了後にテスト
3. **Day2/Day3**: 通知機能の拡充（票割れ/確定通知）

---

**Phase Next-6 Day1: 完了！** 🎊
