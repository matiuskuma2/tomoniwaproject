# Phase2 E2E Runbook

CI が失敗した際のトラブルシューティング手順を記載。

---

## 1. よくある失敗パターンと対応策

### 1-1. DB schema mismatch

**症状**:
```
SQLITE_ERROR: table scheduling_threads has no column named proposal_version
```

**原因**: migration が適用されていない

**対応**:
```bash
# ローカルDBに migration 適用
npx wrangler d1 migrations apply webapp-production --local

# 本番DBに migration 適用
npx wrangler d1 migrations apply webapp-production
```

**CIでの対応**: `.github/workflows/phase2-e2e.yml` で migration 適用ステップを確認

---

### 1-2. wrangler dev が起動しない

**症状**:
```
Error: Address already in use :::8787
```
または
```
Error: EADDRINUSE: address already in use
```

**原因**: 前回の wrangler プロセスが残っている

**対応**:
```bash
# ポートを使用しているプロセスを確認
lsof -i :8787

# 強制終了
pkill -f "wrangler dev"
pkill -f "workerd"

# 再起動
npx wrangler dev --local --port 8787
```

**CIでの対応**: ジョブ開始時に `pkill` を実行（既存プロセスを確実に停止）

---

### 1-3. token 期限切れ

**症状**:
```
HTTP 410 Gone
{"error":"token_expired"}
```

**原因**: prepare → confirm → execute の間隔が15分（900秒）以上空いている

**対応**:
- テスト実行のタイミングを確認
- CI ログで各 API 呼び出しのタイムスタンプを確認
- 必要に応じてテストを分割または並列化を解除

**確認方法**:
```bash
# pending_action の expires_at を確認
npx wrangler d1 execute webapp-production --local \
  --command="SELECT confirm_token, expires_at, created_at FROM pending_actions ORDER BY created_at DESC LIMIT 5;"
```

---

### 1-4. Case 3-5 で unexpected error

**症状**: API は 200 だが検証が失敗

**原因**: DBデータの不整合、または期待値の誤り

**対応**:
```bash
# 1. wrangler ログを確認
tail -100 /tmp/wrangler_phase2_e2e.log

# 2. DBの状態を確認
npx wrangler d1 execute webapp-production --local \
  --command="SELECT id, status, proposal_version, additional_propose_count FROM scheduling_threads LIMIT 5;"

npx wrangler d1 execute webapp-production --local \
  --command="SELECT slot_id, thread_id, proposal_version FROM scheduling_slots ORDER BY created_at DESC LIMIT 10;"

npx wrangler d1 execute webapp-production --local \
  --command="SELECT * FROM pending_actions WHERE action_type = 'add_slots' ORDER BY created_at DESC LIMIT 5;"
```

---

## 2. artifact ログの読み方

CIが失敗すると以下のログが artifact に保存される:

| ファイル | 内容 |
|----------|------|
| `/tmp/wrangler_phase2_e2e.log` | 追加候補 E2E (phase2_additional_slots.sh) |
| `/tmp/wrangler_ops_e2e.log` | 運用インシデント防止 E2E (phase2_ops_incident.sh) |
| `/tmp/wrangler_need_response_e2e.log` | 再回答判定 E2E (phase2_need_response.sh) |

### ログの確認ポイント

1. **`[FAIL]` を検索**: 失敗した箇所を特定
2. **その前の `[TEST]` を確認**: どのケースで失敗したか特定
3. **API レスポンスを確認**: HTTP status と body を確認

```bash
# ローカルでログを確認
grep -n "FAIL\|ERROR\|TEST" /tmp/wrangler_phase2_e2e.log

# APIレスポンスの抽出
grep -A5 "Response:" /tmp/wrangler_phase2_e2e.log
```

### CI artifact のダウンロード

```bash
# GitHub CLI で artifact をダウンロード
gh run download <run_id> -n phase2-e2e-logs
```

---

## 3. ローカル再現手順

```bash
cd /home/user/tomoniwaproject

# 1. 依存関係インストール
npm ci

# 2. DB初期化（クリーンな状態から）
rm -rf .wrangler/state
npx wrangler d1 migrations apply webapp-production --local

# 3. 開発サーバー起動（別ターミナル）
npm run dev &
sleep 10  # サーバー起動待ち

# 4. E2Eテスト実行
bash tests/e2e/phase2_additional_slots.sh
bash tests/e2e/phase2_ops_incident.sh
bash tests/e2e/phase2_need_response.sh

# 5. 全テスト完了後にサーバー停止
pkill -f "wrangler dev"
```

### 特定のケースのみ実行

```bash
# テストスクリプトを編集して特定のケースのみ実行
# または grep でフィルタリング
bash tests/e2e/phase2_additional_slots.sh 2>&1 | grep -E "Case|PASS|FAIL"
```

---

## 4. 環境変数の確認

| 変数 | デフォルト | 説明 |
|------|------------|------|
| `API_PORT` | 8787 | wrangler dev のポート |
| `DB_NAME` | webapp-production | D1 データベース名 |
| `USER_ID` | test-user-001 | テスト用ユーザーID |
| `WORKSPACE_ID` | ws-default | テスト用ワークスペースID |
| `LOG_DIR` | /tmp | wrangler ログの出力先 |

```bash
# 環境変数の確認
echo "API_PORT=${API_PORT:-8787}"
echo "DB_NAME=${DB_NAME:-webapp-production}"
```

---

## 5. CHECK制約エラー

**症状**:
```
SQLITE_CONSTRAINT: CHECK constraint failed: action_type
```

**原因**: `pending_actions.action_type` に `add_slots` が含まれていない

**確認**:
```bash
npx wrangler d1 execute webapp-production --local \
  --command=".schema pending_actions"
```

**対応**: migration 0071 を適用
```bash
npx wrangler d1 migrations apply webapp-production --local
```

---

## 6. エスカレーション

上記で解決しない場合:

1. **GitHub Issue を作成**（ログを添付）
   - [Issues](https://github.com/matiuskuma2/tomoniwaproject/issues)
2. **Slack チャンネルに投稿**
   - #phase2-e2e
3. **関連ドキュメントを確認**
   - [docs/PHASE2_TICKETS.md](../../docs/PHASE2_TICKETS.md)
   - [docs/PHASE2_ARCHITECTURE.md](../../docs/PHASE2_ARCHITECTURE.md)

---

## 7. よくある質問（FAQ）

### Q: CI が flaky（不安定）で時々失敗する

**A**: 以下を確認:
- wrangler dev の起動待ち時間を増やす（`sleep 10` → `sleep 20`）
- 並列実行を避ける（jobs を sequential に変更）
- リソース制限を確認（GitHub Actions の制限）

### Q: ローカルでは成功するが CI で失敗する

**A**: 以下を確認:
- 環境変数の違い
- DB の初期状態の違い
- Node.js / npm のバージョン違い

### Q: 特定のケースだけ失敗する

**A**: 以下を確認:
- 前のケースの副作用（DBの状態）
- タイムアウト設定
- 期待値の誤り（API レスポンスの変更）

---

## 更新履歴

- 2026-01-12: 初版作成（P2-C1）
