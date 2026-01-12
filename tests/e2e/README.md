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

## 関連ドキュメント
- [docs/PHASE2_TICKETS.md](../../docs/PHASE2_TICKETS.md) - 実装チケット
- [docs/PHASE2_SPRINT_PLAN.md](../../docs/PHASE2_SPRINT_PLAN.md) - スプリント計画
