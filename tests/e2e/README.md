# Phase2 E2E Tests (Additional Slots)

## 目的
追加候補（additional slots）が「運用事故・設計矛盾」を起こさないことを CI で保証する。

## 不変条件（CIで必ず落とす）
1) collecting（status='sent'）のみ追加候補可  
2) 最大2回まで  
3) 既存の回答（thread_selections）は絶対に消えない  
4) 重複候補は追加しない  
5) declined は再通知しない  
6) proposal_version 世代管理が成立する  
7) status API が proposal_info を返す  
8) メールHTMLは XSS を起こさない（escapeHtml適用）

## テストケース詳細

| Case | 内容 | 検証方法 |
|------|------|----------|
| 1 | status≠sent で prepare 拒否 | API 400 `invalid_status` |
| 2 | 全候補が重複時 prepare 拒否 | API 400 `all_duplicates` |
| 3 | add_slots フロー成功 + version増加 | API成功 + SQL検証 |
| 4 | 3回目の追加候補は拒否 | API 400 `max_proposals_reached` |
| 5 | declined は通知対象から除外 | API `total_recipients` + SQL検証 |
| 6 | proposal_version_at_response が書かれる | 静的検証（grep） |
| 7 | status API が proposal_info を返す | API レスポンス検証 |
| 8 | メールHTMLがXSS対策済み | 静的検証（escapeHtml grep） |

## 実行方法（ローカル）

```bash
# 依存関係インストール
npm ci

# E2E実行
bash tests/e2e/phase2_additional_slots.sh
```

## 実行方法（CI）
- `.github/workflows/phase2-e2e.yml` が main へのpushで自動実行
- 失敗時は `/tmp/wrangler_phase2_e2e.log` が artifact に残る

## 環境変数

| 変数 | デフォルト | 説明 |
|------|------------|------|
| `API_PORT` | 8787 | wrangler dev のポート |
| `DB_NAME` | webapp-production | D1データベース名 |
| `USER_ID` | test-user-001 | テスト用ユーザーID |
| `WORKSPACE_ID` | ws-default | テスト用ワークスペースID |
| `LOG_DIR` | /tmp | wranglerログの出力先 |

## TODO（仕様確定待ち）
- [ ] `/i/:token/respond` のエンドポイントを CI から curl で叩く（mount確定後）
- [ ] `scheduling_threads` の必須カラム増加に追随（Case1のINSERT更新）

## トラブルシューティング

### wrangler dev が起動しない
```bash
# ポートを確認
lsof -i :8787

# 強制終了
pkill -f "wrangler dev"
pkill -f "workerd"
```

### Case3-5 で unexpected error
```bash
# ログを確認
tail -100 /tmp/wrangler_phase2_e2e.log

# DBの状態を確認
npx wrangler d1 execute webapp-production --local --command="SELECT * FROM scheduling_threads LIMIT 5;"
```

---

## Ops / Incident Prevention（運用インシデント防止）

Phase2 は「静かに死ぬ」を防ぐため、以下もCIゲート化する。

### 不変条件（運用）
- confirm なし execute を禁止（確認必須）
- confirm/execute の二重実行で重複送信しない（冪等）
- 期限切れ token は 410 で落とす
- 誤ユーザーは 404/403 で隠す（越境防止）
- add_slots は「追加/キャンセル」のみ（別スレッドで禁止）
- pending_actions CHECK が add_slots を許可している
- メールHTMLが XSS を起こさない（escapeHtml）

### テストケース詳細（Ops）

| Case | 内容 | 検証方法 |
|------|------|----------|
| 1 | confirm なし execute 拒否 | API error |
| 2 | execute 二重実行で冪等 | 2回目 inserted=0 |
| 3 | confirm 二重で decision 変更不可 | error or 元のまま |
| 4 | 期限切れ token 拒否 | API expired error |
| 5 | 別ユーザーは confirm 不可 | API 404/403 |
| 6 | add_slots で「別スレッドで」拒否 | API invalid_decision |
| 7 | CHECK制約に add_slots 含む | 静的検証（SQL） |
| 8 | HTMLエスケープ適用 | 静的検証（grep） |

### 実行
```bash
bash tests/e2e/phase2_ops_incident.sh
```

### 失敗時の確認
- `/tmp/wrangler_ops_e2e.log` を参照（CIではartifactで回収）

---

## NeedResponse（再回答が必要な人の判定）

追加候補後に「再回答が必要」が正しく判定されることを保証する。

### 不変条件
- 追加候補後、全員が「再回答必要」になる（declined除く）
- declined は再回答必要から除外
- status API の proposal_info に必要なフィールドが含まれる
- slots に proposal_version が含まれる

### テストケース詳細（NeedResponse）

| Case | 内容 | 検証方法 |
|------|------|----------|
| 1 | add_slots 後に need_response 増加 | API proposal_info |
| 2 | declined は need_response から除外 | need < total |
| 3 | proposal_info 構造検証 | 必須フィールド存在 |
| 4 | slots に proposal_version 含む | 全slots検証 |

### 実行
```bash
bash tests/e2e/phase2_need_response.sh
```

### 失敗時の確認
- `/tmp/wrangler_need_response_e2e.log` を参照

---

## 全テスト一括実行

```bash
# 依存関係インストール
npm ci

# 3つのE2Eを順番に実行
bash tests/e2e/phase2_additional_slots.sh
bash tests/e2e/phase2_ops_incident.sh
bash tests/e2e/phase2_need_response.sh
```

---

## 関連ドキュメント
- [RUNBOOK.md](./RUNBOOK.md) - **CI失敗時のトラブルシューティング**
- [docs/PHASE2_TICKETS.md](../../docs/PHASE2_TICKETS.md) - 実装チケット（P2-B1/B2/C1 含む）
- [docs/PHASE2_SPRINT_PLAN.md](../../docs/PHASE2_SPRINT_PLAN.md) - スプリント計画
- [docs/PHASE2_ARCHITECTURE.md](../../docs/PHASE2_ARCHITECTURE.md) - アーキテクチャ・運用ルール

## 次ステップ（Sprint 2-B/2-C）
- **P2-B1**: UIで世代混在表示（v1/v2/v3バッジ、再回答必要カウント）
- **P2-B2**: 再通知文面の統一（3要素必須）
- **P2-C1**: CI failing時のRunbook作成

詳細は [docs/PHASE2_TICKETS.md](../../docs/PHASE2_TICKETS.md) を参照。
