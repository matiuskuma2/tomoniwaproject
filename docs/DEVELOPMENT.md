# 開発ドキュメント - Tomoniwao

最終更新: 2026-01-20

---

## 📋 目次

1. [現在の CI/E2E 状況](#現在の-cie2e-状況)
2. [技術負債と撤去計画](#技術負債と撤去計画)
3. [E2E テスト詳細](#e2e-テスト詳細)
4. [解決済みの問題](#解決済みの問題)
5. [再スタート手順](#再スタート手順)

---

## 現在の CI/E2E 状況

### 全ワークフロー グリーン達成 ✅

```
CI (ci.yml)                    ✅ グリーン - lint + typecheck
Unit Tests                     ✅ グリーン - 単体テスト
TypeScript Check               ✅ グリーン - 型チェック
E2E Smoke Tests                ✅ グリーン - 認証なし基本動作
E2E Authenticated Tests        ✅ グリーン - 認証あり（Step 1-5 全通過）
Phase2 E2E                     ✅ グリーン - 追加候補・NeedResponse（workaround なし）
P0 Guardrails                  ✅ グリーン - テナント分離・Migration安全性
```

### 安全優先ロードマップ 達成状況

| フェーズ | 状態 | 詳細 |
|---------|------|------|
| 1) CI 安定化 | ✅ 完了 | lint/typecheck 安定 |
| 2) Smoke E2E 常時グリーン | ✅ 完了 | webServer 設定修正 |
| 3) Phase2 E2E グリーン | ✅ 完了 | 8ケース全パス |
| 4) Authenticated E2E 基盤 | ✅ 完了 | 認証確認（Step 1）グリーン |
| 5) ワークアラウンド撤去 | ✅ 完了 | Step B: SQL workaround 撤去 |
| 6) Authenticated Step 2-5 | ✅ 完了 | Step D: 状態ベース待機で復活 |

---

## 技術負債と撤去計画

### 回収済みの負債

| 負債 | 状態 | 回収日 | コミット |
|------|------|--------|----------|
| SQL Workaround (status='sent') | ✅ 撤去完了 | 2026-01-20 | `11f32a6` |
| Critical Path Step 2-5 skip | ✅ 復活完了 | 2026-01-20 | `4d83b43` |

### 現在の技術負債

**なし** - 意図的な負債はすべて回収済み

---

## E2E テスト詳細

### Phase2 E2E (shell script)

**ファイル**: `tests/e2e/phase2_additional_slots.sh`

**テストケース**:
| Case | 説明 | 状態 |
|------|------|------|
| Case1 | proposals/prepare: status != sent で失敗 | ✅ |
| Case2 | proposals/prepare: 全スロット重複で失敗 | ✅ |
| Case3 | add_slots: 成功 + version 増加 | ✅ |
| Case4 | add_slots: 3回目で max 到達エラー | ✅ |
| Case5 | add_slots: declined 除外の通知 | ✅ |
| Case6 | proposal_version_at_response 静的ガード | ✅ |
| Case7 | status API に proposal_info 存在 | ✅ |
| Case8 | email XSS 静的ガード | ✅ |

**Phase2 NeedResponse**: `tests/e2e/phase2_need_response.sh`
- proposal_info.current_version の検証
- invitees_needing_response_count の検証

### Playwright E2E

**Smoke Tests** (`frontend/e2e/smoke.smoke.spec.ts`):
- ページ読み込み確認
- JavaScript エラーなし確認
- 基本 UI 表示確認

**Authenticated Tests** (`frontend/e2e/critical-path.spec.ts`):
- Step 1: 認証済み状態でアクセス ✅
- Step 2: スレッド作成（メールアドレス入力）✅
- Step 3: リスト作成 ✅
- Step 4: バッチ処理（10件メンバー追加）✅
- Step 5: UI更新確認 ✅

**認証設定**:
- `frontend/e2e/auth/auth.setup.ts` で sessionStorage に設定
- `critical-path.spec.ts` の `beforeEach` で各テスト前に再設定

### E2E 用 data-testid 一覧

| コンポーネント | 属性 | 用途 |
|---------------|------|------|
| ChatPane | `data-testid="chat-input"` | チャット入力欄 |
| ChatPane | `data-testid="chat-send-button"` | 送信ボタン |
| ChatPane | `data-testid="chat-messages"` | メッセージエリア |
| ChatPane | `data-testid="chat-message"` | 各メッセージ |
| ChatPane | `data-message-role="user\|assistant"` | メッセージの役割 |
| ThreadsList | `data-testid="threads-list"` | スレッド一覧 |
| ThreadsList | `data-testid="thread-item"` | 各スレッドアイテム |
| ThreadsList | `data-thread-id="<uuid>"` | スレッドID |
| SlotsCard | `data-testid="slots-latest-only-toggle"` | P2-B1: 最新候補のみ表示トグル |
| ThreadStatusCard | `data-testid="proposal-info-section"` | P2-B1: 世代情報セクション |
| ThreadStatusCard | `data-testid="proposal-version-badge"` | P2-B1: 世代バッジ |
| ThreadStatusCard | `data-testid="need-response-alert"` | P2-B1: 再回答必要アラート |
| ThreadStatusCard | `data-testid="need-response-toggle"` | P2-B1: 詳細展開ボタン |
| ThreadStatusCard | `data-testid="need-response-list"` | P2-B1: 再回答必要者リスト |

### E2E ヘルパー関数

**ファイル**: `frontend/e2e/helpers/test-helpers.ts`

| 関数 | 用途 |
|------|------|
| `waitForAssistantMessage(page, timeout)` | アシスタントメッセージの追加を待つ |
| `waitForAssistantMessageMatching(page, pattern, timeout)` | 特定パターンのメッセージを待つ |
| `waitForThreadCreated(page, timeout)` | URL変更でスレッド作成を確認 |
| `waitForThreadListUpdate(page, initialCount, timeout)` | スレッドリスト更新を待つ |
| `assertNoErrorEnhanced(page)` | チャット内エラーも検出 |
| `sendChatMessage(page, message)` | メッセージ送信 |
| `getChatInput(page)` | チャット入力欄を取得 |
| `waitForUIStable(page, timeout)` | UIが安定するまで待つ |
| `assertProposalVersionBadgeVisible(page, expectedVersion?)` | P2-B1: 世代バッジ表示確認 |
| `toggleLatestSlotsOnly(page, enable)` | P2-B1: 最新のみトグル操作 |
| `assertNeedResponseAlertVisible(page, expectedCount?)` | P2-B1: 再回答必要アラート確認 |
| `expandAndCheckNeedResponseList(page)` | P2-B1: 再回答必要者リスト展開・取得 |

---

## 解決済みの問題

### 2026-01-19 修正履歴

| Commit | 問題 | 解決策 |
|--------|------|--------|
| `5218b36` | stdout/stderr 混在で base_thread が壊れる | info/ok を stderr に出力 |
| `24d54ca` | Case2 でスロットがなく重複テスト不可 | 初期スロットを追加してからテスト |
| `baac275` | execute 後も status='draft' のまま | SQL workaround で 'sent' に更新 |
| `3a10a4f` | Case4 で max 到達前にエラー | additional_propose_count 確認後にテスト |
| `cb809d5` | Case5 で max 到達エラー | 新規スレッド作成してテスト |
| `30e8dd6` | NeedResponse で current_proposal_version 不一致 | current_version に修正 |
| `0d812e2` | Smoke Test で webServer 起動失敗 | localhost の場合は webServer 有効化 |
| `c3f12d6` | auth.setup.ts で __dirname エラー | ES Module 対応 |
| `377b2b5` | 認証 Cookie が sessionStorage と不一致 | sessionStorage に設定 |
| `272b8c7` | テスト間で認証が引き継がれない | beforeEach で毎回設定 |
| `820d7cc` | Step 2-5 のセレクタ不一致 | 一時 skip |
| `11f32a6` | SQL workaround が残存 | バックエンド確認後に撤去 |
| `4d83b43` | Step 2-5 が skip のまま | 状態ベース待機で復活 |

### 2026-01-20 P2-B1 世代混在表示UI強化

| Commit | 変更内容 |
|--------|----------|
| `bdade5f` | P2-B1: SlotsCard に「最新候補のみ表示」トグル追加、ThreadStatusCard に再回答必要者の名前一覧表示、E2Eヘルパー追加 |
| `f52210c` | ESLint 未使用変数エラー修正 |

### 2026-01-20 P2-B2 文面統一フォーマッター

| Commit | 変更内容 |
|--------|----------|
| `fc3afb4` | P2-B2: messageFormatter.ts 新規作成、統一フォーマット関数追加 |
| `676e898` | P2-B2: 未返信リマインドも統一フォーマッターを使用 |

**統一フォーマット構造:**
```
見出し → 要点 → 対象者 → 次アクション → 注意書き（世代/期限）
```

**統一済みの機能:**
- ✅ need_response.list（再回答必要者リスト）
- ✅ remind.need_response.confirm/sent（再回答リマインド確認/送信完了）
- ✅ remind.pending.confirm（未返信リマインド確認）

**未統一（バックエンドメッセージ使用）:**
- additional_slots（追加候補通知）- バックエンド側の message_for_chat を使用

### 2026-01-20 P2-D2 回答済みの人へのリマインド

| Commit | 変更内容 |
|--------|----------|
| `0b1be5b` | P2-D2: schedule.remind.responded インテント追加、executor実装 |

**送信対象オプション:**
- 未返信リマインド: 「リマインド」→ 一度も回答していない人
- 再回答リマインド: 「再回答リマインド」→ 旧世代回答 + 未回答
- 回答済みリマインド: 「回答済みリマインド」→ 最新候補に回答済み

---

## 再スタート手順

### 1. リポジトリクローン

```bash
git clone https://github.com/matiuskuma2/tomoniwaproject.git
cd tomoniwaproject
```

### 2. 依存関係インストール

```bash
# ルート
npm install

# フロントエンド
cd frontend && npm install && cd ..

# API
cd apps/api && npm install && cd ../..
```

### 3. ローカル開発環境

```bash
# DB Migration
npm run db:migrate:local

# 開発サーバー起動（PM2）
npm run build
pm2 start ecosystem.config.cjs

# 確認
curl http://localhost:3000/health
```

### 4. E2E テスト実行（ローカル）

```bash
# Phase2 E2E
bash tests/e2e/phase2_additional_slots.sh

# Playwright Smoke
cd frontend && npx playwright test --project=smoke
```

### 5. GitHub Secrets 設定（必要に応じて）

| Secret | 説明 |
|--------|------|
| `E2E_BASE_URL` | staging 環境 URL |
| `E2E_AUTH_TOKEN` | E2E 用認証トークン |
| `CLOUDFLARE_API_TOKEN` | Cloudflare デプロイ用 |

### 6. CI 確認

```bash
# [e2e] タグでコミットすると Authenticated E2E が実行される
git commit --allow-empty -m "chore: trigger E2E [e2e]"
git push origin main
```

---

## 連絡先

- **開発者**: 関屋紘之（モギモギ）
- **X**: @aitanoshimu
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject
- **Actions**: https://github.com/matiuskuma2/tomoniwaproject/actions
