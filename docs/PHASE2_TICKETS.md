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

## 更新履歴

- 2025-01-11: Phase2 Sprint 2-A 完了（A-D実装完了、E設計完了）
