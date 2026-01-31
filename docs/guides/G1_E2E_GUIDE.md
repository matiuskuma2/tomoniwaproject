# G1 1対N E2E テストガイド

## 概要

G1（1対N Broadcast Scheduling）の E2E テストは、API サーバー（port 3000）に依存するため、
現在は `*.local.spec.ts` として管理し、**ローカル環境でのみ実行**しています。

## テストファイル一覧

| ファイル名 | テスト数 | 内容 |
|-----------|---------|------|
| `one-to-many.local.spec.ts` | 6 | candidates 3×3 完全フロー |
| `one-to-many-open-slots.local.spec.ts` | 10 | open_slots 5×3 完全フロー + 先着制テスト |
| `one-to-many.security.local.spec.ts` | 18 | セキュリティテスト（401/403/404/SQLi/XSS） |

## ローカル実行方法

### 1. API サーバーの起動

```bash
# プロジェクトルートで
cd /home/user/tomoniwaproject

# D1 データベースのマイグレーション（初回のみ）
npm run db:migrate:local

# API サーバーを起動（port 3000）
npm run dev
```

### 2. E2E テストの実行

別のターミナルで：

```bash
cd frontend

# 全 G1 テストを実行
E2E_API_URL=http://localhost:3000 npx playwright test one-to-many --project=smoke

# 個別テストファイルを実行
E2E_API_URL=http://localhost:3000 npx playwright test one-to-many.local.spec.ts --project=smoke
E2E_API_URL=http://localhost:3000 npx playwright test one-to-many-open-slots.local.spec.ts --project=smoke
E2E_API_URL=http://localhost:3000 npx playwright test one-to-many.security.local.spec.ts --project=smoke

# 特定のテストのみ実行（-g オプション）
E2E_API_URL=http://localhost:3000 npx playwright test one-to-many.local.spec.ts -g "G1-S1" --project=smoke
```

### 3. PM2 を使った API サーバー起動（サンドボックス環境）

```bash
# PM2 で起動
cd /home/user/tomoniwaproject && pm2 start ecosystem.config.cjs

# ログ確認
pm2 logs --nostream

# 再起動
fuser -k 3000/tcp 2>/dev/null || true
pm2 restart webapp
```

## テストカバレッジ（DoD）

### candidates モード（3×3 フロー）
- [x] fixture 作成（3 invites × 2 slots）
- [x] invitee が OK/NO/MAYBE で回答
- [x] 再アクセスで「回答済み」表示（冪等性）
- [x] organizer が summary を確認
- [x] organizer が finalize
- [x] finalize 後、invitee に「確定済み」表示
- [x] 本番環境で fixture 403

### open_slots モード（5×3 フロー + 先着制）
- [x] fixture 作成（5 invites × 3 slots, mode=open_slots）
- [x] invitee が申込（OK）
- [x] 先着制: 同じ枠に 2 人目が OK → 409 + 「枠が埋まっています」
- [x] UI でロック済み枠は disabled + 🔒 バッジ
- [x] 再アクセスで「申込済み」表示
- [x] organizer が summary を確認
- [x] organizer が finalize（手動）
- [x] finalize 後、invitee に「確定済み」表示

### セキュリティテスト
- [x] SEC-1: 認証なし API → 401（4 endpoints）
- [x] SEC-2: 無効トークン → エラー表示
- [x] SEC-3: 他ユーザーアクセス → 403
- [x] SEC-4: 存在しないリソース → 404
- [x] SEC-5: SQL インジェクション防止
- [x] SEC-6: 回答冪等性
- [x] SEC-7: 本番 fixture guard 403（本番環境のみ）
- [x] SEC-8: XSS 防止
- [x] SEC-9: 期限切れトークン → 適切なエラー

## CI への統合（将来計画）

現在、G1 テストは CI で実行されていません。CI で G1 を回すには以下の workflow 変更が必要です：

### 必要な変更（`.github/workflows/test.yml`）

```yaml
# e2e-smoke ジョブに追加
- name: Setup D1 database
  run: npx wrangler d1 migrations apply webapp-production --local
  working-directory: .

- name: Start API server
  run: |
    npx wrangler dev --local --port 3000 &
    sleep 10
    curl -s http://127.0.0.1:3000/health || echo "API health check skipped"
  working-directory: .

- name: Run E2E Smoke tests
  run: npx playwright test --project=smoke
  working-directory: frontend
  env:
    CI: true
    E2E_BASE_URL: http://127.0.0.1:4173
    E2E_API_URL: http://127.0.0.1:3000  # 追加
```

### テストファイルのリネーム

workflow 変更後、以下のリネームを行います：

```bash
cd frontend/e2e
mv one-to-many.local.spec.ts one-to-many.smoke.spec.ts
mv one-to-many-open-slots.local.spec.ts one-to-many-open-slots.smoke.spec.ts
mv one-to-many.security.local.spec.ts one-to-many.security.smoke.spec.ts
```

## トラブルシューティング

### API サーバーが起動しない
```bash
# ポートを確認
fuser 3000/tcp

# プロセスを強制終了
fuser -k 3000/tcp

# D1 データベースをリセット
npm run db:reset:local
```

### テストがタイムアウトする
- `E2E_API_URL` が正しく設定されているか確認
- API サーバーが port 3000 で稼働しているか確認
- `curl http://localhost:3000/api/one-to-many` でレスポンスがあるか確認

### fixture が 403 を返す
- 本番環境（`*.pages.dev` / `tomoniwao.jp`）では fixture は無効化されています
- ローカル環境でのみテスト可能です

## 関連ドキュメント

- [G1-PLAN.md](../plans/G1-PLAN.md) - G1 設計ドキュメント
- [E2E テスト全般](../../frontend/e2e/README.md)
