# ToMoniWao - 次のステップ

**作成日**: 2025-12-28  
**現在の状態**: Phase 0B（MVP） - 85%完了

---

## 🎯 現在の状況

### ✅ 完了済み
- **Backend**: Cloudflare Workers（API完成）
- **Frontend**: React SPA（Pages デプロイ済み）
- **Database**: D1（40マイグレーション完了）
- **Infrastructure**: Monorepo構成、GitHub統合
- **Documentation**: 全体計画・アーキテクチャ文書化

### ⏳ 残作業（15%）
- **Cloudflare設定**: カスタムドメイン、Workers Routes、Google OAuth URI
- **本番E2Eテスト**: 全機能動作確認
- **バグ修正**: エラーメッセージ日本語化等

---

## 🚀 次にやるべきこと（優先度順）

### 1. Cloudflare Dashboard 設定（最優先）⚡

#### 1-1. カスタムドメイン設定
1. https://dash.cloudflare.com にログイン
2. **Workers & Pages** → **Pages タブ** → **webapp** をクリック
3. **Custom domains** タブ → **Set up a custom domain** をクリック
4. `app.tomoniwao.jp` を入力 → **Continue**
5. DNS設定が自動追加される（CNAME: `app` → `webapp-6t3.pages.dev`）
6. SSL証明書発行を待つ（数分）
7. **確認**: `https://app.tomoniwao.jp` にアクセス → React SPAが表示

#### 1-2. Workers Routes 設定
1. **Workers & Pages** → **Overview タブ** → **webapp**（Workers） をクリック
2. **Settings** タブ → **Triggers** → **Routes** セクション
3. **Add route** を3回クリックして以下を追加:
   - Route: `app.tomoniwao.jp/api/*` | Zone: `tomoniwao.jp` | Env: `Production`
   - Route: `app.tomoniwao.jp/auth/*` | Zone: `tomoniwao.jp` | Env: `Production`
   - Route: `app.tomoniwao.jp/i/*` | Zone: `tomoniwao.jp` | Env: `Production`
4. **確認**: `curl https://app.tomoniwao.jp/api/health` → `{"status":"ok"}`

#### 1-3. Google OAuth Redirect URI 更新
1. https://console.cloud.google.com にログイン
2. **APIs & Services** → **認証情報** → OAuth 2.0 Client IDを選択
3. **承認済みのリダイレクト URI** に追加:
   - `https://app.tomoniwao.jp/auth/google/callback`
4. **保存**

---

### 2. 本番E2Eテスト（2番目）🧪

#### テストシナリオ
1. **ログイン**
   - `https://app.tomoniwao.jp` にアクセス
   - 「Googleでログイン」クリック
   - Google OAuth → 許可
   - Dashboardが表示される ✅

2. **Thread作成 → 招待送信**
   - Dashboard → 「新規スレッド作成」
   - タイトル・説明入力
   - 連絡先から選択 or メールアドレス入力
   - 候補日時を2〜3個追加
   - 「招待送信」
   - 招待リンクが生成される ✅

3. **外部招待ページ動作確認**
   - 別のブラウザ（シークレットモード）で招待リンクにアクセス
   - `/i/:token` ページが表示される
   - 候補日時を選択
   - 「この日程で回答」クリック
   - 完了メッセージが表示される ✅

4. **確定 → Meet生成**
   - 元のブラウザに戻る
   - Thread Detail → 「進捗状況」で「承諾」を確認
   - 候補日時を選択
   - 「この日程で確定」クリック
   - Google Meet URLが表示される ✅
   - Meet URLをクリック → Google Meetが開く ✅

5. **Contacts CRUD**
   - Contacts → 「新規追加」
   - 名前・メールアドレス入力 → 保存
   - 一覧に表示される ✅
   - 編集・削除が動作する ✅

6. **Lists CRUD**
   - Lists → 「新規作成」
   - リスト名・説明入力 → 保存
   - 「メンバー確認」→ メンバー追加
   - 「一括招待」→ Thread作成 ✅

---

### 3. バグ修正・UI改善（3番目）🐛

#### 優先度高
- [ ] エラーメッセージ日本語化
- [ ] ローディング状態の改善
- [ ] レスポンシブ対応の最終確認

#### 優先度中
- [ ] Meet URLのカード表示
- [ ] Thread一覧の空状態メッセージ
- [ ] ステータス表示色の改善

#### 優先度低
- [ ] アニメーション追加
- [ ] ダークモード（Phase 1へ延期）

---

### 4. ユーザーテスト開始（4番目）👥

#### 準備
- [ ] テストユーザー10名を選定
- [ ] テストシナリオ作成
- [ ] フィードバックフォーム準備

#### 実施
- [ ] テストユーザーに招待送信
- [ ] 使用方法説明（簡単なドキュメント）
- [ ] フィードバック収集（1週間）

#### 分析
- [ ] バグレポート整理
- [ ] UI/UX改善点抽出
- [ ] 優先順位付け

---

## 📋 チェックリスト

### Cloudflare設定
- [ ] カスタムドメイン設定完了（app.tomoniwao.jp）
- [ ] SSL証明書発行完了
- [ ] Workers Route 1: `/api/*` 設定完了
- [ ] Workers Route 2: `/auth/*` 設定完了
- [ ] Workers Route 3: `/i/*` 設定完了
- [ ] Google OAuth Redirect URI更新完了

### 本番E2Eテスト
- [ ] ログイン成功
- [ ] Thread作成成功
- [ ] 招待リンク送信成功
- [ ] 外部招待ページ動作確認
- [ ] 候補選択成功
- [ ] 確定＋Meet生成成功
- [ ] Meet URL動作確認
- [ ] Contacts CRUD動作確認
- [ ] Lists CRUD動作確認

### バグ修正
- [ ] エラーメッセージ日本語化
- [ ] ローディング改善
- [ ] レスポンシブ対応確認

### ユーザーテスト
- [ ] テストユーザー10名選定
- [ ] テストシナリオ作成
- [ ] フィードバックフォーム準備
- [ ] テスト実施（1週間）
- [ ] フィードバック分析

---

## 🎯 Phase 0B完了条件

以下がすべて満たされたらPhase 0B完了：

1. ✅ Backend API実装完了
2. ✅ Frontend SPA実装完了
3. ✅ Monorepo統合完了
4. ✅ Cloudflare Pages デプロイ完了
5. ⏳ Cloudflare設定完了（カスタムドメイン、Routes）
6. ⏳ 本番E2Eテスト全通過
7. ⏳ 外部ユーザー10名でテスト成功
8. ⏳ 重大バグ: 0件

---

## 📊 進捗確認

### 現在の進捗: 85%
```
Phase 0B進捗
[████████████████████░░░░] 85%

完了: Backend, Frontend, Monorepo, Pages Deploy
残り: Cloudflare設定, 本番E2E, ユーザーテスト
```

### 次のマイルストーン
- **2026年1月**: Phase 0B完了
- **2026年1月**: Phase 1開始（音声入力）

---

## 📞 問い合わせ

- **開発者**: モギモギ（関屋紘之）
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject

---

## 📚 関連ドキュメント

### 全体計画
- [PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) - プロジェクト全体像
- [ROADMAP.md](docs/ROADMAP.md) - Phase 1-3ロードマップ

### 技術仕様
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - システムアーキテクチャ
- [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) - データベース設計
- [API_SPECIFICATION.md](docs/API_SPECIFICATION.md) - API仕様

### 開発管理
- [DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) - 開発進捗・差分
- [README_MONOREPO.md](README_MONOREPO.md) - Monorepo運用ガイド

---

**重要**: Cloudflare設定を完了したら、必ず本番E2Eテストを実施してください。全機能が正常に動作することを確認してから、ユーザーテストに進みましょう。

**Next Action**: Cloudflare Dashboard を開いて、カスタムドメイン設定から始めてください！🚀
