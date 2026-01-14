# Frontend Performance Plan（1万人同時接続対応）

> 1万人同時接続でも体感速度を維持するための段階的改善計画
> 「落ちる原因」を潰す順序と実装方針

## 📋 概要

### 1万人で落ちる主な原因（フロントエンド）

1. **DOM肥大化** - メッセージ・スレッド・カードの描画が重くなる
2. **無駄なAPI連打** - 同じデータを複数回取得
3. **二重状態による再レンダー地獄** - キャッシュとローカル状態の不整合
4. **メモリリーク** - 古いデータが解放されない

### 対策の優先順位

| 優先度 | 対策 | 効果 | 工数 |
|--------|------|------|------|
| P0 | DOM肥大化防止（表示上限） | 体感に直撃 | 小 |
| P1 | API連打防止（キャッシュ統一） | サーバー負荷軽減 | 中 |
| P1 | 二重状態解消 | 再レンダー削減 | 中 |
| P2 | 仮想スクロール | 上限撤廃 | 大 |
| P2 | メモ化（React.memo） | 微細な改善 | 小 |

---

## 🎯 Phase 0: DOM肥大化防止（P0）✅ 完了

### 実装済み（PERF-S2）

**メッセージ表示上限**
```typescript
// ChatPane.tsx
const MAX_DISPLAY_MESSAGES = 50;
const displayMessages = messages.slice(-MAX_DISPLAY_MESSAGES);

{messages.length > MAX_DISPLAY_MESSAGES && (
  <div className="text-center text-gray-500 text-sm py-2">
    ⚠️ {messages.length - MAX_DISPLAY_MESSAGES}件の古いメッセージは省略されています
  </div>
)}
```

**localStorage保存上限**
```typescript
// useChatReducer.ts
const MAX_MESSAGES_PER_THREAD = 100;
const MAX_THREADS = 20;
```

### 効果
- 1スレッドに1000件メッセージがあっても50件しか描画しない
- localStorageの5MB上限を超えない

---

## 🎯 Phase 1: API連打防止（P1）🔄 進行中

### 1-1: Status取得キャッシュ ✅ 完了（PERF-S1）

**実装済み**
- `threadStatusCache.ts`: TTL 10秒、inflight共有、optimistic update
- `useThreadStatus.ts`: SWR風React Hook
- `getStatusWithCache()`: Executor用ヘルパー

**キャッシュ戦略**
```typescript
// TTL: 10秒
// inflight共有: 同時リクエストを1本化
// 強制refresh: Write操作後
```

### 1-2: Threads List キャッシュ ⏳ 未着手

**目標**
- `threadsApi.list()` をキャッシュ化
- TTL: 30秒
- inflight共有: ✅
- Write後refresh: create, finalize時

**実装予定**
```typescript
// core/cache/threadsListCache.ts
export const threadsListCache = {
  getList: async () => { /* TTL付きキャッシュ */ },
  refreshList: async () => { /* 強制refresh */ },
  invalidate: () => { /* キャッシュクリア */ },
};
```

### 1-3: Inbox キャッシュ ⏳ 未着手

**目標**
- `inboxApi.list()` をキャッシュ化
- TTL: 30秒
- finalize後にrefresh

### 1-4: AbortController導入 ⏳ 未着手

**目的**: スレッド切り替え連打で古いレスポンスが勝つ事故を防止

**実装予定**
```typescript
// useThreadStatus.ts
const abortControllerRef = useRef<AbortController | null>(null);

useEffect(() => {
  // 前のリクエストをキャンセル
  abortControllerRef.current?.abort();
  abortControllerRef.current = new AbortController();
  
  fetchStatus(threadId, { signal: abortControllerRef.current.signal });
  
  return () => abortControllerRef.current?.abort();
}, [threadId]);
```

---

## 🎯 Phase 2: 二重状態解消（P1）✅ 完了

### 実装済み

**キャッシュを単一ソースに**
- `useChatReducer` から `status` / `loading` を削除
- `useThreadStatus` の結果をそのまま使用
- 二重管理による再レンダー地獄を防止

**Before（二重管理）**
```typescript
// ❌ 危険：キャッシュとローカル状態が別
const { status: cachedStatus } = useThreadStatus(threadId);
const [localStatus, setLocalStatus] = useState(null);
// → どちらが正しいか分からない
```

**After（単一ソース）**
```typescript
// ✅ 安全：キャッシュのみ
const { status, loading, refresh } = useThreadStatus(threadId);
// → statusは常にキャッシュから
```

---

## 🎯 Phase 3: 仮想スクロール（P2）⏳ 保留

### 導入条件
- 表示上限（50件）で体感が改善しない場合
- 「全メッセージを見たい」要望が強い場合

### 技術選定
| ライブラリ | 特徴 | 推奨度 |
|-----------|------|--------|
| react-virtual | 可変高さに強い | ⭐⭐⭐ |
| react-window | 高速だが固定高さ向き | ⭐⭐ |
| react-virtuoso | 機能豊富だがバンドル大 | ⭐ |

### 実装方針
```typescript
// ChatPane.tsx with react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

const rowVirtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 80, // 推定高さ
  overscan: 5,
});
```

---

## 🎯 Phase 4: メモ化（P2）⏳ 保留

### 対象コンポーネント

| コンポーネント | メモ化 | 理由 |
|---------------|--------|------|
| ThreadsList内の各行 | ✅ | 大量に描画される |
| CardsPane内の各カード | ✅ | 頻繁に再描画される |
| ChatPane内のメッセージ行 | ✅ | 大量に描画される |
| ChatLayout | ❌ | 親コンポーネントはメモ化不要 |

### 実装例
```typescript
// components/ThreadRow.tsx
export const ThreadRow = React.memo(({ thread, isSelected, onClick }) => {
  return (
    <div onClick={onClick} className={isSelected ? 'bg-blue-50' : ''}>
      {thread.title}
    </div>
  );
}, (prev, next) => {
  // カスタム比較：必要な props だけ比較
  return prev.thread.id === next.thread.id 
      && prev.isSelected === next.isSelected;
});
```

---

## 📊 計測指標

### 必須指標

| 指標 | 目標 | 計測方法 |
|------|------|----------|
| FCP（First Contentful Paint） | < 1.5s | Lighthouse |
| TTI（Time to Interactive） | < 3s | Lighthouse |
| API呼び出し数/分 | < 10 | Network tab |
| DOM要素数 | < 1500 | Performance tab |

### キャッシュ効率

```typescript
// コンソールログで計測
[StatusCache] HIT: xxx-thread-id (age: 5000ms)
[StatusCache] MISS: xxx-thread-id
[StatusCache] REFRESH: xxx-thread-id (forced)
```

---

## 🔧 実装チェックリスト

### Phase 1 完了条件
- [x] Status取得キャッシュ（PERF-S1）
- [x] 二重状態解消
- [ ] Threads List キャッシュ
- [ ] Inbox キャッシュ
- [ ] AbortController導入

### Phase 2 完了条件
- [ ] DOM要素数 < 1500 の維持
- [ ] 仮想スクロール（必要な場合のみ）
- [ ] React.memo 適用

---

## 📝 更新履歴

| 日付 | 内容 | コミット |
|------|------|----------|
| 2026-01-14 | PERF-S1 Status取得キャッシュ | b12fb81 |
| 2026-01-14 | PERF-S2 メッセージ表示上限 | 3fcffa1 |
| 2026-01-14 | 二重状態解消 | 339709a |

---

## 関連ドキュメント

- [FRONTEND_REFRESH_MAP.md](./FRONTEND_REFRESH_MAP.md) - Write→Refresh一覧
- [FRONTEND_NATIVE_PREP.md](./FRONTEND_NATIVE_PREP.md) - ネイティブ化準備
- [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) - 全体設計
