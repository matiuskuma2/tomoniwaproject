# FE-7 を実装に入る前の確認すべきこと

> **作成日**: 2026-03-05
> **作成者**: モギモギ（関屋紘之）
> **目的**: FE-7（Mode Chip UI）の実装に入る前に、UI/UX 安定性・状態管理・パフォーマンス・運用安全性の観点から
> 漏れなく確認すべきポイントを列挙する。**結論は出さない**。項目の洗い出しのみ。
>
> **前提**:
> - バックエンド（scheduling, invites, RA Phase 2）は完了済み
> - 焦点は **UI/UX の操作品質**（LINE/Slack 相当）
> - **PWA 前提** の設計（将来 Service Worker, オフライン対応, Push通知）
> - **大量ユーザー耐性**（1万人同時接続想定）
> - **Slack/Chatwork 連携運用**（Webhook 配信、チャネル管理）

---

## 0. 前提確認

- [ ] **0-1**: FE-7 PRD（`docs/plans/FE-7-MODE-CHIP-UI.md`）の設計内容に変更・追加はないか
- [ ] **0-2**: 現在の classifier chain（14分類器）の優先順序と処理フローを全員が理解しているか
- [ ] **0-3**: 現在のテスト 410/410 が全て green であることを手元で再確認したか
- [ ] **0-4**: TypeScript strict mode が 0 errors であることを確認したか
- [ ] **0-5**: 本番環境（app.tomoniwao.jp）で直近のデプロイが正常に動作しているか
- [ ] **0-6**: `apiExecutor.ts`（1,476行）のコードを把握し、FE-7 で触る箇所を特定できているか
- [ ] **0-7**: `classifyOneOnOne.ts`（740行）の分岐フローを把握できているか
- [ ] **0-8**: `useChatReducer.ts`（857行）の handleExecutionResult の全 kind を理解しているか
- [ ] **0-9**: 現在の技術的負債リスト（TD-10〜TD-33）の中で FE-7 と衝突するものはないか

---

## 1. くるくる（全画面スピナー）問題

### 1-1. スピナーの種類特定

- [ ] **1-1-a**: `ChatPane` L411-417 の `if (loading)` による全画面スピナーが表示される条件は何か（`useThreadStatus` の `loading` 状態のライフサイクル）
- [ ] **1-1-b**: `ThreadsList` L52-58 の `if (loading)` による左ペイン全体スピナーが表示される条件は何か
- [ ] **1-1-c**: 上記2つのスピナーが同時に表示されるケースはあるか（例: スレッド選択直後）
- [ ] **1-1-d**: Route 遷移（`/chat` → `/chat/:threadId`）時に `ChatLayout` 自体が unmount/remount されるか、それとも `threadId` パラメータの変更のみか
- [ ] **1-1-e**: `useThreadStatus` の `fetchStatus` が走る間、ChatPane の既存メッセージは消えるか・残るか

### 1-2. 送信時の再取得パターン

- [ ] **1-2-a**: `handleSendClick` 内で `onThreadUpdate()` が呼ばれると `refreshThreadStatus()` が走る。この間、`loading` が `true` になり ChatPane が全画面スピナーに切り替わるか
- [ ] **1-2-b**: `executeIntent` の実行中（`isProcessing=true`）に送信ボタンの `disabled` 以外で UI がブロックされる箇所はないか
- [ ] **1-2-c**: `thread.create` / `thread.invites.batch` の結果で `navigate` が走る。navigate 後に `useThreadStatus` の初回 fetch で再びスピナーが出るか
- [ ] **1-2-d**: `refreshThreadStatus` → `getStatus` → API 呼び出し → レスポンス待ちの間、ユーザーに何が見えるか
- [ ] **1-2-e**: `setTimeout(() => onThreadUpdate(), 500)` の 500ms は根拠があるか。API がその間に完了する保証はあるか
- [ ] **1-2-f**: 送信1回で `GET /api/threads/:id/status` が何回呼ばれるか（useThreadStatus のキャッシュ TTL 10s 内での重複呼び出し）

### 1-3. ChatPane の mount/unmount

- [ ] **1-3-a**: `useParams<{ threadId }>` の変更で ChatLayout 内の ChatPane は re-mount されるか、それとも props 更新のみか
- [ ] **1-3-b**: re-mount される場合、`messages` / `isProcessing` / `attachedImages` のローカル state はリセットされるか
- [ ] **1-3-c**: Mobile タブ切替（threads → chat → cards）で ChatPane が unmount → remount されるか
- [ ] **1-3-d**: `isSettingsOpen` の dropdown 表示/非表示が ChatPane の再レンダーをトリガーしないか

### 1-4. スレッド一覧の再描画

- [ ] **1-4-a**: 送信完了後の `onThreadUpdate` → `refreshThreadStatus` が ThreadsList の再描画を引き起こすか（ThreadsList は独自の `getThreadsList` キャッシュを使用）
- [ ] **1-4-b**: `subscribeThreadsList` でキャッシュ更新を受信した時、スクロール位置はリセットされるか
- [ ] **1-4-c**: 選択中のスレッドの `bg-blue-50` ハイライトが再描画後も維持されるか

---

## 2. Optimistic UI（LINE/Slack 同等体験）

### 2-1. メッセージ即時表示

- [ ] **2-1-a**: `onAppend(targetThreadId, userMsg)` の呼び出しが `executeIntent` の **前** に実行されることを確認（現在 L255 で append → L261 で classifyIntent の順序）
- [ ] **2-1-b**: append 後、DOM の `scrollIntoView({ behavior: 'smooth' })` が即座にトリガーされるか（useEffect [messages] 依存）
- [ ] **2-1-c**: `isProcessing=true` の間、送信ボタンに「処理中...」が表示されるが、メッセージ欄にタイピングインジケーターの表示は不要か
- [ ] **2-1-d**: API がエラーを返した場合、ユーザーメッセージは残る（消えない）ことを確認
- [ ] **2-1-e**: エラー後の再送信（retry）は現在サポートされているか。されていない場合、必要か

### 2-2. 応答のインクリメンタル追加

- [ ] **2-2-a**: `assistantMessage` が1件の `onAppend` で追加される。Streaming 表示（文字が徐々に現れる）は将来必要か
- [ ] **2-2-b**: 複数の assistant メッセージが連続で追加されるケース（template seed）で、UI がチラつかないか
- [ ] **2-2-c**: `handleExecutionResult` で navigate が走る場合、assistant メッセージの表示が navigate より先に確実に完了するか（`setTimeout 100ms` の race condition）

### 2-3. 送信失敗時のUX

- [ ] **2-3-a**: ネットワークエラー時、`extractErrorMessage(error)` のメッセージはユーザーに分かりやすいか
- [ ] **2-3-b**: 失敗したメッセージに対して「再送信」ボタンや赤い警告アイコンを付ける必要はないか
- [ ] **2-3-c**: `isProcessing` が `false` に戻る（finally ブロック）ため、失敗後すぐに次の送信が可能であることを確認

---

## 3. Mode Chip 設計安全性

### 3-1. モードの寿命とスコープ

- [ ] **3-1-a**: `selectedMode` はスレッドに紐づくか、入力欄に紐づくか（PRD: 「スレッド切替後に Auto リセット」→ 入力セッション単位）
- [ ] **3-1-b**: 送信後に `selectedMode` がリセットされないことの是非（PRD: 「同モードで連続操作を想定」）
- [ ] **3-1-c**: ブラウザリロード時に `selectedMode` はリセットされるか（PRD: localStorage に保存しない → セッション内のみ）
- [ ] **3-1-d**: `selectedMode` が `useChatReducer` の `ChatState` に含まれると、毎回の state 変更で永続化ロジック（debounce 500ms）がトリガーされないか
- [ ] **3-1-e**: Mobile でスレッドタブ → チャットタブ → スレッドタブと行き来した時、`selectedMode` は維持されるか

### 3-2. Pending との競合

- [ ] **3-2-a**: pending active 時に Mode Chip 全体が disabled になる実装は、`pendingForThread` **と** `globalPendingAction` の**両方**を見る必要があるか
- [ ] **3-2-b**: pending.action の confirmToken 期限切れ（5分）後に Mode Chip が自動で enabled に戻るか
- [ ] **3-2-c**: pending 解決（confirm/cancel）後に Mode Chip の状態がどうなるか（Auto に戻るか、前の選択を維持するか）
- [ ] **3-2-d**: 13種の PendingKind すべてに対して disabled 挙動をテストする必要があるか

### 3-3. Classifier Chain への影響

- [ ] **3-3-a**: `preferredMode` が `auto` 以外の時、`hasTriggerWord(input)` がないと `classifyOneOnOne` が early return する。Mode 選択時にキーワードなしでもモード発動させるべきか
- [ ] **3-3-b**: `preferredMode='candidates'` だが人名が1人しかなく日時も1つしか指定されていない場合、clarification で候補追加を促す動作は正しいか
- [ ] **3-3-c**: `preferredMode='reverse_availability'` + `classifyReverseAvailability` で RA キーワードをスキップした場合、person/email 抽出に失敗した時の fallback は何か
- [ ] **3-3-d**: `classifyOneToMany` が `classifyOneOnOne` より chain 上位にあるため、2名以上の入力で Mode Chip の 1on1 モードが無視される動作は意図通りか
- [ ] **3-3-e**: `buildForcedModeResult` 関数で生成される `IntentResult` の `confidence` 値は何が適切か（1.0? 0.9?）
- [ ] **3-3-f**: 全14 classifier に対して `preferredMode` の影響がない（#1-7, #10-14）ことを回帰テストで保証できるか

### 3-4. UI 視覚安全

- [ ] **3-4-a**: Mode Chip の横スクロール（SP）が、ChatPane のメッセージスクロールと干渉しないか
- [ ] **3-4-b**: Chip 選択時のハイライト色が pending バナー（黄色背景）と視覚的に被らないか
- [ ] **3-4-c**: 6つの Chip が画面幅の狭い端末（iPhone SE: 375px）で正しく横スクロールできるか
- [ ] **3-4-d**: Mode Chip の tooltip / description 表示（長押し or ホバー）は必要か
- [ ] **3-4-e**: Mode Chip を追加すると ChatPane の入力エリアの高さが増える。メッセージ表示領域の圧迫度は許容範囲か

---

## 4. Slack / Chatwork 通知

### 4-1. 通知スコープとチャネル

- [ ] **4-1-a**: Slack/Chatwork 通知のスコープは「ワークスペース全体」か「スレッド単位」か「ユーザー単位」か
- [ ] **4-1-b**: Webhook URL / Bot Token はどこに保存するか（`workspace_notifications` テーブル? 新テーブル?）
- [ ] **4-1-c**: 1つのスレッドイベントに対して複数チャネル（Slack + Chatwork + メール）への同時配信は想定するか
- [ ] **4-1-d**: 通知のトリガーイベント（招待送信、回答受信、確定、リマインドなど）の定義は完了しているか

### 4-2. 通知の集約とバッチ処理

- [ ] **4-2-a**: 同一スレッドで短時間に複数イベントが発生した場合（例: 3人同時回答）、通知を集約するか個別送信するか
- [ ] **4-2-b**: 1対N の招待で10名に同時送信する場合、Slack 通知は1件にまとめるか
- [ ] **4-2-c**: バッチ送信時の Webhook rate limit（Slack: 1msg/sec）への対策は考慮されているか

### 4-3. 障害検知とフォールバック

- [ ] **4-3-a**: Webhook 送信が失敗（404, 410 = channel deleted, 429 = rate limit）した場合の検知とリトライ方針は
- [ ] **4-3-b**: Slack Bot Token が revoke された場合の検知手段は（定期ヘルスチェック? 送信失敗時?）
- [ ] **4-3-c**: 通知送信失敗がユーザーの日程調整フローをブロックしない設計になっているか（fire-and-forget?）
- [ ] **4-3-d**: 通知の配信ログ（成功/失敗/リトライ）の保存先と閲覧方法は

### 4-4. FE-7 との相互影響

- [ ] **4-4-a**: Mode Chip の選択イベントは Slack/Chatwork 通知の対象外であることを確認
- [ ] **4-4-b**: Mode Chip で強制モード選択された結果（例: FreeBusy → 自動候補生成）が通知対象イベントを発火する場合、通知内容は Mode に関わらず同一か

---

## 5. People Hub / つながり一貫性

### 5-1. Connection と Contact の区別

- [ ] **5-1-a**: 「つながり（connection = relationship）」と「連絡先（contact）」は DB レベルで別テーブルか。両者の関係は明確か
- [ ] **5-1-b**: 日程調整を1回行った相手は自動的に「つながり」になるか、明示的な操作が必要か
- [ ] **5-1-c**: People Hub のタブ構成（contacts / lists / relationships?）と各タブのデータソースは整合しているか

### 5-2. Post-Request フロー

- [ ] **5-2-a**: つながり申請（`/relationships/request`）が承認された後、UI はどこに遷移するか（People Hub? Chat?）
- [ ] **5-2-b**: つながり申請の承認/拒否の結果が、Chat UI のどこかに表示されるか
- [ ] **5-2-c**: Post-Import Auto-Connect Bridge（FE-5）で名刺取込後に自動的に日程調整に入るフロー、connection 状態に影響するか

### 5-3. FE-7 との相互影響

- [ ] **5-3-a**: Mode Chip の選択は People Hub のデータに一切影響しないことを確認
- [ ] **5-3-b**: Contacts の検索/選択 UI と Mode Chip が同じ入力セッション内で共存する場面はあるか

---

## 6. 招待リンク / トークン管理

### 6-1. トークン寿命と有効期限

- [ ] **6-1-a**: 招待リンクトークン（`/i/:token`）の有効期限は何時間/何日か。期限切れ時のゲスト向け UI はどうなるか
- [ ] **6-1-b**: RA トークン（`/ra/:token`）の有効期限と、招待トークンとの差異は
- [ ] **6-1-c**: Open Slots トークン（`/s/:token`）の有効期限は
- [ ] **6-1-d**: `pending.action` の `expiresAt`（5分）とリンクトークンの寿命は別の概念であることを全員が理解しているか

### 6-2. 漏洩耐性

- [ ] **6-2-a**: トークンの entropy（ランダム性）は十分か（UUID v4? cryptographic random?）
- [ ] **6-2-b**: 同一トークンで複数回の回答送信（idempotency）は防止されているか
- [ ] **6-2-c**: 短時間に大量のトークン生成リクエスト（DoS）に対する rate limit はあるか
- [ ] **6-2-d**: CSRF 対策（RA OAuth フローの `state` パラメータ等）は実装済みか
- [ ] **6-2-e**: トークンが URL に含まれるため、Referer ヘッダーでの漏洩防止（`<meta name="referrer" content="no-referrer">`）は対応済みか

### 6-3. トークン → スレッド対応追跡

- [ ] **6-3-a**: 管理者（ホスト）が発行済みトークンの一覧を確認できる UI はあるか
- [ ] **6-3-b**: トークンからスレッドへの逆引き（「このリンクはどのスレッドの？」）はログまたは DB クエリで可能か
- [ ] **6-3-c**: 無効化（revoke）操作は可能か（例: 間違って送ったリンクを無効にしたい）

### 6-4. FE-7 との相互影響

- [ ] **6-4-a**: Mode Chip の選択が招待リンクの生成やトークン内容に影響するか（想定: しない）
- [ ] **6-4-b**: Mode Chip で `reverse_availability` を選択した場合に生成される RA リンクのフローは、手動入力で RA が発動した場合と同一か

---

## 7. DOM 肥大化 / 再レンダー範囲

### 7-1. メッセージ表示の上限管理

- [ ] **7-1-a**: `MAX_DISPLAY_MESSAGES = 50`（ChatPane L422）の制限は、長時間セッションで十分か
- [ ] **7-1-b**: `hiddenCount > 0` 時の「○件の古いメッセージは省略されています」の上部にスクロールアップで過去メッセージを遅延読み込みする機能は必要か
- [ ] **7-1-c**: `useChatReducer` の localStorage 保存上限（MAX_MESSAGES_PER_THREAD=100, MAX_THREADS=20）と表示上限（50）の整合性は取れているか
- [ ] **7-1-d**: 5MB の localStorage サイズ制限を超えた場合の段階的縮小（50件×10スレッド）は十分か
- [ ] **7-1-e**: 仮想スクロール（react-window / react-virtuoso 等）の導入を FE-7 前に行うべきか、FE-7 後に行うべきか

### 7-2. 再レンダー範囲の限定

- [ ] **7-2-a**: `ChatLayout` の state 変更（`useChatReducer` の dispatch）で、ThreadsList / ChatPane / CardsPane の **全て** が re-render されるか
- [ ] **7-2-b**: `useReducer` の state が変更されるたび、`currentMessages` の参照が変わり ChatPane が再描画される。`React.memo` で防止すべきか
- [ ] **7-2-c**: `handleExecutionResult` 内の `dispatch` 呼び出しが、mode/pending/counter の変更で不要な再レンダーを引き起こすか
- [ ] **7-2-d**: Mode Chip の選択（`SET_MODE` action）が ChatPane 全体の再レンダーをトリガーするか。Mode Chip のみの再描画に限定できるか
- [ ] **7-2-e**: `messagesByThreadId` オブジェクトの参照が頻繁に変わることで、永続化 effect が過剰にトリガーされないか

### 7-3. メモリ使用量

- [ ] **7-3-a**: `messagesByThreadId` に20スレッド × 100件 = 2,000メッセージオブジェクトを保持した時のメモリ使用量は許容範囲か
- [ ] **7-3-b**: `Set<string>` の `seededThreads` がスレッド数に比例して膨張する。上限は設けるべきか
- [ ] **7-3-c**: `pendingByThreadId` に古いスレッドの null エントリが蓄積する。クリーンアップは必要か
- [ ] **7-3-d**: 画像添付の `URL.createObjectURL(file)` で作成した Blob URL が、`removeImage` 時に `URL.revokeObjectURL` で解放されているか（現在: されていない → メモリリーク）

---

## 8. PWA / Service Worker

### 8-1. 現状確認

- [ ] **8-1-a**: Service Worker は現在未実装であることの確認（`sw.js` なし）
- [ ] **8-1-b**: `manifest.json` / `manifest.webmanifest` は存在するか（PWA インストール用）
- [ ] **8-1-c**: FE-7 の実装は Service Worker 導入を前提にしているか、独立しているか

### 8-2. キャッシュ戦略

- [ ] **8-2-a**: 将来の Service Worker で API レスポンス（`/api/*`）をキャッシュすべきか、すべきでないか
- [ ] **8-2-b**: 静的アセット（JS/CSS/画像）のキャッシュ戦略は決まっているか（Cache-First? Network-First?）
- [ ] **8-2-c**: Service Worker の更新で古い JS がキャッシュに残り、新しい API と不整合を起こすリスクへの対策は
- [ ] **8-2-d**: `threadStatusCache` の TTL 10s キャッシュと、Service Worker キャッシュが二重になった場合の動作は

### 8-3. オフライン対応

- [ ] **8-3-a**: オフライン時にチャット入力を受け付け、オンライン復帰後に送信するキューイング機能は FE-7 で必要か、将来か
- [ ] **8-3-b**: オフライン時の UI 表示（バナー、disabled 状態）の設計は
- [ ] **8-3-c**: オフライン → オンライン復帰時に `threadStatusCache` の強制リフレッシュは必要か

### 8-4. App Shell パターン

- [ ] **8-4-a**: ChatLayout の 3 カラム構造（ThreadsList / ChatPane / CardsPane）を App Shell として事前キャッシュすべきか
- [ ] **8-4-b**: ログインページのキャッシュは不要（認証トークン消失時はサーバーアクセス必須）であることを確認

---

## 9. パフォーマンス（1万人同時接続想定）

### 9-1. API 呼び出し頻度

- [ ] **9-1-a**: `useThreadStatus` のキャッシュ TTL 10s は、1万人が全員同じスレッドを見た場合の D1 負荷に耐えるか
- [ ] **9-1-b**: `getThreadsList` のキャッシュ TTL 30s は適切か。更新頻度と鮮度のバランス
- [ ] **9-1-c**: `subscribeThreadsList` のキャッシュ更新通知が1万セッションに同時配信される場合、ブラウザ側のメモリ・CPU は問題ないか
- [ ] **9-1-d**: Mode Chip 選択自体は API 呼び出しを行わないことを確認（フロントのみ）

### 9-2. レンダリング性能

- [ ] **9-2-a**: 50件のメッセージ表示でフレームレートが 60fps を維持できるか（特にモバイル端末）
- [ ] **9-2-b**: Mode Chip 追加による追加の DOM ノード数（6 chip + ラッパー ≈ 20ノード）は許容範囲か
- [ ] **9-2-c**: `displayMessages.map()` で key に `msg.id` を使用しているが、`msg.id` の一意性（`user-${Date.now()}`）が高速入力時に衝突しないか
- [ ] **9-2-d**: `scrollIntoView({ behavior: 'smooth' })` がメッセージ追加のたびに走る。大量メッセージ追加時にスクロールアニメーションが重なるか

### 9-3. バンドルサイズ

- [ ] **9-3-a**: FE-7 で追加される `ModeChip.tsx` のコードサイズは dist/ 全体の 2MB 制限内か
- [ ] **9-3-b**: `SchedulingMode` 型と `MODES` 定数の定義場所は tree-shaking に影響しないか
- [ ] **9-3-c**: Mode Chip で新しい CDN ライブラリの追加は不要であることを確認

---

## 10. 認証 / OAuth フロー

### 10-1. ログイン状態管理

- [ ] **10-1-a**: `ProtectedRoute` の `isAuthenticated()` チェックで、トークン有効期限切れ時の挙動は（画面遷移中にセッション切れ → 白画面の可能性）
- [ ] **10-1-b**: Google OAuth のリフレッシュトークン処理が FE-7 の操作中（Mode 選択 → 送信）に介入する可能性はあるか
- [ ] **10-1-c**: ChatLayout の `handleLogout` で `clearAuth()` 後、ChatState（メッセージ等）がメモリに残る。セキュリティ上問題ないか

### 10-2. ゲスト OAuth（RA Phase 2）

- [ ] **10-2-a**: RA ゲスト OAuth のコールバック URL（`/api/ra-oauth/callback`）が本番で正しく設定されていることの確認
- [ ] **10-2-b**: OAuth 同意画面から戻った際の画面遷移が自然か（白画面にならないか）
- [ ] **10-2-c**: Mode Chip で `reverse_availability` を選んだ場合に生成される RA リンクから、ゲストが OAuth で進んだ場合のフロー全体に問題はないか

---

## 11. エラーハンドリング / ロギング

### 11-1. フロントエンドエラー

- [ ] **11-1-a**: `ErrorBoundary`（App.tsx L31）が ChatLayout 内の例外をキャッチした場合、ユーザーに何が表示されるか
- [ ] **11-1-b**: `classifyIntent` が null を返した場合（全 classifier で不一致）の UI 表示は何か
- [ ] **11-1-c**: `executeIntent` が throw した場合の catch ブロック（L361-369）は全ての例外型をカバーしているか
- [ ] **11-1-d**: `console.log` / `console.error` が本番で有効になっている。構造化ログ（`log` from `core/platform`）への移行は必要か

### 11-2. バックエンドエラー

- [ ] **11-2-a**: D1 cold start による初回レスポンス遅延（~600ms）を FE 側で適切にハンドリングしているか
- [ ] **11-2-b**: Workers の CPU time limit（10ms free / 30ms paid）超過時のエラーが FE でどう表示されるか
- [ ] **11-2-c**: Cloudflare Dashboard でのエラーモニタリング（エラー率 < 0.1% 目標）は設定済みか

---

## 12. テスト / 品質保証

### 12-1. FE-7 テスト完全性

- [ ] **12-1-a**: PRD の FE7-1〜FE7-12（classifier unit tests）と FE7-C1〜C4（component tests）の計16テストで十分か
- [ ] **12-1-b**: Mode Chip → classifyIntent → executeIntent → handleExecutionResult の統合テスト（フロントエンド内 E2E）は必要か
- [ ] **12-1-c**: 全 410 既存テストの回帰を CI で自動実行できる環境は整っているか

### 12-2. 手動検証チェックリスト（DevTools / React DevTools）

- [ ] **12-2-a**: DevTools Network タブで、Mode Chip 選択 → 送信 → 結果表示の間に発生する API リクエストの数と内容を記録
- [ ] **12-2-b**: React DevTools Profiler で、送信時の re-render 回数と各コンポーネントの render 時間を計測
- [ ] **12-2-c**: React DevTools Components タブで、ChatPane が送信時に unmount → remount されるか否かを確認
- [ ] **12-2-d**: DevTools Console タブで、送信時の `[Intent]` / `[API]` ログの出力順序と内容を確認
- [ ] **12-2-e**: DevTools Performance タブで、Long Task（50ms超）が送信フローに含まれるか計測
- [ ] **12-2-f**: Lighthouse の Performance / PWA スコアを FE-7 実装前後で比較

---

## 13. 確認推奨順序

以下の順序で確認を進めることを推奨する：

| Step | セクション | 理由 |
|------|-----------|------|
| 1 | **§1-3** ChatPane mount/unmount | スピナー問題の根本原因特定 |
| 2 | **§1-2** 送信時の再取得パターン | UI ブロッキングの原因特定 |
| 3 | **§2-1** Optimistic UI 即時表示 | ユーザー体感の最重要改善ポイント |
| 4 | **§3-2** Mode Chip pending 競合 | FE-7 固有の事故リスク |
| 5 | **§3-3** Classifier Chain 影響 | FE-7 ロジック安全性 |
| 6 | **§6** 招待リンク / トークン管理 | セキュリティリスク |
| 7 | **§4** Slack/Chatwork 通知 | 運用準備 |
| 8 | **§7** DOM 肥大化 / 再レンダー | PWA 前提のパフォーマンス |
| 9 | **§8** PWA / Service Worker | 将来設計の方向確認 |
| 10 | **§12-2** DevTools 手動検証 | 実装後の検証手順確認 |

---

## 14. 次のステップ

このチェックリストの全項目を確認した後：

1. 確認結果を元に **FE-7 実装の Go/No-Go 判定** を行う
2. Go の場合、**PR-FE7-a**（Classifier override + Unit tests）から着手
3. 確認で判明した課題は **FE-7 PRD の Appendix** に追記する
4. DevTools チェック（§12-2）は FE-7 実装中・実装後に並行実施する

---

*このチェックリストは FE-7 実装前の確認作業のための文書です。確認結果・結論は別ドキュメントに記載してください。*
