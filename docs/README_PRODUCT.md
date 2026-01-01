# README_PRODUCT.md

**tomonowa プロダクト開発ガイド - 開発チーム向け入口**

---

## 📋 このドキュメントの目的

- **開発チームが迷わず開発を進めるための"唯一の入口"**
- 全ドキュメントへの導線と絶対に守るべきルールを明示
- 技術負債を貯めないための運用方針を固定

---

## 🎯 最初に読むべき5つの文書

### 1. **PRODUCT_VISION_OS.md** (v1.2-final)
**プロダクトの最終像と原則**
- 距離感（external/work/team/family）
- Link（予約モード/投票モード）
- 1対N調整の成立条件
- 誘われた側UX
- 管理者（admin/superadmin）

👉 **変更時は必ず影響範囲を列挙**

---

### 2. **DEVELOPMENT_ROADMAP.md** (v1.0)
**審査待ち期間の開発計画**
- Phase Next-8：関係性OS + 台帳OS
- Phase Next-9：AIが事情を把握する土台
- Next-7：Calendar Sync（審査完了後）
- 10,000人耐性の設計原則

👉 **このロードマップが現在の開発計画の正**

---

### 3. **CHAT_DATA_CONTRACT.md** (v1.0)
**チャットデータ契約（増えても壊れない設計）**
- cursor pagination固定（offset禁止）
- DOM描画上限200件
- localStorageリングバッファ（50件×10スレッド）
- debounce 500ms
- 自動OFF（3連続失敗）

👉 **この契約を破るとスマホで白画面事故が起きる**

---

### 4. **LOGGING_AND_RETENTION.md** (v1.0)
**ログ分離とRetention方針**
- chat_messages（UI表示用）
- audit_logs（監査用・長期保持）
- jobs（非同期処理ログ）
- cursor pagination固定
- 集計テーブル方式

👉 **ログ肥大化でパフォーマンス劣化を防ぐ**

---

### 5. **RELATIONSHIP_POLICY.md**
**距離感と同意の詳細仕様**
- 昇格の原則（自動禁止）
- 同意の種類（ConsentA/B/C/D）
- 監査ログ必須
- externalの安全ガード

👉 **勝手に昇格させると事故る**

---

## 🚫 絶対に守る10のルール（後戻り防止）

### 1. 決めないと作れないものを先にDecision Logに固定
- 例：Relationship昇格の同意粒度、Linkモード、Scheduleの状態遷移、Participantsの正規化
- **決めずに実装を始めると後から必ず破綻する**

### 2. 境界（Boundary）を切って審査依存を隔離
- Google同期は `CalendarSyncProvider` のインターフェースで固定
- 審査前は `ManualFallbackProvider`（手動登録セット返す）
- 審査後に `GoogleCalendarProvider` を差し替える
- **審査待ちでも前進できて、後戻りしない**

### 3. DBは「正規化＋インデックス＋cursor paging」を初期から固定
- **offset paging禁止**（1万人で死ぬ）
- `user_id`（tenant）スコープを必ず入れる
- 必須インデックスを先に決める（後から直すのは地獄）

### 4. 書き込みは "confirm intent only" を永久ルール化
- どの機能も **propose → confirm → execute**
- **"勝手に送らない/勝手に登録しない"を最初から壊さない**

### 5. データ肥大は前提：ログと要約のパイプラインを早期に作る
- 会話ログは全量保持ではなく
  - 最新N件表示＋アーカイブ
  - 要約（RAG）＋索引
- **1対Nはやり取り爆増するのでここは必須**

### 6. スマホを正（カードは補助）
- 重要提案/通知は **チャット上部バナーで必ず見える**
- **「カードにしか出ない」は禁止**

### 7. Feature Flagを"必ず"入れてロールバック可能にする
- 例：`FEATURE_CALENDAR_SYNC_ENABLED`
- 例：`FEATURE_TTS_ENABLED`（将来削除前提）
- **後戻りしない＝いつでも安全に止められる**

### 8. 実行ログ（Audit）は全実行に必須
- consent取得/撤回、確定、通知生成、同期、APIキー操作
- **後から監査入れるのは負債**

### 9. 仕様変更はPRで差分と影響範囲を書かないとマージ禁止
- 用語定義（0章）／距離感（Relationship）／誘われた側UXは変更に影響が大きい
- 必ず「影響範囲」「移行」「ロールバック」まで書く

### 10. "仮実装のまま放置禁止"の期限を決める
- 例：localStorage永続化は暫定なら「期限と移行先（Zustand persist等）」をDecision Logに書く
- **期限無しの暫定＝負債化**

---

## 📚 全ドキュメント一覧

### プロダクトビジョン（最優先）
- ✅ `PRODUCT_VISION_OS.md` - 最終像と原則（v1.2-final）
- ✅ `BILLING_AND_LIMITS.md` - プラン別制限
- ✅ `RELATIONSHIP_POLICY.md` - 距離感と同意の詳細
- ✅ `INVITEE_UX_SPEC.md` - 誘われた側UX仕様
- ✅ `SUPERADMIN_SPEC.md` - 運営者向け管理仕様

### 開発計画（現在地）
- ✅ `DEVELOPMENT_ROADMAP.md` - 審査待ち期間の開発計画（v1.0）
- ✅ `CHAT_DATA_CONTRACT.md` - チャットデータ契約（v1.0）
- ✅ `LOGGING_AND_RETENTION.md` - ログ分離とRetention（v1.0）

### 技術仕様
- `DATABASE_SCHEMA.md` - DBスキーマ
- `API_SPECIFICATION.md` - API仕様
- `SYNC_RUNBOOK.md` - カレンダー同期設計（審査待ち）
- `SYNC_API_SPEC.md` - 同期API仕様
- `NEXT7_REVIEW_CHECKLIST.md` - Next-7 チェックリスト
- `ARCHITECTURE.md` - アーキテクチャ概要

### フェーズ完了レポート
- `PHASE_NEXT6_COMPLETE.md` - Next-6 完了レポート
- `PHASE_NEXT6_DAY1_SUMMARY.md` - Day1 完了
- `PHASE_NEXT6_DAY1.5_COMPLETE.md` - Day1.5 完了
- `PHASE_NEXT6_DAY2_COMPLETE.md` - Day2 完了
- `PHASE_NEXT6_DAY3_COMPLETE.md` - Day3 完了

### 開発状況
- `OAUTH_REVIEW_SUMMARY.md` - OAuth審査状況
- `CURRENT_IMPLEMENTATION_STATUS.md` - 現在の実装状況
- `DEVELOPMENT_STATUS.md` - 開発ステータス

### 専門領域
- `CONTACTS_SPEC.md` - 顧客台帳仕様
- `LISTS_SPEC.md` - リスト仕様
- `ATTENDANCE_EVAL_ENGINE.md` - 成立条件評価エンジン
- `ATTENDANCE_RULE_SCHEMA.md` - 成立条件スキーマ
- `INTENT_TO_ATTENDANCE_RULE.md` - Intent→成立条件マッピング

---

## 🔧 開発環境セットアップ

### 前提
- Node.js 18+
- PostgreSQL 14+
- Cloudflare Wrangler CLI

### セットアップ手順

```bash
# 1. リポジトリクローン
git clone https://github.com/matiuskuma2/tomoniwaproject.git
cd tomoniwaproject

# 2. 依存関係インストール
cd frontend && npm install
cd ../apps/api && npm install

# 3. 環境変数設定
cp .env.example .env
# .envファイルを編集してDBやAPIキーを設定

# 4. DB migration
cd apps/api
npm run migrate

# 5. 開発サーバー起動
# Frontend
cd frontend && npm run dev

# Backend
cd apps/api && npm run dev
```

---

## 🧪 テストとデプロイ

### ローカルテスト
```bash
# Frontend
cd frontend && npm run test

# Backend
cd apps/api && npm run test
```

### デプロイ（Production）
```bash
# Frontend（Cloudflare Pages）
cd frontend && npm run deploy

# Backend（要確認）
cd apps/api && npm run deploy
```

---

## 🚀 Phase Next-8 開始前のチェックリスト

### 必須確認事項（Decision Log）

- [ ] **1. relationships/consents/audit_logs のテーブル名/key確定**
  - 現状：`DEVELOPMENT_ROADMAP.md` で確定済み
  - 確認：DB migration準備OK

- [ ] **2. schedule_participants の導入タイミング**
  - 推奨：Next-8 Day2で実施
  - 確認：移行スクリプト準備

- [ ] **3. 1対N成立条件のJSON定義（3種類）**
  - 必須：all_required / min_attendees / keyman_required
  - 確認：DB構造とAPI I/F確定

- [ ] **4. スマホ状態バナーのUI仕様（チャット上部）**
  - 必須：何をいつ出すか
  - 確認：デザイン/実装方針確定

---

## 📞 サポートと質問

### ドキュメントで解決しない場合
1. まず関連ドキュメントを確認
2. Decision Logに記載があるか確認
3. チーム内で確認（Slack等）

### 仕様変更が必要な場合
1. 影響範囲を列挙
2. PRで差分を提出
3. レビュー承認後にマージ

---

## 🔄 このドキュメントの更新ルール

- 新しい重要文書が追加されたら、このREADMEに追加する
- 絶対ルールが追加/変更されたら、影響範囲を明記する
- 開発フェーズが進んだら、チェックリストを更新する

---

## 📌 クイックリンク

| カテゴリ | ドキュメント | 用途 |
|---------|------------|------|
| **最優先** | `PRODUCT_VISION_OS.md` | プロダクトの最終像 |
| **現在地** | `DEVELOPMENT_ROADMAP.md` | 今やるべきこと |
| **データ契約** | `CHAT_DATA_CONTRACT.md` | 増えても壊れない設計 |
| **ログ分離** | `LOGGING_AND_RETENTION.md` | 1万人耐性の土台 |
| **距離感** | `RELATIONSHIP_POLICY.md` | 勝手に昇格させない |
| **誘われた側** | `INVITEE_UX_SPEC.md` | 破綻しないUX |
| **管理者** | `SUPERADMIN_SPEC.md` | 運営の土台 |
| **制限** | `BILLING_AND_LIMITS.md` | プラン別entitlements |

---

## 🎉 開発を始める前に

1. ✅ この README_PRODUCT.md を読んだ
2. ✅ PRODUCT_VISION_OS.md を読んだ
3. ✅ DEVELOPMENT_ROADMAP.md を読んだ
4. ✅ CHAT_DATA_CONTRACT.md を読んだ
5. ✅ LOGGING_AND_RETENTION.md を読んだ
6. ✅ 絶対に守る10のルールを理解した
7. ✅ 開発環境セットアップ完了
8. ✅ Phase Next-8 の Decision Log を確認した

**これで開発を開始する準備が整いました！🚀**

---

**最終更新**: 2026-01-01  
**バージョン**: v1.0  
**ステータス**: ✅ 確定

---

**END OF DOCUMENT**
