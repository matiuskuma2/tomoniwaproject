# 開発ワークフロー（PR駆動開発）

> **原則**: すべての変更はPull Request経由で行い、コードレビューを通す

---

## 1. ブランチ戦略

```
main (本番)
  │
  ├── feature/TICKET-ID-description  (機能開発)
  ├── fix/TICKET-ID-description      (バグ修正)
  └── docs/description               (ドキュメントのみ)
```

### ブランチ命名規則

| プレフィックス | 用途 | 例 |
|---------------|------|-----|
| `feature/` | 新機能 | `feature/CONV-CHAT-ai-secretary` |
| `fix/` | バグ修正 | `fix/PREF-SET-1-duplicate-save` |
| `docs/` | ドキュメント | `docs/api-reference` |
| `refactor/` | リファクタリング | `refactor/executor-split` |

---

## 2. 開発フロー

### 2.1 新機能開発

```bash
# 1. mainを最新に
git checkout main
git pull origin main

# 2. featureブランチ作成
git checkout -b feature/TICKET-ID-description

# 3. 開発・コミット
git add .
git commit -m "feat(TICKET-ID): 説明"

# 4. プッシュ
git push origin feature/TICKET-ID-description

# 5. PRを作成（GitHub CLI）
gh pr create --title "feat(TICKET-ID): 説明" --body "## 変更内容\n- xxx\n- yyy"

# 6. レビュー後マージ
gh pr merge --squash

# 7. ローカルを更新
git checkout main
git pull origin main
git branch -d feature/TICKET-ID-description
```

### 2.2 緊急修正（Hotfix）

```bash
# 1. mainから直接修正
git checkout main
git pull origin main

# 2. fixブランチ作成
git checkout -b fix/TICKET-ID-description

# 3. 修正・コミット・プッシュ
git add .
git commit -m "fix(TICKET-ID): 説明"
git push origin fix/TICKET-ID-description

# 4. PR作成→即マージ
gh pr create --title "fix(TICKET-ID): 説明" --body "緊急修正"
gh pr merge --squash
```

---

## 3. コミットメッセージ規約

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

| Type | 用途 |
|------|------|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `docs` | ドキュメント |
| `style` | フォーマット（機能変更なし） |
| `refactor` | リファクタリング |
| `test` | テスト追加・修正 |
| `chore` | ビルド・設定変更 |

### 例

```
feat(CONV-CHAT): AI秘書の雑談対応

- Backend: chat_messages テーブル追加
- Frontend: executeChatFallback 追加
- E2E: chat.spec.ts 追加

Closes #123
```

---

## 4. PRテンプレート

```markdown
## 変更内容
<!-- 何を変更したか -->

## 変更理由
<!-- なぜ変更が必要か -->

## テスト方法
<!-- どうやって動作確認したか -->

## チェックリスト
- [ ] 型チェック通過 (`npm run typecheck`)
- [ ] E2Eテスト追加/更新
- [ ] ドキュメント更新
- [ ] 本番デプロイ確認
```

---

## 5. デプロイフロー

```
feature/* → PR → main → 自動/手動デプロイ → 本番
```

### デプロイコマンド

```bash
# Workers デプロイ
cd apps/api && npm run deploy

# DBマイグレーション（新規テーブル追加時）
npx wrangler d1 execute webapp-production --remote --file=db/migrations/XXXX_xxx.sql
```

---

## 6. 型チェック・リント

```bash
# Backend
cd apps/api && npx tsc --noEmit

# Frontend
cd frontend && npx tsc --noEmit

# 全体
npm run typecheck
```

---

## 7. サンドボックス管理

### 軽量化手順

```bash
# 不要キャッシュ削除
rm -rf node_modules/.cache
rm -rf .wrangler/tmp

# git gc
git gc --aggressive --prune=now
```

### バックアップ

```bash
# AI Driveへバックアップ
tar -czf /mnt/aidrive/tomoniwa_backup_$(date +%Y%m%d).tar.gz \
  --exclude=node_modules \
  --exclude=.wrangler \
  --exclude=dist \
  /home/user/tomoniwaproject
```

---

*最終更新: 2026-01-24*
