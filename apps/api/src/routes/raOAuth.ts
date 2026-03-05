/**
 * PR-B6 Phase 2: Guest OAuth Routes (ゲストOAuth + FreeBusy自動取得)
 *
 * ゲスト（目上の相手）がGoogle認証すると、カレンダーの空き時間だけを自動表示。
 * 認証しない/失敗した場合は Phase 1 の手動選択にフォールバック。
 *
 * Public (no auth):
 *   GET  /ra/:token/oauth/start     - OAuth開始 → Google consent画面
 *   GET  /api/ra-oauth/callback     - OAuthコールバック（固定URI）
 *   POST /ra/:token/oauth/skip      - OAuthスキップ
 */

import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { v4 as uuidv4 } from 'uuid';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';
import { GoogleCalendarService } from '../services/googleCalendar';

// ============================================================
// Types
// ============================================================

interface ReverseAvailabilityRow {
  id: string;
  token: string;
  workspace_id: string;
  requester_user_id: string;
  target_email: string;
  target_name: string | null;
  time_min: string;
  time_max: string;
  duration_minutes: number;
  preferred_slots_count: number;
  slot_interval_minutes: number;
  title: string;
  status: string;
  guest_oauth_status: string | null;
  expires_at: string;
}

interface GuestGoogleTokenRow {
  id: string;
  reverse_availability_id: string;
  token: string;
  provider: string;
  google_email: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  freebusy_result: string | null;
  freebusy_fetched_at: string | null;
  available_slots_json: string | null;
  status: string;
  error_message: string | null;
}

interface SlotData {
  start: string; // ISO8601
  end: string;
  label: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * ランダムnonce生成（CSRF防止用）
 */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * FreeBusy結果からbusy期間を除外したスロットを生成
 * Phase 1 のスロット生成ロジックと同じ条件（平日09:00-18:00）で
 * busy期間を除外する
 */
function generateFreeBusyFilteredSlots(
  busyPeriods: Array<{ start: string; end: string }>,
  timeMin: string,
  timeMax: string,
  durationMinutes: number,
  intervalMinutes: number,
): Map<string, SlotData[]> {
  const slotsByDate = new Map<string, SlotData[]>();
  const jstOffset = 9 * 60 * 60 * 1000;

  const tMin = new Date(timeMin);
  const tMax = new Date(timeMax);
  const now = new Date();

  // busy期間をDateオブジェクトに変換
  const busyDates = busyPeriods.map(bp => ({
    start: new Date(bp.start),
    end: new Date(bp.end),
  }));

  const current = new Date(tMin);

  while (current < tMax) {
    const jstDate = new Date(current.getTime() + jstOffset);
    const dayOfWeek = jstDate.getUTCDay();

    // 平日のみ
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const dateKey = `${jstDate.getUTCFullYear()}-${String(jstDate.getUTCMonth() + 1).padStart(2, '0')}-${String(jstDate.getUTCDate()).padStart(2, '0')}`;

      // 09:00-18:00 (JST) のスロット
      for (let hour = 9; hour < 18; hour++) {
        for (let minute = 0; minute < 60; minute += intervalMinutes) {
          const slotStartJST = new Date(Date.UTC(
            jstDate.getUTCFullYear(),
            jstDate.getUTCMonth(),
            jstDate.getUTCDate(),
            hour - 9, // UTC = JST - 9
            minute,
            0
          ));
          const slotEnd = new Date(slotStartJST.getTime() + durationMinutes * 60 * 1000);

          // 18:00 JST (= 09:00 UTC) を超えないようにする
          const endLimitUTC = new Date(Date.UTC(
            jstDate.getUTCFullYear(),
            jstDate.getUTCMonth(),
            jstDate.getUTCDate(),
            18 - 9,
            0,
            0
          ));

          if (slotEnd > endLimitUTC) continue;
          if (slotStartJST < tMin || slotEnd > tMax) continue;
          if (slotStartJST < now) continue;

          // ★ Phase 2: busy期間との重複チェック
          const isBusy = busyDates.some(bp =>
            slotStartJST < bp.end && slotEnd > bp.start
          );

          if (isBusy) continue; // busy期間と重なるスロットをスキップ

          if (!slotsByDate.has(dateKey)) {
            slotsByDate.set(dateKey, []);
          }
          slotsByDate.get(dateKey)!.push({
            start: slotStartJST.toISOString(),
            end: slotEnd.toISOString(),
            label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          });
        }
      }
    }

    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return slotsByDate;
}

// ============================================================
// Public OAuth Routes (mount at /ra prefix alongside existing)
// ============================================================

const raOAuthPublicApp = new Hono<{ Bindings: Env }>();

/**
 * GET /ra/:token/oauth/start — OAuth開始
 *
 * ゲストがGoogleカレンダー認証を開始する。
 * → Google consent画面にリダイレクト
 */
raOAuthPublicApp.get('/:token/oauth/start', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'RAOAuth', handler: 'start' });
  const token = c.req.param('token');

  try {
    // 1. RA取得 + バリデーション
    const ra = await env.DB.prepare(`
      SELECT * FROM reverse_availability WHERE token = ?
    `).bind(token).first<ReverseAvailabilityRow>();

    if (!ra) {
      return c.json({ error: 'not_found', message: 'リンクが見つかりません' }, 404);
    }

    if (ra.status !== 'pending') {
      return c.json({ error: 'invalid_status', message: 'このリンクはすでに使用済みです' }, 400);
    }

    if (new Date(ra.expires_at) < new Date()) {
      return c.json({ error: 'expired', message: '有効期限が切れています' }, 410);
    }

    // 2. OAuth設定チェック
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      log.error('Google OAuth not configured');
      // OAuth使用不可 → Phase 1にフォールバック
      const baseUrl = (env as any).APP_URL || 'https://app.tomoniwao.jp';
      return c.redirect(`${baseUrl}/ra/${token}?oauth=unavailable`);
    }

    // 3. Google OAuth URL生成
    const baseUrl = (env as any).APP_URL || 'https://app.tomoniwao.jp';
    const redirectUri = `${baseUrl}/api/ra-oauth/callback`;

    // stateにtokenを含める（固定redirect_uri戦略）
    const nonce = generateNonce();
    const state = JSON.stringify({ token, nonce });
    const stateBase64 = btoa(state);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    // 最小権限: FreeBusy読み取りのみ
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.freebusy openid email');
    authUrl.searchParams.set('state', stateBase64);
    authUrl.searchParams.set('access_type', 'online'); // refresh_token不要
    authUrl.searchParams.set('prompt', 'consent');

    // 4. guest_google_tokens レコード作成
    const ggtId = uuidv4();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO guest_google_tokens (
        id, reverse_availability_id, token, provider, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'google', 'pending', ?, ?)
    `).bind(ggtId, ra.id, token, now, now).run();

    // 5. RA.guest_oauth_status 更新
    await env.DB.prepare(`
      UPDATE reverse_availability
      SET guest_oauth_status = 'offered', updated_at = ?
      WHERE id = ?
    `).bind(now, ra.id).run();

    // 6. CSRF防止: nonceをcookieに保存
    setCookie(c, 'ra_oauth_nonce', nonce, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 600, // 10分
      path: '/',
    });

    log.debug('OAuth start redirect', { token, ggtId });
    return c.redirect(authUrl.toString());

  } catch (error) {
    log.error('OAuth start error', {
      error: error instanceof Error ? error.message : String(error),
    });
    const baseUrl = (env as any).APP_URL || 'https://app.tomoniwao.jp';
    return c.redirect(`${baseUrl}/ra/${token}?oauth=error`);
  }
});

/**
 * POST /ra/:token/oauth/skip — OAuthスキップ
 *
 * ゲストが「スキップして手動で選ぶ」を選択した場合。
 */
raOAuthPublicApp.post('/:token/oauth/skip', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'RAOAuth', handler: 'skip' });
  const token = c.req.param('token');

  try {
    const ra = await env.DB.prepare(`
      SELECT id, status FROM reverse_availability WHERE token = ?
    `).bind(token).first<{ id: string; status: string }>();

    if (!ra) {
      return c.json({ error: 'not_found' }, 404);
    }

    if (ra.status !== 'pending') {
      return c.json({ error: 'invalid_status' }, 400);
    }

    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE reverse_availability
      SET guest_oauth_status = 'skipped', updated_at = ?
      WHERE id = ?
    `).bind(now, ra.id).run();

    log.debug('OAuth skipped', { token });
    return c.json({ success: true });

  } catch (error) {
    log.error('OAuth skip error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: 'internal_error' }, 500);
  }
});

// ============================================================
// OAuth Callback Route (fixed URI, mount at /api prefix)
// ============================================================

const raOAuthCallbackApp = new Hono<{ Bindings: Env }>();

/**
 * GET /api/ra-oauth/callback — OAuthコールバック（固定URI）
 *
 * Google OAuth認証完了後のコールバック。
 * stateパラメータからtokenを復元し、FreeBusy取得 → スロット計算を行う。
 */
raOAuthCallbackApp.get('/callback', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'RAOAuth', handler: 'callback' });
  const baseUrl = (env as any).APP_URL || 'https://app.tomoniwao.jp';

  try {
    const code = c.req.query('code');
    const stateParam = c.req.query('state');
    const error = c.req.query('error');

    // 1. OAuthエラーチェック
    if (error) {
      log.warn('OAuth consent denied or errored', { error });
      // stateからtokenを復元してリダイレクト
      let token = '';
      try {
        const stateJson = JSON.parse(atob(stateParam || ''));
        token = stateJson.token;
      } catch {}

      if (token) {
        // RA.guest_oauth_status を error に更新
        await env.DB.prepare(`
          UPDATE reverse_availability
          SET guest_oauth_status = 'error', updated_at = datetime('now')
          WHERE token = ?
        `).bind(token).run();

        return c.redirect(`${baseUrl}/ra/${token}?oauth=denied`);
      }
      return c.json({ error: 'OAuth denied' }, 400);
    }

    if (!code || !stateParam) {
      return c.json({ error: 'Missing code or state' }, 400);
    }

    // 2. stateからtokenを復元
    let token: string;
    let nonce: string;
    try {
      const stateJson = JSON.parse(atob(stateParam));
      token = stateJson.token;
      nonce = stateJson.nonce;
    } catch {
      return c.json({ error: 'Invalid state parameter' }, 400);
    }

    if (!token) {
      return c.json({ error: 'Missing token in state' }, 400);
    }

    // 3. CSRF検証（nonce）
    const storedNonce = getCookie(c, 'ra_oauth_nonce');
    if (storedNonce && storedNonce !== nonce) {
      log.warn('CSRF nonce mismatch', { token });
      return c.redirect(`${baseUrl}/ra/${token}?oauth=error`);
    }

    // 4. RA取得 + バリデーション
    const ra = await env.DB.prepare(`
      SELECT * FROM reverse_availability WHERE token = ?
    `).bind(token).first<ReverseAvailabilityRow>();

    if (!ra) {
      return c.json({ error: 'RA not found' }, 404);
    }

    if (ra.status !== 'pending') {
      return c.redirect(`${baseUrl}/ra/${token}?oauth=error`);
    }

    // 5. code → access_token 交換
    const redirectUri = `${baseUrl}/api/ra-oauth/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID || '',
        client_secret: env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      log.error('Token exchange failed', { status: tokenResponse.status, error: errorData });

      // フォールバック: OAuthエラー
      await updateOAuthError(env.DB, ra.id, token, 'Token exchange failed');
      return c.redirect(`${baseUrl}/ra/${token}?oauth=error`);
    }

    const tokens = await tokenResponse.json<{
      access_token: string;
      expires_in: number;
      scope: string;
      id_token?: string;
    }>();

    log.debug('Token exchanged successfully', { token, scope: tokens.scope });

    // 6. ゲストのメールアドレスを取得（オプション、ログ用）
    let guestEmail: string | null = null;
    try {
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json<{ email?: string }>();
        guestEmail = userInfo.email || null;
      }
    } catch {
      // メール取得失敗は非致命的
    }

    // 7. FreeBusy取得
    let busyPeriods: Array<{ start: string; end: string }> = [];
    try {
      const calendarService = new GoogleCalendarService(tokens.access_token, env);
      busyPeriods = await calendarService.getFreeBusy(ra.time_min, ra.time_max);
      log.debug('FreeBusy fetched', { token, busyCount: busyPeriods.length });
    } catch (fbError) {
      log.error('FreeBusy fetch failed', {
        error: fbError instanceof Error ? fbError.message : String(fbError),
      });

      // FreeBusy取得失敗 → フォールバック
      await updateOAuthError(env.DB, ra.id, token, 'FreeBusy fetch failed');
      return c.redirect(`${baseUrl}/ra/${token}?oauth=freebusy_error`);
    }

    // 8. busy除外スロット計算
    const availableSlotsByDate = generateFreeBusyFilteredSlots(
      busyPeriods,
      ra.time_min,
      ra.time_max,
      ra.duration_minutes,
      ra.slot_interval_minutes || 60,
    );

    // Map → serializable object
    const availableSlotsObj: Record<string, SlotData[]> = {};
    for (const [dateKey, daySlots] of availableSlotsByDate) {
      availableSlotsObj[dateKey] = daySlots;
    }

    // 9. DB更新: guest_google_tokens
    const now = new Date().toISOString();
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // 既存レコードを更新（pending → freebusy_fetched）
    const existingGgt = await env.DB.prepare(`
      SELECT id FROM guest_google_tokens
      WHERE token = ? AND reverse_availability_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(token, ra.id).first<{ id: string }>();

    if (existingGgt) {
      await env.DB.prepare(`
        UPDATE guest_google_tokens
        SET google_email = ?,
            access_token = ?,
            token_expires_at = ?,
            freebusy_result = ?,
            freebusy_fetched_at = ?,
            available_slots_json = ?,
            status = 'freebusy_fetched',
            updated_at = ?
        WHERE id = ?
      `).bind(
        guestEmail,
        tokens.access_token,
        tokenExpiresAt,
        JSON.stringify(busyPeriods),
        now,
        JSON.stringify(availableSlotsObj),
        now,
        existingGgt.id,
      ).run();
    } else {
      // 新規作成（OAuth startを経由しなかった場合のフォールバック）
      const ggtId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO guest_google_tokens (
          id, reverse_availability_id, token, provider,
          google_email, access_token, token_expires_at,
          freebusy_result, freebusy_fetched_at, available_slots_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 'google', ?, ?, ?, ?, ?, ?, 'freebusy_fetched', ?, ?)
      `).bind(
        ggtId, ra.id, token,
        guestEmail, tokens.access_token, tokenExpiresAt,
        JSON.stringify(busyPeriods), now, JSON.stringify(availableSlotsObj),
        now, now,
      ).run();
    }

    // 10. RA.guest_oauth_status 更新
    await env.DB.prepare(`
      UPDATE reverse_availability
      SET guest_oauth_status = 'authenticated', updated_at = ?
      WHERE id = ?
    `).bind(now, ra.id).run();

    log.debug('OAuth + FreeBusy complete', {
      token,
      busyCount: busyPeriods.length,
      availableDays: Object.keys(availableSlotsObj).length,
      guestEmail,
    });

    // 11. リダイレクト → ゲストページ
    return c.redirect(`${baseUrl}/ra/${token}?oauth=done`);

  } catch (error) {
    log.error('OAuth callback error', {
      error: error instanceof Error ? error.message : String(error),
    });

    // stateからtokenを復元してフォールバック
    let token = '';
    try {
      const stateParam = c.req.query('state');
      const stateJson = JSON.parse(atob(stateParam || ''));
      token = stateJson.token;
    } catch {}

    if (token) {
      await updateOAuthError(env.DB, '', token, 'Unexpected error');
      return c.redirect(`${baseUrl}/ra/${token}?oauth=error`);
    }

    return c.json({ error: 'OAuth callback failed' }, 500);
  }
});

/**
 * Helper: OAuthエラー時のDB更新
 */
async function updateOAuthError(
  db: D1Database,
  raId: string,
  token: string,
  errorMessage: string,
): Promise<void> {
  const now = new Date().toISOString();

  try {
    // guest_google_tokens のエラー更新
    await db.prepare(`
      UPDATE guest_google_tokens
      SET status = 'error', error_message = ?, updated_at = ?
      WHERE token = ?
    `).bind(errorMessage, now, token).run();

    // RA.guest_oauth_status をエラーに更新
    await db.prepare(`
      UPDATE reverse_availability
      SET guest_oauth_status = 'error', updated_at = ?
      WHERE token = ?
    `).bind(now, token).run();
  } catch {
    // DB更新失敗は非致命的
  }
}

// ============================================================
// Exports
// ============================================================

/** Public OAuth routes: mount at /ra (alongside existing RA public routes) */
export const raOAuthPublicRoutes = raOAuthPublicApp;

/** OAuth callback route: mount at /api/ra-oauth */
export const raOAuthCallbackRoutes = raOAuthCallbackApp;

export { generateFreeBusyFilteredSlots };
