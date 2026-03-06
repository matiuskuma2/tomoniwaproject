# STATE_RESPONSIBILITY.md — 状態責務定義書

> **目的**: 「この状態はどこが権威か？」を1箇所に定義し、  
> フロントエンドの ref / sessionStorage / message correction が  
> なし崩しに増えることを防ぐ。  
> **作成日**: 2026-03-06  
> **関連**: CONVERSATION_FLOW.md, pendingTypes.ts, useChatReducer.ts

---

## 1. 原則

| 原則 | 内容 |
|---|---|
| **Single Source of Truth (SSOT)** | 全ての状態は唯一の権威ソースを持つ |
| **Server-first** | サーバーが権威の状態はクライアントで上書きしない |
| **Client-first** | UIのみに存在する状態はクライアントが権威 |
| **Fallback は例外** | sessionStorage等のフォールバックは「バグ対策」であり正規フローではない |

---

## 2. 状態マトリックス

### 2.1 スレッド状態 (Thread Status)

| 項目 | 権威ソース | 保存場所 | 理由 |
|---|---|---|---|
| `thread.status` (draft/active/confirmed/cancelled) | **Server** | DB → API → `threadStatusCache` | 唯一の真実。クライアントは読み取り専用 |
| `invitees[]` / `selections[]` | **Server** | DB → API | 参加者・回答はサーバーが管理 |
| `evaluation.meeting` | **Server** | DB → API | Google Meet URL等はサーバーが生成 |
| キャッシュ TTL | **Client** | `threadStatusCache` (10s TTL) | パフォーマンス最適化のみ |
| `initialLoading` / `refreshing` | **Client** | `useThreadStatus` hook | UI表示フラグのみ |

**ルール**:
- `threadStatusCache.refreshStatus()` = サーバーから強制取得
- `threadStatusCache.getCached()` = TTL内ならキャッシュ返却
- `updateOptimistic()` = UI即時反映 → バックグラウンドで server verify
- CardsPane は `useThreadStatus` のみを参照（reducer に status を持たない）

### 2.2 Pending 状態

| 項目 | 権威ソース | 保存場所 | フォールバック |
|---|---|---|---|
| `pendingByThreadId` | **Client (Reducer)** | `useChatReducer` state | なし |
| `pending.scheduling.clarification` | **Client (Reducer)** | `useChatReducer` state | `sessionStorage` (5分TTL) |
| `pending.action` (confirmToken等) | **Server → Client** | Server が token 発行 → Client が保持 | なし |
| `pending.contact_import.confirm` | **Server → Client** | Server が preview 返却 → Client が保持 | なし |

**ルール**:
- pending の作成: `handleExecutionResult` → `SET_PENDING_FOR_THREAD`
- pending の削除: `handleExecutionResult` → `CLEAR_PENDING_FOR_THREAD`
- pending の参照: `pendingForThread` (computed from `pendingByThreadId[threadId]`)
- ChatPane は `pendingForThreadRef` (useRef) で常に最新値を保持

**sessionStorage フォールバックの位置づけ**:

```
正規フロー:
  handleExecutionResult → SET_PENDING_FOR_THREAD → state 更新
  → pendingForThread 更新 → pendingForThreadRef.current 更新
  → 次の handleSendClick で ref から取得

フォールバック（React state 消失時のみ）:
  sessionStorage.getItem('__tomoniwao_scheduling_clarification')
  → JSON.parse → 5分以内か確認 → PendingState として返却
  → ⚠️ これは「保険」であり、正規フローが正常なら使われない
```

### 2.3 メッセージ (Chat Messages)

| 項目 | 権威ソース | 保存場所 | 永続化 |
|---|---|---|---|
| `messagesByThreadId` | **Client (Reducer)** | `useChatReducer` state | `localStorage` (debounced 500ms) |
| メッセージ内容 | **Client** | Client が生成（user/assistant 両方） | 同上 |
| テンプレートメッセージ | **Client** | `generateTemplateText(status)` | seededThreads Set で二重防止 |

**ルール**:
- サーバーはメッセージを保存しない（チャットはローカルのみ）
- `SEED_MESSAGES` は空スレッドへの初回のみ（`seededThreads` で制御）
- 永続化上限: 20スレッド × 100件 / 表示上限: 50件 (`MAX_DISPLAY_MESSAGES`)
- 5MB超過時: 10スレッド × 50件に自動縮小

### 2.4 敬称 (Honorific Suffix)

| 項目 | 権威ソース | 保存場所 | 補正場所 |
|---|---|---|---|
| ユーザー入力の敬称 | **Client (Classifier)** | `extractPerson()` → `person.suffix` | なし（そのまま保持） |
| API レスポンスの敬称 | **Server** | `message_for_chat` に含まれる | `correctHonorificInMessage()` |
| 表示名 | **Client (Corrected)** | `personDisplayName()` | clarification message 内 |

**ルール**:

```
① ユーザーが「大島くん」と入力
   → extractPerson() → { name: '大島', suffix: 'くん' }
   → suffix は originalParams に保存される

② API に送信
   → invitee.name = '大島'（suffix なし）

③ API レスポンス
   → message_for_chat = "大島さんとの予定を..." （サーバーはデフォルト「さん」）

④ Client 補正
   → correctHonorificInMessage(message, '大島', 'くん')
   → "大島くんとの予定を..." に置換

⑤ 保存場所: suffix は PendingState.originalParams.person.suffix に保持
   → clarification 時も引き継がれる
```

**信頼レベル**: Client > Server（敬称に関してはクライアントが正）  
**理由**: ユーザーの意図（くん/さん/氏/様）はクライアント入力が唯一の真実

### 2.5 `temp` スレッド ID

| 項目 | 定義 |
|---|---|
| `'temp'` とは？ | スレッド未選択時の仮想 threadId。URL は `/chat`（IDなし）|
| 公式か？ | **暫定的 (Provisional)**。正式な threadId が返るまでの橋渡し |
| 使用箇所 | `pendingByThreadId['temp']`, `messagesByThreadId['temp']` |
| ライフサイクル | thread creation 成功時に `temp` → 正式 threadId に移行 |

**ルール**:
- `temp` に保存されたメッセージは navigate 後も `messagesByThreadId['temp']` に残る
- `temp` の pending は `1on1.*.prepared` / `thread.create` 時に明示クリア
- `temp` のメッセージは新 threadId にマイグレーションしない（別々に保持）
- `temp` は永続化対象（localStorage に保存される）

**移行フロー**:
```
① temp に pending/messages を蓄積
② executor → threadId 返却
③ handleExecutionResult → CLEAR_PENDING_FOR_THREAD { threadId: 'temp' }
④ ChatPane → onAppend(newThreadId, assistantMessage)  ← 新スレッドに直接追加
⑤ navigate(`/chat/${newThreadId}`)
⑥ temp のメッセージはそのまま残る（次回 temp 使用時に表示される）
```

### 2.6 カレンダーデータ

| 項目 | 権威ソース | 保存場所 |
|---|---|---|
| `calendarData.today` | **Server** | Reducer state (SET_CALENDAR_TODAY) |
| `calendarData.week` | **Server** | Reducer state (SET_CALENDAR_WEEK) |
| `calendarData.freebusy` | **Server** | Reducer state (SET_CALENDAR_FREEBUSY) |

**ルール**:
- カレンダーデータはスレッド非依存（グローバル）
- 永続化なし（ページリロードで再取得）
- handleExecutionResult で kind 判定して dispatch

---

## 3. Server vs Client 責務分界

### 3.1 Server（API）の責務

| 責務 | 具体例 |
|---|---|
| データの正規化 | thread status, invitee list, slot list |
| ビジネスロジック | 日程候補計算, カレンダーアクセス, メール送信 |
| 認証・認可 | JWT token 検証, tenant isolation |
| ID 生成 | threadId, inviteKey, confirmToken |
| 永続化 | D1 database, R2 storage |

### 3.2 Client（Frontend）の責務

| 責務 | 具体例 |
|---|---|
| Intent 分類 | classifierChain（rule-based, no LLM） |
| Executor 呼び出し | executeIntent → API call → result 処理 |
| 会話状態管理 | pending, messages, UI flags |
| 敬称補正 | correctHonorificInMessage() |
| UI 表示制御 | skeleton, spinner, hint banner |
| キャッシュ管理 | threadStatusCache (10s TTL) |

### 3.3 境界ルール

```
① Server のレスポンスは「事実」→ Client は上書きしない
   例外: 敬称（Server は「さん」固定 → Client がユーザー入力で補正）

② Client の pending は「UI 状態」→ Server は知らない
   Server が知るのは confirmToken のみ（有効期限付き）

③ メッセージは Client のみ
   Server の message_for_chat は「提案」→ Client が最終的に表示
   → correctHonorificInMessage() で補正可能

④ スレッド状態は Server が権威
   Client の optimistic update は一時的 → 必ず Server verify
```

---

## 4. 重複概念の統合マップ

### 4.1 現状の重複箇所

| 重複概念 | 現状の実装 | 権威ソース（確定） |
|---|---|---|
| clarification state | `pendingByThreadId['temp']` + `sessionStorage` + `pendingForThreadRef` | `pendingByThreadId` (Reducer) |
| temp thread | `'temp'` in `pendingByThreadId` + `messagesByThreadId` | Provisional（正式 threadId 取得まで） |
| post-creation transition | `ChatPane.handleSendClick` + `handleExecutionResult` + `navigate` | `ChatPane` がオーケストレータ |
| status sync | `threadStatusCache` + `useThreadStatus` + `prefetchThreadStatus` | `threadStatusCache` |

### 4.2 sessionStorage の使用箇所（全量）

| キー | 用途 | 削除タイミング |
|---|---|---|
| `__tomoniwao_scheduling_clarification` | pending.scheduling.clarification のバックアップ | resolved / prepared / 5分 TTL 超過 |

**方針**: sessionStorage は scheduling clarification の 1 件のみ。  
他の pending には sessionStorage フォールバックを追加しない。

---

## 5. 禁止事項

| 禁止 | 理由 |
|---|---|
| `handleExecutionResult` 内での `navigate()` 直接呼び出し | ChatPane が navigate のオーケストレータ |
| `pending.action` の `confirmToken` をクライアントで生成 | Server のみが token を発行 |
| `threadStatusCache` を bypass した直接 API 呼び出し | キャッシュ一貫性が壊れる |
| `messagesByThreadId` にサーバーメッセージを混在 | メッセージは Client 生成のみ |
| `pendingByThreadId` を localStorage に永続化 | pending は session 寿命（ブラウザタブ閉じで消滅が正しい） |
| 新しい `sessionStorage` キーの追加 | 1件のみに制限 |
| classifier chain の順序変更 | CONVERSATION_FLOW.md が仕様 |

---

## 6. 将来の統合候補

### 6.1 短期（次の close-up phase で対応）

- [ ] `handleExecutionResult` の stale closure 修正（`currentThreadId` を ref 化）
- [ ] `temp` メッセージの自動クリーンアップ（一定期間後に削除）
- [ ] pending の TTL 導入（長期放置 pending の自動失効）

### 6.2 中期（Phase 2 以降）

- [ ] Server-side message storage（チャット履歴のサーバー保存）
- [ ] Pending state の server-side 管理（confirmToken と統合）
- [ ] classifierChain の server-side migration（Edge Worker での分類）

---

## 更新履歴

| 日付 | 内容 |
|---|---|
| 2026-03-06 | 初版作成（4カテゴリの責務定義） |
