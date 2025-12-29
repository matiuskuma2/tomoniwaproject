# PHASE_NEXT1_CHAT_UI_SPEC.md
## ToMoniWao – Phase Next-1（チャットUIの器）実装仕様（誤解ゼロ版）

最終更新日: 2025-12-29  
ステータス: 確定（実装可能粒度 / Next-1の "正"）

---

## 0. この仕様の目的（Next-1の本質）

Phase Next-1 の目的は **「チャットUIの器（Shell）だけを作る」**こと。  
現行の Phase 0B MVP（外部リンク型日程調整E2E・票数表示・招待者選択表示・確定→Meet生成→表示）を **絶対に壊さず**、Next-2/3 に進むためのUI土台を整える。

- ✅ やる：左スレッド一覧／中央チャット風表示（テンプレ）／右カード（status/invites/slots/meet）／ベル（inbox見える化）
- ❌ やらない：AI実装、intent解析、自動調整ループ、AND/CORE/MAX自動判定、音声実装、DB/API/migration変更

---

## 1. 不変条件（Breaking禁止 / Next-1のガードレール）

### 1.1 既存E2Eフローを壊さない（最優先）
既存の以下フローが **今と同じ手順で**動くこと：

- 主催者：/threads/new で作成
- 外部：/i/:token で候補選択
- 主催者：/threads/:id で「票数」「誰がどの候補を選んだか」を確認
- 主催者：確定（finalize）
- 主催者：Meet URL と calendar_event_id を確認（UI表示）

### 1.2 DB / API / Migration は変更しない
- DBスキーマ変更禁止
- APIエンドポイント追加・変更禁止（Next-1は "UIだけ"）
- 過去migration変更禁止

### 1.3 チャットUIは「表示の器」に限定
- Next-1では「入力→実行」はしない（送信は未実装トーストでOK）
- チャット表示は **既存データからテンプレ文章を生成して表示**するのみ

---

## 2. 非目的（Next-1で絶対にやらないこと）

- ❌ 音声入力（UIだけ置くのは可、機能は無効）
- ❌ 発話→intent→API実行（Next-2）
- ❌ AND/CORE/MAX の自動判定（Next-2）
- ❌ 調整ラウンド最大2回のコード制御（Next-2：いまは運用でOK）
- ❌ coworker / family の自動調整（Next-3）
- ❌ freebusy/events.list 等のカレンダー読み取り（Next-3）
- ❌ チャット履歴のDB保存（Next-2で thread_messages を使う前提）
- ❌ 既存UI（/dashboard / /threads/*）の置き換え

---

## 3. 画面構成（レイアウト）

### 3.1 Desktop（基本）

```
┌──────────────────────────────────────────────────────────────┐
│ Header：ロゴ / ユーザー / ベル(inbox) / ログアウト           │
├───────────────┬───────────────────────────────┬──────────────┤
│ LeftPane      │ CenterPane                    │ RightPane    │
│ ThreadsList   │ ChatPane（会話ログ風）         │ CardsPane    │
│               │ + Input（未実装）              │（カード群）   │
└───────────────┴───────────────────────────────┴──────────────┘
```

推奨幅：
- Left: 300px固定
- Center: 可変（flex-1）
- Right: 400px固定（折りたたみ可）

### 3.2 Mobile（最小）
- 3ペインはタブ化：Threads / Chat / Cards
- ベルはHeaderに残す

---

## 4. ルーティング（Next-1で追加するのはこれだけ）

### 新規（Next-1）
- `/chat` … チャットUIの器（スレッド未選択）
- `/chat/:threadId` … スレッド選択状態

### 既存（維持・削除禁止）
- `/dashboard` … 既存検証UI
- `/threads/new` … 既存作成UI
- `/threads/:threadId` … 既存詳細UI（票数/選択/確定/Meet表示の核）
- `/contacts` `/lists`

---

## 5. コンポーネント仕様（責務 / 依存API）

### 5.1 ChatLayout（メイン）
責務：
- 3カラムレイアウト、選択中threadの状態管理、右ペイン折りたたみ

依存API：
- GET /api/threads
- GET /api/threads/:id/status
- GET /api/inbox

状態：
- selectedThreadId
- showRightPane

---

### 5.2 ThreadsList（左）
責務：
- threads一覧表示、選択・ハイライト、最小情報の可視化

表示項目（固定）：
- title
- status
- pending_count相当（未返信数：statusレスポンス or invitesから算出、既存に合わせる）
- updated_at

依存API：
- GET /api/threads

注意：
- 「スレッドが増えすぎ問題」は Next-2/3 で "会話スレッドで束ねる" 方針。Next-1では触らない。

---

### 5.3 ChatPane（中央：AIなし）
責務：
- statusレスポンスから **"会話ログ風"テンプレ文**を生成し表示
- 入力欄（テキスト/音声）を置くが、Next-1では送信しても実行しない

依存API：
- GET /api/threads/:id/status

入力欄（Next-1）：
- 送信 → 「Next-2で実装予定」トースト
- 音声 → 「Next-2以降」トースト

テンプレ文章（固定）：
- 初回表示：
  - 「このスレッドは日程調整の案件です。候補日時と回答状況を確認できます。」
- draft/active：
  - 「候補日時を送付済みです。主催者は回答状況を確認し、最適な日程を選んで確定できます。」
  - selectionsがあれば：「回答済みX名 / 未返信Y名」
- confirmed：
  - 「日程が確定しました。Google Meet URL を確認できます。」

---

### 5.4 CardsPane（右：カード群）
責務：
- statusレスポンスを "カード"で可視化（チャット本文ではなく、右ペインにまとめる）

依存API：
- GET /api/threads/:id/status

Next-1で必ず出すカード（固定）：
1) ThreadStatusCard（常時）
- title / status / updated_at / counts（あれば）

2) InvitesCard（invites.length>0）
- invitee（name/email）
- invite status（pending/accepted/declined）
- 選択した候補日時（Phase0Bで実装済みの表示と同等の情報が取れれば表示）

3) SlotsCard（slots.length>0）
- start_at/end_at
- "票数"表示（X名が選択）  ※Phase0Bで実現済みの集計ロジックを踏襲

4) MeetCard（confirmed && evaluation.meeting）
- meet url（コピー/参加）
- calendar_event_id

※ Finalize操作（確定ボタン）は Next-1のShellには移植しない  
（既存 ThreadDetailPage が核であり、壊さないため）

---

### 5.5 NotificationBell（ベル / inbox見える化）
責務：
- inbox の一覧表示（最小）
- クリックで /chat/:threadId に遷移できる（threadId紐付けがある場合）

依存API：
- GET /api/inbox

注意：
- 通知チャネル切替の本格実装は Next-2/3（NOTIFICATION_CHANNEL_RULESに従う）
- Next-1では "見える化"だけ

---

## 6. Next-1で叩くAPI（追加禁止）

- GET /api/threads
- GET /api/threads/:id/status
- GET /api/inbox
- GET /auth/me（TopBar表示用、任意）
- POST /auth/logout（任意）

※ Next-1で POST /api/threads 等を "Shell側"に持ち込まない  
（既存検証UIを壊さないため）

---

## 7. 既存E2Eを壊さない確認（Definition of Done）

### 7.1 既存E2E（必須）
- /threads/new で作成できる
- /i/:token で外部が選択できる
- /threads/:id で票数が見える
- /threads/:id で「誰がどの候補を選んだか」が見える
- /threads/:id で確定→Meet生成→Meet表示ができる

### 7.2 Shell（/chat）最低限
- /chat が開ける
- 左でスレッド選択→中央/右が更新される
- 右に status/invites/slots/meet が表示される（meetはconfirmedのみ）
- ベルで inbox が見える
- 入力は未実装トースト（Next-2で実装予定）

---

## 8. 実装順（事故らない順）

Day1：/chat ルート＋3カラム枠  
Day2：ThreadsList（GET /api/threads）＋選択管理  
Day3：status取得（GET /api/threads/:id/status）＋CardsPane（4カード）  
Day4：ChatPaneテンプレ文＋ベル(inbox)  
Day5：回帰テスト（既存E2E全確認）

---

## 9. Next-2/3への接続（ここは説明だけ）

Next-2：
- チャット入力を有効化（発話→intent→既存API呼び分け）
- AND/CORE/MAX の自動判定（UIで選ばせない）
- 調整ラウンド最大2回を内部制御（DB追加なし）

Next-3：
- coworker/family の権限前提でカレンダー読み取り（freebusy/events.list）
- Room/Grid の可視性
- familyは自動確定運用へ

---

## 10. 重要な注記（誤解防止）

- Next-1のShellは "最終形チャットUIの見た目" を作るが、機能はまだ付けない
- 最終形で「スレッドが増えすぎる」問題は、会話スレッドで束ねる（Next-2/3）
- DB/APIを歪めて解決しない（API_CONTRACT_CRITICALに従う）

---

以上。
