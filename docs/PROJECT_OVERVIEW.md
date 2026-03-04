# ToMoniWao - プロジェクト全体像・現在地・今後の計画

**最終更新**: 2026-02-23
**最新コミット**: 64f984e (main)
**フェーズ**: Phase 0B 完了 → Phase 1 実装中

---

## 1. プロジェクトの本質

Tomoniwa は単なるチャットツールや予約サービスではない。

> **人の接点 → 実行（招待・調整・確定）までを AI が完走する「秘書OS」**

コアアーキテクチャは3層構造:

```
① 人の取り込み（名刺OCR / CSV / テキスト → 連絡先DB）
         ↓
② 次のアクション判断（自然言語 → Intent分類 → 自動ルーティング）
         ↓
③ 実行エンジン（招待メール / 1対1調整 / 1対N調整 / 通知）
```

完成像:

```
ユーザー: 「この名刺の人たちと来週木金午後で調整して」
    ↓
AI: 名刺OCR → 連絡先作成 → 候補生成 → 招待送信 → 回答集約 → 確定 → Meet生成
    ↓
ユーザー: 何もしない。指示だけ。
```

---

## 2. 本番URL

| サービス | URL |
|----------|-----|
| **フロントエンド** | https://app.tomoniwao.jp |
| **API** | https://webapp.snsrilarc.workers.dev |
| **GitHub** | https://github.com/matiuskuma2/tomoniwaproject |

---

## 3. 現在の完成度（2026-02-23）

### 全体ステータス

| 領域 | 状態 | 備考 |
|------|------|------|
| 連絡先取り込み（テキスト/CSV/名刺OCR） | ✅ 完成 | PR-D シリーズ |
| 1対1 スケジュール（4モード） | ✅ 完成 | Fixed / Candidates3 / FreeBusy / Open Slots |
| 1対N スケジュール（API + Client） | ✅ 完成 | G1 シリーズ |
| 招待エンジン（メール送信） | ✅ 完成 | Beta A |
| Inbox通知 | ✅ 完成 | |
| 関係性管理（workmate） | ✅ 完成 | D0 |
| Pool Booking（受付予約） | ✅ 完成 | G2-A |
| CI / E2E | ✅ 全グリーン | Unit 354 + E2E 63 |
| Post-Import 自動接続（FE-5） | ✅ 完成 | 46d5a2f |
| 1対N チャット直接スケジューリング（FE-6） | ✅ 完成 | 6f926c2 |
| 逆アベイラビリティ（PR-B6） | 📋 計画済み | [計画書](./plans/PR-B6-REVERSE-AVAILABILITY.md) |
| FE-6b ホストカレンダー FreeBusy for 1-to-N | 📋 次タスク | |

### 進捗バー

```
全体完成度:
████████████████████░░  ~90%

残り: FE-6b（ホスト空き連携） / PR-B6（逆アベイラビリティ） / UX polish
```

---

## 4. システム構造

### 4.1 技術スタック

| レイヤー | 技術 |
|----------|------|
| **Frontend** | React SPA + TypeScript |
| **Backend** | Cloudflare Workers + Hono |
| **Database** | Cloudflare D1 (SQLite) |
| **Storage** | Cloudflare R2 |
| **Auth** | Google OAuth 2.0 |
| **Calendar** | Google Calendar API (FreeBusy + Events) |
| **Video** | Google Meet 自動生成 |
| **Email** | SendGrid |
| **CDN** | Cloudflare Pages |

### 4.2 Monorepo構造

```
tomoniwaproject/
├── apps/api/src/              # Backend (Cloudflare Workers + Hono)
│   ├── routes/                # 50+ APIルートファイル
│   ├── repositories/          # データアクセス層
│   └── middleware/            # 認証・テナント
├── frontend/src/              # Frontend (React SPA)
│   ├── core/                  # ビジネスロジック
│   │   ├── api/               # 19 APIクライアント
│   │   ├── chat/              # Chat Engine (下記詳細)
│   │   ├── auth/              # 認証
│   │   └── platform/          # ロガー等
│   └── components/            # UIコンポーネント
├── packages/shared/           # 共有型定義
├── db/migrations/             # 92 マイグレーション
└── docs/                      # 120+ ドキュメント
```

### 4.3 デプロイ構成

```
app.tomoniwao.jp/
├── /*                 → Cloudflare Pages (React SPA)
├── /api/*             → Cloudflare Workers (Backend API)
├── /auth/*            → Cloudflare Workers (OAuth)
├── /i/:token          → Cloudflare Workers (招待ページ)
└── /open/:token       → Cloudflare Workers (Open Slots ページ)
```

---

## 5. Backend API（主要ルート）

### 連絡先・取り込み

```
/api/contacts              # CRUD
/api/contact-import        # テキスト / CSV 取り込み
/api/business-cards        # 名刺OCR
```

### 1対1 スケジュール（4モード）

```
POST /api/one-on-one/fixed/prepare        # 確定日時
POST /api/one-on-one/candidates/prepare   # 候補3つ提示
POST /api/one-on-one/freebusy/prepare     # カレンダー空き自動検出
POST /api/one-on-one/open-slots/prepare   # 公開枠（相手が選ぶ）
```

### 1対N スケジュール

```
POST /api/one-to-many/prepare     # スレッド作成
POST /api/one-to-many/send        # 招待送信
POST /api/one-to-many/respond     # 相手が回答
GET  /api/one-to-many/summary     # 回答集計
POST /api/one-to-many/finalize    # 確定
POST /api/one-to-many/repropose   # 再提案
```

### Inbox・通知

```
GET  /api/inbox                    # 受信一覧
PATCH /api/inbox/:id/read          # 既読
POST /api/inbox/mark-all-read      # 全既読
GET  /api/inbox/unread-count       # 未読数
```

### 関係性

```
POST /api/relationships/block      # ブロック
GET  /api/relationships/blocked    # ブロック一覧
```

### Pool Booking

```
POST /api/pools                    # プール作成
POST /api/pools/:id/book           # 予約
POST /api/pools/:id/cancel         # キャンセル
GET  /api/pools/:id/slots          # 空き枠
```

### Open Slots（ゲストページ）

```
GET  /open/:token                  # 枠一覧表示
POST /open/:token/select           # 枠選択
GET  /open/:token/thank-you        # 完了画面
```

### その他

```
/api/calendar          # カレンダー統合
/api/lists             # リスト管理
/api/people            # 人物検索
/api/pending-actions   # 確認フロー
/api/nlRouter          # 自然言語ルーティング
/api/scheduling        # 内部スケジューリング
```

---

## 6. Frontend Chat Engine（コア設計）

### アーキテクチャ

```
ユーザー入力 (テキスト / 音声)
         ↓
┌─────────────────────────────────────────┐
│ Classifier Chain (13分類器、固定順序)         │
│                                          │
│  1. pendingDecision  (pending最優先)       │
│  2. contactImport    (連絡先取り込み)        │
│  3. confirmCancel    (はい/いいえ系)         │
│  4. lists            (リスト5コマンド)        │
│  5. calendar         (カレンダー読み取り)     │
│  6. preference       (好み設定)              │
│  7. oneToMany        (1対N, 2名以上) ★FE-6  │
│  8. oneOnOne         (1対1, 4モード)         │
│  9. propose          (候補提案)              │
│ 10. remind           (リマインド)            │
│ 11. relation         (関係性管理)            │
│ 12. pool             (Pool Booking)         │
│ 13. thread           (スレッド操作)           │
│                                          │
│  → unknown → nlRouter フォールバック        │
└─────────────────────────────────────────┘
         ↓ IntentResult
┌─────────────────────────────────────────┐
│ apiExecutor (switch dispatcher)          │
│ 63 case文 → 対応する executor を呼出      │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│ Executors (15ファイル + 5 shared)          │
│                                          │
│ calendar / list / thread / invite /      │
│ pending / autoPropose / remind / batch / │
│ oneOnOne / oneToMany / postImportBridge / │
│ contactImport / preference / pool系       │
└─────────────────────────────────────────┘
         ↓
    API Client (19ファイル)
         ↓
    Backend API
```

### Reducer

```
useChatReducer.ts (857行)

責務:
- pending 管理（confirm / cancel / expire）
- post-import next step ハンドリング（FE-5）
- message append / loading state
- executor result → UI state 変換
```

### APIクライアント (19ファイル)

```
calendar / chat / client / contacts / inbox / lists /
nlPrefs / nlRouter / oneToMany / pendingActions / people /
pools / relationships / schedulingInternal / threads /
usersMe / voice / workspaceNotifications / index
```

---

## 7. スケジューリングモード一覧

### 1対1（5モード: 4完成 + 1計画中）

| モード | Intent | 方向 | 状態 |
|--------|--------|------|------|
| **Fixed** | `schedule.1on1.fixed` | 主催者 → 確定日時通知 | ✅ |
| **Candidates3** | `schedule.1on1.candidates3` | 主催者の候補 → 相手が選ぶ | ✅ |
| **FreeBusy** | `schedule.1on1.freebusy` | 主催者カレンダー空き → 候補生成 → 相手が選ぶ | ✅ |
| **Open Slots** | `schedule.1on1.open_slots` | 主催者の空き枠公開 → 相手が選ぶ | ✅ |
| **Reverse Availability** | `schedule.1on1.reverse_availability` | 相手の空き → 相手が候補を出す → 主催者が合わせる | 📋 [PR-B6](./plans/PR-B6-REVERSE-AVAILABILITY.md) |

**デフォルトルーティング:**

```
制約なし            → Candidates3
制約あり（時間帯等）  → FreeBusy
明示的に「選んでもらう」 → Open Slots
明示的に「ご都合伺い」  → Reverse Availability (将来)
日時完全指定          → Fixed
```

### 1対N（2経路: 両方完成）

| 経路 | 説明 | 実装 |
|------|------|------|
| **Post-Import Bridge (FE-5)** | Contact Import後の自動接続。emails確定済み。 | `postImportBridge.ts` |
| **Chat Direct (FE-6)** | NL入力 → 名前解決 → constraints付き実行 | `classifier/oneToMany.ts` + `executors/oneToMany.ts` |

---

## 8. 連絡先取り込み → 実行の接続フロー

```
テキスト / CSV / 名刺OCR
         ↓
contact_import.preview  (プレビュー表示)
         ↓
person_select           (曖昧一致時)
         ↓
contact_import.confirm  (DB書き込み)
         ↓
post_import.next_step   (「招待？日程調整？保存のみ？」)
         ↓
┌────────────────────────────────────────────────────────┐
│ postImportBridge.ts (FE-5)                              │
│                                                         │
│  send_invite → executeInvitePrepareEmails               │
│  schedule (1名) → executeOneOnOneFreebusy                │
│  schedule (2名+) → oneToManyApi.prepare + send           │
│  message_only → 完了（DB保存のみ）                         │
└────────────────────────────────────────────────────────┘
```

設計思想（PRD v2.0 B-strategy）:

> **止めない。聞き直さない。再入力を求めない。**

---

## 9. テスト状況（2026-02-23）

### Unit Tests

```
フレームワーク: Vitest v4.0.17
テストファイル: 16
テスト数: 354
結果: 全パス ✅
TypeScript: エラーゼロ ✅
```

### E2E Tests

```
フレームワーク: Playwright
Specファイル: 32
結果: 全グリーン ✅（CI含む）
```

### 主要テストカバレッジ

| テスト対象 | テスト数 |
|-----------|---------|
| Intent分類回帰 | 42 |
| Intent分類ゴールデンファイル | 52 |
| リフレッシュマップ | 52 |
| Post-Import Next Step | 42 |
| チャンネル解決 | 25 |
| PostImportBridge | 20 |
| 連絡先解決 | 19 |
| OneToMany Classifier | 15 |
| Executor Refresh | 15 |
| 1対1回帰 | 13 |
| バッチ処理 | 12 |
| リマインド | 11 |
| OneToMany Executor | 10 |
| 名刺チャットUI | 9 |
| 名刺スキャン | 6 |
| 連絡先取込FE | 11 |

---

## 10. 技術負債

### 低リスク（運用に影響なし）

| ID | 内容 | 影響 |
|----|------|------|
| TD-1 | workspace_members テーブル未作成（`ws-default` ハードコード） | マルチテナント非対応。単一ワークスペースでは問題なし |
| TD-2 | ESLint 既知の警告 | 解消済み（CI green） |
| TD-3 | CSRF cookie 未実装 | SameSite=Lax + Bearer Token で軽減済み |
| TD-4 | multi-tenant 未整理 | Phase 2 以降の課題 |

### 重大な技術負債

**なし** — 現在の構造でスケール可能。

---

## 11. DBマイグレーション（92ファイル、主要抜粋）

| # | マイグレーション | 説明 |
|---|------------------|------|
| 0079 | create_chat_messages | チャットメッセージ |
| 0083 | create_open_slots | Open Slots テーブル |
| 0084 | add_workmate_relation_type | 関係性管理 |
| 0085 | add_scheduling_thread_kind | kind カラム（external/internal） |
| 0086 | add_one_to_many_support | topology, group_policy, thread_responses |
| 0088 | create_pool_booking | Pool Booking基本テーブル |
| 0090 | create_blocks_and_pool_public_links | ブロック+公開リンク |
| 0091 | create_contact_import_tokens | 連絡先インポートトークン |
| 0092 | extend_pending_actions | Contact Import用 pending拡張 |

---

## 12. 運用インシデントリスク

| リスク | 対策 | 状態 |
|--------|------|------|
| メール誤送信（不可逆） | send_invite は confirm → execute の2段階 | ✅ 実装済み |
| Google Calendar API failure | FreeBusy失敗 → Candidates3にフォールバック | ✅ 実装済み |
| Calendar未接続ユーザー | FreeBusy不可 → デフォルトスロット生成 | ✅ 実装済み |
| orphan thread（send失敗） | threadID返却 → チャットからリトライ可能 | ✅ 実装済み |
| 認証エラー | 401検出 → ログイン誘導メッセージ | ✅ 実装済み |

---

## 13. ロードマップ

```
2025-10        2025-12        2026-01        2026-02        2026-03        2026-04
   │              │              │              │              │              │
   ├── Phase 0A ──┤              │              │              │              │
   │  DB/Auth/    │              │              │              │              │
   │  Admin       │              │              │              │              │
   │              ├── Phase 0B ──┤              │              │              │
   │              │  Threads/    │              │              │              │
   │              │  Invite/     │              │              │              │
   │              │  Meet/SPA    │              │              │              │
   │              │              ├─── 1対1(4) ──┤              │              │
   │              │              │ Contact Import│              │              │
   │              │              │ Pool Booking  │              │              │
   │              │              │ Relationships │              │              │
   │              │              │              ├── FE-5/FE-6 ─┤              │
   │              │              │              │ Post-Import   │              │
   │              │              │              │ 1toN Chat     │              │
   │              │              │              │ CI Green      │              │
   │              │              │              │              ├── Phase 1 ───┤
   │              │              │              │              │ FE-6b FreeBusy│
   │              │              │              │              │ PR-B6 Reverse │
   │              │              │              │              │ UX Polish     │
   │              │              │              │              │ PWA/Voice     │
   │              │              │              │              │              ├→ Phase 2
   │              │              │              │              │              │ AI Slot Gen
   │              │              │              │              │              │ N対N
```

### フェーズ詳細

| フェーズ | 期間 | 内容 | 状態 |
|----------|------|------|------|
| **Phase 0A** | ~2025-10 | D1/Auth/Admin | ✅ 完了 |
| **Phase 0B** | ~2025-12 | Threads/Invite/Meet/SPA | ✅ 完了 |
| **Phase 0B+** | 2026-01 | 1対1(4モード)/Contact Import/Pool/Relations | ✅ 完了 |
| **FE-5/FE-6** | 2026-02 | Post-Import接続/1対Nチャット直接/CI | ✅ 完了 |
| **Phase 1** | 2026-03~04 | FE-6b/PR-B6/PWA/Voice/UX | 🔄 次 |
| **Phase 2** | 2026-04~06 | AI Slot生成/OCR高度化/N対N | 📋 計画 |
| **Phase 3** | 2026-07~09 | ネイティブアプリ (iOS/Android) | 📋 計画 |

---

## 14. 直近の実装計画

### 14.1 FE-6b: ホストカレンダー FreeBusy for 1-to-N

**課題**: 現在1対N調整のデフォルトスロットは固定（次5営業日 × 10:00, 14:00, 16:00）。
主催者のカレンダー空きを反映していない。

**対応**: `generateDefaultSlots()` を拡張し、主催者のFreeBusy APIを呼び出して
実際の空き時間からスロットを生成する。

**見積り**: ~4h

### 14.2 PR-B6: 逆アベイラビリティ（ご都合伺いモード）

**課題**: 目上の人への「空き日を選んでください」は失礼。
逆に「ご都合の良い日をお知らせください」というフローが必要。

**フロー**:
1. 主催者がチャットで「佐藤部長のご都合を伺いたい」
2. 相手にカレンダー認証リンクをメール送信
3. 相手がカレンダー認証 → 自分の空きから候補2-3つを選択
4. 候補が主催者のチャットに届く
5. 主催者が番号選択で確定 → Meet + Calendar

**見積り**: ~20h（[詳細計画書](./plans/PR-B6-REVERSE-AVAILABILITY.md)）

### 14.3 UX Polish

- チャットUI改善
- エラーメッセージの統一
- モード選択UIの追加

---

## 15. コスト構造

### Cloudflare無料枠

| サービス | 制限 | 十分性 |
|---------|------|--------|
| Workers | 100,000 req/day | ✅ |
| Pages | 無制限デプロイ | ✅ |
| D1 | 5GB / 5M reads/day | ✅ |
| KV | 100,000 reads/day | ✅ |
| R2 | 10GB | ✅ |

### 外部サービス

| サービス | 用途 | コスト |
|---------|------|--------|
| Google Cloud | OAuth + Calendar API | 無料枠内 |
| SendGrid | メール送信 | 100通/日 無料 |

→ **月間数千ユーザーまで無料で運用可能**

---

## 16. セキュリティ

| 項目 | 対策 |
|------|------|
| 認証 | Google OAuth 2.0 (openid, email, profile, calendar.events) |
| セッション | D1 + Cookie (HttpOnly, Secure, SameSite=Lax) + Bearer Token |
| トークン保管 | Google refresh_token 暗号化保存 |
| アクセス制御 | ユーザーは自分のデータのみ |
| Rate Limiting | Cloudflare KV (IP/User ベース) |
| メール送信 | 2段階確認（confirm → execute） |
| FreeBusy | busy/free のみ取得（予定内容は非参照） |

---

## 17. git コミット履歴（直近）

```
64f984e docs(PR-B6): Reverse Availability plan
6f926c2 feat(FE-6): 1-to-N chat-direct scheduling
46d5a2f feat(FE-5): post-import auto-connect bridge
986a73b docs: FE-5 PRD v2.0 — B strategy
b5ce1f8 fix: wire open_slots intent to apiExecutor (#FE-4.5)
9d67e3b docs: 包括アーキテクチャ&ステータスレポート 2026-02-17
df5cead fix: E2E Smoke CI green (#122)
9a63ebd fix: ESLint known failures (#121)
```

---

## 18. 関連ドキュメント

### 設計・仕様

| ドキュメント | 概要 |
|-------------|------|
| [CURRENT_STATUS.md](./CURRENT_STATUS.md) | 実装状況詳細（テスト結果、タスク完了状況） |
| [ARCHITECTURE_OVERVIEW_2026_02.md](./ARCHITECTURE_OVERVIEW_2026_02.md) | アーキテクチャ概要 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | DB スキーマ |
| [MIGRATION_HISTORY.md](./MIGRATION_HISTORY.md) | マイグレーション履歴 |
| [SCHEDULING_COVERAGE_MATRIX.md](./SCHEDULING_COVERAGE_MATRIX.md) | スケジューリング網羅マトリクス |
| [SCHEDULING_RULES.md](./SCHEDULING_RULES.md) | 調整ロジック定義 |

### 計画書

| ドキュメント | 概要 |
|-------------|------|
| [PR-B6-REVERSE-AVAILABILITY.md](./plans/PR-B6-REVERSE-AVAILABILITY.md) | 逆アベイラビリティ計画 |
| [PR-B4.md](./plans/PR-B4.md) | Open Slots 計画 |
| [G1-PLAN.md](./plans/G1-PLAN.md) | 1対N 計画 |
| [R1-PLAN.md](./plans/R1-PLAN.md) | 内部スケジューリング計画 |

### PRD

| ドキュメント | 概要 |
|-------------|------|
| [PRD-FE-5-post-import-auto-connect.md](./PRD-FE-5-post-import-auto-connect.md) | Post-Import 自動接続 PRD |

---

## 19. 開発者情報

- **開発者**: モギモギ（関屋紘之）
- **居住地**: ドバイ
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject
- **X**: @aitanoshimu

---

*このドキュメントはプロジェクトの主要な変更時に更新されます。*
*前回更新: 2026-02-23 (FE-5/FE-6完了、PR-B6計画追加)*
