# CONVERSATION_FLOW.md — 会話オーケストレーション仕様書

> **目的**: 会話分岐・pending処理・スレッド生成・右ペイン同期・UI描画の密結合を可視化し、  
> 仕様を固定（spec lock）することで技術負債の蓄積を防ぐ。  
> **作成日**: 2026-03-06  
> **最終更新**: 2026-03-06 (PR-UX-15: clarificationId・thread migration event 追加)  
> **対象PR**: PR-UX-12, PR-UX-13, PR-UX-14, PR-UX-15, BUG-1b, P0-1  

---

## 1. 全体アーキテクチャ概要

```
User Input
  │
  ▼
ChatPane.handleSendClick()
  │
  ├─ 画像添付あり → handleBusinessCardScan() → contactImport pipeline
  │
  └─ テキスト入力
       │
       ├─ ① pendingForThreadRef.current → 最新 pending 取得（ref経由）
       │
       ├─ ② classifyIntent(input, context)
       │     └─ classifierChain[14] を順次実行（最初の非nullで停止）
       │
       ├─ ③ executeIntent(intentResult, executionContext)
       │     └─ API呼び出し → ExecutionResult 返却
       │
       ├─ ④ clarification 解消判定
       │     └─ pending.scheduling.clarification → resolved エミット
       │
       ├─ ⑤ thread creation / navigation 判定
       │     └─ prefetchThreadStatus(newThreadId) → navigate
       │
       └─ ⑥ onExecutionResult → useChatReducer.handleExecutionResult
             └─ 状態更新（pending set/clear, calendar, counter etc.）
```

---

## 2. フロー1: 新規調整開始

**トリガー**: `「大島くんと予定調整したい」`

```
[ChatPane] User: "大島くんと予定調整したい"
  │
  ▼ classifyIntentChain()
  │  pendingDecision → null (pending なし)
  │  contactImport   → null (連絡先キーワードなし)
  │  confirmCancel   → null (はい/いいえ以外)
  │  lists           → null
  │  calendar        → null
  │  preference      → null (SCHEDULING_TRIGGER_WORDS にマッチするが person 検出で oneOnOne へ)
  │  oneToMany       → null (1名のため)
  │  reverseAvail.   → null (ご都合伺いキーワードなし)
  │  oneOnOne        → ✅ HIT
  │
  ▼ classifyOneOnOne()
  │  person: { name: "大島", suffix: "くん" }
  │  start_at: undefined  ← 日時なし
  │  end_at: undefined
  │
  ▼ Intent: schedule.1on1.fixed (confidence: 0.7)
  │  BUT: needsClarification ではなく、executor が判定
  │
  ▼ executeOneOnOneFixed()
  │  params.start_at === undefined
  │  → return clarification needed
  │    message: "大島くんとの予定、いつがいいですか？"
  │    data.kind: 'scheduling.clarification.needed'
  │    data.payload: {
  │      originalIntent: 'schedule.1on1.fixed',
  │      originalParams: { person: { name: '大島', suffix: 'くん' }, ... },
  │      missingField: 'date'
  │    }
  │
  ▼ handleExecutionResult()
  │  kind === 'scheduling.clarification.needed'
  │  → clarificationId = generateClarificationId()  ← PR-UX-15
  │  → SET_PENDING_FOR_THREAD { threadId: 'temp', pending: {
  │      kind: 'pending.scheduling.clarification',
  │      clarificationId,  ← 全経路で保持
  │      originalIntent, originalParams, missingField
  │    }}
  │  → sessionStorage.setItem('__tomoniwao_scheduling_clarification', ...)  ← clarificationId 含む
  │  → logPendingSet(threadId, kind, missingField, clarificationId)  ← 構造化ログ
  │
  ▼ ChatPane 表示:
     Assistant: "大島くんとの予定、いつがいいですか？（例: 来週木曜17時から1時間）"
     hint banner: "🔵 追加情報を入力してください"
     placeholder: "日時を入力..."
```

**状態遷移**:
- `pendingByThreadId['temp']` = `{ kind: 'pending.scheduling.clarification', clarificationId: 'clr-xxx', ... }`
- `sessionStorage['__tomoniwao_scheduling_clarification']` = 同データ（バックアップ、clarificationId 含む）
- `clarificationId` は pending 解消まで全ログエントリに記録される

---

## 3. フロー2: Clarification 継続

**トリガー**: `「来週木曜17時から」`（直前に clarification 発生済み）

```
[ChatPane] User: "来週木曜17時から"
  │
  ▼ pendingForThreadRef.current
  │  → { kind: 'pending.scheduling.clarification',
  │      originalIntent: 'schedule.1on1.fixed',
  │      originalParams: { person: { name: '大島', suffix: 'くん' } },
  │      missingField: 'date' }
  │
  ▼ classifyIntentChain(input, { pendingForThread: above })
  │  activePending = pending.scheduling.clarification
  │
  │  pendingDecision → null
  │  contactImport   → null
  │  confirmCancel   → null（10文字超、かつ pending 種別が異なる）
  │  lists           → null
  │  calendar        → null ⚠️ GUARD: line 97-99
  │    「pending.scheduling.clarification が active なら null を返す」
  │    → 「空き」キーワードにマッチしても calendar に吸われない
  │  preference      → null（同様のガード）
  │  oneToMany       → null
  │  reverseAvail.   → null
  │  oneOnOne        → ✅ HIT（pending.scheduling.clarification を検出）
  │
  ▼ classifyOneOnOne()
  │  ← activePending が pending.scheduling.clarification
  │  → originalParams を復元
  │  → 新入力から日時を抽出: start_at = "来週木曜17:00", end_at = "+1h"
  │  → person は originalParams から引き継ぎ: { name: '大島', suffix: 'くん' }
  │  → Intent: schedule.1on1.fixed (confidence: 0.9)
  │    params: { person, start_at, end_at } ← 全パラメータ揃い
  │
  ▼ executeOneOnOneFixed()
  │  person ✅, start_at ✅, end_at ✅
  │  → resolveContact → channelResolve → API /prepare
  │  → return { success: true, data: { kind: '1on1.fixed.prepared', payload: { threadId: 'xxx' } } }
  │
  ▼ ChatPane: clarification 解消判定
  │  latestPendingForThread.kind === 'pending.scheduling.clarification'
  │  AND result.data.kind !== 'scheduling.clarification.needed'
  │  → onExecutionResult({ kind: 'scheduling.clarification.resolved' }) を発火
  │
  ▼ handleExecutionResult()
  │  (1) 'scheduling.clarification.resolved'
  │      → clarificationId retrieved from sessionStorage  ← PR-UX-15
  │      → logPendingClear(threadId, reason, clarificationId)
  │      → CLEAR_PENDING_FOR_THREAD { threadId: 'temp' }
  │      → sessionStorage.removeItem(...)
  │  (2) '1on1.fixed.prepared'
  │      → logThreadMigration('temp', newThreadId, kind, clarificationId)  ← PR-UX-15
  │      → CLEAR_PENDING_FOR_THREAD { threadId: 'temp' }  ← 二重クリア（安全）
  │      → sessionStorage.removeItem(...)
  │
  ▼ ChatPane: thread creation 判定
     result.data.kind === '1on1.fixed.prepared' → isThreadCreation = true
     newThreadId = result.data.payload.threadId
     → onAppend(newThreadId, assistantMessage)
     → onExecutionResult(result)
     → prefetchThreadStatus(newThreadId)  ← PR-UX-13
     → setTimeout(() => navigate(`/chat/${newThreadId}`), 100)
```

**critical path**: `calendar` と `preference` のガードが `pending.scheduling.clarification` を検知して null を返すことで、  
clarification 入力が他の classifier に誤キャプチャされない。

---

## 4. フロー3: スレッド作成 (Thread Creation)

**トリガー**: Executor が新 threadId を返した場合

```
Executor returns:
  data.kind ∈ {
    'thread.create',
    '1on1.fixed.prepared',
    '1on1.candidates3.prepared',
    '1on1.freebusy.prepared',
    '1on1.open_slots.prepared',
    'thread.invites.batch'
  }

  │
  ▼ ChatPane: isThreadCreation 判定
  │  newThreadId = data.payload.threadId
  │
  ├─ ① onAppend(newThreadId, assistantMessage)  ← 新スレッドにメッセージ追加
  ├─ ② onExecutionResult(result)                ← reducer 状態更新
  ├─ ③ prefetchThreadStatus(newThreadId)         ← PR-UX-13: cache warm
  └─ ④ setTimeout(() => navigate(`/chat/${newThreadId}`), 100)
       │
       ▼ URL 変更: /chat → /chat/{newThreadId}
       │
       ▼ ChatLayout: threadId prop が更新
       │  → useThreadStatus(newThreadId) 起動
       │  → getCached(newThreadId) ← prefetch 済みならキャッシュヒット
       │  → initialLoading = false（キャッシュがある場合）
       │
       ▼ CardsPane: status が即座に利用可能
          → skeleton なし or 最小限
```

**注意**: `setTimeout(100)` は React state 更新と DOM 描画の完了を待つため。  
`prefetchThreadStatus` はその 100ms の間に fetch を開始し、  
navigate 後の `useThreadStatus` で cache hit を実現する。

---

## 5. フロー4: prepared 後の遷移

**前提**: フロー3 で navigate 完了後

```
navigate(`/chat/${newThreadId}`) 完了
  │
  ▼ ChatLayout re-render
  │  currentThreadId = newThreadId
  │  messages[newThreadId] = [assistantMessage]  ← フロー3で追加済み
  │
  ▼ useThreadStatus(newThreadId)
  │  ├─ getCached(newThreadId) → prefetch 済みデータ
  │  ├─ status = { thread: { status: 'draft', invitees: [...] }, ... }
  │  └─ initialLoading = false ← cache hit
  │
  ▼ ChatPane render:
  │  showSkeleton = false（messages.length > 0 かつ status あり）
  │  → 通常のチャット画面表示
  │
  ▼ CardsPane render:
  │  status ≠ null → ThreadCardsSwitch / ThreadStatusCard 表示
  │  initialLoading = false → skeleton なし
  │
  ▼ ThreadsList: refresh by navigate
     → ThreadsList が新スレッドをリスト上に表示
```

**failure mode**: API が遅延し prefetch が間に合わない場合  
→ `useThreadStatus` は `initialLoading = true` でフォールバック  
→ CardsPane に skeleton 表示（数百ms）  
→ fetch 完了で status 更新 → 通常表示

---

## 6. フロー5: Pending 解消 (Resolution)

**パターンA: Clarification 解消（フロー2で説明済み）**

```
pending.scheduling.clarification が active
  → classifyOneOnOne が復元パラメータ + 新入力で完全な intent を生成
  → executeOneOnOneFixed 成功
  → ChatPane: scheduling.clarification.resolved をエミット
  → handleExecutionResult: CLEAR_PENDING_FOR_THREAD + sessionStorage 削除
```

**パターンB: Confirm/Cancel 解消**

```
pending.action / remind.pending / notify.confirmed / etc. が active
  → User: 「はい」or「いいえ」
  → classifyConfirmCancel がマッチ
    → pending.kind に応じた confirm/cancel intent を返す
  → executeIntent → API 実行
  → handleExecutionResult:
    └─ *.cancelled / *.sent / *.executed → CLEAR_PENDING_FOR_THREAD
```

**パターンC: Contact Select 解消**

```
pending.contact.select が active
  → User: 番号選択（「1」「2」等）
  → classifyPendingDecision がマッチ
  → executor が選択を処理 → pending クリア
```

---

## 7. フロー6: CardsPane 同期

**同期メカニズム**:

```
1. Executor 内 refreshAfterWrite (write 系 API 後)
   → threadStatusCache.refreshStatus(threadId) 強制
   → notifyListeners() → subscribe callback → setStatus()
   → CardsPane re-render

2. prefetchThreadStatus (thread creation 時)
   → cache に status を先行投入
   → navigate 後の useThreadStatus が cache hit

3. useThreadStatus TTL (10秒)
   → 通常操作では TTL 内は cache から返す
   → TTL 超過時は background refresh（refreshing = true, initialLoading = false）
   → CardsPane: tiny sync indicator のみ表示

4. URL 変更 (navigate)
   → threadId prop 変更 → useThreadStatus(newThreadId) 起動
   → getCached(newThreadId) → cache hit or initial fetch
```

**CardsPane 表示ロジック**:

```
if (status)           → ThreadCardsSwitch or individual cards
else if (initialLoading) → CardsSkeleton (pulse animation)
else if (calendarData)   → Calendar cards only
else                     → Guide message ("スレッドを選択してください")
```

**refreshing 時**: 常に tiny indicator（h-2 w-2 spinner + "同期中"テキスト）  
**initialLoading 時のみ**: CardsSkeleton  
**全画面スピナー**: 禁止（PR-UX-6 で廃止済み）

---

## 8. フロー7: nlRouter 進入条件

**nlRouter は「最終手段」のフォールバック**

```
classifierChain 全14分類器 → 全て null
  │
  ▼ return { intent: 'unknown', confidence: 0, params: { rawInput } }
  │
  ▼ executeIntent() → switch(intent)
  │  case 'unknown':
  │    → handleChatFallback() or nlRouter()
  │
  ▼ nlRouter 進入条件:
     ✅ 全 classifier が null
     ✅ intent === 'unknown'
     ✅ confidence === 0
     ✅ 有効な pending が存在しない
        (pending が active なら classifyPendingDecision or
         classifyConfirmCancel or classifyOneOnOne がキャプチャ済み)
```

**nlRouter を通してはいけないケース（ガードまとめ）**:

| ガード場所 | 条件 | 理由 |
|---|---|---|
| `classifyCalendar` L97-99 | `pending.scheduling.clarification` active | clarification を空き検索に誤分類しない |
| `classifyPreference` | `pending.scheduling.clarification` active | clarification を好み設定に誤分類しない |
| `classifyOneOnOne` | `pending.scheduling.clarification` active | clarification を拾って originalParams を復元 |
| `classifyPendingDecision` | 任意の `pending.action` active | pending 操作中の入力を逸脱させない |
| `classifyConfirmCancel` | 短入力 + 確認系 pending active | yes/no を雑談に流さない |
| `classifyContactImport` | `pending.contact_import.*` active | 連絡先フロー中の入力を保護 |

---

## 9. Classifier Chain 固定順序

```
# 絶対に順序を変更しないこと（CONVERSATION_FLOW.md が仕様）

 1. pendingDecision     ← pending.action 決定（最優先）
 2. contactImport       ← 連絡先取り込み（pending.contact_import/person.select）
 3. confirmCancel       ← はい/いいえ（split/notify/remind 優先順）
 4. lists               ← Beta A リスト5コマンド
 5. calendar            ← カレンダー読み取り（clarification ガード付き）
 6. preference          ← 好み設定（clarification ガード付き）
 7. oneToMany           ← 1対N（2名以上検出で優先）
 8. reverseAvailability ← 逆アベイラビリティ（ご都合伺い）
 9. oneOnOne            ← 1対1予定調整（clarification 復元含む）
10. propose             ← 候補提案
11. remind              ← リマインド
12. relation            ← 関係性管理（仕事仲間）
13. pool                ← Pool Booking
14. thread              ← スレッド操作
─────────────────────────
    fallback            ← unknown → nlRouter / chat
```

---

## 10. 危険シグナルとチェックポイント

### ✅ 解決済み
- [x] clarification が calendar/preference に吸われる → ガード追加済み
- [x] pendingForThread が stale closure で null → ref 経由に変更済み
- [x] sessionStorage フォールバック → 5分TTL付きで実装済み
- [x] prepared 後の右ペイン空白 → prefetchThreadStatus 追加済み
- [x] temp pending が残る → prepared 時に明示クリア追加済み
- [x] 会話継続判定が threadId のみに依存 → clarificationId 追加済み (PR-UX-15)
- [x] temp → 正式 thread 移行が暗黙的 → thread.migration event で明示化 (PR-UX-15)

### ⚠️ 監視対象（未発火だが設計上の弱点）
- [ ] `handleExecutionResult` の `currentThreadId` stale closure（useCallback の deps が `[currentThreadId, navigate]` のみ）
- [ ] `setTimeout(100)` による navigate タイミング依存
- [ ] `sessionStorage` の 5分 TTL 超過時の挙動（長時間放置→復帰）
- [ ] `pendingByThreadId` のメモリ増加（古い pending がクリアされない場合）

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-03-06 | 初版作成（7フロー全網羅） |
| 2026-03-06 | PR-UX-15: clarificationId 追加（Flow 1/2 更新）、thread.migration event、ログ強化 |
