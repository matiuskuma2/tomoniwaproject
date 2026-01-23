/**
 * Users Me API Routes
 * P3-TZ1: ユーザープロフィール取得・タイムゾーン設定
 * P3-PREF1: スケジュール好み設定の保存・取得
 * 
 * GET /api/users/me - 現在のユーザー情報を取得
 * PATCH /api/users/me - タイムゾーンなどを更新
 * GET /api/users/me/schedule-prefs - スケジュール好み設定を取得
 * PUT /api/users/me/schedule-prefs - スケジュール好み設定を保存
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { getUserIdFromContext } from '../middleware/auth';
import { isValidTimeZone } from '../utils/datetime';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/users/me
 * 現在のユーザー情報を取得
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const row = await env.DB.prepare(`
    SELECT id, email, display_name, avatar_url, timezone, locale
    FROM users 
    WHERE id = ? 
    LIMIT 1
  `).bind(userId).first<{
    id: string;
    email: string;
    display_name?: string;
    avatar_url?: string;
    timezone: string;
    locale: string;
  }>();

  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({ 
    user: {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      timezone: row.timezone || 'Asia/Tokyo',
      locale: row.locale || 'ja',
    }
  });
});

/**
 * PATCH /api/users/me
 * ユーザー設定を更新（タイムゾーンなど）
 */
app.patch('/', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const updates: string[] = [];
  const binds: any[] = [];

  // タイムゾーン更新
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string') {
      return c.json({ error: 'invalid_timezone', message: 'timezone must be a string' }, 400);
    }
    if (!isValidTimeZone(body.timezone)) {
      return c.json({ error: 'invalid_timezone', message: `Invalid timezone: ${body.timezone}` }, 400);
    }
    updates.push('timezone = ?');
    binds.push(body.timezone);
  }

  // ロケール更新（将来拡張用）
  if (body.locale !== undefined) {
    if (typeof body.locale !== 'string') {
      return c.json({ error: 'invalid_locale', message: 'locale must be a string' }, 400);
    }
    updates.push('locale = ?');
    binds.push(body.locale);
  }

  // 表示名更新（将来拡張用）
  if (body.display_name !== undefined) {
    if (typeof body.display_name !== 'string') {
      return c.json({ error: 'invalid_display_name', message: 'display_name must be a string' }, 400);
    }
    updates.push('display_name = ?');
    binds.push(body.display_name);
  }

  if (updates.length === 0) {
    return c.json({ error: 'no_updates', message: 'No valid fields to update' }, 400);
  }

  // updated_at を更新
  updates.push("updated_at = datetime('now')");
  binds.push(userId);

  await env.DB.prepare(`
    UPDATE users 
    SET ${updates.join(', ')}
    WHERE id = ?
  `).bind(...binds).run();

  // 更新後のデータを返却
  const updatedRow = await env.DB.prepare(`
    SELECT id, email, display_name, avatar_url, timezone, locale
    FROM users 
    WHERE id = ? 
    LIMIT 1
  `).bind(userId).first<{
    id: string;
    email: string;
    display_name?: string;
    avatar_url?: string;
    timezone: string;
    locale: string;
  }>();

  return c.json({ 
    success: true,
    user: updatedRow ? {
      id: updatedRow.id,
      email: updatedRow.email,
      display_name: updatedRow.display_name,
      avatar_url: updatedRow.avatar_url,
      timezone: updatedRow.timezone || 'Asia/Tokyo',
      locale: updatedRow.locale || 'ja',
    } : null
  });
});

// ============================================================
// P3-PREF1: Schedule Preferences
// ============================================================

/**
 * Schedule Preferences Type
 * 主催者の会議好み設定
 */
export interface SchedulePreferences {
  // 好む時間帯（weight > 0）
  windows?: Array<{
    dow: number[];      // 曜日（0=日, 1=月, ..., 6=土）
    start: string;      // 開始時刻 "HH:mm"
    end: string;        // 終了時刻 "HH:mm"
    weight: number;     // スコア重み（正の値）
    label?: string;     // ラベル（例: "平日午後"）
  }>;
  // 避けたい時間帯（weight < 0）
  avoid?: Array<{
    dow: number[];
    start: string;
    end: string;
    weight: number;     // スコア重み（負の値）
    label?: string;
  }>;
  // 最小通知時間（時間単位）
  min_notice_hours?: number;
  // 会議の長さ（分）
  meeting_length_min?: number;
  // 最終終了時刻
  max_end_time?: string;
}

/**
 * GET /api/users/me/schedule-prefs
 * スケジュール好み設定を取得
 */
app.get('/schedule-prefs', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const row = await env.DB.prepare(`
    SELECT schedule_prefs_json
    FROM users 
    WHERE id = ? 
    LIMIT 1
  `).bind(userId).first<{ schedule_prefs_json: string | null }>();

  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }

  // JSONをパース（nullの場合はデフォルト値）
  let prefs: SchedulePreferences = {};
  if (row.schedule_prefs_json) {
    try {
      prefs = JSON.parse(row.schedule_prefs_json);
    } catch {
      console.warn('[usersMe] Failed to parse schedule_prefs_json for user:', userId);
    }
  }

  return c.json({ 
    schedule_prefs: prefs,
    has_prefs: row.schedule_prefs_json !== null,
  });
});

/**
 * PUT /api/users/me/schedule-prefs
 * スケジュール好み設定を保存
 */
app.put('/schedule-prefs', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const prefs: SchedulePreferences = body.schedule_prefs || body;

  // バリデーション
  if (prefs.windows) {
    for (const w of prefs.windows) {
      if (!Array.isArray(w.dow) || !w.start || !w.end || typeof w.weight !== 'number') {
        return c.json({ 
          error: 'invalid_window', 
          message: 'Each window must have dow (array), start (string), end (string), weight (number)' 
        }, 400);
      }
    }
  }

  if (prefs.avoid) {
    for (const a of prefs.avoid) {
      if (!Array.isArray(a.dow) || !a.start || !a.end || typeof a.weight !== 'number') {
        return c.json({ 
          error: 'invalid_avoid', 
          message: 'Each avoid must have dow (array), start (string), end (string), weight (number)' 
        }, 400);
      }
    }
  }

  // JSONに変換して保存
  const prefsJson = JSON.stringify(prefs);

  await env.DB.prepare(`
    UPDATE users 
    SET schedule_prefs_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(prefsJson, userId).run();

  console.log('[usersMe] Updated schedule_prefs for user:', userId, prefs);

  return c.json({ 
    success: true,
    schedule_prefs: prefs,
  });
});

/**
 * DELETE /api/users/me/schedule-prefs
 * スケジュール好み設定をクリア
 */
app.delete('/schedule-prefs', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  await env.DB.prepare(`
    UPDATE users 
    SET schedule_prefs_json = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).bind(userId).run();

  console.log('[usersMe] Cleared schedule_prefs for user:', userId);

  return c.json({ 
    success: true,
    schedule_prefs: null,
  });
});

export default app;
