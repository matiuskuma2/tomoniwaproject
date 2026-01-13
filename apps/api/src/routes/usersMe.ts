/**
 * Users Me API Routes
 * P3-TZ1: ユーザープロフィール取得・タイムゾーン設定
 * 
 * GET /api/users/me - 現在のユーザー情報を取得
 * PATCH /api/users/me - タイムゾーンなどを更新
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

export default app;
