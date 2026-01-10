# フロントエンド リファクタリング計画

> 10万ユーザー規模 × ネイティブアプリ対応を前提とした設計

## 🚀 進捗状況 (2026-01-10)

### ✅ Phase 1: 完了
- Zustand導入完了
- store/slices/ に6つのスライス作成
  - authSlice.ts (認証状態)
  - chatSlice.ts (メッセージ状態)
  - threadsSlice.ts (スレッド状態)
  - pendingSlice.ts (保留アクション状態)
  - calendarSlice.ts (カレンダー状態)
  - uiSlice.ts (UI状態)
- ChatLayout.tsx リファクタリング完了
  - Before: 529行, 16 useState
  - After: 280行, 0 useState (全てZustand)
- 本番デプロイ済み: https://app.tomoniwao.jp

### 🔄 Phase 2: 進行中
- services/executor/ ディレクトリ作成済み
- types.ts, utils.ts 作成済み
- calendarHandlers.ts 作成済み
- listHandlers.ts 作成済み
- 残り: threadHandlers, pendingHandlers, autoProposeHandlers

### ⏳ Phase 3-4: 未着手
- intentClassifier分割
- コンポーネント分割

---

## 📊 現状分析

### ファイル規模と問題点

| ファイル | 行数 | useState数 | 問題 |
|---------|------|-----------|------|
| `apiExecutor.ts` | **2235** | - | God Object: 39関数が1ファイル |
| `intentClassifier.ts` | 662 | - | 全ルールが単一ファイル、拡張困難 |
| `ChatLayout.tsx` | 529 | **16** | 状態爆発、責務過多 |
| `ChatPane.tsx` | 448 | 4 | Props過多（15件以上） |
| `ThreadDetailPage.tsx` | 431 | 7 | ページ単位で状態管理 |

### 現状アーキテクチャの問題

```
現状: 密結合モノリシック構造
┌─────────────────────────────────────────────────┐
│ ChatLayout.tsx (529行, 16 useState)             │
│  ├── messagesByThreadId (全スレッド履歴)        │
│  ├── calendarData                               │
│  ├── pendingAutoPropose                         │
│  ├── pendingRemind/Notify/Split/Action          │
│  ├── additionalProposeCountByThreadId           │
│  └── ... (計13種類のRecord状態)                 │
│                                                 │
│  └── ChatPane.tsx (15+ props drilling)          │
│       └── apiExecutor.ts (2235行, 39関数)       │
│            └── intentClassifier.ts (662行)      │
└─────────────────────────────────────────────────┘

問題:
1. 状態がコンポーネントに密結合 → テスト困難
2. Props Drilling地獄 → 可読性低下
3. localStorage依存 → オフライン/同期問題
4. メモリ無制限増加 → パフォーマンス劣化
5. 単一ファイル巨大化 → 保守不能
6. 型安全性欠如 (any多用) → ランタイムエラー
```

---

## 🎯 理想アーキテクチャ

### 設計原則

1. **状態とUIの分離**: ビジネスロジックはUIに依存しない
2. **単一責任の原則**: 1ファイル200-300行以内
3. **型安全性**: `any` は禁止、厳密な型定義
4. **テスタビリティ**: 各層が独立してテスト可能
5. **スケーラビリティ**: 10万ユーザーでも破綻しない
6. **ネイティブ対応**: React Native への移植を想定

### 理想構造

```
理想: レイヤードアーキテクチャ + 状態管理分離
┌─────────────────────────────────────────────────┐
│                   UI Layer                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ChatPane  │ │ThreadList│ │CardsPane │        │
│  │(純粋表示)│ │(純粋表示)│ │(純粋表示)│        │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘        │
│       │            │            │               │
├───────┴────────────┴────────────┴───────────────┤
│                 Hooks Layer                     │
│  useChat() | useThreads() | useCalendar()      │
│  (UIとStoreの橋渡し、副作用管理)                │
├─────────────────────────────────────────────────┤
│              State Management                   │
│  ┌──────────────────────────────────────────┐  │
│  │           Zustand Store                   │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │  │
│  │  │authSlice│ │chatSlice│ │uiSlice  │    │  │
│  │  └─────────┘ └─────────┘ └─────────┘    │  │
│  │  (永続化: IndexedDB + メモリキャッシュ)  │  │
│  └──────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│              Service Layer                      │
│  ┌──────────────────────────────────────────┐  │
│  │  IntentService │ ThreadService │ etc.    │  │
│  │  (ビジネスロジック、API呼び出し)         │  │
│  └──────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│              API Client Layer                   │
│  ┌──────────────────────────────────────────┐  │
│  │  apiClient (キャッシュ、リトライ、認証)  │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## 📁 理想ディレクトリ構造

```
frontend/src/
├── main.tsx                    # エントリーポイント
├── App.tsx                     # ルーティングのみ
│
├── components/                 # 純粋UIコンポーネント (Presentational)
│   ├── chat/
│   │   ├── ChatPane.tsx        # メッセージ表示 (100行以内)
│   │   ├── MessageBubble.tsx   # 単一メッセージ
│   │   ├── MessageInput.tsx    # 入力欄
│   │   ├── ThreadsList.tsx     # スレッド一覧
│   │   └── index.ts
│   ├── cards/
│   │   ├── StatusCard.tsx
│   │   └── ...
│   └── common/
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── LoadingSpinner.tsx
│       └── ErrorBoundary.tsx
│
├── containers/                 # ロジック統合コンテナ (Container)
│   ├── ChatContainer.tsx       # useChat() → ChatPane
│   ├── ThreadsContainer.tsx
│   └── CardsContainer.tsx
│
├── hooks/                      # カスタムフック
│   ├── useChat.ts              # チャット操作
│   ├── useThreads.ts           # スレッド操作
│   ├── useCalendar.ts          # カレンダー操作
│   ├── useAuth.ts              # 認証状態
│   └── usePendingAction.ts     # Beta A フロー
│
├── store/                      # Zustand ストア
│   ├── index.ts                # ストア統合
│   ├── slices/
│   │   ├── authSlice.ts        # 認証状態 (50行)
│   │   ├── chatSlice.ts        # メッセージ状態 (100行)
│   │   ├── threadsSlice.ts     # スレッド状態 (80行)
│   │   ├── calendarSlice.ts    # カレンダー状態 (60行)
│   │   ├── pendingSlice.ts     # 保留アクション (80行)
│   │   └── uiSlice.ts          # UI状態 (40行)
│   └── middleware/
│       ├── persist.ts          # IndexedDB永続化
│       └── logger.ts           # 開発用ログ
│
├── services/                   # ビジネスロジック
│   ├── intent/
│   │   ├── IntentService.ts    # Intent分類メイン (100行)
│   │   ├── rules/
│   │   │   ├── calendarRules.ts
│   │   │   ├── threadRules.ts
│   │   │   ├── listRules.ts
│   │   │   └── pendingActionRules.ts
│   │   └── index.ts
│   ├── executor/
│   │   ├── ExecutorService.ts  # 実行メイン (100行)
│   │   ├── handlers/
│   │   │   ├── calendarHandlers.ts
│   │   │   ├── threadHandlers.ts
│   │   │   ├── listHandlers.ts
│   │   │   └── pendingActionHandlers.ts
│   │   └── index.ts
│   └── thread/
│       └── ThreadService.ts
│
├── api/                        # API クライアント
│   ├── client.ts               # 共通クライアント (キャッシュ、リトライ)
│   ├── endpoints/
│   │   ├── threads.ts
│   │   ├── calendar.ts
│   │   ├── lists.ts
│   │   └── pendingActions.ts
│   └── types/                  # API型定義
│       ├── threads.ts
│       ├── calendar.ts
│       └── common.ts
│
├── types/                      # グローバル型定義
│   ├── chat.ts
│   ├── thread.ts
│   ├── calendar.ts
│   └── index.ts
│
├── utils/                      # ユーティリティ
│   ├── format.ts               # 日時フォーマット
│   ├── validation.ts           # 入力検証
│   └── storage.ts              # ストレージ抽象化
│
└── pages/                      # ページコンポーネント
    ├── LoginPage.tsx
    ├── ChatPage.tsx            # ChatContainer をマウント
    └── ...
```

---

## 🔄 移行計画

### Phase 1: 状態管理の分離 (優先度: 最高)

**目標**: ChatLayout の16個の useState を Zustand に移行

```typescript
// Before: ChatLayout.tsx (16 useState)
const [status, setStatus] = useState<ThreadStatus_API | null>(null);
const [loading, setLoading] = useState(false);
const [messagesByThreadId, setMessagesByThreadId] = useState<...>({});
// ... 13 more

// After: store/slices/chatSlice.ts
interface ChatState {
  messagesByThreadId: Record<string, ChatMessage[]>;
  currentThreadId: string | null;
  isProcessing: boolean;
}

interface ChatActions {
  appendMessage: (threadId: string, message: ChatMessage) => void;
  setCurrentThread: (threadId: string | null) => void;
  clearOldMessages: (keepThreadCount: number) => void;
}
```

### Phase 2: API層のリファクタリング (優先度: 高)

**目標**: apiExecutor.ts (2235行) を分割

```
apiExecutor.ts (2235行)
  ↓ 分割
services/executor/
├── ExecutorService.ts       # 100行: ルーティングのみ
├── handlers/
│   ├── calendarHandlers.ts  # 200行
│   ├── threadHandlers.ts    # 300行
│   ├── listHandlers.ts      # 150行
│   └── pendingHandlers.ts   # 200行
└── index.ts
```

### Phase 3: Intent分類の分離 (優先度: 中)

**目標**: intentClassifier.ts (662行) を分割

```
intentClassifier.ts (662行)
  ↓ 分割
services/intent/
├── IntentService.ts         # 100行: メインロジック
├── rules/
│   ├── calendarRules.ts     # 100行
│   ├── threadRules.ts       # 150行
│   ├── listRules.ts         # 100行
│   └── pendingActionRules.ts# 100行
└── index.ts
```

### Phase 4: コンポーネント分割 (優先度: 中)

**目標**: ChatPane.tsx (448行), ChatLayout.tsx (529行) を分割

```
ChatLayout.tsx (529行)
  ↓ 分割
containers/ChatContainer.tsx  # 100行: ロジック統合
components/chat/ChatPane.tsx  # 150行: 純粋表示
components/chat/MessageList.tsx
components/chat/MessageInput.tsx
```

---

## 📈 パフォーマンス最適化

### メモリ管理

```typescript
// store/slices/chatSlice.ts
const MAX_THREADS_IN_MEMORY = 20;
const MAX_MESSAGES_PER_THREAD = 100;

appendMessage: (threadId, message) => {
  set((state) => {
    const messages = state.messagesByThreadId[threadId] || [];
    const newMessages = [...messages, message].slice(-MAX_MESSAGES_PER_THREAD);
    
    // 古いスレッドを削除
    const threadIds = Object.keys(state.messagesByThreadId);
    if (threadIds.length > MAX_THREADS_IN_MEMORY) {
      const oldestThreadId = threadIds[0];
      delete state.messagesByThreadId[oldestThreadId];
    }
    
    return {
      messagesByThreadId: {
        ...state.messagesByThreadId,
        [threadId]: newMessages,
      },
    };
  });
};
```

### IndexedDB永続化 (localStorage置換)

```typescript
// store/middleware/persist.ts
import { openDB } from 'idb';

const db = await openDB('tomoniwao', 1, {
  upgrade(db) {
    db.createObjectStore('messages', { keyPath: 'threadId' });
    db.createObjectStore('threads', { keyPath: 'id' });
  },
});

// 非同期永続化 (UIブロックしない)
export const persistMiddleware = (config) => (set, get, api) =>
  config(
    async (...args) => {
      set(...args);
      // 非同期でIndexedDBに保存
      queueMicrotask(() => {
        db.put('messages', get().messagesByThreadId);
      });
    },
    get,
    api
  );
```

### API キャッシュ戦略

```typescript
// api/client.ts
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30 * 1000; // 30秒

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: { ttl?: number; forceRefresh?: boolean }
): Promise<T> {
  const cached = cache.get(key);
  const now = Date.now();
  
  if (cached && !options?.forceRefresh && now - cached.timestamp < (options?.ttl || CACHE_TTL)) {
    return cached.data as T;
  }
  
  const data = await fetcher();
  cache.set(key, { data, timestamp: now });
  return data;
}
```

---

## ✅ 移行チェックリスト

### Phase 1 (状態管理)
- [ ] Zustand インストール (`npm install zustand`)
- [ ] `store/` ディレクトリ作成
- [ ] `authSlice.ts` 実装
- [ ] `chatSlice.ts` 実装
- [ ] `threadsSlice.ts` 実装
- [ ] `pendingSlice.ts` 実装
- [ ] `uiSlice.ts` 実装
- [ ] ChatLayout から useState を削除
- [ ] 全テスト通過確認

### Phase 2 (API層)
- [ ] `services/executor/` ディレクトリ作成
- [ ] `ExecutorService.ts` 実装
- [ ] `calendarHandlers.ts` 分離
- [ ] `threadHandlers.ts` 分離
- [ ] `listHandlers.ts` 分離
- [ ] `pendingActionHandlers.ts` 分離
- [ ] 旧 `apiExecutor.ts` 削除
- [ ] 全テスト通過確認

### Phase 3 (Intent分類)
- [ ] `services/intent/` ディレクトリ作成
- [ ] `IntentService.ts` 実装
- [ ] ルールファイル分離
- [ ] 旧 `intentClassifier.ts` 削除
- [ ] 全テスト通過確認

### Phase 4 (コンポーネント)
- [ ] `containers/` ディレクトリ作成
- [ ] ChatContainer 実装
- [ ] ChatPane 純粋化
- [ ] MessageBubble 分離
- [ ] MessageInput 分離
- [ ] 全テスト通過確認

---

## 🎯 成功指標

| 指標 | 現状 | 目標 |
|------|------|------|
| 最大ファイル行数 | 2235行 | **300行以内** |
| useState数/コンポーネント | 16 | **3以内** |
| Props数/コンポーネント | 15+ | **5以内** |
| `any` 使用箇所 | 多数 | **0** |
| テストカバレッジ | 0% | **80%以上** |
| メモリ使用量 | 無制限 | **50MB以内** |
| 初期ロード時間 | 未計測 | **2秒以内** |

---

## 📅 スケジュール目安

| Phase | 作業内容 | 見積時間 |
|-------|---------|---------|
| Phase 1 | 状態管理 Zustand 移行 | 4-6時間 |
| Phase 2 | apiExecutor 分割 | 3-4時間 |
| Phase 3 | intentClassifier 分割 | 2-3時間 |
| Phase 4 | コンポーネント分割 | 3-4時間 |
| **合計** | | **12-17時間** |

---

## 🚨 リスクと対策

### リスク1: 移行中の機能破壊
- **対策**: 段階的移行、各Phase後に全機能テスト

### リスク2: パフォーマンス劣化
- **対策**: 各Phase後にLighthouseスコア計測

### リスク3: 型エラー大量発生
- **対策**: `strict: true` は最後に有効化、段階的型付け

---

*作成日: 2026-01-10*
*更新日: 2026-01-10*
