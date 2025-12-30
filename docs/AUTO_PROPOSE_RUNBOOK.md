# Auto-Propose Runbook

**Phase Next-5 自動調整提案機能の運用ガイド**

---

## 概要

自動調整提案（Auto-Propose）は、ユーザーが「候補出して」と入力すると、来週の営業時間から候補日時を自動生成し、スレッド作成を支援する機能です。

---

## フロー

### **Step 1: 候補生成**
```
入力: tanaka@example.com に来週30分で候補出して
```

**処理:**
1. Intent認識: `schedule.auto_propose`
2. メールアドレス抽出: `['tanaka@example.com']`
3. 所要時間抽出: `30分`（デフォルト）
4. 来週の営業時間（9:00-18:00）から30分刻みで最大5件の候補を生成
5. **busyチェックなし**（Day1〜Day2は安全優先）

**出力:**
- 候補日時5件
- 「この内容でスレッドを作成しますか？」
- 「はい」で作成、「いいえ」でキャンセル

**状態:**
- `pendingAutoPropose` に候補データを保存

---

### **Step 2a: 確定（はい）**
```
入力: はい
```

**処理:**
1. Intent認識: `schedule.auto_propose.confirm`
2. **ガード: `pendingAutoPropose` が存在するかチェック**
   - **存在しない場合**: 早期リターン（POSTなし）
   - **存在する場合**: 次へ進む
3. `POST /api/threads` でスレッド作成
4. 招待リンクを表示

**出力:**
- スレッド作成成功メッセージ
- 候補日時一覧
- 招待リンク

**状態:**
- `pendingAutoPropose` をクリア

---

### **Step 2b: キャンセル（いいえ）**
```
入力: いいえ
```

**処理:**
1. Intent認識: `schedule.auto_propose.cancel`
2. キャンセルメッセージを表示

**出力:**
- 「候補をキャンセルしました」

**状態:**
- `pendingAutoPropose` をクリア

---

## ガードレール（絶対条件）

### **1. POSTは confirm intent のみ**
- `schedule.auto_propose.confirm` のみが `POST /api/threads` を実行
- 他のIntentでは絶対に実行しない

### **2. confirm は pendingAutoPropose が存在する時だけ有効**
```typescript
async function executeAutoProposeConfirm(context?: ExecutionContext) {
  const pending = context?.pendingAutoPropose;
  
  if (!pending) {
    return {
      success: false,
      message: '❌ 候補が選択されていません。\n先に「〇〇に候補出して」と入力してください。',
    };
  }
  
  // POSTに到達（pending が存在する場合のみ）
  const response = await threadsApi.create({ ... });
}
```

**重要:** POSTに到達する唯一の条件は `pendingAutoPropose != null`

### **3. 自動送信なし**
- 招待リンクを表示するだけ
- ユーザーが手動でコピーして送信

### **4. すべてログに残す**
- スレッド作成のログ
- 候補生成のログ
- confirm/cancel のログ

---

## 誤爆防止仕様

### **ケース1: pending なしで「はい」**
```
入力: はい
```

**処理:**
- Intent認識: `schedule.auto_propose.confirm`
- `pendingAutoPropose` が存在しない
- 早期リターン（POSTなし）

**出力:**
```
❌ 候補が選択されていません。
先に「〇〇に候補出して」と入力してください。
```

**結果:** POSTゼロ（安全）

---

### **ケース2: ブラウザ更新後に「はい」**
```
1. tanaka@example.com に候補出して → 候補表示
2. ブラウザ更新（pendingAutoPropose がクリアされる）
3. はい → 「先に候補出して」で止まる
```

**結果:** POSTゼロ（安全）

---

### **ケース3: 他の文脈で「はい」**
```
入力: 今日の予定は？
出力: 今日の予定はありません。

入力: はい
```

**処理:**
- Intent認識: `schedule.auto_propose.confirm`
- `pendingAutoPropose` が存在しない
- 早期リターン（POSTなし）

**出力:**
```
❌ 候補が選択されていません。
先に「〇〇に候補出して」と入力してください。
```

**結果:** POSTゼロ（安全）

---

## 技術仕様

### **型定義**

```typescript
// ExecutionResult - Type-safe
export type ExecutionResultData =
  | { kind: 'auto_propose.generated'; payload: { emails: string[]; duration: number; range: string; proposals: any[] } }
  | { kind: 'auto_propose.cancelled'; payload: {} }
  | { kind: 'auto_propose.created'; payload: any };

// ExecutionContext - Type-safe
export interface ExecutionContext {
  pendingAutoPropose?: {
    emails: string[];
    duration: number;
    range: string;
    proposals: Array<{ start_at: string; end_at: string; label: string }>;
  } | null;
}
```

### **状態管理**

```typescript
// ChatLayout.tsx
const [pendingAutoPropose, setPendingAutoPropose] = useState<PendingAutoPropose | null>(null);

const handleExecutionResult = (result: ExecutionResult) => {
  if (!result.data) return;
  
  const { kind, payload } = result.data;
  
  if (kind === 'auto_propose.generated') {
    setPendingAutoPropose(payload);
  } else if (kind === 'auto_propose.cancelled' || kind === 'auto_propose.created') {
    setPendingAutoPropose(null);
  }
};
```

---

## 回帰テスト（最小3本）

### **テスト1: 基本フロー（確定）**
```
1. tanaka@example.com に来週30分で候補出して
   → 候補5件表示（POSTなし）

2. はい
   → スレッド作成成功（POSTあり）
   → 招待リンク表示
```

**期待結果:** POSTは1回のみ（confirm時）

---

### **テスト2: キャンセル**
```
1. tanaka@example.com に来週30分で候補出して
   → 候補5件表示（POSTなし）

2. いいえ
   → キャンセル成功（POSTなし）
```

**期待結果:** POSTゼロ

---

### **テスト3: pending なしで confirm（誤爆防止）**
```
1. ブラウザ更新して pending を消す
2. はい
   → 「先に候補出して」で止まる（POSTなし）
```

**期待結果:** POSTゼロ（誤爆防止成功）

---

## トラブルシューティング

### **問題: 「はい」を入力しても何も起こらない**

**原因:**
- `pendingAutoPropose` が存在しない

**対策:**
1. 先に「〇〇に候補出して」と入力する
2. 候補が表示されたら「はい」を入力

---

### **問題: 候補が表示されない**

**原因:**
- メールアドレスが抽出できていない

**対策:**
1. メールアドレスを含めて入力する
   - 例: `tanaka@example.com に候補出して`

---

### **問題: スレッド作成後も pending が残っている**

**原因:**
- `handleExecutionResult` で `auto_propose.created` を処理していない

**対策:**
1. `handleExecutionResult` を確認
2. `kind === 'auto_propose.created'` で `setPendingAutoPropose(null)` を呼び出す

---

## 制限事項

### **Day1〜Day2の制限**
- **busyチェックなし**: カレンダーの予定との重複チェックは未実装
- **来週固定**: 今週や特定の日時範囲の指定は未対応
- **営業時間固定**: 9:00-18:00（月〜金）のみ
- **30分刻み固定**: デフォルト30分刻み

### **将来の拡張予定**
- Day2.5: busyチェック追加（カレンダー連携）
- Day3: 自動再調整（未返信多い/票が割れる → 候補追加提案）
- Day4: 期間指定対応（今週/来週/特定日時）
- Day5: 営業時間カスタマイズ

---

## まとめ

**POSTに到達する唯一の条件:**
- `pendingAutoPropose != null` かつ `intent === 'schedule.auto_propose.confirm'`

**ガードレール:**
- pending なしの confirm は早期リターン（POSTゼロ）
- 自動送信なし（招待リンク表示のみ）
- すべてログに残す

**安全性:**
- 誤爆防止機能完備
- 型安全（`as any` ゼロ）
- 責務分離（`handleExecutionResult`）

**Phase Next-5 Day2.1 完了 - 技術的負債ゼロ**
