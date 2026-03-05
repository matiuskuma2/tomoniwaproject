# PR-B6 Phase 2 実装PRD：ゲストOAuth → FreeBusy自動取得

## ステータス: 📋 PRD確定（実装待ち）

> **起案日**: 2026-03-05
> **PRD確定日**: 2026-03-05
> **前提**: PR-B6 Phase 1 完了（commit `b847769`）
> **起案者**: モギモギ（関屋紘之）
> **優先度**: Phase 1-2（逆アベイラビリティ強化）
> **見積り**: DB 0.5h + API(OAuth) 3h + FreeBusy統合 1.5h + UI改修 2h + テスト 2h ≈ 9h
> **方針**: Google-only（A案）、`provider: 'google'` フィールドで将来Microsoft拡張に備える

---

## 1. 課題（なぜPhase 2が必要か）

### Phase 1の限界

Phase 1 の `/ra/:token` ページでは、ゲスト（目上の相手）が **2週間分の全スロット（平日09:00-18:00）から手動で2-3つ選ぶ** 必要がある。

**問題点:**
- ゲストの既存予定を考慮していないため、選んだ候補がゲスト自身のスケジュールと衝突する可能性
- ゲストは自分のカレンダーを別タブで確認しながら選ぶ → 手間
- 「秘書レベルの体験」には遠い

### Phase 2 で解決すること

> 「Googleカレンダーでログインいただければ、空いている時間帯だけを自動表示します。」

**ゲストがOAuth認証すると:**
1. Google Calendar FreeBusy APIでゲストのbusy期間を取得
2. busy期間を除外したスロットだけを表示
3. ゲストは「確実に空いている」候補だけから選べる

**認証しない/失敗した場合:**
→ Phase 1の手動選択にフォールバック（既存動作を完全に維持）

---

## 2. ユーザーフロー（確定版）

### 2.1 ゲストページ (`/ra/:token`) の新フロー

```
Step 0: ゲストがリンクをクリック → /ra/:token

Step 1: OAuth案内（新規）
  ┌─────────────────────────────────┐
  │  🗓 ○○さんからのご都合伺い      │
  │  「打ち合わせ（約60分）」        │
  │                                  │
  │  Googleカレンダーの空き時間を    │
  │  自動で表示できます（推奨）       │
  │                                  │
  │  [Googleカレンダーで確認]         │
  │                                  │
  │  スキップして手動で選ぶ →         │
  └─────────────────────────────────┘

Step 2a: OAuth成功 → 自動スロット表示
  ┌─────────────────────────────────┐
  │  ✅ カレンダーの空き時間を表示    │
  │                                  │
  │  3/10(月)                        │
  │  [10:00] [14:00] [16:00]         │ ← busy除外済み
  │                                  │
  │  3/11(火)                        │
  │  [09:00] [11:00]                 │ ← busy除外済み
  │  ...                             │
  └─────────────────────────────────┘

Step 2b: OAuthスキップ/失敗 → 手動選択（Phase 1フォールバック）
  ┌─────────────────────────────────┐
  │  📅 ご都合の良い日時を3つ        │
  │  お選びください                   │
  │                                  │
  │  3/10(月)                        │
  │  [09:00] [10:00] [11:00] ...     │ ← 全スロット表示
  │  ...                             │
  └─────────────────────────────────┘

Step 3: 候補選択 → 送信 → Thank you (Phase 1と同じ)
```

### 2.2 OAuth フロー詳細

```
1. ゲストが「Googleカレンダーで確認」をクリック
   → GET /ra/:token/oauth/start

2. Google OAuth consent画面
   scope: calendar.freebusy.readonly (最小権限)
   redirect_uri: APP_URL/ra/:token/oauth/callback

3. 認証成功
   → GET /ra/:token/oauth/callback?code=xxx&state=yyy
   → code を token に交換
   → FreeBusy取得
   → access_token を guest_google_tokens に保存
   → /ra/:token にリダイレクト（?oauth=done）

4. ゲストページが?oauth=doneを検知
   → DBからFreeBusy結果を取得
   → busy除外済みスロットを表示
```

### 2.3 セキュリティ設計

| 項目 | 設計 |
|------|------|
| OAuth scope | `https://www.googleapis.com/auth/calendar.freebusy` (読み取り専用、最小権限) |
| state パラメータ | CSRF防止、トークンとの紐付け |
| access_token 保管 | `guest_google_tokens` テーブルに保存、72時間で自動削除 |
| refresh_token | **取得しない**（`access_type=online`）。一時的なアクセスのみ |
| redirect_uri | `APP_URL/ra/:token/oauth/callback` （トークンごとに一意） |
| token暗号化 | 現時点ではplaintext保存（既存google_accountsと同様、将来暗号化対象） |

**重要**: ゲストのaccess_tokenは**1回限りのFreeBusy取得**のためだけに使用。refresh_tokenは保持しない。

---

## 3. 技術設計

### 3.1 DB マイグレーション (0094)

```sql
-- 0094_add_guest_oauth_for_reverse_availability.sql

-- ゲストOAuth一時トークン（RA用）
CREATE TABLE IF NOT EXISTS guest_google_tokens (
  id TEXT PRIMARY KEY,                       -- UUID
  reverse_availability_id TEXT NOT NULL,     -- FK: reverse_availability.id
  token TEXT NOT NULL,                       -- RA token（/ra/:token と同じ）

  -- Google OAuth
  provider TEXT NOT NULL DEFAULT 'google',   -- 将来: 'microsoft' 追加用
  google_email TEXT,                         -- 認証したGoogleアカウントのメール
  access_token TEXT,                         -- OAuth access_token（一時的）
  token_expires_at TEXT,                     -- access_token の有効期限

  -- FreeBusy結果キャッシュ
  freebusy_result TEXT,                      -- JSON: FreeBusy結果（busy期間配列）
  freebusy_fetched_at TEXT,                  -- FreeBusy取得日時
  available_slots_json TEXT,                 -- JSON: 計算済み空きスロット（busy除外済み）

  -- 状態
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authenticated', 'freebusy_fetched', 'error', 'expired')),
  error_message TEXT,                        -- エラー時のメッセージ

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (reverse_availability_id) REFERENCES reverse_availability(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ggt_ra_id ON guest_google_tokens(reverse_availability_id);
CREATE INDEX IF NOT EXISTS idx_ggt_token ON guest_google_tokens(token);
CREATE INDEX IF NOT EXISTS idx_ggt_status ON guest_google_tokens(status);

-- reverse_availability テーブルに guest_oauth_status カラム追加
ALTER TABLE reverse_availability ADD COLUMN guest_oauth_status TEXT DEFAULT NULL;
-- NULL = Phase1互換（OAuth未使用）
-- 'offered' = OAuth案内表示済み
-- 'authenticated' = OAuth成功
-- 'skipped' = ゲストがスキップ
-- 'error' = OAuth失敗→フォールバック
```

### 3.2 API 設計

#### 3.2.1 GET /ra/:token/oauth/start — OAuth開始

ゲストがOAuth認証を開始する。

```
Input: なし（:tokenから RA 特定）
Processing:
  1. RA取得 + status='pending' チェック
  2. Google OAuth URL生成
     - scope: calendar.freebusy (readonly)
     - redirect_uri: APP_URL/ra/{token}/oauth/callback
     - state: ランダム文字列（CSRF防止、cookieにも保存）
     - access_type: online（refresh_token不要）
     - prompt: consent
  3. guest_google_tokens レコード作成（status='pending'）
  4. リダイレクト → Google consent画面
```

#### 3.2.2 GET /ra/:token/oauth/callback — OAuthコールバック

Google認証完了後のコールバック。

```
Input: ?code=xxx&state=yyy
Processing:
  1. state検証（CSRF防止）
  2. code → access_token 交換
  3. access_tokenでFreeBusy取得
     - timeMin: RA.time_min
     - timeMax: RA.time_max
  4. busy除外スロット計算（既存slotGenerator再利用）
  5. guest_google_tokens更新
     - access_token保存
     - freebusy_result（JSON）保存
     - available_slots_json（計算済み空きスロット）保存
     - status='freebusy_fetched'
  6. RA.guest_oauth_status='authenticated'
  7. リダイレクト → /ra/:token?oauth=done
```

#### 3.2.3 GET /ra/:token (既存改修) — ゲストページ

Phase 2対応の拡張。

```
変更点:
  1. guest_google_tokens を JOIN で取得
  2. oauth=done クエリパラメータ判定
  3. 表示モード分岐:
     a) guest_google_tokens.status='freebusy_fetched'
        → available_slots_json から空きスロットのみ表示
        → 「カレンダーの空き時間を表示しています」バッジ
     b) それ以外
        → Phase 1の全スロット表示（既存動作）
        → OAuth案内セクション追加
  4. 「スキップして手動で選ぶ」リンク
     → /ra/:token?mode=manual
     → RA.guest_oauth_status='skipped' に更新
```

#### 3.2.4 POST /ra/:token/oauth/skip — OAuthスキップ（任意）

```
Input: なし
Processing:
  1. RA.guest_oauth_status = 'skipped'
  2. JSON response: { success: true }
```

### 3.3 既存コード再利用マップ

| 既存パーツ | 再利用方法 | 改修量 |
|-----------|----------|--------|
| `auth.ts` OAuth flow (L47-83) | Google OAuth URL生成パターン | コピー＆改修（scope変更） |
| `auth.ts` token交換 (L110-135) | code → access_token パターン | ほぼそのまま |
| `GoogleCalendarService.getFreeBusy()` | FreeBusy API呼び出し | そのまま使用 |
| `slotGenerator.generateFreeSlots()` | busy除外スロット計算 | そのまま使用 |
| `reverseAvailability.ts` ゲストページ | UIの基盤 | 拡張（OAuth案内追加） |
| `Env.GOOGLE_CLIENT_ID/SECRET` | OAuth認証情報 | そのまま使用 |

### 3.4 Env 追加

```typescript
// packages/shared/src/types/env.ts に追加不要
// 既存の GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET をそのまま利用
// redirect_uri はコード内で動的に生成（APP_URL + /ra/:token/oauth/callback）

// ただし、Google Cloud Consoleの OAuth2 redirect_uri に
// https://app.tomoniwao.jp/ra/*/oauth/callback パターンを追加する必要あり
// ★ 実際にはワイルドカード不可のため、中間redirect経由にする（3.5参照）
```

### 3.5 OAuth redirect_uri 戦略

**課題**: Google OAuth redirect_uri はワイルドカード不可。`/ra/:token/oauth/callback` はtoken毎に異なるURLになる。

**解決策**: 固定redirect_uriを使用し、stateパラメータでtokenを復元する。

```
1. redirect_uri = APP_URL/api/ra-oauth/callback  ← 固定URL（1つだけ登録）
2. state = JSON.stringify({ token, nonce })
3. callback受信後、stateからtokenを取り出して処理
4. 処理完了後、/ra/:token?oauth=done にリダイレクト
```

**API構造（改訂版）:**
```
GET  /ra/:token/oauth/start    → Google consent画面へリダイレクト
                                  (redirect_uri = APP_URL/api/ra-oauth/callback)
GET  /api/ra-oauth/callback    → 固定コールバック（stateからtoken復元）
                                  → FreeBusy取得 → /ra/:token?oauth=done
```

### 3.6 フォールバック設計

```
                         ┌───────────────┐
                         │ /ra/:token    │
                         └──────┬────────┘
                                │
                         OAuth案内表示
                                │
                    ┌───────────┴───────────┐
                    │                       │
              「Googleで確認」         「スキップ」
                    │                       │
              OAuth開始                Phase 1表示
                    │                   (全スロット)
            ┌───────┴───────┐
            │               │
        OAuth成功        OAuth失敗/拒否
            │               │
      FreeBusy取得     Phase 1フォールバック
            │           (全スロット + 警告表示)
        ┌───┴───┐
        │       │
    取得成功  取得失敗
        │       │
   空き枠表示  Phase 1フォールバック
  (busy除外)  (全スロット + 警告表示)
```

**フォールバック条件一覧:**

| 条件 | 動作 | UI表示 |
|------|------|--------|
| ゲストが「スキップ」 | Phase 1表示 | 全スロット表示 |
| OAuth consent拒否 | Phase 1 + 案内再表示 | 「再度試す」リンク |
| access_token取得失敗 | Phase 1表示 | 「カレンダー連携できませんでした」 |
| FreeBusy API失敗 | Phase 1表示 | 「空き時間の取得に失敗しました」 |
| FreeBusy結果が空 | Phase 1表示 | 「予定が見つかりませんでした」 |
| token期限切れ | エラーページ | 「リンクの有効期限が切れました」 |

---

## 4. 影響範囲

### 4.1 新規ファイル

| ファイル | 内容 | 行数見積り |
|---------|------|----------|
| `db/migrations/0094_add_guest_oauth_for_reverse_availability.sql` | DB migration | ~40行 |
| `apps/api/src/routes/raOAuth.ts` | Guest OAuth start/callback | ~250行 |
| `apps/api/src/routes/__tests__/raOAuth.test.ts` | OAuth APIテスト | ~200行 |

### 4.2 改修ファイル

| ファイル | 変更内容 | 影響度 |
|---------|---------|--------|
| `apps/api/src/routes/reverseAvailability.ts` | ゲストページUI拡張、OAuth案内追加 | 中 |
| `apps/api/src/index.ts` | raOAuthルート登録 | 小 |
| `docs/plans/PR-B6-REVERSE-AVAILABILITY.md` | Phase 2セクション更新 | 小 |
| `docs/CURRENT_STATUS.md` | ステータス更新 | 小 |

### 4.3 変更なし（Phase 1コードの安全性）

| ファイル | 理由 |
|---------|------|
| `classifier/reverseAvailability.ts` | 変更不要（intentは同一） |
| `executors/reverseAvailability.ts` | 変更不要（prepare/finalize APIは同一） |
| `classifier/index.ts` | 変更不要 |
| `executors/index.ts` | 変更不要 |
| `apiExecutor.ts` | 変更不要 |

**Phase 2はサーバーサイド（API + ゲストUI）のみの変更。フロントエンド（Classifier/Executor）は一切変更なし。**

---

## 5. 実装タスク分解

| ID | タスク | ファイル | 見積り | 依存 |
|----|--------|---------|--------|------|
| B6P2-1 | DB migration (0094) | `db/migrations/0094_*.sql` | 30m | - |
| B6P2-2 | raOAuth.ts: OAuth start + callback | `routes/raOAuth.ts` | 2h | B6P2-1 |
| B6P2-3 | FreeBusy取得 + スロット計算 | `routes/raOAuth.ts` (callback内) | 1h | B6P2-2 |
| B6P2-4 | ゲストページUI改修（OAuth案内 + 自動スロット表示） | `routes/reverseAvailability.ts` | 2h | B6P2-3 |
| B6P2-5 | index.ts ルート登録 | `index.ts` | 15m | B6P2-2 |
| B6P2-6 | フォールバック実装（全パス） | 各ファイル | 30m | B6P2-4 |
| B6P2-7 | Unit tests (OAuth flow + FreeBusy + fallback) | `__tests__/` | 1.5h | B6P2-2,3,4 |
| B6P2-8 | 回帰テスト + TypeScript check | - | 30m | 全体 |
| B6P2-9 | ドキュメント更新 + コミット | `docs/` | 30m | 全体 |
| **合計** | | | **~9h** | |

### 推奨実装順序

```
B6P2-1 (DB) → B6P2-2 (OAuth API) → B6P2-3 (FreeBusy)
  → B6P2-4 (UI改修) → B6P2-5 (ルート登録) → B6P2-6 (フォールバック)
  → B6P2-7 (テスト) → B6P2-8 (回帰) → B6P2-9 (ドキュメント)
```

**PRは2分割推奨:**
- **PR-B6P2-a**: DB + OAuth API + FreeBusy取得 + ルート登録（バックエンド完了）
- **PR-B6P2-b**: ゲストUI改修 + フォールバック + テスト + ドキュメント

---

## 6. テスト計画

### 6.1 Unit Tests (新規)

| ID | テスト | 期待結果 |
|----|--------|---------|
| RA-P2-1 | OAuth start: 正常RA → Google consent URLにリダイレクト | 302, location=accounts.google.com |
| RA-P2-2 | OAuth start: 期限切れRA → エラー | 400/410 |
| RA-P2-3 | OAuth start: status≠pending → エラー | 400 |
| RA-P2-4 | OAuth callback: 正常code → token交換→FreeBusy取得→リダイレクト | 302→/ra/:token?oauth=done |
| RA-P2-5 | OAuth callback: 不正state → CSRF拒否 | 400 |
| RA-P2-6 | OAuth callback: token交換失敗 → フォールバック | 302→/ra/:token?oauth=error |
| RA-P2-7 | OAuth callback: FreeBusy取得失敗 → フォールバック | 302→/ra/:token?oauth=error |
| RA-P2-8 | ゲストページ: OAuth済み → 空きスロットのみ表示 | HTML内にfiltered slots |
| RA-P2-9 | ゲストページ: OAuth未済 → Phase 1表示 + OAuth案内 | HTML内にOAuth button |
| RA-P2-10 | ゲストページ: mode=manual → Phase 1表示 | HTML内に全スロット |
| RA-P2-11 | OAuth skip → guest_oauth_status更新 | JSON: success=true |
| RA-P2-12 | FreeBusy→スロット計算: busy期間が正しく除外される | 空きスロットにbusyが含まれない |
| RA-P2-13 | FreeBusy→スロット計算: busy期間なし → 全スロット | Phase 1と同数 |
| RA-P2-14 | 回帰: Phase 1のrespond API → OAuth有無に関わらず動作 | success=true |
| RA-P2-15 | 回帰: Phase 1のfinalize API → 変更なし | success=true |

### 6.2 回帰テスト

- Phase 1のクラシファイア 11件（RA-C1〜RA-C11）: 全パス
- Phase 1のエクゼキュータ 9件（RA-E1〜RA-E9）: 全パス
- 全体テストスイート 398件: 全パス（0 regression）

---

## 7. Google Cloud Console 設定要件

Phase 2 デプロイ前に以下の設定が必要:

```
1. OAuth consent screen
   - 追加scope: https://www.googleapis.com/auth/calendar.freebusy
   - （既存scope: openid, email, profile, calendar.events）

2. Authorized redirect URIs に追加:
   - https://app.tomoniwao.jp/api/ra-oauth/callback
   - （開発用: http://localhost:3000/api/ra-oauth/callback）

3. 本番デプロイ時:
   - wrangler.jsonc に変更なし（既存 GOOGLE_CLIENT_ID/SECRET を利用）
   - APP_URL 環境変数を確認（https://app.tomoniwao.jp）
```

---

## 8. Phase 1 との互換性

**完全後方互換。Phase 1 の動作は一切変わらない。**

| Phase 1 機能 | Phase 2 での扱い |
|-------------|----------------|
| `/ra/:token` 全スロット表示 | OAuth未使用時のフォールバックとして維持 |
| `POST /ra/:token/respond` | 変更なし（OAuth有無に関わらず同じAPI） |
| `POST /api/reverse-availability/prepare` | 変更なし |
| `POST /api/reverse-availability/:id/finalize` | 変更なし |
| Classifier/Executor | 変更なし |
| メール送信 | 変更なし |
| Inbox通知 | 変更なし |

---

## 9. 将来拡張ポイント

| 拡張 | 対応方法 | Phase |
|------|---------|-------|
| Microsoft OAuth | `provider: 'microsoft'` を guest_google_tokens に追加 | Phase 3 |
| 主催者+ゲスト双方のFreeBusy | 主催者のbusyも取得して intersection | Phase 3 |
| ゲストのpreference取得 | OAuth時に追加情報を取得 | Phase 3 |
| token暗号化 | access_token_enc + ENCRYPTION_KEY | Phase 3 |
| 多言語対応（英語UI） | i18n分離 | Phase 3 |

---

## 10. Definition of Done

- [ ] `guest_google_tokens` テーブル作成（migration 0094）
- [ ] `/ra/:token/oauth/start` → Google consent画面にリダイレクト
- [ ] `/api/ra-oauth/callback` → token交換 + FreeBusy取得 + スロット計算
- [ ] `/ra/:token` OAuth済み → 空きスロットのみ表示
- [ ] `/ra/:token` OAuth未済 → Phase 1フォールバック（全スロット）
- [ ] OAuth拒否/失敗 → Phase 1フォールバック + 案内
- [ ] Phase 1 テスト全パス（0 regression）
- [ ] Phase 2 テスト 15件 全パス
- [ ] 全体テストスイート 400+ 件パス
- [ ] TypeScript 0 errors
- [ ] ドキュメント更新

---

*PRD確定版。B6P2-1 (DBマイグレーション) から着手可能。*
*Phase 1 のコードは一切壊さない差分実装。*
