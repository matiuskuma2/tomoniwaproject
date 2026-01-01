# CHAT_DATA_CONTRACT.md

**Chat Data Contract（増えても壊れない・スマホ前提）**

---

## ドキュメント情報

| 項目 | 内容 |
|------|------|
| バージョン | v1.0 |
| 作成日 | 2026-01-01 |
| ステータス | ✅ 確定（変更は影響範囲必須） |
| 関連文書 | `DEVELOPMENT_ROADMAP.md`, `LOGGING_AND_RETENTION.md` |

---

## 目的

- チャットのDOM/ログ増加でUIが壊れないよう「取得契約」「表示上限」「永続化」を固定する
- **UIの見た目は変えてよいが、データの契約は変えない**

## 非目的

- 表示デザインの固定（CSS/レイアウトは自由）
- 監査ログの仕様（別紙 `LOGGING_AND_RETENTION.md` 参照）

---

## 1. データの正（Single Source of Truth）

### 1.1 状態の正

**固定原則：**
- "状態（票数/未返信/票割れ/確定/通知提案など）"は **ThreadStatus API が唯一の正**
- **チャット本文から状態を推測してはいけない**
- UIは ThreadStatus API のpayloadを描画するだけ（チャットは補助）

**理由：**
- チャット履歴から推測すると、localStorage破損やリロードで不整合が起きる
- Status APIを正とすれば、UIが壊れても再取得で復旧できる

---

## 2. API取得契約（必須固定）

### 2.1 メッセージ取得（cursor方式固定）

**禁止事項：**
- ❌ **OFFSET方式は禁止**（データ増で遅くなる・重複/欠落が起きる）

**必須方式：**
- ✅ **必ず cursor/limit でページングする**

**推奨I/F（例）：**
```
GET /api/threads/:id/messages?limit=50&cursor=<cursor>
```

**レスポンス（例）：**
```json
{
  "thread_id": "...",
  "messages": [
    {
      "id": "...",
      "role": "user|assistant|system",
      "content": "...",
      "created_at": "ISO8601",
      "kind": "optional",
      "meta": {}
    }
  ],
  "next_cursor": "..."
}
```

**契約（固定）：**
1. サーバーは `created_at ASC`（古い→新しい）で返す
2. UI側での再ソートはしない（必要なら最後に軽く整形する程度）
3. 同一cursorで取得したデータは冪等（同じ内容が返る想定）

---

### 2.2 ThreadStatus取得（状態の正）

**API：**
```
GET /api/threads/:id/status
```

**UI表示の原則：**
- 票数/未返信/票割れ/確定/通知提案などは、**ここからのみ描画**
- チャット履歴から推測しない

---

## 3. UI描画契約（DOM肥大を防ぐ固定ルール）

### 3.1 画面に描画する上限（固定）

**固定原則：**
- 1スレッドあたり **最大200メッセージ**までをDOMに描画する（スマホ前提）
- 200件を超えたら古いメッセージはDOMから外す（データは保持しても良い）
- "古い履歴を見る"は「もっと見る」導線で追取得（または別画面）

**推奨値：**
- **DESKTOP**: 300（必要なら）
- **MOBILE**: 200（固定推奨）

**理由：**
- スマホで200件を超えると体感で重くなる
- DOM増加がメモリ/スクロールパフォーマンスの最大の敵

---

### 3.2 スクロール/追取得

**フロー：**
1. **初期表示**：最新N件（例：50）
2. **上にスクロール**→ `next_cursor` で追加取得
3. **取得後もDOM上限を超える場合**は最古から削る

**実装例：**
```typescript
// DOM上限チェック
const MAX_DOM_MESSAGES = 200;

function addMessagesToDOM(newMessages: Message[]) {
  const allMessages = [...currentMessages, ...newMessages];
  
  if (allMessages.length > MAX_DOM_MESSAGES) {
    // 最古のメッセージから削除
    const trimmedMessages = allMessages.slice(-MAX_DOM_MESSAGES);
    setCurrentMessages(trimmedMessages);
  } else {
    setCurrentMessages(allMessages);
  }
}
```

---

## 4. localStorage 永続化（リングバッファ固定）

### 目的
- リロードで消える問題を防ぐ（PWA/スマホ優先）
- ただし localStorage は壊れやすいので **上限/自動OFF** を固定

---

### 4.1 保存形式

**key:**
```
tomoniwao_messages_v1
```

**value:**
```json
{
  "<thread_id>": [Message... up to N]
}
```

---

### 4.2 保存上限（固定）

| 項目 | 上限 | 理由 |
|------|------|------|
| スレッドごと保存件数 | 最新50件 | リロード後の復旧に十分 |
| 保存対象スレッド数 | 最新10スレッド | 容量制限（5MB目安） |
| 総容量制限 | 5MB | QuotaExceededError防止 |

**超過時の動作：**
- これを超えるデータは**古いスレッドから削除**
- 容量制限超過時は自動的に古いスレッドを削除

---

### 4.3 保存頻度（debounce固定）

**禁止事項：**
- ❌ messagesByThreadId更新ごとに即保存は禁止

**必須方式：**
- ✅ **500ms debounce** で保存する（スマホの体感読み込み抑制）

**実装例：**
```typescript
// Debounce実装
const debouncedSave = useMemo(
  () => debounce((messages: Record<string, Message[]>) => {
    try {
      localStorage.setItem('tomoniwao_messages_v1', JSON.stringify(messages));
    } catch (e) {
      handleSaveError(e);
    }
  }, 500),
  []
);

// messagesByThreadId更新時
useEffect(() => {
  debouncedSave(messagesByThreadId);
}, [messagesByThreadId, debouncedSave]);
```

---

### 4.4 失敗時の自動OFF（固定）

**原則：**
- 保存失敗が **3回連続** したら永続化を自動OFFにする
- OFFになったら、以降の保存はしない（表示は継続）
- OFF状態は session中維持（再起動で再試行してよい）

**実装例：**
```typescript
let saveFailureCount = 0;
let persistenceEnabled = true;

function handleSaveError(error: Error) {
  saveFailureCount++;
  console.error(`[localStorage] Save failed (${saveFailureCount}/3):`, error);
  
  if (saveFailureCount >= 3) {
    persistenceEnabled = false;
    console.warn('[localStorage] Persistence disabled after 3 failures');
  }
}

function saveToLocalStorage(data: any) {
  if (!persistenceEnabled) {
    return; // 永続化OFF
  }
  
  try {
    localStorage.setItem('tomoniwao_messages_v1', JSON.stringify(data));
    saveFailureCount = 0; // 成功時はリセット
  } catch (e) {
    handleSaveError(e as Error);
  }
}
```

---

### 4.5 破損時の自動回復（固定）

**原則：**
1. **JSON.parse失敗** → localStorage該当キーを削除 → 空として起動
2. **型が不正（objectでない）** → 削除 → 空として起動

**実装例：**
```typescript
function loadFromLocalStorage(): Record<string, Message[]> {
  try {
    const data = localStorage.getItem('tomoniwao_messages_v1');
    if (!data) return {};
    
    const parsed = JSON.parse(data);
    
    // 型チェック
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('[localStorage] Invalid data type, clearing');
      localStorage.removeItem('tomoniwao_messages_v1');
      return {};
    }
    
    return parsed;
  } catch (e) {
    console.error('[localStorage] Parse failed, clearing:', e);
    localStorage.removeItem('tomoniwao_messages_v1');
    return {};
  }
}
```

---

## 5. エラー時の表示（白画面防止）

### 5.1 ErrorBoundary（必須）

**原則：**
- アプリ全体を ErrorBoundary で包む
- エラー発生時は「復旧導線」を出す

**復旧導線：**
1. localStorageクリア
2. リロード
3. ログインへ戻る

**実装済み：**
- `/home/user/tomoniwaproject/frontend/src/components/ErrorBoundary.tsx`

---

### 5.2 例外時のデータクリア（最後の砦）

**原則：**
- 永続化データ破損が疑われる場合は、UIからクリア可能にする
- クリアしてもサーバー側の正（status/messages）は残る想定

**実装例：**
```typescript
// ErrorBoundaryのクリアボタン
<Button onClick={() => {
  localStorage.clear();
  window.location.href = '/';
}}>
  データをクリアして再起動
</Button>
```

---

## 6. 変更ルール（運用）

**このファイルに触れる変更は必ずPRで差分提出し、影響範囲を列挙する**

### 変更時に影響範囲を確認する項目：

| 項目 | 現在値 | 変更時の影響 |
|------|--------|-------------|
| APIページング方式 | cursor/limit | API/UIの全取得処理 |
| DOM描画上限 | 200 | UI描画ロジック/メモリ使用量 |
| localStorageリングバッファ | 50件×10スレッド | 永続化ロジック/容量制限 |
| debounce時間 | 500ms | 保存頻度/ユーザー体感 |
| 自動OFF条件 | 3連続失敗 | エラーハンドリング |

---

## 7. テストケース（必須）

以下のテストケースは必ず維持する：

### 7.1 DOM上限テスト
- [ ] 200件を超えるメッセージで最古から削除される
- [ ] スクロールで追加取得しても上限を超えない

### 7.2 localStorage永続化テスト
- [ ] リロード後にメッセージが復元される
- [ ] 50件を超えると古いメッセージから削除される
- [ ] 10スレッドを超えると古いスレッドから削除される
- [ ] 3回連続失敗で永続化がOFFになる
- [ ] 破損データで起動しても白画面にならない

### 7.3 cursor paginationテスト
- [ ] 同じcursorで同じデータが返る（冪等性）
- [ ] 古いメッセージを追加取得できる
- [ ] 重複なく取得できる

---

**END OF DOCUMENT**
