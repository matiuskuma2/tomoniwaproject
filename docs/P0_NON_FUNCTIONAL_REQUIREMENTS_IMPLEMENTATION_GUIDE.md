# P0非機能要件 実装ガイド（DOM事故防止・埋め込み隔離・CI）

**Version**: v1.0  
**Status**: 実装手順確定  
**更新日**: 2026-01-01

---

## 📌 目的

DOM構造事故・外部サービス埋め込み事故・ビルド事故を「起こせなくする」ための仕組み化を、**技術負債ゼロ・後戻りなし**の順序で実装する。

このガイドは、開発チームがそのまま実装できる「PR作成手順」と「レビュー観点」を提供する。

---

## 📦 実装する4ファイル

### 1. `docs/UI_DOM_RULES.md`（v1.0）
- **目的**: DOM構造事故を防ぐ固定ルール6項目
- **配置**: `/docs/UI_DOM_RULES.md`
- **内容**: 下記「ファイル内容」参照

### 2. `docs/EMBED_INTEGRATION_POLICY.md`（v1.0）
- **目的**: 外部サービス埋め込みの隔離方針（MyASP等）
- **配置**: `/docs/EMBED_INTEGRATION_POLICY.md`
- **内容**: 下記「ファイル内容」参照

### 3. `docs/DEVELOPMENT_ROADMAP.md` への追記
- **目的**: P0非機能要件セクションを追加（v1.0 → v1.1）
- **配置**: 既存ファイルに追記
- **内容**: 下記「追記内容」参照

### 4. `.github/workflows/ci.yml`
- **目的**: lint/build自動チェック（TypeScript・ESLint・Vite Build）
- **配置**: `/.github/workflows/ci.yml`
- **内容**: 下記「ファイル内容」参照

---

## 🔢 実装順序（後戻りしない順）

### **Phase 1: ルール導入（0.5日）**
1. ✅ `UI_DOM_RULES.md` を作成
2. ✅ `EMBED_INTEGRATION_POLICY.md` を作成
3. ✅ `DEVELOPMENT_ROADMAP.md` に追記
4. ✅ 全員でドキュメントを読了

### **Phase 2: CI導入（0.5日）**
1. ✅ `.github/workflows/ci.yml` を作成
2. ✅ PR作成時に自動実行を確認
3. ✅ 型エラー・lint警告・ビルドエラーでCI失敗を確認

### **Phase 3: MyASP埋め込み実装（1-2日）**
1. ✅ `/billing/subscribe` 実装（iframe方式）
2. ✅ `/billing/return` 実装（受け皿のみ）
3. ✅ MyASP側にサンクスURL設定
4. ✅ スマホ表示確認（iPhone / Android）

### **Phase 4: Gate（実行制御）実装（1日）**
1. ✅ `canExecute(userId, action)` 関数実装
2. ✅ 実行系APIにgate追加
3. ✅ `status=2/4` で実行系を止める
4. ✅ 提案は止めないことを確認

---

## 📝 PR作成手順

### **PR #1: P0非機能要件ドキュメント追加**

#### ブランチ名
```
feature/p0-non-functional-requirements-docs
```

#### 変更内容
- ✅ `docs/UI_DOM_RULES.md` 追加
- ✅ `docs/EMBED_INTEGRATION_POLICY.md` 追加
- ✅ `docs/DEVELOPMENT_ROADMAP.md` 追記（v1.1）
- ✅ `docs/README_PRODUCT.md` 更新（P0非機能要件セクション追加）

#### PRタイトル
```
docs: P0非機能要件（DOM事故防止・埋め込み隔離）を追加
```

#### PR説明
```markdown
## 目的
DOM構造事故・外部サービス埋め込み事故を「起こせなくする」仕組み化

## 変更内容
- UI_DOM_RULES.md: DOM構造事故を防ぐ固定ルール6項目
- EMBED_INTEGRATION_POLICY.md: 外部サービス埋め込みの隔離方針
- DEVELOPMENT_ROADMAP.md: P0非機能要件セクション追加

## レビュー観点
- [ ] ルール6項目の妥当性
- [ ] 既存コードへの影響範囲
- [ ] 開発チーム全員がドキュメントを読了

## 参照
- MYASP_INTEGRATION_SPEC.md
- CHAT_DATA_CONTRACT.md
```

#### レビュー観点
- [ ] ルール6項目が現実的か？（守れるか？）
- [ ] 既存コードで違反箇所がないか？
- [ ] 開発チーム全員がドキュメントを読了したか？

---

### **PR #2: CI自動チェック導入**

#### ブランチ名
```
feature/ci-lint-and-build
```

#### 変更内容
- ✅ `.github/workflows/ci.yml` 追加

#### PRタイトル
```
ci: lint/build自動チェックを追加（TypeScript・ESLint・Vite Build）
```

#### PR説明
```markdown
## 目的
型エラー・lint警告・ビルドエラーでCI失敗し、merge不可にする

## 変更内容
- .github/workflows/ci.yml: 自動チェック（TypeScript・ESLint・Vite Build）

## 動作確認
- [ ] PR作成時にCIが自動実行される
- [ ] 型エラーでCI失敗
- [ ] lint警告でCI失敗
- [ ] ビルドエラーでCI失敗

## 参照
- UI_DOM_RULES.md
```

#### レビュー観点
- [ ] CI設定が正しいか？（workflow構文エラーなし）
- [ ] 必須チェック3項目が含まれているか？
- [ ] monorepoの場合、workspace構成が正しいか？

---

### **PR #3: MyASP埋め込み実装（iframe方式）**

#### ブランチ名
```
feature/billing-myasp-embed-iframe
```

#### 変更内容
- ✅ `/billing/subscribe` ページ追加（iframe方式）
- ✅ `/billing/return` ページ追加（受け皿のみ）
- ✅ MyASP側サンクスURL設定手順（コメント）

#### PRタイトル
```
feat: MyASP課金連携（iframe埋め込み）を追加
```

#### PR説明
```markdown
## 目的
MyASP課金フォームをiframe方式で埋め込み（DOM事故ゼロ）

## 変更内容
- /billing/subscribe: iframeでMyASPフォームを表示
- /billing/return: 決済完了後の受け皿（plan/status反映確認）

## 動作確認
- [ ] スマホ表示確認（iPhone / Android）
- [ ] 決済完了後に /billing/return にリダイレクト
- [ ] /billing/return で plan/status が反映される（30秒以内）
- [ ] CSS衝突がない（アプリのスタイルが崩れない）

## 参照
- EMBED_INTEGRATION_POLICY.md
- MYASP_INTEGRATION_SPEC.md
```

#### レビュー観点
- [ ] iframe方式で実装されているか？（JSタグ注入ではない）
- [ ] サンクスURLはMyASP側で管理されているか？
- [ ] `/billing/return` は表示だけか？（データ同期は別API）
- [ ] スマホ表示が崩れていないか？

---

## 📋 ファイル内容

### 1. `docs/UI_DOM_RULES.md`

```markdown
# UI DOM Rules（DOM構造事故を防ぐ固定ルール）

Version: v1.0
Status: FIXED (P0)
Owner: Frontend Lead
Last Updated: 2026-01-01

## 目的
DOM構造事故（閉じタグ欠落、条件分岐ネスト崩壊、タブの責務混在、意図しない再レンダリング）を
「レビューで頑張る」ではなく「起こせなくする」ための固定ルール。

本ルールは、PWA/スマホ前提・今後の機能追加（Cards増加、埋め込み、SuperAdmin、チーム機能）に耐えるために必須。

## 適用範囲
- frontend/src/components/**
- frontend/src/pages/**
- ChatLayout / ChatPane / CardsPane を含む主要UI

## ルール（P0：必ず守る）

### Rule 1: タブの責務は「表示切替のみ」
- Tabsは「表示切替」だけを行う
- データ取得・状態更新・副作用は Tab 内で持たない（親/専用Hookに集約）
- Mobileタブは render関数1つに集約（switchで返すだけ）

### Rule 2: レイアウト境界を固定する（3カラムDOMは変えない）
- ChatLayoutの3カラム（Threads/Chat/Cards）DOM構造は固定
- 子要素は slot 的に差し込む（DOMの入れ子構造を変えない）
- 右ペインのCardsは「データがある時だけ表示」のルールを維持する

### Rule 3: dangerouslySetInnerHTML 原則禁止
- 原則禁止（レビュー例外はセキュリティ承認必須）
- 外部HTMLを見せたい場合は iframe か、サーバ側で安全なHTMLに変換して表示

### Rule 4: 外部サービス埋め込みは "隔離"
- 外部スクリプト（jQuery含む）を Reactツリー直下に注入しない
- 原則：iframe方式
- 次点：専用コンポーネント（mount/unmountで完全cleanup）で隔離

### Rule 5: カード表示は「データがある時だけ」
- always visible禁止
- Chatの操作がトリガーで初めて出る（既存思想を維持）

### Rule 6: JSXのネスト深度を制限する
- JSXネストは最大3階層を推奨（分岐は関数に切り出す）
- "条件分岐 inside return" を増やしすぎない（事故ポイント）
- Fragment乱用はOKだが「構造が読めない状態」は禁止

## PRレビュー観点（必須）
- [ ] Tabが副作用を持っていないか？
- [ ] ChatLayoutのDOM境界を崩していないか？
- [ ] 外部埋め込みを Reactツリー内で直接注入していないか？
- [ ] dangerouslySetInnerHTML を使っていないか？
- [ ] 条件分岐ネストが深くなっていないか？
- [ ] "スマホで見える位置"に重要な状態/確認が出るか？

## 事故時の復旧手順
- 画面が白：ErrorBoundaryのメッセージ表示を優先し、localStorageクリア導線を用意
- DOMが崩れる：直近PRのUI差分を最小化して戻す（境界固定に戻す）
- 埋め込み事故：iframeに戻して隔離する（最短復旧）

END
```

---

### 2. `docs/EMBED_INTEGRATION_POLICY.md`

```markdown
# Embed Integration Policy（外部サービス埋め込みの隔離方針）

Version: v1.0
Status: FIXED (P0)
Owner: Frontend Lead
Last Updated: 2026-01-01

## 目的
外部サービス（MyASPなど）の埋め込みで
- DOM崩壊
- CSS衝突
- jQuery混入によるReact破壊
- スマホ白画面
を起こさないための固定方針。

## 適用範囲
- MyASP 登録フォーム / 決済フォーム
- サンクス計測タグ
- 外部スクリプト挿入を伴う全機能

## 方針（P0）

### 原則：iframe方式（推奨）
- DOM事故ゼロ、CSS衝突ゼロ、Reactツリー破壊ゼロ
- "アプリ内でやってるように見せる"は、周囲のUIで演出する（ヘッダ/余白/背景/カード）

#### 画面
- /billing/subscribe : iframeでMyASPフォームを表示
- /billing/return : MyASPサンクスの戻り先（受け皿）

### サンクスURLの真実は MyASP
- サンクス（完了遷移）はMyASP側で設定する
- tomonowa側は受け皿 /billing/return を持つだけ
- アプリ側でサンクスURLを二重管理しない（負債）

### /billing/return の役割（受け皿）
- 「決済完了。反映を確認中…」を表示
- GET /api/billing/me を短時間ポーリングして plan/status を反映
- 反映後に /dashboard などへ誘導

## 非推奨：JSタグ注入方式（やるなら隔離）
MyASPのJSタグは jQuery を含む場合があるため、Reactと衝突しやすい。
採用する場合は、必ず専用コンポーネントで隔離し、cleanupを徹底する。

### 禁止事項
- Reactツリー直下に script を生で追加
- windowグローバルを書き換えるスクリプトの放置
- cleanup無し（メモリリーク・2重読み込み）

## セキュリティ
- iframeは必要に応じて sandbox を検討（ただしMyASPフォーム動作に影響が出るので事前検証）
- CSPは段階的導入（最初はログ/監査優先）

END
```

---

### 3. `docs/DEVELOPMENT_ROADMAP.md` への追記

**追記位置**: 「## 7. リスクと対策」の前に新規セクションを追加

```markdown
---

## 6.5. P0非機能要件（DOM事故・埋め込み・CI）

### 目的
**DOM構造事故・外部サービス埋め込み事故・ビルド事故を「起こせなくする」** ための仕組み化。

後から直すのではなく、**最初から事故を防ぐガードレール**を入れる。

---

### Epic 6.5-1: UI DOM Rules（固定ルール）

**優先度**: P0（最優先）  
**工数**: 0.5日（ドキュメント確認 + ルール適用）

#### タスク
- [ ] `UI_DOM_RULES.md` を全員で確認
- [ ] 固定ルール6項目の適用
  1. タブの責務は「表示切替のみ」
  2. レイアウト境界を固定（3カラムDOM）
  3. `dangerouslySetInnerHTML` は原則禁止
  4. 外部スクリプトは iframe で隔離
  5. カードの表示条件を固定
  6. Fragment多用の禁止（最大3階層）

#### DoD
- [ ] UI_DOM_RULES.md を全員が読了
- [ ] レビュー観点をPRテンプレートに追加
- [ ] 既存コードで違反箇所がないか確認

---

### Epic 6.5-2: Embed Integration Policy（外部サービス埋め込み隔離）

**優先度**: P0（最優先）  
**工数**: 1-2日（MyASP埋め込み実装時）

#### タスク
- [ ] `EMBED_INTEGRATION_POLICY.md` を確認
- [ ] MyASP埋め込み方式を決定
  - **推奨**: iframe方式（DOM事故ゼロ）
  - **次点**: JSタグ注入（専用コンポーネントで隔離）
- [ ] `/billing/subscribe` 実装（iframe or JSタグ）
- [ ] `/billing/return` 実装（受け皿のみ）
- [ ] サンクスURL設定（MyASP側のみ）

#### 固定方針
- **MyASP埋め込みは iframe をデフォルト（JS注入は例外対応）**

#### DoD
- [ ] 決済完了後に `/billing/return` にリダイレクト
- [ ] `/billing/return` で plan/status が反映される（30秒以内）
- [ ] CSS衝突がない（アプリのスタイルが崩れない）
- [ ] スマホ表示確認（iPhone / Android）

---

### Epic 6.5-3: CI（lint/build自動チェック）

**優先度**: P0（最優先）  
**工数**: 0.5日（GitHub Actions設定）

#### タスク
- [ ] GitHub Actions設定（`.github/workflows/ci.yml`）
- [ ] 必須チェック3項目
  1. TypeScript型チェック（`tsc -b`）
  2. ESLint（`eslint src/`）
  3. Vite Build（`vite build`）
- [ ] PR作成時に自動実行
- [ ] main merge時に自動実行

#### DoD
- [ ] PR作成時にCIが自動実行される
- [ ] 型エラー・lint警告・ビルドエラーで CI失敗
- [ ] CI失敗時はmerge不可

---

### 重要：本体未完成でも負債にならない設計

**今回のスコープ（P0非機能要件）**:
- ✅ DOM事故を「起こせなくする」ルール化
- ✅ 外部サービス埋め込みの隔離方針
- ✅ CI自動チェック（lint/build）

**将来の拡張（Phase Next-12以降）**:
- Bundle Size チェック
- 未使用コンポーネント検出
- E2Eテスト自動化

---
```

---

### 4. `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [ "main" ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install
        run: npm ci

      - name: Typecheck (frontend)
        run: npm run -w frontend build --if-present

      - name: Typecheck (api)
        run: npm run -w apps/api build --if-present

      - name: Lint (frontend)
        run: npm run -w frontend lint --if-present

      - name: Lint (api)
        run: npm run -w apps/api lint --if-present
```

**注意**: monorepo の npm workspace 構成が違う場合は、`npm run -w` の部分を調整してください。

---

## ✅ 完了条件（DoD）

### Phase 1: ルール導入
- [ ] `UI_DOM_RULES.md` がdocsに追加された
- [ ] `EMBED_INTEGRATION_POLICY.md` がdocsに追加された
- [ ] `DEVELOPMENT_ROADMAP.md` にP0非機能要件が追記された
- [ ] 開発チーム全員がドキュメントを読了した

### Phase 2: CI導入
- [ ] `.github/workflows/ci.yml` が追加された
- [ ] PR作成時にCIが自動実行される
- [ ] 型エラー・lint警告・ビルドエラーでCI失敗する

### Phase 3: MyASP埋め込み実装
- [ ] `/billing/subscribe` が実装された（iframe方式）
- [ ] `/billing/return` が実装された（受け皿のみ）
- [ ] MyASP側にサンクスURL設定された
- [ ] スマホ表示確認完了（iPhone / Android）

---

## 🚨 トラブルシューティング

### CI失敗: TypeScript型エラー
**対処**: `tsc -b` を手元で実行し、型エラーを修正

### CI失敗: ESLint警告
**対処**: `npm run lint` を手元で実行し、警告を修正

### CI失敗: ビルドエラー
**対処**: `npm run build` を手元で実行し、ビルドエラーを修正

### MyASP埋め込みでスタイル崩壊
**対処**: iframe方式に切替（JSタグ注入はCSS衝突リスク高）

---

## 📚 参照文書

- [UI_DOM_RULES.md](./UI_DOM_RULES.md): DOM構造事故を防ぐルール
- [EMBED_INTEGRATION_POLICY.md](./EMBED_INTEGRATION_POLICY.md): 外部サービス埋め込み方針
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md): P0非機能要件
- [MYASP_INTEGRATION_SPEC.md](./MYASP_INTEGRATION_SPEC.md): MyASP課金連携 実装仕様
- [CHAT_DATA_CONTRACT.md](./CHAT_DATA_CONTRACT.md): チャットデータ契約

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（実装ガイド） | 開発チーム |

---

**END OF GUIDE**
