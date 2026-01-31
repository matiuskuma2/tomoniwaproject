# CI Workflow パッチ - G1 E2E Smoke Tests 有効化

## 概要

このドキュメントは、G1（1対N）E2E テストを CI で実行するために必要な
`.github/workflows/test.yml` の変更内容を記載しています。

**重要**: このパッチは workflow ファイルの変更を含むため、
リポジトリ管理者による適用が必要です。

## 変更内容

### ファイル: `.github/workflows/test.yml`

`e2e-smoke` ジョブに以下のステップを追加します：

```yaml
  e2e-smoke:
    name: 'E2E Smoke Tests'
    needs: unit-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      
      - name: Install frontend dependencies
        run: npm ci
        working-directory: frontend
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
        working-directory: frontend
      
      - name: Build frontend
        run: npm run build
        working-directory: frontend

      # === G1 API Server Setup (NEW) ===
      - name: Install root dependencies
        run: npm ci
        
      - name: Setup D1 database
        run: npx wrangler d1 migrations apply webapp-production --local
        
      - name: Start API server
        run: |
          npx wrangler dev --local --port 3000 &
          echo "Waiting for API server to start..."
          for i in {1..30}; do
            if curl -s http://127.0.0.1:3000/health > /dev/null 2>&1; then
              echo "API server is ready"
              break
            fi
            sleep 1
          done
      # === End G1 API Server Setup ===
      
      - name: Run E2E Smoke tests
        run: npx playwright test --project=smoke
        working-directory: frontend
        env:
          CI: true
          E2E_BASE_URL: http://127.0.0.1:4173
          E2E_API_URL: http://127.0.0.1:3000  # NEW: G1 tests need this
      
      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-smoke
          path: frontend/e2e-report/
          retention-days: 7
```

## 適用手順

### 1. workflow ファイルの編集

管理者権限でリポジトリにアクセスし、以下の変更を適用：

```bash
# ブランチ作成
git checkout -b chore/ci-enable-g1-smoke

# workflow ファイルを編集
# 上記の変更を .github/workflows/test.yml に適用

# コミット & プッシュ
git add .github/workflows/test.yml
git commit -m "ci: Enable G1 E2E smoke tests with API server"
git push -u origin chore/ci-enable-g1-smoke

# PR 作成 & マージ
gh pr create --title "ci: Enable G1 E2E smoke tests with API server" --body "..."
gh pr merge --squash
```

### 2. テストファイルのリネーム

workflow がマージされた後、以下のリネームを行います：

```bash
cd frontend/e2e

# .local.spec.ts → .smoke.spec.ts
mv one-to-many.local.spec.ts one-to-many.smoke.spec.ts
mv one-to-many-open-slots.local.spec.ts one-to-many-open-slots.smoke.spec.ts
mv one-to-many.security.local.spec.ts one-to-many.security.smoke.spec.ts

# ファイル内の参照も更新
sed -i 's/.local.spec.ts/.smoke.spec.ts/g' *.smoke.spec.ts
```

## 注意事項

1. **API サーバー起動時間**: wrangler dev の起動に最大 30 秒かかる場合があります
2. **D1 データベース**: ローカルモード（`--local`）で SQLite を使用します
3. **テストの独立性**: 各テストは fixture の作成・クリーンアップを行います
4. **環境変数**: `E2E_API_URL` が設定されていない場合、G1 テストは自動的にスキップされます

## テスト対象

パッチ適用後、以下のテストが CI で実行されます：

- `one-to-many.smoke.spec.ts` - candidates 3×3 フロー（6 tests）
- `one-to-many-open-slots.smoke.spec.ts` - open_slots 5×3 + 先着制（10 tests）
- `one-to-many.security.smoke.spec.ts` - セキュリティテスト（18 tests）

合計: **34 tests** が追加されます

## 検証方法

パッチ適用後、以下で検証できます：

```bash
# PR を作成して CI を確認
gh pr create --title "test: Verify G1 CI smoke tests"

# または手動で workflow を実行
gh workflow run test.yml
```

## 関連 PR

- PR #95: G1 E2E 基盤（3×3 フロー）
- PR #96: open_slots 5×3 フロー
- PR #97: セキュリティテスト 18 tests
- PR #98: 先着制（枠ロック）実装
