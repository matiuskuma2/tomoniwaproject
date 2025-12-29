# PHASE_NEXT1_CHAT_UI_SPEC.md
## ToMoniWao – Phase Next-1: チャットUI（器）仕様（誤解ゼロ版）

最終更新日: 2025-12-29  
ステータス: 確定（Phase Next-1 実装の "正" / Source of Truth）

---

## 0. この仕様の目的

Phase Next-1 の目的は **「チャット中心UXの"器（Shell）"を作ること」**であり、  
現行の Phase 0B MVP（日程調整E2E・Google Meet生成・票数表示・招待者の選択表示）を**壊さずに**、次フェーズに進むための UI の土台を整える。

- ✅ 目的：左スレッド一覧／中央チャット／右カード（状態可視化）／ベル通知（inbox可視化）
- ❌ 非目的：AI秘書の自動調整ロジックの実装（Next-2/3でやる）
- ❌ 非目的：DB・API・マイグレーションの変更（Phase Next-1では0）

---

## 1. 不変条件（Breaking禁止 / Phase Next-1のガードレール）

Phase Next-1 では以下を**絶対に守る**。

### 1.1 既存のE2Eフローは壊さない
- 既存の「外部リンク型日程調整（/i/:token）→回答→主催者が票数/選択を確認→確定→Meet生成」フローは、今と同じ手順で動くこと。
- 「票数表示」「招待者がどの候補を選んだか表示」「Meet URL表示」「Calendar event idが返る」など Phase0Bの核は維持。

### 1.2 DB / API / Migration は変更しない
- テーブル追加・カラム追加・過去migrationの変更は禁止。
- APIのURL・レスポンスキーの変更禁止（追加のみ可、ただしNext-1では基本触らない）。

### 1.3 チャットUIは "表示の器" に限定する
- Next-1では「発話→intent→API実行」はしない。
- チャット表示は **既存データからテンプレ文章を生成して表示**するのみ。

---

## 2. Phase Next-1 でやること / やらないこと

### 2.1 やること（必須）
A) 3ペインUI（Shell）
- 左：ThreadsList（既存threads一覧）
- 中央：ChatPane（会話ログ風の表示。AI実装なし）
- 右：CardsPane（UI_CARD_CATALOG に沿うカード表示）

B) Inbox（ベル）表示（最小）
- inbox を一覧表示できる（既存の通知を見れる）
- 「重要度」「関係性別」などの高度な分類は Next-2/3

C) 既存の "検証用UI" は残す
- 既存の Dashboard / ThreadCreate / ThreadDetail / Contacts / Lists は、E2Eが動くことを優先し、完全移行しない。
- Shell からも旧画面へ遷移できる（リンク）※必須ではないが推奨

### 2.2 やらないこと（禁止 / Next-2以降）
- 音声入力の実装（UIだけ置くのは可、機能は無効）
- 発話の意図解析（intent分類）と自動実行（Next-2）
- AND/CORE/MAX の自動判定（Next-2）
- 調整ラウンド（最大2回）をコードで制御（Next-2：運用→実装へ）
- coworker/family のカレンダー参照・自動調整ループ（Next-3）
- freebusy/events.list などのカレンダー読み取り（Next-3）

---

## 3. 画面構成（情報設計 / IA）

### 3.1 Desktop（基本）

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar：ロゴ / 検索 / ベル(inbox) / プロフィール / ログアウト │
├───────────────┬───────────────────────────┬───────────────────┤
│ LeftPane      │ CenterPane                │ RightPane         │
│ ThreadsList   │ ChatPane                  │ CardsPane         │
│               │ （会話ログ風）             │ （カード表示）     │
└───────────────┴───────────────────────────┴───────────────────┘
```

### 3.2 Mobile（最小）
- 3ペインはタブ化（Threads / Chat / Cards）
- ベルはTopBarに残す

---

## 4. ルーティング（Phase Next-1での最小追加）

既存ルートは維持し、Next-1のShellを追加する。

**新規ルート（Phase Next-1で追加）**:
- `/chat`（新規）… チャットUIの器（スレッド未選択状態）
- `/chat/:threadId`（新規）… 特定スレッドを選択した状態

**既存ルート（維持）**:
- `/dashboard`
- `/threads/new`
- `/threads/:threadId`
- `/contacts`
- `/lists`

※ Next-1の段階では `/chat` を「ベータ」扱いにしてもよい  
（/dashboard を既定のままにしておくなど）

---

## 5. コンポーネント仕様（Props / 責務 / 依存API）

### 5.1 TopBar
**責務**
- ベル（inbox）開閉
- ログアウト
- ユーザー表示（/auth/me から取得済みがあれば表示）

**依存API**
- `GET /auth/me`（既存）
- `POST /auth/logout`（既存）

---

### 5.2 ThreadsList（LeftPane）
**責務**
- threads一覧の表示（最新順）
- 選択中threadのハイライト
- 「未返信数」「状態」「最終更新」を表示

**表示項目（固定）**
- title
- status
- pending_count（未返信数に相当する値：現状はinvites/statusから算出 or APIの字段があればそれを表示）
- updated_at

**依存API**
- `GET /api/threads`（既存）

**注意**
- "スレッドが多すぎる"問題はNext-2/3で解決（会話スレッドと調整スレッドを束ねる）。Next-1では触らない。

---

### 5.3 ChatPane（CenterPane）※AIなし
**責務**
- 選択中threadの "会話ログ風" 表示を生成する
- ユーザー入力欄（テキスト/音声アイコン）を置くが、Next-1では送信しても実行しない（「Next-2で実装予定」の表示に留める）

**入力欄（Next-1の扱い）**
- 送信ボタン押下 → "未実装"トースト表示
- 音声ボタン押下 → "未実装"トースト表示

**会話ログ生成ルール（Next-1は固定テンプレ）**
- ThreadStatus（GET /api/threads/:id/status）を取得し、以下の文章を組み立てる

**テンプレ例（固定）**

1) **スレッドを開いた直後**
   - 「このスレッドは日程調整の案件です。候補日時と回答状況を確認できます。」

2) **招待送信済み（draft/active相当）**
   - 「候補日時を送付済みです。回答が集まり次第、主催者が最適な日程を選んで確定できます。」

3) **回答がある場合**
   - 「現在の回答：回答済みX名 / 未返信Y名」

4) **confirmedの場合**
   - 「日程が確定しました。Meet URLを確認できます。」

**依存API**
- `GET /api/threads/:id/status`（既存）

---

### 5.4 CardsPane（RightPane）
**責務**
- UI_CARD_CATALOG.md に沿って、必要カードを表示する
- Next-1では "カード種別は固定" （追加しない）

**Next-1で表示するカード（最小3種）**

1) **ThreadStatusCard**
   - status / pending_count / updated_at
   - 依存：status API

2) **InvitesCard**
   - invites一覧（未返信/承諾/辞退）
   - 依存：status API

3) **MeetCard（confirmed時のみ）**
   - Meet URL / calendar_event_id（表示・コピー）
   - 依存：status API（evaluation.meeting）

※ SlotsCard / FinalizeCard は既存 ThreadDetailPage 側で十分に動いているため、Next-1で無理に移植しない（壊さないため）

---

### 5.5 InboxDrawer（ベル）
**責務**
- inboxの一覧表示（最新順）
- クリックで詳細表示（最小：タイトル＋本文）

**依存API**
- `GET /api/inbox`（既存）

**注意**
- external/coworker/family のチャネル切替ロジックは Next-2/3（このUIは "見える化" だけ）

---

## 6. 既存E2Eを壊さないための確認項目（DoD）

Phase Next-1 実装後、必ず以下を確認する。

### 6.1 既存E2E（日程調整）の完全維持
- `/dashboard` でスレッド一覧が見える
- `/threads/new` で作成できる
- `/i/:token` で外部が選択できる
- `/threads/:id` で票数表示が見える
- `/threads/:id` で「誰がどの候補を選んだか」が見える
- `/finalize` でMeet生成できる
- `/threads/:id` でMeet表示できる

### 6.2 Shell（/chat）の最低限
- /chat が表示できる
- ThreadsListにスレッドが表示される
- スレッド選択でChatPaneとCardsPaneが更新される
- Inbox（ベル）を開ける（通知が見える）
- 送信ボタンは "未実装" 表示でOK（実行しない）

---

## 7. 実装順（最短・事故らない順）

**Day 1**
- `/chat` ルート追加
- 3ペインレイアウト（TopBar/Left/Center/Right）

**Day 2**
- ThreadsList（GET /api/threads）
- 選択状態管理（selectedThreadId）

**Day 3**
- ThreadStatus取得（GET /api/threads/:id/status）
- ChatPaneテンプレ文章生成（AIなし）
- CardsPane（ThreadStatusCard / InvitesCard / MeetCard）

**Day 4**
- InboxDrawer（GET /api/inbox）
- Mobileタブ切替（Threads/Chat/Cards）
- 既存E2Eの回帰テスト（必須）

---

## 8. 完了条件（Definition of Done）

- `/chat` が本番で閲覧可能
- ThreadsList / ChatPane / CardsPane / Inbox が動作
- 既存E2Eが一切壊れていない（6.1が全てOK）
- Next-2に進むための "器" になっている（送信は未実装でもOK）

---

## 9. 次フェーズへの接続（Next-2/3）

Next-1で作ったChatPane入力欄は、Next-2で以下を実装するための入口になる。

**Next-2（発話→intent→API）**
- 発話テキストを intent に分類し、既存APIを呼び分ける
- AND/CORE/MAX の自動判定（UIで選ばせない）
- 調整ラウンド最大2回を「AI内部状態」で制御（DB追加なし）

**Next-3（カレンダー読み取り＋関係性）**
- coworker/family の許諾に基づく freebusy/events.list
- Room/Gridに基づく権限と可視性
- familyは自動確定の運用へ

---

## 10. 重要な注記（誤解防止）

- 現在の Dashboard/ThreadDetail は「検証UI」であり、最終形ではない
- ただし E2Eの核を担っているため、Next-1では置き換えない
- 最終形の「会話スレッド = 調整スレッド」問題は Next-2/3で "束ねる" ことで解決する
  - DB/APIは壊さず、UI側で「会話の継続」を表現する

---

以上。
