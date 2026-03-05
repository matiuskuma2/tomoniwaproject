-- ============================================================
-- Migration: 0094_add_guest_oauth_for_reverse_availability.sql
-- Purpose: PR-B6 Phase 2 — ゲストOAuth + FreeBusy自動取得
--
-- Phase 1 で手動候補選択だったゲスト体験を、
-- Google OAuth認証 → FreeBusy自動取得 → 空きスロットのみ表示 に拡張。
-- 認証しない/失敗した場合は Phase 1 の手動選択にフォールバック。
--
-- テーブル:
-- 1. guest_google_tokens: ゲストOAuth一時トークン + FreeBusy結果キャッシュ
--
-- カラム追加:
-- 2. reverse_availability.guest_oauth_status: OAuth認証ステータス
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. guest_google_tokens: ゲストOAuth一時トークン（RA用）
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_google_tokens (
  id TEXT PRIMARY KEY,                        -- UUID
  reverse_availability_id TEXT NOT NULL,      -- FK: reverse_availability.id
  token TEXT NOT NULL,                        -- RA token（/ra/:token と同じ）

  -- Google OAuth
  provider TEXT NOT NULL DEFAULT 'google',    -- 将来: 'microsoft' 追加用
  google_email TEXT,                          -- 認証したGoogleアカウントのメール
  access_token TEXT,                          -- OAuth access_token（一時的、refresh不要）
  token_expires_at TEXT,                      -- access_token の有効期限

  -- FreeBusy結果キャッシュ
  freebusy_result TEXT,                       -- JSON: busy期間配列
  freebusy_fetched_at TEXT,                   -- FreeBusy取得日時
  available_slots_json TEXT,                  -- JSON: 計算済み空きスロット（busy除外済み）

  -- 状態
  -- pending     = OAuth開始前
  -- authenticated = OAuth成功（access_token取得済み）
  -- freebusy_fetched = FreeBusy取得完了（空きスロット計算済み）
  -- error       = OAuth失敗またはFreeBusy取得失敗
  -- expired     = 有効期限切れ
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authenticated', 'freebusy_fetched', 'error', 'expired')),
  error_message TEXT,                         -- エラー時のメッセージ

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (reverse_availability_id) REFERENCES reverse_availability(id) ON DELETE CASCADE
);

-- Indexes for guest_google_tokens
CREATE INDEX IF NOT EXISTS idx_ggt_ra_id ON guest_google_tokens(reverse_availability_id);
CREATE INDEX IF NOT EXISTS idx_ggt_token ON guest_google_tokens(token);
CREATE INDEX IF NOT EXISTS idx_ggt_status ON guest_google_tokens(status);

-- ============================================================
-- 2. reverse_availability: guest_oauth_status カラム追加
-- ============================================================
-- NULL      = Phase 1 互換（OAuth未使用）
-- 'offered' = OAuth案内表示済み
-- 'authenticated' = OAuth成功 → FreeBusy自動取得
-- 'skipped' = ゲストがスキップ → 手動選択
-- 'error'   = OAuth失敗 → フォールバック
ALTER TABLE reverse_availability ADD COLUMN guest_oauth_status TEXT DEFAULT NULL;

-- ============================================================
-- Comments
-- ============================================================
-- PR-B6 Phase 2: ゲストOAuth + FreeBusy自動取得
--
-- フロー:
-- 1. ゲストが /ra/:token にアクセス → OAuth案内表示
-- 2. 「Googleカレンダーで確認」→ /ra/:token/oauth/start → Google consent
-- 3. 認証成功 → /api/ra-oauth/callback → token交換 → FreeBusy取得
-- 4. busy除外スロット計算 → guest_google_tokens.available_slots_json に保存
-- 5. /ra/:token?oauth=done → 空きスロットのみ表示
--
-- フォールバック:
-- - OAuth スキップ/拒否/失敗 → Phase 1 の全スロット手動選択
--
-- セキュリティ:
-- - scope: calendar.freebusy（読み取り専用、最小権限）
-- - access_type: online（refresh_token不取得）
-- - 72時間で RA と共に自動失効
-- - provider フィールドで将来 Microsoft 拡張に備える
-- ============================================================
