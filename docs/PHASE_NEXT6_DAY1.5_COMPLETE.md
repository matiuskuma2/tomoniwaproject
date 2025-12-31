# Phase Next-6 Day1.5 完了報告: リマインド API 実装（A案・事故ゼロ）

## ✅ 実装完了日: 2025-12-31

---

## 🎯 **実装内容**

### **A案（最小で事故ゼロ）**

#### **方針**
- POST `/api/threads/:id/remind` は **メール送信しない**
- 代わりに返すもの:
  1. 未返信者リスト
  2. invite URL（再表示）
  3. テンプレ文面（コピー用）
- **ユーザーが手動で送る（事故ゼロ）**

---

## **実装詳細**

### **1. バックエンド実装（apps/api/src/routes/threads.ts）**

#### **エンドポイント**
```
POST /api/threads/:id/remind
```

#### **リクエスト**
```json
{
  "invitee_keys": ["key1", "key2"]  // optional, 空の場合は全未返信者
}
```

#### **レスポンス（A案）**
```json
{
  "success": true,
  "reminded_count": 2,
  "reminded_invites": [
    {
      "email": "alice@example.com",
      "name": "Alice",
      "invite_url": "https://app.tomoniwao.jp/i/abc123",
      "template_message": "こんにちは Aliceさん、\n\n「日程調整」の日程調整にご協力ください。\n..."
    }
  ],
  "message": "2名の未返信者に送信する準備ができました。\n\n以下の内容をコピーしてメールで送信してください。"
}
```

#### **ロジック**
```typescript
1. Authorization: organizer のみ
2. Get pending invites: status = 'pending' OR NULL
3. Build reminder data:
   - invite_url: https://app.tomoniwao.jp/i/{token}
   - template_message: テンプレ文面
4. Return reminder set (メール送信しない)
```

---

### **2. フロントエンド実装**

#### **API クライアント（frontend/src/core/api/threads.ts）**
```typescript
async sendReminder(threadId: string): Promise<{
  success: boolean;
  reminded_count: number;
  reminded_invites: Array<{
    email: string;
    name?: string;
    invite_url: string;
    template_message: string;
  }>;
  message?: string;
}>
```

#### **Executor（frontend/src/core/chat/apiExecutor.ts）**
```typescript
async function executeRemindPendingConfirm(context?: ExecutionContext) {
  // POST /api/threads/:id/remind
  const response = await threadsApi.sendReminder(threadId);
  
  // A案: 送信用セットを表示（コピー用）
  let message = `✅ リマインド用の文面を生成しました（${response.reminded_count}名）\n\n`;
  message += '📋 以下をコピーして各自にメールで送信してください:\n\n';
  message += '────────────────────────────\n\n';
  
  response.reminded_invites.forEach((invite, index) => {
    message += `【${index + 1}. ${invite.email}${invite.name ? ` (${invite.name})` : ''}】\n\n`;
    message += `件名: 日程調整のリマインド\n\n`;
    message += invite.template_message;
    message += '\n\n────────────────────────────\n\n';
  });
  
  return { success: true, message, data: { kind: 'remind.pending.sent', ... } };
}
```

---

## 🛡️ **ガードレール（事故ゼロ）**

### **A案の安全性**
✅ **メール送信しない**: API は送信用セットを返すだけ  
✅ **人が送る**: ユーザーが手動でコピー&ペースト  
✅ **事故ゼロ**: 誤送信の可能性ゼロ  
✅ **Authorization**: organizer のみがアクセス可能  
✅ **Pending チェック**: status = 'pending' OR NULL のみ対象

---

## 📦 **変更ファイル**

### **Backend**
1. `apps/api/src/routes/threads.ts`
   - 新規エンドポイント: `POST /threads/:id/remind`
   - Authorization チェック
   - Pending invites 取得
   - Reminder data 生成（A案）

### **Frontend**
1. `frontend/src/core/api/threads.ts`
   - `sendReminder()` の型定義更新

2. `frontend/src/core/chat/apiExecutor.ts`
   - `executeRemindPendingConfirm()` の実装完了
   - A案: 送信用セットを表示

---

## 🧪 **DoD（Definition of Done）**

### **テスト1: 提案表示（未返信あり）**
```
前提: スレッド選択、未返信者が1名以上
入力: 「リマインド送って」
期待: 
  - 未返信者リスト表示
  - 「はい」「いいえ」の選択肢
  - 残り回数: 1回
  - POSTなし
✅ 完了
```

### **テスト2: 「はい」→ 送信用セット表示（A案）**
```
前提: テスト1の提案が表示されている
入力: 「はい」
期待: 
  - POST /api/threads/:id/remind
  - 送信用セット表示（コピー用）
    【1. alice@example.com (Alice)】
    件名: 日程調整のリマインド
    こんにちは Aliceさん、...
    https://app.tomoniwao.jp/i/abc123
  - pendingRemind をクリア
✅ 完了
```

### **テスト3: 3回目は不可**
```
前提: 同じスレッドで2回リマインド提案済み
入力: 「リマインド送って」
期待: 
  - エラーメッセージ: 「最大2回までです」
  - POSTなし
✅ 完了（Day1で実装済み）
```

### **テスト4: 「いいえ」→ キャンセル**
```
前提: テスト1の提案が表示されている
入力: 「いいえ」
期待: 
  - キャンセルメッセージ
  - POSTなし
  - pendingRemind をクリア
✅ 完了（Day1で実装済み）
```

---

## 🚀 **デプロイ情報**

### **URLs**
- **Production**: https://app.tomoniwao.jp
- **Latest Deploy**: https://54b1c035.webapp-6t3.pages.dev

### **Git Commit**
- **Hash**: `dbf2764`
- **Message**: `feat(Next-6 Day1.5): Implement remind API (A案: 送信用セット返す)`

---

## 📊 **技術的負債**

### **✅ ゼロ負債維持**
- ✅ A案: メール送信しない（事故ゼロ）
- ✅ Authorization チェック（organizer のみ）
- ✅ Pending チェック（未返信者のみ）
- ✅ Type-safe API クライアント
- ✅ 明示的なエラーハンドリング

---

## 🔄 **次のステップ**

### **推奨方針**

#### **1. Day1 正式クローズ（今できる）**
- DoD 4本テスト完了
- Day1 + Day1.5 で正式クローズ

#### **2. B案への拡張（任意・後回しOK）**
```typescript
// B案: 実メール送信（Resend等）
POST /api/threads/:id/remind
{
  "invitee_keys": ["key1", "key2"],
  "send_email": true  // NEW: 実メール送信
}

Response:
{
  "success": true,
  "reminded_count": 2,
  "sent_emails": 2,
  "failed_emails": 0
}
```

#### **3. Day2: 票割れ通知（推奨）**
- Intent: `schedule.propose_for_split`
- 票割れ時に追加候補を提案

#### **4. Day3: 確定通知（最重要）**
- Intent: `schedule.notify.confirmed`
- 日程確定時に全員へ通知

---

## 🎉 **まとめ**

### **Day1.5 実装成果**
- ✅ POST `/api/threads/:id/remind` 実装（A案）
- ✅ 送信用セット生成（コピー用）
- ✅ Frontend と Backend の統合完了
- ✅ DoD 4本テスト完了
- ✅ 事故ゼロ設計
- ✅ ゼロ負債維持

### **Day1 + Day1.5 の成果**
1. ✅ 未返信リマインド提案（POSTなし）
2. ✅ Context-aware intent routing
3. ✅ 最大2回制限
4. ✅ リマインド API 実装（A案）
5. ✅ 送信用セット生成

### **推奨方針**
- **Day1 正式クローズ**: DoD 4本テスト完了で閉じる
- **Day2/Day3**: 通知機能の拡充（票割れ/確定通知）
- **B案（任意）**: 実メール送信（後回しOK）

---

**Phase Next-6 Day1 + Day1.5: 完了！** 🎊
