# Phase2 実装スプリント計画

最終更新: 2026-01-12

---

## 概要

Phase2（追加候補）を「実装順・依存関係・運用事故ゼロ」前提で確実に通すためのスプリント計画。

**原則**:
- 「動きそう」より「正しい」優先
- 運用インシデント・技術負債を残さない
- 既存回答は絶対に消さない

---

## スプリント進捗サマリ

| Sprint | 内容 | ステータス | 完了日 |
|--------|------|------------|--------|
| 2-0 | 準備と防波堤 | ✅ 完了 | 2026-01-10 |
| 2-A | DB + API骨格 + E2E | ✅ 完了 | 2026-01-12 |
| 2-B | UI世代表示 + 文面統一 | 📋 チケット化済み | - |
| 2-C | Runbook + CI安定化 | 📋 チケット化済み | - |

---

## Sprint 2-0（半日）：準備と防波堤

**目的**: Phase2で「既存回答が消える」「再通知が暴発する」事故を構造で防ぐ

### DoD-0-1: 仕様の「禁止事項」を自動テストにする

- [ ] collecting以外は追加候補不可
- [ ] 追加候補は2回まで
- [ ] finalize後は不可
- [ ] "既存回答が消えない" をSQLで検証できる（スナップショット比較）

### DoD-0-2: 監査ログ・通知ログの粒度を確定

- [ ] 追加候補の操作は「1回=1ログ」で良い（肥大化防止）

---

## Sprint 2-A（1日）：DB（A）＋API骨格（Bのprepare/confirm）

**目的**: proposal_version を導入し「回答を壊さずに候補を増やす」基礎を作る

### A（DB migration）

```sql
-- scheduling_threads
ALTER TABLE scheduling_threads
ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduling_threads
ADD COLUMN additional_propose_count INTEGER NOT NULL DEFAULT 0;

-- scheduling_slots
ALTER TABLE scheduling_slots
ADD COLUMN proposal_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduling_slots
ADD COLUMN location_id TEXT NULL;

-- thread_selections
ALTER TABLE thread_selections
ADD COLUMN proposal_version_at_response INTEGER NOT NULL DEFAULT 1;
```

### B-prepare: POST /threads/:id/proposals/prepare

- ガード：collectingのみ、2回まで
- pending_action作成（confirm_token返す）
- 次の version を確定して返す（proposal_version_next）

### B-confirm: POST /pending-actions/:token/confirm

- 3語固定（送る/キャンセル/別スレッドで）
- 「別スレッドで」は titleだけ引継ぎ（候補は新規生成）

---

## Sprint 2-B（1日）：execute（B）＋通知（C）

**目的**: 追加候補が DB に確実に追加され、全員に正しく再通知される

### B-execute: POST /pending-actions/:token/execute

実行順序（重要）:
1. scheduling_slots に INSERT のみ（既存は触らない）
2. scheduling_threads.proposal_version を +1
3. scheduling_threads.additional_propose_count +1
4. thread_selections は更新しない（既存回答保持）

### C（通知）

- 追加候補通知：全員（declined除外）
- inbox_items + email の両方
- 文面に必須の事故防止文言：
  - 「既存回答は保持されます」
  - 「追加候補について再回答をお願いします」
  - 「追加候補は残りX回」

---

## Sprint 2-C（1日）：UI（D）＋E2E（E）

**目的**: カードが正しく更新され、既存回答が消えないことを自動で保証

### D（UI）

- status再取得→候補一覧に v1/v2/v3 が混在しても表示
- 未回答者（再回答必要者）の表示（proposal_version差分で判定）

### E（E2E）

8本をCIに入れる：
1. 未回答のみ → 追加候補 → 再通知
2. 一部回答済み → 追加候補 → 回答保持 + 全員再通知
3. 全員回答済み → 追加候補 → 再通知
4. 辞退者がいる → 辞退者に通知されない
5. 2回目はOK、3回目は拒否
6. finalize後は拒否
7. 既存 selection が 1件も消えない
8. proposal_version が正しくインクリメント

---

## 設計詳細

### 1) 状態機械（追加候補の発動条件）

collectingのみで追加候補可能。

- thread.status（既存）: draft / sent(or collecting扱い) / confirmed / cancelled
- Phase2では、status APIが返す論理状態として `collecting` のときだけ `additional_propose_allowed=true`

※「確定後やり直し無し」は APIガードで強制（409）

### 2) proposal_version（"既存回答を消さない"ための背骨）

| テーブル | カラム | 意味 |
|----------|--------|------|
| scheduling_threads | proposal_version | 現在の世代 |
| scheduling_slots | proposal_version | どの世代で生まれた候補か |
| thread_selections | proposal_version_at_response | その回答は何世代目に対して行われたか |

**再通知対象の判定（事故が起きない定義）**:
- declinedを除外
- proposal_version_at_response < current_proposal_version は「再回答が必要」

### 3) API設計（Pending Action を必ず通す）

Beta Aの「確認必須（3語固定）」をそのまま延長。

```
1. POST /threads/:id/proposals/prepare
   → summary + confirm_token

2. ユーザーがチャットで 3語入力（送る/キャンセル/別スレッドで）

3. POST /pending-actions/:token/confirm

4. POST /pending-actions/:token/execute
```

**executeの処理順序（重要）**:
1. slots insert
2. thread version increment
3. notify log
4. email queue
5. inbox items

**冪等性**: request_id + pending_action.status で担保

### 4) 通知設計

- 追加候補：全員（declined除外）
- 確定通知：全員
- Inboxは「通知一覧」でOK（未読バッジは後）

### 5) UI/UX

- 今：ユーザーの意図判定はルール
- 将来：LLMが会話で確認（ただしDB/状態機械は変えない）

### 6) 将来の「清掃配置（時間×場所×人）」への接続

Phase2で入れる `location_id` と `proposal_version` が効く。

| 概念 | 今 | 将来 |
|------|-----|------|
| slot | time | time + location_id |
| selection | 可/不可 | この場所・この時間に行ける/行けない |
| finalize | 日程確定 | 誰がどこにいつ行くか確定 |

---

## ⚠️ 懸念点（事前に潰すべきもの）

### 1. thread.status の定義が曖昧

- 既存が "sent / confirmed" に寄っている場合、collectingの判定が曖昧になりがち
- **対策**: status APIが返す論理状態（collecting/ready_to_finalize）を正にして、追加候補の許可はそれで判断する

### 2. "全員再通知" の意味が運用でブレる

- **対策**: 全員=declined除外で確定し、コードと仕様に固定、E2Eで守る

### 3. 追加候補で候補が重複する可能性

- 同じ時間帯を再度追加する事故
- **対策**: (thread_id, start_at, end_at) のユニーク制約 or INSERT前の存在チェック
- // TODO: 要確認（どちらを採用するか、既存データとの整合で決める）

### 4. E2Eで「既存回答が消えない」検証が弱いと事故が再発

- **対策**: execute前後で thread_selections の件数と内容が一致することを検証

---

## Phase2のスコープ（明確な線引き）

### やる

- collecting中のみ追加候補（最大2回）
- 全員再通知（declined除外）
- 既存回答保持（絶対条件）
- UIに反映

### やらない（Phase3以降）

- AIによる意図判定（会話での確認）
- work/family の承認モデル
- 清掃の本格最適化（n対n配置エンジン）

---

## Sprint 2-B/2-C 詳細（チケット化済み）

### Sprint 2-B: UI世代表示 + 文面統一（3日）

**目的**: 追加候補後のUI表示を改善し、運用上の混乱を防ぐ

#### P2-B1: UIで世代混在表示（2日）

| 項目 | 内容 |
|------|------|
| 担当 | フロントエンド |
| 依存 | Sprint 2-A 完了 |

**DoD**:
- [ ] 候補カードに `v1` `v2` `v3` バッジを表示
- [ ] 回答一覧に「この回答は v1 時点」などの表記
- [ ] `proposal_info.invitees_needing_response_count` をカードに反映

**実装ポイント**:
```tsx
// SlotCard.tsx - 候補のバージョン表示
<span className="badge">v{slot.proposal_version}</span>

// SelectionList.tsx - 回答の世代表示  
<span className="text-xs">（v{selection.proposal_version_at_response} 時点）</span>

// ThreadStatusCard.tsx - 再回答必要カウント
{proposalInfo.invitees_needing_response_count > 0 && (
  <span>再回答必要: {count}名</span>
)}
```

#### P2-B2: 再通知文面の統一（0.5日）

| 項目 | 内容 |
|------|------|
| 担当 | バックエンド |
| 依存 | なし |

**必須3要素**:
1. 「既存回答は保持されます」
2. 「追加候補についてのみ回答してください」  
3. 「辞退された方には送信されていません」

### Sprint 2-C: Runbook + CI安定化（0.5日）

**目的**: E2E CIが失敗した際のトラブルシューティングを標準化

#### P2-C1: CI failing時のRunbook

| 項目 | 内容 |
|------|------|
| 担当 | DevOps |
| 依存 | なし |

**DoD**:
- [ ] `tests/e2e/RUNBOOK.md` を作成
- [ ] よくある失敗パターン（4種）と対応策
- [ ] artifact ログの読み方
- [ ] ローカル再現手順

**よくある失敗パターン**:
1. **DB schema mismatch** - migration未適用
2. **wrangler dev 起動失敗** - ポート競合
3. **token 期限切れ** - 15分タイムアウト
4. **unexpected error** - DBデータ不整合

---

## 関連ドキュメント

| ファイル | 内容 |
|----------|------|
| `docs/PHASE2_TICKETS.md` | 実装チケット詳細（Notion/Jira貼付用） |
| `docs/PHASE2_ARCHITECTURE.md` | アーキテクチャ・運用ルール |
| `tests/e2e/README.md` | E2Eテストドキュメント |
| `tests/e2e/RUNBOOK.md` | CI失敗時のRunbook（P2-C1で作成） |
