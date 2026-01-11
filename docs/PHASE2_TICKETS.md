# Phase2 実装チケット

テーマ：追加候補（Additional Proposals）＋ 将来の清掃・配置（時間×場所×人）に耐える設計

---

## 🎯 Phase2 のゴール

- 回答収集中（collecting）のみ 候補を追加できる
- 既存回答は絶対に消えない
- 追加候補は 最大2回
- 全員再通知（辞退者除外）
- 3語固定（送る / キャンセル / 別スレッドで）
- 将来の「誰が・どこに・いつ行くか（時間×場所×人）」に自然に拡張できる

---

## チケットA：DB設計（Proposal Version + Slot拡張）

### A-1. scheduling_threads 拡張

**目的**: 追加候補・配置変更の「世代管理」を可能にする。

```sql
ALTER TABLE scheduling_threads
ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduling_threads
ADD COLUMN additional_propose_count INTEGER NOT NULL DEFAULT 0;
```

**意味**:
- `proposal_version`: 初期候補=1, 追加1回目=2, 追加2回目=3
- `additional_propose_count`: 最大2まで（サーバ側で強制）

### A-2. scheduling_slots 拡張（時間×場所を見据える）

```sql
ALTER TABLE scheduling_slots
ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduling_slots
ADD COLUMN location_id TEXT NULL;
```

**意味**:
- `proposal_version`: どの提案で追加された候補か
- `location_id`: 将来の清掃・拠点・建物ID（Phase2では NULL OK）

### A-3. thread_selections 拡張（将来事故防止）

```sql
ALTER TABLE thread_selections
ADD COLUMN proposal_version_at_response INTEGER NOT NULL DEFAULT 1;
```

**意味**:
- 「この人は proposal v1 の時点で回答した」
- 追加候補時に "誰が再回答していないか" を正確に把握可能

### ✅ Aチケット Done条件

- [ ] migration 作成
- [ ] 既存データは全て version=1 で backfill
- [ ] rollback 手順明記

---

## チケットB：API（追加候補フロー）

### B-1. 追加候補 prepare API（確認必須）

**POST /api/threads/:id/proposals/prepare**

**ガード条件**:
- status === collecting
- additional_propose_count < 2
- finalized / cancelled は 409

**レスポンス**:
```json
{
  "confirm_token": "...",
  "proposal_version_next": 2,
  "slots_preview": [
    { "start_at": "...", "end_at": "...", "location_id": null }
  ],
  "remaining_count": 1,
  "message_for_chat": "..."
}
```

**message_for_chat（固定文言）**:
```
📅 候補日を追加します。

・既存の回答は保持されます
・追加した候補について、全員に再回答をお願いします
・追加候補はあと {remaining_count} 回まで可能です

次に「送る / キャンセル / 別スレッドで」を入力してください。
```

### B-2. confirm / execute（既存 PendingAction を利用）

**confirm**:
- send → executeへ
- cancel → 何もしない
- new_thread → 別スレッド作成（既存仕様）

**execute（send）**:
- scheduling_slots に INSERTのみ
- proposal_version を +1
- additional_propose_count +1
- thread_selections は一切更新しない
- 通知作成

### B-3. 再通知対象の確定ロジック（超重要）

**再通知する人**:
- invite.status !== declined
- 以下のいずれか:
  - 未回答
  - proposal_version_at_response < current proposal_version

**再通知しない人**:
- 明示的に declined

### ✅ Bチケット Done条件

- [ ] 3語確認必須
- [ ] 既存回答が1件も消えない
- [ ] 2回制限がサーバ側で保証される
- [ ] 冪等（request_id）

---

## チケットC：通知（メール + Inbox）

### C-1. 追加候補メール（必須文言）

**件名**:
```
【候補追加】日程調整の候補が追加されました
```

**本文（必須要素）**:
- 既存回答は保持される
- 追加候補に再回答が必要
- 回答リンク

### C-2. Inbox通知（アプリユーザー）

```
📅 候補追加：新しい日程候補が追加されました
```

### ✅ Cチケット Done条件

- [ ] メール + Inbox 両方作成
- [ ] 辞退者に送られていない
- [ ] 本文に事故防止文言が必ず含まれる

---

## チケットD：フロント（カード + チャット）

### D-1. カード表示ルール

- proposal_version が異なる候補を 全て表示
- 既存回答は保持されたまま
- 新候補は「未回答」として表示

### D-2. チャット文言（準備中事故防止）

追加候補無効時 or 回数超過時：
```
❌ これ以上候補は追加できません。
新しい調整を行う場合は「別スレッドで」と入力してください。
```

### ✅ Dチケット Done条件

- [ ] 追加候補後、カードに即反映
- [ ] 回答済みの人の選択が消えない

---

## チケットE：E2Eテスト（事故防止）

### 必須テストケース

1. [ ] 未回答のみ → 追加候補 → 再通知
2. [ ] 一部回答済み → 追加候補 → 回答保持 + 全員再通知
3. [ ] 全員回答済み → 追加候補 → 再通知
4. [ ] 辞退者がいる → 辞退者に通知されない
5. [ ] 2回目はOK、3回目は拒否
6. [ ] finalize後は拒否
7. [ ] 既存 selection が 1件も消えない
8. [ ] proposal_version が正しくインクリメント

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

## 実装優先度

1. **A（DB）** - 基盤
2. **B（API）** - ロジック
3. **C（通知）** - ユーザー体験
4. **D（UI）** - 表示
5. **E（E2E）** - 品質保証
