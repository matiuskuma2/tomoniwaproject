# AI_INSTRUCTION_PHASE_NEXT1.md
## Phase Next-1（チャットUIの器）実装用：AI指示テンプレ（コピペ用）

最終更新日: 2025-12-29  
用途: Phase Next-1 実装時に AI へコピペで渡す指示テンプレ

---

## 📋 AI指示テンプレ（コピペ用・1枚）

```
あなたは ToMoniWao（tomoniwaproject）の開発補助AIです。
Phase Next-1（チャットUIの器 / Shell）のみを実装してください。

========================
【必読（Source of Truth）】
- docs/PHASE_NEXT1_CHAT_UI_SPEC.md（最新）
- docs/UX_CHAT_SPEC.md
- docs/UI_CARD_CATALOG.md
- docs/NOTIFICATION_CHANNEL_RULES.md
- docs/SCHEDULING_RULES.md
- docs/API_CONTRACT_CRITICAL.md
- docs/PHASE0B_VS_DOCS_GAP_REPORT.md

========================
【不変条件（Breaking禁止）】
1) DBスキーマ変更禁止（追加/変更/削除すべて禁止）
2) API変更禁止（URL/レスポンスキー/挙動の変更、追加API作成も禁止）
3) 既存migrationの変更禁止（追加migrationもNext-1では不要）
4) 既存ルート削除禁止：
   - /dashboard
   - /threads/new
   - /threads/:threadId
   - /i/:token
   - /contacts
   - /lists
5) 既存E2E（招待→選択→票数/誰が選んだ→finalize→Meet生成/表示）を壊す変更は禁止
6) Next-1は「表示の器のみ」。発話→intent→実行は Next-2 なので実装禁止。
7) 入力欄は置いてOKだが、送信/音声ボタンは未実装トースト表示のみ（APIは叩かない）。

========================
【実装範囲（Next-1でやること）】
A) ルーティング追加（これだけ）
- /chat
- /chat/:threadId
※ 既存ルートはそのまま残す（E2E保護）

B) 3ペインUI（Shell）
- Left: ThreadsList（GET /api/threads）
- Center: ChatPane（AIなし・テンプレ文章生成のみ / GET /api/threads/:id/status）
- Right: CardsPane（固定カード4種 / GET /api/threads/:id/status）
  1) ThreadStatusCard（常時）
  2) InvitesCard（invitesがあれば）
  3) SlotsCard（slotsがあれば、票数表示）
  4) MeetCard（confirmed && evaluation.meeting があれば）
- Header: NotificationBell（GET /api/inbox）＋ログアウト（既存があれば）

C) Mobile最小
- Threads/Chat/Cards のタブ切り替え（最低限でOK）

========================
【禁止事項（よくある事故）】
- /chat UI内で POST /api/threads を実装する（Next-1ではしない）
- finalize（確定）ボタンを /chat に移植する（既存 /threads/:id を核として残す）
- 「スレッド多すぎ問題」を今解決しようとする（Next-2/3で束ねる）
- "ついで修正"でAPI/DBに手を入れる

========================
【作業手順（必須）】
作業開始前に、以下を順番に必ず出力してから実装に入ってください。

1) 実装するファイル一覧（追加/変更）
2) 新規ルートと既存ルートへの影響（0であること）
3) 既存E2Eを壊さない理由（具体的に）
4) 受け入れ条件（DoD）チェックリスト（後述）をそのまま再掲

========================
【DoD（必須チェック）】
Next-1完了は以下がすべて満たされること。

(既存E2E維持)
- /threads/new で作成できる
- /i/:token で外部が選択できる
- /threads/:id で票数が見える
- /threads/:id で「誰がどの候補を選んだか」が見える
- /threads/:id で finalize→Meet生成→Meet表示ができる

(Shell)
- /chat が開ける
- 左でスレッドを選ぶと中央/右が更新される
- 右に status/invites/slots/meet が表示される（meetはconfirmedのみ）
- ベル(inbox)が開いて通知一覧が見える
- 入力欄の送信は「未実装」トーストで終了（APIを叩かない）

========================
【実装後に提出するもの（この順番）】
1) 変更差分の要約（何を追加/変更したか）
2) /chat で動作確認した手順（クリック手順）
3) 既存E2Eの回帰確認結果（DoDの各項目を✅で列挙）
4) 既存ルートに影響がないことの説明（1段落）

========================
【補足：重要な前提】
- 今はOAuth審査中だが、Next-1は審査とは独立して進めてよい。
- Next-1は "器だけ" で、Next-2から「発話→intent→API実行」を実装する。
- DB/APIの意味を変える提案は禁止。必要なら "提案のみ" に留めること。

以上の条件を守って、Phase Next-1の実装を開始してください。
```

---

## 📝 作業タスク文の例（コピペ用）

Phase Next-1 の実装を依頼する際は、上記テンプレートと一緒に以下のタスク文を使用してください：

```
Phase Next-1として /chat と /chat/:threadId のShell（Left/Center/Right + Bell）を追加し、既存E2Eは一切変更せず維持してください。
```

---

## 🎯 使い方（ワークフロー）

### Step 1: AI に指示テンプレを渡す
上記の「AI指示テンプレ（コピペ用・1枚）」をコピーして、AI に貼り付ける。

### Step 2: タスク文を追加
「作業タスク文の例」を続けて貼り付ける。

### Step 3: AI が作業開始前に出力すべき内容を確認
AI は実装前に以下を出力する：
1. 実装するファイル一覧（追加/変更）
2. 新規ルートと既存ルートへの影響（0であること）
3. 既存E2Eを壊さない理由（具体的に）
4. 受け入れ条件（DoD）チェックリスト

### Step 4: 実装開始
AI が上記を出力した後、実装を開始する。

### Step 5: 実装後に提出されるもの
AI は実装後に以下を提出する：
1. 変更差分の要約（何を追加/変更したか）
2. /chat で動作確認した手順（クリック手順）
3. 既存E2Eの回帰確認結果（DoDの各項目を✅で列挙）
4. 既存ルートに影響がないことの説明（1段落）

---

## ⚠️ 重要な注意事項

### このテンプレートで防止できる事故
1. **DB/API変更の事故**: 不変条件に明記
2. **既存E2E破壊の事故**: DoD に明記
3. **スコープクリープの事故**: 禁止事項に明記
4. **ついで修正の事故**: 補足に明記

### テンプレートの更新タイミング
- Phase Next-1 の仕様変更時
- 新しい禁止事項が見つかった時
- DoD に新しい項目が追加された時

---

以上。
