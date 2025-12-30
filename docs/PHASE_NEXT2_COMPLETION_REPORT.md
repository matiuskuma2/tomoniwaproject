# Phase Next-2 (P0) 完了報告（修正版）

**完了日:** 2025-12-30  
**ステータス:** 正式完了  
**本番URL:** https://app.tomoniwao.jp/chat  
**GitHub:** https://github.com/matiuskuma2/tomoniwaproject  
**最新コミット:** a546ceb

---

## 目的

Phase Next-2 (P0) は /chat 上で「テキスト→Intent→既存API実行」を可能にするフェーズ。

**重要:**
- DB / Workers API / migrations は変更しない
- Next-2 (P0) は **GET + POST** を使用（GETのみではない）
- 既存E2E（/threads/new → /i/:token → finalize → Meet生成）を維持

---

## P0で実装したIntent（3種類）

### P0-1: schedule.external.create
- **機能:** メールアドレスから日程調整を作成
- **入力例:** 「tanaka@example.com に日程調整送って」
- **実装:**
  - メール抽出を最優先（正規表現）
  - タイトル固定: "日程調整（自動生成）"
  - description 固定: ""（空文字列）
  - candidates 自動生成: `emails.map(email => ({ email, name: email.split('@')[0] }))`
  - 招待リンクを全件チャットに列挙
- **API:** POST /api/threads
- **動作確認:** ✅ 成功

### P0-2: schedule.status.check
- **機能:** スレッドの投票状況を確認
- **入力例:** 「状況教えて」
- **実装:**
  - threadId が選択されていれば GET /api/threads/:id/status
  - 投票数、選択者、未返信者を表示
- **API:** GET /api/threads/:id/status
- **動作確認:** ✅ 成功

### P0-3: schedule.finalize
- **機能:** 日程を確定してMeet URLを生成
- **入力例:** 「1番で確定して」
- **実装:**
  - 番号指定で slot_id を特定
  - POST /api/threads/:id/finalize
  - Meet URL をチャットに表示
- **API:** POST /api/threads/:id/finalize
- **動作確認:** ✅ 成功

---

## 重大バグ修正（Phase Next-2中に発見・修正）

### 問題1: スレッド切り替えで会話が消える
- **原因:** `ChatPane` が `useState(messages)` で管理していた
- **修正:** `ChatLayout` に `messagesByThreadId: Record<string, ChatMessage[]>` を追加
- **結果:** スレッドごとに会話履歴が保持される
- **コミット:** a546ceb

### 問題2: confirmedスレッドで初期メッセージが表示されない
- **原因:** スレッド切り替え時に messages を上書きしていた
- **修正:** `seedIfEmpty()` で空の場合のみテンプレート挿入
- **結果:** 確定済みスレッドで正しくテンプレートが表示される
- **コミット:** a546ceb

---

## 実装ファイル

### 新規作成
- `frontend/src/core/chat/intentClassifier.ts` - Intent分類ロジック（ルールベース）
- `frontend/src/core/chat/apiExecutor.ts` - API実行ロジック（P0の3種類）

### 変更ファイル
- `frontend/src/components/chat/ChatPane.tsx` - テキスト入力対応、スレッドごとの会話履歴（props化）
- `frontend/src/components/chat/ChatLayout.tsx` - messagesByThreadId 管理
- `frontend/src/components/cards/InvitesCard.tsx` - 招待リンクのコピーボタン
- `frontend/src/core/api/threads.ts` - API仕様の実態に合わせたフロント型定義の追記（後方互換）
  - `candidates` フィールド追加（既存APIレスポンスに元々含まれていた）

### 変更なし
- DBスキーマ
- APIエンドポイント（Workers側）
- Migration
- 既存ルート（/threads/*, /i/*, /contacts, /lists）
- ThreadDetailPage
- ThreadCreatePage

---

## DoD（Definition of Done）

### P0 必須項目
1. ✅ /chatでテキスト入力→送信が可能
2. ✅ P0-1: 条件成立時に POST /api/threads、作成したthreadと invite_url が表示される
3. ✅ P0-2: status checkで投票状況と誰が何を選んだかが表示される
4. ✅ P0-3: finalizeで Meet URL が表示される
5. ✅ 既存E2Eの影響なし（確認済み）

### 追加達成項目
6. ✅ スレッドごとの会話履歴保持（重大バグ修正）
7. ✅ confirmedスレッドの正常表示（重大バグ修正）
8. ✅ 招待リンクのコピーボタン（InvitesCard）

---

## 実装しなかった項目（Next-3以降）

### P1以降の機能
- schedule.today（今日の予定）
- schedule.week（今週の予定）
- schedule.freebusy（空き時間）
- schedule.reschedule（再調整）
- schedule.cancel（キャンセル）
- schedule.reminder（リマインダー）
- その他4種類のIntent

### Next-3で実装予定
- 音声入力（Web Speech API）
- カレンダー閲覧（FreeBusy / Events.list）
- P1 intents（today/week/freebusy）
- coworker可視性の準備（Room/Grid）

### Next-4以降
- 自動再調整ループ
- 権限設定・Room Grid本格実装
- P2/P3 intents

---

## 既知の制約

1. **テキスト入力のみ:** 音声入力は Next-3 で実装
2. **P0の3Intentのみ:** 他の機能は Next-3 以降
3. **ルールベース分類:** LLM連携なし（意図的）
4. **曖昧性確認:** 
   - 連絡先不明 → メール問い合わせ
   - スレッドID不明 → 選択促す
   - 候補日時不明 → 候補一覧表示

---

## 成果物

- **本番URL:** https://app.tomoniwao.jp/chat
- **GitHub:** https://github.com/matiuskuma2/tomoniwaproject
- **最新コミット:** a546ceb
- **デプロイURL:** https://f8991766.webapp-6t3.pages.dev

---

## Git履歴

```
a546ceb - fix(P0): Per-thread conversation history (no more mixed/lost messages)
1e180e8 - fix(chat): Clear conversation history on thread switch [REVERTED]
08c77b2 - fix(P0): Prioritize email extraction for external.create
54dd5c4 - feat: Implement Phase Next-2 (P0 only)
77b4720 - feat: Add Chat Beta link to Dashboard (Phase Next-1 navigation)
```

---

## Phase Next-3 への引き継ぎ

### 実装済み（Next-2で完了）
- ✅ チャットUI（Next-1）
- ✅ テキスト入力 → Intent → API実行（Next-2 P0）
- ✅ スレッドごとの会話履歴管理

### Next-3 で実装する機能
1. **カレンダー閲覧:** 今日/今週/空き時間（Read-only）
2. **P1 intents:** schedule.today / schedule.week / schedule.freebusy
3. **Workers API:** GET /api/calendar/* 追加
4. **UI:** CalendarCard / FreeBusyCard 追加

### ガードレール（継続）
- ✅ DB/API（Workers側既存）/Migration 変更なし（Next-3も継続）
- ✅ 既存E2Eを壊さない（Next-3も継続）
- ✅ Read-only（閲覧のみ）を徹底

---

## 総評

### Phase Next-2 (P0) の達成
- **目的:** /chat入力を"実際に動く"ようにする（P0の3Intentのみ）
- **結果:** ✅ 完全達成
- **追加成果:** 重大バグ2件を発見・修正
- **品質:** 既存E2Eに影響なし、スレッドごとの会話履歴保持を実現

### カレンダーアプリ化について
Phase Next-3で「予定を見る（カレンダー閲覧）」を実装します。
- 計画に含まれています
- 順番は正しい：調整機能の安定 → カレンダー閲覧の追加
- Next-3: Read-only（今日/今週/空き時間）
- Next-4以降: 権限設定・Room/Grid・音声入力本格化

---

## 次のステップ

**Phase Next-3（カレンダー閲覧 + P1 intents）** の準備が完了しました。

---

**完了報告終わり**
