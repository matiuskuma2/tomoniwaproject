# Phase2 実装チケット

テーマ：追加候補（Additional Proposals）＋ 将来の清掃・配置（時間×場所×人）に耐える設計

---

## 🎯 Phase2 のゴール

- 回答収集中（collecting）のみ 候補を追加できる
- 既存回答は絶対に消えない
- 追加候補は 最大2回
- 全員再通知（辞退者除外）
- 2語固定（追加 / キャンセル）
- 将来の「誰が・どこに・いつ行くか（時間×場所×人）」に自然に拡張できる

---

## 実装ステータス

| チケット | 内容 | ステータス | 備考 |
|----------|------|------------|------|
| A | DB設計（Migration 0067-0070） | ✅ 完了 | 本番適用済み |
| B | API（prepare/confirm/execute） | ✅ 完了 | デプロイ済み |
| C | 通知（Email + Inbox） | ✅ 完了 | テンプレ追加済み |
| D | フロント（カード + チャット） | ✅ 完了 | 2語フロー対応済み |
| E | E2Eテスト | ⏳ 設計済み | CI組込み待ち |

---

## チケットA：DB設計（Proposal Version + Slot拡張）✅ 完了

### A-1. scheduling_threads 拡張（0067_add_proposal_version_to_threads.sql）

```sql
ALTER TABLE scheduling_threads
ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduling_threads
ADD COLUMN additional_propose_count INTEGER NOT NULL DEFAULT 0;
```

**意味**:
- `proposal_version`: 初期候補=1, 追加1回目=2, 追加2回目=3
- `additional_propose_count`: 最大2まで（サーバ側で強制）

### A-2. scheduling_slots 拡張（0068_add_proposal_version_to_slots.sql）

```sql
ALTER TABLE scheduling_slots
ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduling_slots
ADD COLUMN location_id TEXT NULL;

-- 重複防止（同一スレッド・同一日時は1つのみ）
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_slots_thread_time
ON scheduling_slots(thread_id, start_at, end_at);
```

**意味**:
- `proposal_version`: どの提案で追加された候補か
- `location_id`: 将来の清掃・拠点・建物ID（Phase2では NULL OK）

### A-3. thread_selections 拡張（0069_add_proposal_version_to_selections.sql）

```sql
ALTER TABLE thread_selections
ADD COLUMN proposal_version_at_response INTEGER NULL;
```

**意味**:
- 「この人は proposal v1 の時点で回答した」
- 追加候補時に "誰が再回答していないか" を正確に把握可能

### A-4. pending_actions 拡張（0070_add_additional_slots_action_type.sql）

```sql
-- action_type に 'add_slots' を追加（CHECK制約の再作成）
```

### ✅ Aチケット Done条件

- [x] migration 0067-0070 作成・本番適用
- [x] 既存データは全て version=1 で backfill（DEFAULT値）
- [x] 重複防止 UNIQUE INDEX 適用

---

## チケットB：API（追加候補フロー）✅ 完了

### B-1. 追加候補 prepare API（確認必須）

**POST /api/threads/:id/proposals/prepare**

**実装ファイル**: `apps/api/src/routes/threads.ts`

**ガード条件（サーバー側強制）**:
- ✅ status === 'sent'（collecting状態）
- ✅ additional_propose_count < 2
- ✅ finalized / cancelled は 400 エラー

**レスポンス**:
```json
{
  "request_id": "...",
  "confirm_token": "...",
  "expires_at": "...",
  "expires_in_seconds": 900,
  "summary": {
    "slots_count": 3,
    "new_slots": [...],
    "remaining_proposals": 1
  },
  "message_for_chat": "..."
}
```

**message_for_chat（固定文言）**:
```
📅 候補日を追加します。

・既存の回答は保持されます
・追加した候補について、全員に再回答をお願いします
・追加候補はあと {remaining_count} 回まで可能です

「追加」または「キャンセル」を入力してください。
```

### B-2. confirm / execute（既存 PendingAction を拡張）

**実装ファイル**: `apps/api/src/routes/pendingActions.ts`

**confirm（POST /api/pending-actions/:token/confirm）**:
- 追加 → executeへ
- キャンセル → 何もしない

**execute（POST /api/pending-actions/:token/execute）**:
- ✅ scheduling_slots に INSERTのみ（既存削除なし）
- ✅ proposal_version を +1
- ✅ additional_propose_count +1
- ✅ thread_selections は一切更新しない（既存回答保持）
- ✅ 通知作成（declined除外）
- ✅ 冪等性保証（request_id / confirm_token）

### B-3. 再通知対象の確定ロジック

**再通知する人**:
- invite.status !== 'declined'

**再通知しない人**:
- 明示的に declined

### B-4. 外部回答時の proposal_version 記録

**実装ファイル**: `apps/api/src/routes/invite.ts`

**POST /i/:token/respond**:
- ✅ 回答時に `thread.proposal_version` を `thread_selections.proposal_version_at_response` に書き込む
- ✅ selected / declined 両方で記録

### ✅ Bチケット Done条件

- [x] 2語確認必須（追加/キャンセル）
- [x] 既存回答が1件も消えない
- [x] 2回制限がサーバ側で保証される
- [x] 冪等（request_id）
- [x] proposal_version_at_response が外部回答時に記録される

---

## チケットC：通知（メール + Inbox）✅ 完了

### C-1. 追加候補メール（必須文言）

**実装ファイル**: `apps/api/src/queue/emailConsumer.ts`

**件名**:
```
【追加候補】「{thread_title}」に候補日が追加されました
```

**本文（必須要素）**:
- ✅ 既存回答は保持される
- ✅ 追加候補に回答が必要
- ✅ 回答リンク
- ✅ 72時間の期限表記

### C-2. Inbox通知（アプリユーザー）

**実装ファイル**: `apps/api/src/routes/pendingActions.ts`

```
📅 【追加候補】{thread_title}
新しい候補日が追加されました。追加分について回答してください。
```

### ✅ Cチケット Done条件

- [x] メール + Inbox 両方作成
- [x] 辞退者に送られていない
- [x] 本文に事故防止文言が必ず含まれる

---

## チケットD：フロント（カード + チャット）✅ 完了

### D-1. カード表示ルール

**実装ファイル**: `frontend/src/core/chat/apiExecutor.ts`

- ✅ proposal_version が異なる候補を 全て表示
- ✅ 既存回答は保持されたまま
- ✅ 新候補は「未回答」として表示

### D-2. チャット文言

**追加候補無効時 or 回数超過時**:
```
❌ 追加候補の提案は最大2回までです。これ以上は手動で候補を追加してください。
```

**追加候補準備完了時**:
```
📅 候補日を追加します。

・既存の回答は保持されます
・追加した候補について、全員に再回答をお願いします
・追加候補はあと {remaining_count} 回まで可能です

「追加」または「キャンセル」を入力してください。
```

### D-3. 2語決定フロー

**実装ファイル**: 
- `frontend/src/core/chat/intentClassifier.ts`
- `frontend/src/core/chat/apiExecutor.ts`
- `frontend/src/components/chat/ChatPane.tsx`

- ✅ pendingAction.mode === 'add_slots' 対応
- ✅ 「追加」で execute 実行
- ✅ 「キャンセル」で pending_action クリア

### ✅ Dチケット Done条件

- [x] 追加候補後、カードに即反映
- [x] 回答済みの人の選択が消えない
- [x] 2語フロー（追加/キャンセル）が動作

---

## チケットE：E2Eテスト（事故防止）⏳ 設計済み

### 必須テストケース

1. [ ] collecting で prepare → confirm(追加) → execute 成功
2. [ ] collecting で追加候補2回目 成功
3. [ ] 3回目は拒否（400）
4. [ ] status≠collecting で prepare 拒否
5. [ ] 重複 slot 入力 → prepare 400
6. [ ] declined の人が通知対象から除外される
7. [ ] 追加候補後、v1回答者の回答が保持されている
8. [ ] 追加候補後、未回答者/回答済み者の再回答必要フラグが正しく出る

### 検証SQL（例）

```sql
-- slots が v2 で増えている
SELECT slot_id, proposal_version FROM scheduling_slots WHERE thread_id = ?;

-- selections の proposal_version_at_response が入っている
SELECT selection_id, proposal_version_at_response FROM thread_selections WHERE thread_id = ?;

-- invite_deliveries / inbox が対象分作成
SELECT * FROM invite_deliveries WHERE thread_id = ?;
```

### ✅ Eチケット Done条件

- [ ] 8ケースをローカル再現可能
- [ ] 少なくとも1,2,3,4は CI で落とせる

---

## 🔮 将来（清掃・配置）への接続イメージ

| 概念 | 今回 | 将来（清掃） |
|------|------|-------------|
| Slot | 時間 | 時間＋場所 |
| Selection | 可/不可 | 担当可否 |
| Proposal | 候補日 | 配置案 |
| Finalize | 日程確定 | 担当割当確定 |

👉 設計を一切変えず拡張可能

---

## 実装優先度（完了順）

1. **A（DB）** - ✅ 完了（本番適用済み）
2. **B（API）** - ✅ 完了（デプロイ済み）
3. **C（通知）** - ✅ 完了（テンプレ追加済み）
4. **D（UI）** - ✅ 完了（2語フロー対応済み）
5. **E（E2E）** - ⏳ 設計済み（CI組込み待ち）

---

## デプロイ情報

- **Backend**: https://webapp.snsrilarc.workers.dev
- **Frontend**: https://app.tomoniwao.jp
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject

---

---

## 🚀 Phase2 Sprint 2-B/2-C チケット（Notion/Jira 貼り付け用）

以下は追加候補実装の「次フェーズ」チケット。Sprint 2-A完了を前提とする。

---

### ✅ P2-B1: UIで世代混在表示（v1/v2/v3）

**優先度**: 高  
**見積もり**: 2日  
**担当**: フロントエンド  
**ステータス**: ✅ 完了（2026-01-20）

#### 目的
追加候補後に、どの候補が v1/v2/v3 で追加されたか、どの回答が v1 時点かを視覚化し、運用上の混乱を防ぐ。

#### 完了条件（DoD）
- [x] 候補カードに `v1` `v2` `v3` バッジを表示
- [x] 「最新候補のみ表示」トグル追加（デフォルトON）
- [x] `proposal_info.invitees_needing_response_count` をカードに反映（例：「再回答必要: 3名」）
- [x] 再回答必要者の名前一覧を展開表示

#### 実装詳細

**1. SlotsCard - 「最新候補のみ表示」トグル**
```tsx
// frontend/src/components/cards/SlotsCard.tsx
const [showLatestOnly, setShowLatestOnly] = useState(true);
const currentVersion = status.proposal_info?.current_version ?? 1;
const displaySlots = showLatestOnly && hasMultipleVersions
  ? status.slots.filter(s => (s.proposal_version ?? 1) === currentVersion)
  : status.slots;
```

**2. ThreadStatusCard - ProposalInfoSection**
```tsx
// frontend/src/components/cards/ThreadStatusCard.tsx
// 世代バッジ + 再回答必要者の名前一覧を展開表示
<ProposalInfoSection status={status} />
```

**3. E2E ヘルパー関数**
```ts
// frontend/e2e/helpers/test-helpers.ts
assertProposalVersionBadgeVisible(page, expectedVersion?)
toggleLatestSlotsOnly(page, enable)
assertNeedResponseAlertVisible(page, expectedCount?)
expandAndCheckNeedResponseList(page)
```

#### テスト条件
- [x] 世代バッジが表示される
- [x] 「最新候補のみ表示」トグルが機能する
- [x] 再回答必要カウントが正しく表示される
- [x] 再回答必要者の名前一覧が展開表示される

#### 実装ファイル
- `frontend/src/components/cards/SlotsCard.tsx` - トグル追加
- `frontend/src/components/cards/ThreadStatusCard.tsx` - ProposalInfoSection 追加
- `frontend/e2e/helpers/test-helpers.ts` - E2Eヘルパー追加

#### コミット
- `bdade5f` - feat: P2-B1 - 世代混在表示UI強化
- `f52210c` - fix: ESLint unused variable error

---

### 📋 P2-B2: 再通知文面の統一（メール + Inbox） ✅ 完了

**優先度**: 中  
**見積もり**: 0.5日  
**担当**: フロントエンド（チャットメッセージ）+ バックエンド（メール/Inbox）  
**ステータス**: ✅ 完了（フロントエンド部分 - 2026-01-20）

#### 目的
追加候補の再通知文面を統一し、受信者が「何をすべきか」を明確に理解できるようにする。

#### 完了条件（DoD）
**フロントエンド（チャットメッセージ）: ✅ 完了**
- [x] messageFormatter.ts による統一フォーマッター作成
- [x] 統一構造: 見出し → 要点 → 対象者 → 次アクション → 注意書き（世代/期限）
- [x] 世代が絡む文面に v を明記
- [x] need_response.list/confirm/sent, remind.pending.confirm が統一フォーマット使用

**バックエンド（メール + Inbox）: 別途対応**
- [ ] メールテンプレートに必須3要素が含まれる
  - 「既存回答は保持されます」
  - 「追加候補についてのみ回答してください」
  - 「辞退された方には送信されていません」
- [ ] Inbox通知も同様の文言を含む
- [ ] 72時間の期限表記が含まれる

#### 実装コミット
- `fc3afb4` - feat: P2-B2 - 統一メッセージフォーマッター実装開始
- `676e898` - feat: P2-B2 - 未返信リマインドも統一フォーマッターを使用

#### 文面案（メール）

**件名**:
```
【追加候補】「{thread_title}」に新しい候補日が追加されました
```

**本文**:
```
{inviter_name} さんより、「{thread_title}」に新しい候補日が追加されました。

📌 重要なお知らせ
・これまでの回答は保持されています
・追加された候補についてのみ、ご回答をお願いします
・辞退された方にはこのメールは送信されていません

追加された候補: {slot_count}件
{slot_description}

▼ 回答はこちら
{invite_url}

※ このリンクの有効期限は 72時間 です。
```

**文面案（Inbox）**:
```
📅 【追加候補】{thread_title}
新しい候補日が追加されました。追加分についてご回答ください。
（これまでの回答は保持されています）
```

#### 実装ファイル
- `apps/api/src/queue/emailConsumer.ts` - generateAdditionalSlotsEmail()
- `apps/api/src/routes/pendingActions.ts` - Inbox通知作成部分

#### テスト条件
- [ ] 追加候補メールに3要素が必ず含まれる
- [ ] Inbox通知に「回答は保持」の文言がある
- [ ] 72時間期限が表示される

---

### 📋 P2-C1: CI failing時のRunbook

**優先度**: 低  
**見積もり**: 0.5日  
**担当**: DevOps / 共通

#### 目的
E2E CIが失敗した際のトラブルシューティング手順を明文化し、誰でも原因特定・修正ができる状態にする。

#### 完了条件（DoD）
- [ ] `tests/e2e/RUNBOOK.md` を作成
- [ ] よくある失敗パターンと対応策を記載
- [ ] artifact ログの読み方を記載
- [ ] ローカル再現手順を記載

#### Runbook内容

```markdown
# Phase2 E2E Runbook

## 1. よくある失敗パターン

### 1-1. DB schema mismatch
**症状**: `SQLITE_ERROR: table scheduling_threads has no column named proposal_version`

**原因**: migration が適用されていない

**対応**:
```bash
npx wrangler d1 migrations apply webapp-production --local
```

### 1-2. wrangler dev が起動しない
**症状**: `Error: Address already in use`

**対応**:
```bash
lsof -i :8787
pkill -f "wrangler dev"
pkill -f "workerd"
```

### 1-3. token 期限切れ
**症状**: `410 Gone` or `token_expired`

**対応**: テスト実行のタイミングを確認。prepare→confirm→executeの間隔が15分以上空いていないか。

### 1-4. Case 3-5 で unexpected error
**症状**: API は 200 だが検証が失敗

**対応**:
```bash
# ログを確認
tail -100 /tmp/wrangler_phase2_e2e.log

# DBの状態を確認
npx wrangler d1 execute webapp-production --local \
  --command="SELECT * FROM scheduling_threads LIMIT 5;"
```

## 2. artifact ログの読み方

CIが失敗すると以下のログが artifact に保存される:
- `/tmp/wrangler_phase2_e2e.log` - 追加候補E2E
- `/tmp/wrangler_ops_e2e.log` - 運用インシデント防止E2E
- `/tmp/wrangler_need_response_e2e.log` - 再回答判定E2E

**確認ポイント**:
1. `[FAIL]` を検索
2. その前の `[TEST]` でどのケースか特定
3. API レスポンスの HTTP status と body を確認

## 3. ローカル再現手順

```bash
cd /home/user/tomoniwaproject

# 1. 依存インストール
npm ci

# 2. DB初期化（クリーンな状態から）
rm -rf .wrangler/state
npx wrangler d1 migrations apply webapp-production --local

# 3. 開発サーバー起動（別ターミナル）
npm run dev

# 4. E2Eテスト実行
bash tests/e2e/phase2_additional_slots.sh
bash tests/e2e/phase2_ops_incident.sh
bash tests/e2e/phase2_need_response.sh
```

## 4. エスカレーション

上記で解決しない場合:
1. GitHub Issue を作成（ログを添付）
2. #phase2-e2e Slack チャンネルに投稿
```

#### 関連ファイル
- `tests/e2e/README.md`（既存、Runbookへのリンクを追加）
- `tests/e2e/RUNBOOK.md`（新規作成）
- `.github/workflows/phase2-e2e.yml`

---

## ✅ P2-D0: 再回答必要者リストをチャットで表示（実装完了）

**優先度**: 高  
**見積もり**: 0.5日  
**担当**: フロントエンド  
**ステータス**: ✅ 完了（2026-01-12）

### 目的
追加候補後に「誰が再回答が必要か」をチャットで即座に確認できるようにし、運用ペインを解消する。

### 完了条件（DoD）
- [x] `schedule.need_response.list` インテントを追加
- [x] キーワード: 再回答、要回答、回答待ち、誰が回答、誰に聞く、回答必要
- [x] threadId未選択時は clarification 要求
- [x] `proposal_info` が無い環境でも落ちないガード実装
- [x] API側計算済みの `invitees_needing_response` を優先使用

### 使い方
チャットで以下のように入力:
- 「再回答必要」
- 「誰が回答してない？」
- 「回答待ちの人」

### 表示内容
```
📋 **「〇〇会議」の再回答必要者**

📊 候補バージョン: v2 （追加候補あり）
🔢 追加候補: あと 1 回

⚠️ **再回答が必要: 3名**

1. tanaka@example.com (田中) — v1時点の回答
2. suzuki@example.com (鈴木) — 未回答
3. yamada@example.com (山田) — 未回答

💡 ヒント:
- 「リマインド」と入力すると未返信者にリマインドを送れます
- 「追加候補」と入力すると新しい候補日を追加できます
```

### 実装ファイル
- `frontend/src/core/chat/intentClassifier.ts` - インテント追加
- `frontend/src/core/chat/apiExecutor.ts` - ハンドラ追加

### コミット
- `bf59d69` - feat(P2-D0): 再回答必要者リストをチャットで表示

---

## ✅ P2-D1: 再回答必要者だけにリマインド送信（実装完了）

**優先度**: 高  
**見積もり**: 1日  
**担当**: フロントエンド  
**ステータス**: ✅ 完了（2026-01-12）

### 目的
追加候補後に「再回答が必要な人だけ」にリマインドを送れるようにし、不要な再通知を防ぐ。

### 完了条件（DoD）
- [x] `schedule.remind.need_response` インテント追加
- [x] キーワード: 再回答.*リマインド、要回答.*リマインド、回答必要.*リマインド
- [x] confirm 必須（誤送信防止）
- [x] declined は除外
- [x] 未回答 または proposal_version_at_response < current_version を対象
- [x] 既存 /remind API の `target_invitee_keys` を活用（バックエンド変更なし）

### 使い方
チャットで以下のように入力:
- 「再回答必要な人にリマインド」
- 「要回答者にリマインド」

### 確認フロー
```
ユーザー: 「再回答必要な人にリマインド」

システム:
📩 **再回答必要者へのリマインド確認**

📋 スレッド: 〇〇会議
📊 候補バージョン: v2
📬 送信対象: 3名

**対象者:**
1. tanaka@example.com (田中)
2. suzuki@example.com (鈴木)
3. yamada@example.com (山田)

⚠️ この 3名 にリマインドを送りますか？

「はい」で送信
「いいえ」でキャンセル

ユーザー: 「はい」

システム:
✅ リマインドを送信しました！

📬 送信: 3名

**送信先:**
1. tanaka@example.com - ✅送信完了
2. suzuki@example.com - ✅送信完了
3. yamada@example.com - ✅送信完了

⏰ 次回リマインド可能: 1月12日 16:00
```

### 実装ファイル
- `frontend/src/core/chat/intentClassifier.ts` - インテント追加
- `frontend/src/core/chat/apiExecutor.ts` - ハンドラ追加
- `frontend/src/core/api/threads.ts` - remind() メソッド追加

### コミット
- `e8e641f` - feat(P2-D1): 再回答必要者だけにリマインド送信（confirm必須）

---

## ✅ P2-D2: 回答済みの人へのリマインド（実装完了）

**優先度**: 高  
**見積もり**: 1日  
**担当**: フロントエンド  
**ステータス**: ✅ 完了（2026-01-20）

### 目的
追加候補後に「最新候補に回答済みの人」にもリマインド/お礼を送れるようにし、リマインド対象の選択肢を拡充する。

### 完了条件（DoD）
- [x] `schedule.remind.responded` インテント追加
- [x] キーワード: 回答済み.*リマインド、回答者.*リマインド、答えた人.*リマインド
- [x] confirm 必須（誤送信防止）
- [x] declined は除外
- [x] reason === 'responded'（最新候補に回答済み）を対象
- [x] 既存 /remind API の `target_invitee_keys` を活用（バックエンド変更なし）

### 使い方
チャットで以下のように入力:
- 「回答済みの人にリマインド」
- 「回答者にリマインド」

### 確認フロー
```
ユーザー: 「回答済みの人にリマインド」

システム:
📩 **回答済みの方へのリマインド確認**

📋 スレッド: 〇〇会議
📊 候補バージョン: v2
📬 送信対象: 2名

**対象者:**
1. yamamoto@example.com (山本) — v2時点の回答
2. tanaka@example.com (田中) — v2時点の回答

⚠️ この 2名 にリマインドを送りますか？
（最新候補に回答済みの招待者に送信されます）

「はい」で送信
「いいえ」でキャンセル

ユーザー: 「はい」

システム:
📩 **回答済みの方へのリマインド送信完了**

📋 スレッド: xxx-xxx-xxx
📬 送信対象: 2名

✅ 2名 にリマインドを送信しました。
```

### 送信対象オプションまとめ
| オプション | キーワード | 対象 | 備考 |
|------------|-----------|------|------|
| 未返信リマインド | 「リマインド」 | 一度も回答していない人 | Phase Next-6 |
| 再回答リマインド | 「再回答.*リマインド」 | 旧世代回答の人 + 未回答 | P2-D1 |
| 回答済みリマインド | 「回答済み.*リマインド」 | 最新候補に回答済みの人 | P2-D2 |

### 実装ファイル
- `frontend/src/core/chat/classifier/types.ts` - インテント型追加
- `frontend/src/core/chat/classifier/remind.ts` - キーワード分類
- `frontend/src/core/chat/classifier/confirmCancel.ts` - confirm/cancel
- `frontend/src/core/chat/pendingTypes.ts` - remind.responded kind
- `frontend/src/core/chat/executors/remind.ts` - executor
- `frontend/src/core/chat/executors/types.ts` - ResultData型
- `frontend/src/core/chat/apiExecutor.ts` - case分岐
- `frontend/src/core/chat/messageFormatter.ts` - フォーマッター

### コミット
- `0b1be5b` - feat: P2-D2 - 回答済みの人へのリマインド機能

---

## ⏭️ 次ターム候補チケット（優先度順）

| ID | 内容 | 見積もり | 備考 |
|----|------|----------|------|
| P2-D3 | 確定後のやり直し（別スレッド化） | 3日 | 履歴混乱リスク高 |
| P2-E1 | Slack/Chatwork送達 | 5日 | 送達チャネル拡張 |
| P3-A1 | 清掃の「時間×場所×人」最適化 | 10日+ | n対n配置エンジン |
| P3-TZ1 | ユーザータイムゾーン保存 | 1日 | グローバル対応基盤 |
| P3-TZ2 | 表示側のタイムゾーン対応 | 2日 | フロント/メール両対応 |
| P3-TZ3 | スレッド単位のTZ表示 | 3日 | 複数TZ混在対応 |

---

## 🌍 Phase3: タイムゾーン対応（グローバル展開準備）

### 背景
- 日本から展開するが、将来は海外ユーザーも想定
- 現状: サーバー側で `Asia/Tokyo` 固定
- 理想: ユーザーのいる場所で日時を表示

### 設計方針
- **DB**: UTC の ISO 文字列で保存（現状維持 ✅）
- **表示**: ユーザーのタイムゾーン設定に基づいて動的変換

---

### P3-TZ1: ユーザータイムゾーン保存

**優先度**: 中  
**見積もり**: 1日  
**担当**: バックエンド + フロントエンド

#### 完了条件（DoD）
- [ ] `users` テーブルに `timezone` カラム追加（デフォルト: `Asia/Tokyo`）
- [ ] 設定画面でタイムゾーン選択UI
- [ ] プロフィールAPI でタイムゾーンを返却

#### DB Migration
```sql
ALTER TABLE users
ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo';

-- 主要タイムゾーン例:
-- Asia/Tokyo (JST, UTC+9)
-- Asia/Dubai (GST, UTC+4)
-- America/New_York (EST, UTC-5)
-- Europe/London (GMT, UTC+0)
-- Asia/Singapore (SGT, UTC+8)
```

#### 設定画面UI
```
タイムゾーン設定:
[▼ Asia/Tokyo (日本標準時 UTC+9)]

よく使われるタイムゾーン:
- Asia/Tokyo (日本)
- Asia/Dubai (UAE)
- Asia/Singapore (シンガポール)
- America/New_York (米国東部)
- Europe/London (イギリス)
```

---

### P3-TZ2: 表示側のタイムゾーン対応

**優先度**: 中  
**見積もり**: 2日  
**担当**: フロントエンド + バックエンド

#### 完了条件（DoD）
- [ ] 共通ユーティリティ関数 `formatDateTimeForUser()` を作成
- [ ] フロントエンド: ユーザー設定のタイムゾーンで表示
- [ ] メール生成: 受信者のタイムゾーンで日時表示
- [ ] カード/チャット: 統一フォーマット適用

#### 実装: 共通ユーティリティ
```typescript
// packages/shared/src/utils/timezone.ts

/**
 * ユーザーのタイムゾーンに基づいて日時をフォーマット
 */
export function formatDateTimeForUser(
  isoString: string,
  timezone: string = 'Asia/Tokyo',
  options?: {
    includeWeekday?: boolean;
    includeYear?: boolean;
  }
): string {
  const date = new Date(isoString);
  
  return date.toLocaleString('ja-JP', {
    timeZone: timezone,
    year: options?.includeYear ? 'numeric' : undefined,
    month: 'numeric',
    day: 'numeric',
    weekday: options?.includeWeekday ? 'short' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * タイムゾーン略称を取得（表示用）
 */
export function getTimezoneAbbr(timezone: string): string {
  const abbrs: Record<string, string> = {
    'Asia/Tokyo': 'JST',
    'Asia/Dubai': 'GST',
    'America/New_York': 'EST',
    'Europe/London': 'GMT',
    'Asia/Singapore': 'SGT',
  };
  return abbrs[timezone] || timezone;
}
```

#### メール生成の修正
```typescript
// 受信者のタイムゾーンを取得して表示
const recipientTz = recipient.timezone || 'Asia/Tokyo';
const slotLabel = formatDateTimeForUser(slot.start_at, recipientTz);
```

---

### P3-TZ3: スレッド単位のタイムゾーン表示

**優先度**: 低  
**見積もり**: 3日  
**担当**: フロントエンド

#### 完了条件（DoD）
- [ ] 主催者と招待者が異なるTZの場合の表示ロジック
- [ ] 「あなたの時間では XX:XX」表記
- [ ] 回答画面でのTZ注釈表示

#### UI例
```
📅 候補日: 1/15 (水) 10:00-11:00 JST
   └ あなたの時間: 1/15 (水) 06:00-07:00 GST (ドバイ時間)
```

#### 回答画面
```
〇〇会議 日程調整

【候補日】
□ 1/15 (水) 10:00-11:00 JST
   └ ドバイ時間: 06:00-07:00

□ 1/16 (木) 14:00-15:00 JST
   └ ドバイ時間: 10:00-11:00

⚠️ 表示時間は Asia/Dubai (UTC+4) に変換されています
```

---

### 実装順序
1. **P3-TZ1**: まずユーザーにTZを保存させる（基盤）
2. **P3-TZ2**: 保存したTZで表示を切り替える（実用化）
3. **P3-TZ3**: 複数TZ混在時の表示を改善（UX向上）

### 注意事項
- DBの `start_at` / `end_at` は **必ずUTCのISO文字列** を維持
- 表示のみユーザーTZで変換する
- 「JSTのつもりで作ったISO」をDBに入れると二重補正で事故る

---

## 更新履歴

- 2026-01-20: P2-B1 実装完了（世代混在表示UI強化: トグル追加、再回答必要者名前一覧）
- 2026-01-13: P3-TZ1/TZ2/TZ3 チケット追加（タイムゾーン対応・グローバル展開準備）
- 2026-01-13: HOTFIX: メール通知の日付表示UTCズレ修正（timeZone: 'Asia/Tokyo' 追加）
- 2026-01-12: P2-D1 実装完了（再回答必要者だけにリマインド送信）
- 2026-01-12: P2-D0 実装完了（再回答必要者リストをチャットで表示）
- 2026-01-12: Phase2 Sprint 2-B/2-C チケット追加（P2-B1/B2/C1）
- 2025-01-11: Phase2 Sprint 2-A 完了（A-D実装完了、E設計完了）
