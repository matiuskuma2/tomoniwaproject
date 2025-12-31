# Phase Next-6 Day3 完了報告: 確定通知（A案・事故ゼロ）

## ✅ 実装完了日: 2025-12-31

---

## 🎯 **実装内容**

### **A案（最小で事故ゼロ）**

#### **方針**
- 確定通知提案（POSTなし）
- 「はい」で **送信用セット（テンプレ + 各相手の情報）** を返す
- **メール送信しない（事故ゼロ）**

---

## **実装詳細**

### **1. Intent 定義**

#### **新規 Intent（3つ）**
- `schedule.notify.confirmed`: 確定通知提案（POSTなし）
- `schedule.notify.confirmed.confirm`: 確定通知確定（POST実行・Day3.5で実装予定）
- `schedule.notify.confirmed.cancel`: 確定通知キャンセル

#### **パターン認識**
```typescript
// 確定通知提案
/(確定.*通知|みんな.*知らせ|全員.*連絡|確定.*送|確定.*伝え)/

// confirm/cancel は context-aware routing（優先順位: notify > remind > auto_propose）
```

---

### **2. Executor 実装**

#### **executeNotifyConfirmed()**
```typescript
Flow:
1. status を取得
2. status が confirmed かチェック
3. confirmed でない → 「まだ確定していません」
4. finalized && final_slot_id 存在チェック
5. 最終スロットを取得
6. 全招待者を取得（accepted or pending）
7. 提案メッセージを表示（POSTなし）
   - 確定日時
   - Meet URL（あれば）
   - 参加者リスト
   - 「はい/いいえ」の選択肢
8. payload に source: 'notify', threadId を含む
```

#### **executeNotifyConfirmedConfirm()**
```typescript
Flow:
1. pendingNotify が null → エラー
2. pendingNotify がある → テンプレ文面生成
3. A案: 送信用セットを表示（コピー用）
   - 各参加者ごとに
   - 件名: 日程調整完了のお知らせ
   - テンプレ文面（確定日時 + Meet URL）
4. payload に threadId, invites, count を含む
```

#### **executeNotifyConfirmedCancel()**
```typescript
Flow:
1. キャンセルメッセージを返す
2. pendingNotify を null にリセット
```

---

### **3. Context-aware Routing**

#### **優先順位**
```typescript
if (/(はい|yes)/i.test(input)) {
  // 優先順位: notify > remind > auto_propose
  if (context?.pendingNotify) {
    return 'schedule.notify.confirmed.confirm';
  }
  
  if (context?.pendingRemind) {
    return 'schedule.remind.pending.confirm';
  }
  
  // Default
  return 'schedule.auto_propose.confirm';
}
```

---

### **4. 状態管理（ChatLayout）**

#### **新規状態**
```typescript
// スレッドごとの pending notify
const [pendingNotifyByThreadId, setPendingNotifyByThreadId] = 
  useState<Record<string, PendingNotify | null>>({});
```

#### **handleExecutionResult() 更新**
```typescript
// notify.confirmed.generated
if (kind === 'notify.confirmed.generated') {
  setPendingNotifyByThreadId(prev => ({
    ...prev,
    [payload.threadId]: {
      threadId: payload.threadId,
      invites: payload.invites,
      finalSlot: payload.finalSlot,
      meetingUrl: payload.meetingUrl,
    }
  }));
}

// notify.confirmed.cancelled / notify.confirmed.sent
if (kind === 'notify.confirmed.cancelled' || kind === 'notify.confirmed.sent') {
  setPendingNotifyByThreadId(prev => ({
    ...prev,
    [threadId]: null
  }));
}
```

---

## 🛡️ **ガードレール（事故ゼロ）**

### **A案の安全性**
✅ **メール送信しない**: 送信用セットを返すだけ  
✅ **人が送る**: ユーザーが手動でコピー&ペースト  
✅ **事故ゼロ**: 誤送信の可能性ゼロ  
✅ **Confirmed チェック**: status === 'confirmed' のみ  
✅ **Finalized チェック**: evaluation.finalized && final_slot_id 存在  
✅ **Context-aware**: 優先順位（notify > remind > auto_propose）

---

## 📦 **変更ファイル**

### **Frontend**
1. `frontend/src/core/chat/intentClassifier.ts`
   - 新規 Intent: `schedule.notify.confirmed` / `confirm` / `cancel`
   - Context-aware routing 更新（優先順位: notify > remind > auto_propose）
   - IntentContext に `pendingNotify` 追加

2. `frontend/src/core/chat/apiExecutor.ts`
   - ExecutionResultData に `notify.confirmed.generated` / `sent` / `cancelled` 追加
   - ExecutionContext に `pendingNotify` 追加
   - `executeNotifyConfirmed()` / `Confirm()` / `Cancel()` 追加
   - `executeIntent()` に routing 追加

3. `frontend/src/components/chat/ChatLayout.tsx`
   - `pendingNotifyByThreadId` 状態追加
   - `handleExecutionResult()` に notify 処理追加
   - ChatPane に `pendingNotify` を渡す

4. `frontend/src/components/chat/ChatPane.tsx`
   - Props に `pendingNotify` 追加
   - `classifyIntent()` に `pendingNotify` を渡す
   - `executeIntent()` に `pendingNotify` を渡す

---

## 🧪 **DoD（Definition of Done）**

### **テスト1: 提案表示（confirmed スレッド）**
```
前提: スレッド選択、status === 'confirmed'
入力: 「確定通知送って」
期待: 
  - 確定日時表示
  - Meet URL（あれば）
  - 参加者リスト
  - 「はい」「いいえ」の選択肢
  - POSTなし
✅ 完了
```

### **テスト2: 「はい」→ 送信用セット表示（A案）**
```
前提: テスト1の提案が表示されている
入力: 「はい」
期待: 
  - 送信用セット表示（コピー用）
    【1. alice@example.com (Alice)】
    件名: 日程調整完了のお知らせ
    こんにちは、...
    📅 確定日時: ...
    🎥 Meet URL: ...
  - pendingNotify をクリア
✅ 完了
```

### **テスト3: 「いいえ」→ キャンセル**
```
前提: テスト1の提案が表示されている
入力: 「いいえ」
期待: 
  - キャンセルメッセージ
  - POSTなし
  - pendingNotify をクリア
✅ 完了
```

### **テスト4: 未確定スレッド**
```
前提: スレッド選択、status !== 'confirmed'
入力: 「確定通知送って」
期待: 
  - エラーメッセージ: 「まだ確定していません」
  - 現在の状態表示
  - POSTなし
✅ 完了
```

---

## 🚀 **デプロイ情報**

### **URLs**
- **Production**: https://app.tomoniwao.jp
- **Latest Deploy**: https://a3694fa3.webapp-6t3.pages.dev

### **Git Commit**
- **Hash**: `8790fbb`
- **Message**: `feat(Next-6 Day3): Add confirmed notification (A案: 送信用セット返す)`

---

## 📊 **技術的負債**

### **✅ ゼロ負債維持**
- ✅ A案: メール送信しない（事故ゼロ）
- ✅ Confirmed/Finalized チェック
- ✅ Context-aware routing（優先順位明確）
- ✅ Type-safe API & Context
- ✅ 明示的なエラーハンドリング

---

## 🔄 **次のステップ**

### **推奨方針**

#### **1. Day3 正式クローズ（今できる）**
- DoD 4本テスト完了
- Day3 で正式クローズ

#### **2. Day2: 票割れ通知（次にやる）**
- Intent: `schedule.propose_for_split`
- 票割れ時に追加候補を提案
- Next-5 Day3 の追加候補フローへ誘導

#### **3. Next-7 Day0: カレンダー同期設計（並行でOK）**
- 設計・Runbook・I/F確定のみ
- 本実装は審査完了後

---

## 🎉 **まとめ**

### **Day3 実装成果**
- ✅ 確定通知提案（POSTなし）
- ✅ 送信用セット生成（コピー用）
- ✅ Context-aware routing（優先順位明確）
- ✅ DoD 4本テスト完了
- ✅ 事故ゼロ設計
- ✅ ゼロ負債維持

### **Phase Next-6 の成果（まとめ）**
1. ✅ Day1: 未返信リマインド提案
2. ✅ Day1.5: リマインド API 実装（A案）
3. ✅ Day3: 確定通知提案（A案）

### **推奨方針**
- **Day3 正式クローズ**: DoD 4本テスト完了で閉じる
- **Day2**: 票割れ通知（次にやる）
- **Next-7 Day0**: カレンダー同期設計（並行でOK）

---

**Phase Next-6 Day3: 完了！** 🎊
