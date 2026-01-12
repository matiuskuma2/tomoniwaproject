# Phase2 アーキテクチャ・運用ルール整理

Phase2（追加候補機能）の実装体系を整理し、**矛盾なく・事故らない**ための設計指針を明文化する。

---

## 1. ドメイン分離（戻れなくなる事故を防ぐコア）

### 1-1. People（人の正）

| テーブル | 役割 |
|----------|------|
| `contacts` | 同一人物の正規化（メール・名前の集約） |
| `lists` | contacts を束ねるグループ（スレッドに固定しない） |

**設計原則**:
- contacts が「人」の唯一の真実
- lists はスレッドに依存しない（再利用可能）

### 1-2. Scheduling（予定調整）

| テーブル | 役割 |
|----------|------|
| `scheduling_threads` | スレッド本体（世代管理: proposal_version） |
| `scheduling_slots` | 候補日時（世代: proposal_version） |
| `thread_invites` | 招待（誰を招待したか） |
| `thread_selections` | 回答（どの世代で回答したか: proposal_version_at_response） |
| `thread_finalize` | 確定情報 |

**設計原則**:
- 既存回答は絶対に削除しない（INSERT only）
- 世代（proposal_version）で履歴を追跡可能

### 1-3. Delivery（通知・送達）

| テーブル | 役割 |
|----------|------|
| `pending_actions` | **確認必須ゲート**（全送信系はここを通る） |
| `invite_deliveries` | 送達追跡（メール/inbox） |
| `inbox` | アプリ内通知一覧 |

**設計原則**:
- pending_actions を通さずに送る系を増やさない
- 送達追跡で「誰に何を送ったか」を明確化

---

## 2. 追加候補（Phase2）の運用ルール

### 2-1. 発動条件

| 条件 | 値 |
|------|-----|
| status | `collecting`（実装上は `sent`） |
| 最大回数 | **2回** |

### 2-2. 対象者

| 対象 | 説明 |
|------|------|
| 全員 | declined を除く全招待者に再通知 |
| declined | **除外**（再通知しない） |

**理由**: 「全員再通知」が最も事故が少ない（運用インシデント防止）

### 2-3. 確定後のやり直し

| ルール | 説明 |
|--------|------|
| 原則 | **なし** |
| 例外 | 別スレッドを作成（履歴混乱を避ける） |

### 2-4. 将来（AI会話化）

| 現状 | 将来 |
|------|------|
| ルールで判定 | 意図判定 → 会話 → 確認 |

**移行可能な理由**: pending_actions が確認ゲートとして機能しており、会話化しても構造が崩れない

---

## 3. 「再回答が必要」の定義

### 3-1. proposal_version

| フィールド | 説明 |
|------------|------|
| `scheduling_threads.proposal_version` | スレッドの世代（初期=1, 追加1回目=2, 追加2回目=3） |
| `scheduling_slots.proposal_version` | そのスロットがどの世代で追加されたか |
| `thread_selections.proposal_version_at_response` | 回答がどの世代に対するものか |

### 3-2. 再回答が必要（need_response）の判定

```
need_response = (NOT declined) AND (未回答 OR 旧世代で回答)
```

| 条件 | need_response |
|------|---------------|
| declined | ❌ 除外 |
| 未回答 | ✅ 必要 |
| v1で回答 + 現在v2 | ✅ 必要 |
| v2で回答 + 現在v2 | ❌ 不要 |

---

## 4. E2Eが保証する不変条件

### 4-1. 追加候補のE2E（8本）

| Case | 不変条件 |
|------|----------|
| 1 | collecting以外で拒否 |
| 2 | 重複候補は拒否 |
| 3 | add_slots成功でversion増加 |
| 4 | 3回目は拒否 |
| 5 | declined除外 |
| 6 | proposal_version_at_response記録 |
| 7 | status APIがproposal_infoを返す |
| 8 | XSS対策（escapeHtml） |

### 4-2. Ops Incident Prevention（8本）

| Case | 不変条件 |
|------|----------|
| 1 | confirm無しexecute禁止 |
| 2 | confirm/execute二重実行で冪等 |
| 3 | confirm二重でdecision変更不可 |
| 4 | 期限切れトークン拒否 |
| 5 | 別ユーザーの越境禁止 |
| 6 | add_slotsで「別スレッドで」拒否 |
| 7 | DB CHECK制約がadd_slots許容 |
| 8 | HTMLエスケープ適用 |

### 4-3. NeedResponse（4本）

| Case | 不変条件 |
|------|----------|
| 1 | add_slots後にneed_response増加 |
| 2 | declinedは除外 |
| 3 | proposal_info構造保証 |
| 4 | slotsにproposal_version含む |

---

## 5. 今タームのスコープ

### 5-1. Done（完了）

- [x] 追加候補: collectingのみ、最大2回
- [x] 全員再通知（declined除外）
- [x] 既存回答は消えない（slots追加のみ）
- [x] proposal_versionで世代管理
- [x] need_response判定がstatusで取得可能
- [x] E2E 20ケースでCIゲート

### 5-2. 今タームではやらない（次ターム）

- [ ] 未回答者だけ再通知 / 回答者だけ再通知（意図判定が必要）
- [ ] 確定後のやり直し
- [ ] Slack/Chatwork送達
- [ ] 清掃の「時間×場所×人」最適化（n対n配置エンジン）

---

## 6. 最重要な運用インシデント防止メモ

### ⚠️ 絶対に守ること

| ルール | 理由 |
|--------|------|
| pending_actions を通す | 確認必須ゲート。通さずに送る系を増やすと事故る |
| declined は再通知しない | 破るとクレーム |
| proposal_version を上げたら status API も返す | UI/運用が「誰が未回答か」判別できなくなる |
| メールHTML は escapeHtml | 1回漏れると即インシデント |

---

## 7. 関連ファイル

| ファイル | 内容 |
|----------|------|
| `docs/PHASE2_TICKETS.md` | 実装チケット |
| `docs/PHASE2_SPRINT_PLAN.md` | スプリント計画 |
| `tests/e2e/README.md` | E2Eテストドキュメント |
| `tests/e2e/phase2_additional_slots.sh` | 追加候補E2E |
| `tests/e2e/phase2_ops_incident.sh` | 運用インシデント防止E2E |
| `tests/e2e/phase2_need_response.sh` | 再回答判定E2E |

---

---

## 8. Sprint 2-B/2-C のUI/運用改善

### 8-1. UI世代表示（P2-B1）

追加候補後に「どの候補がv1/v2/v3で追加されたか」を視覚化する。

| 表示箇所 | 表示内容 |
|----------|----------|
| 候補カード | `v1` `v2` `v3` バッジ |
| 回答一覧 | 「この回答は v1 時点」 |
| サマリーカード | 「再回答必要: 3名」 |

**表示ルール**:
- 既存回答は「✓回答済み」
- 新候補は「未回答」
- 旧世代で回答した人は「再回答必要」

### 8-2. 再通知文面（P2-B2）

追加候補メールに必須の3要素:

```
1. 既存回答は保持されます
2. 追加候補についてのみ回答してください
3. 辞退された方には送信されていません
```

**理由**: この3文がないと「前の回答が消えた？」「また全部回答？」「辞退したのにメール来た？」というクレームが発生する

### 8-3. Runbook（P2-C1）

E2E CI失敗時の標準対応:

| 症状 | 原因 | 対応 |
|------|------|------|
| `no column proposal_version` | migration未適用 | `wrangler d1 migrations apply` |
| `Address already in use` | ポート競合 | `pkill -f wrangler` |
| `410 Gone` | token期限切れ | テスト実行間隔を確認 |
| API 200 だが検証失敗 | DBデータ不整合 | ログとDBを確認 |

---

## 9. 次タームへの引き継ぎ事項

### 9-1. 実装済み（Sprint 2-A）

| 項目 | 状態 | 備考 |
|------|------|------|
| DB Migration | ✅ 本番適用済み | 0067-0071 |
| API (prepare/confirm/execute) | ✅ デプロイ済み | add_slots 対応 |
| 通知 (Email + Inbox) | ✅ テンプレ追加済み | XSSエスケープ適用 |
| E2E (20ケース) | ✅ CI設定済み | 3スクリプト |

### 9-2. チケット化済み（Sprint 2-B/2-C）

| チケット | 内容 | 見積もり |
|----------|------|----------|
| P2-B1 | UI世代表示 | 2日 |
| P2-B2 | 文面統一 | 0.5日 |
| P2-C1 | Runbook | 0.5日 |

### 9-3. 今タームではやらない

| 項目 | 理由 |
|------|------|
| 未回答者だけ再通知 | 意図判定が必要 |
| 回答者だけ再通知 | 意図判定が必要 |
| 確定後やり直し | 履歴混乱リスク高 |
| Slack/Chatwork送達 | 送達チャネル拡張は別フェーズ |
| 清掃の時間×場所×人 | Phase3以降 |

---

## 更新履歴

- 2026-01-12: Sprint 2-B/2-C の詳細と引き継ぎ事項を追加
- 2025-01-12: 初版作成（Phase2 Sprint 2-A 完了時点）
