# PRドリブン開発プロセス（Tomoniwao）

## 概要

GenSpark（実装）× ChatGPT（壁打ち）という現行フローを維持しながら、PRごとに品質ゲートを自動で検査する運用。

---

## 現行フロー（維持）

1. **ChatGPT**: 要件定義／方針決定／分割（壁打ち）
2. **GenSpark**: 実装 → サンドボックスで動作確認
3. **ChatGPT**: 必要に応じてレビュー／修正指示
4. **GenSpark**: 修正
5. **デプロイ**: main push → Cloudflare Workers/Pages

---

## 追加するステップ（品質ゲート）

### 2.5. GitHub Actions 自動検査

```
GenSpark で実装
    ↓
git push origin main
    ↓
GitHub Actions 自動実行
    ├── CI (lint/type/build)
    ├── Test (unit/e2e:smoke)
    ├── P0 Guardrails
    └── Phase2 E2E
    ↓
❌ 落ちたら → ログをGenSpark/ChatGPTに貼って修正
✅ 緑なら → デプロイ完了
```

---

## 既存のワークフロー構成

| ファイル | 目的 | トリガー |
|---------|------|---------|
| `ci.yml` | lint/type/build | push, PR |
| `test.yml` | unit/e2e:smoke/e2e:auth | push, PR |
| `p0-guardrails.yml` | migration/tenant/offset | push, PR |
| `phase2-e2e.yml` | Phase2固有E2E | push, PR |
| `db-migration-check.yml` | DBマイグレーション | push, PR |

---

## PR運用（推奨だが必須ではない）

### 現状
- main直pushでCIが回る
- 緑ならデプロイ成功

### PRドリブン（より安全）
1. `feature/*` ブランチで作業
2. PR作成
3. CI緑を確認
4. main にマージ

---

## GenSpark固定指示

プロジェクト開始時に以下を貼り付け：

```md
# GenSpark 固定指示（PRドリブン品質ゲート運用）

- このリポジトリは GitHub Actions による品質ゲートを必須とする
- push後、CI/Test/P0 Guardrails が自動実行される
- 落ちた場合はログを確認して修正
- 必須の自動チェック：
  1) lint (ESLint)
  2) typecheck (TypeScript)
  3) build (frontend + backend)
  4) unit (Vitest)
  5) e2e:smoke (Playwright smoke)
  6) P0 Guardrails (migration/tenant/offset)
- 主要なUI操作要素には data-testid を付与する
- 仕様変更は禁止。仕様に関わる変更が必要な場合は Issue 提案
- 機密情報をコードやログに出さない
```

---

## CIが落ちた場合の対処

### 1. ログを確認
```
GitHub → Actions → 失敗したworkflow → 該当ジョブ → ログ展開
```

### 2. GenSparkに貼り付け
```
CIが落ちました。以下のログを確認して修正してください：
[ログを貼り付け]
```

### 3. 再push
```bash
git add . && git commit -m "fix: CI error" && git push origin main
```

---

## 品質チェック一覧

### CI (ci.yml)
- Frontend: lint, typecheck, build, bundle size
- Backend: typecheck, build

### Test (test.yml)
- Unit: Vitest
- E2E Smoke: Playwright (ローカルビルド)
- E2E Auth: Playwright (本番、手動トリガー)

### P0 Guardrails (p0-guardrails.yml)
- Migration不変性（過去migration編集禁止）
- OFFSET禁止（cursor only）
- Tenant Isolation SQLチェック
- Migration適用チェック

### Phase2 E2E (phase2-e2e.yml)
- Additional Slots
- Operations
- NeedResponse

---

## ファイル構成

```
.github/
├── workflows/
│   ├── ci.yml              # lint/type/build
│   ├── test.yml            # unit/e2e
│   ├── p0-guardrails.yml   # P0チェック
│   ├── phase2-e2e.yml      # Phase2 E2E
│   └── db-migration-check.yml
├── CODE_REVIEW_GUIDE.md    # レビューガイドライン
└── PULL_REQUEST_TEMPLATE.md # PRテンプレート

docs/
└── DEV_PROCESS_PR_DRIVEN.md # この文書
```

---

## まとめ

1. **現行フローは維持**（GenSpark + ChatGPT）
2. **pushすると自動で品質チェック**
3. **落ちたらログを貼って修正**
4. **緑になったらデプロイ完了**

「関屋さんが見ながら進める」体験はそのまま。
違いは「pushした瞬間に、機械が自動で落としてくれる」だけ。
