/**
 * Test Fixtures Route for E2E Tests
 * 
 * CI専用のfixture route - development/staging only
 * 本番環境では絶対に使用不可
 * 
 * @security ENVIRONMENT !== 'production' でガード
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const app = new Hono<{ Bindings: Env }>();

/**
 * 日時フォーマットヘルパー
 */
function formatDateTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  
  return `${year}年${month}月${day}日（${weekday}）${hours}:${minutes}`;
}

/**
 * Create 1-on-1 Fixed Schedule Fixture
 * 
 * E2Eテスト用に scheduling_thread + scheduling_slots + thread_invites を作成
 * 
 * @route POST /test/fixtures/one-on-one
 * @body {
 *   invitee_name?: string,      // デフォルト: "テスト太郎"
 *   invitee_email?: string,     // デフォルト: "test@example.com"  
 *   title?: string,             // デフォルト: "E2Eテスト打ち合わせ"
 *   start_offset_hours?: number // デフォルト: 24（明日）
 *   duration_minutes?: number   // デフォルト: 60
 * }
 * @returns {
 *   success: true,
 *   token: string,
 *   thread_id: string,
 *   slot_id: string,
 *   invite_id: string,
 *   share_url: string,
 *   slot: { start_at: string, end_at: string }
 * }
 */
app.post('/one-on-one', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'one-on-one' });

  // 本番環境での実行を絶対に阻止（二重ガード）
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      invitee_name = 'テスト太郎',
      invitee_email = 'test@example.com',
      title = 'E2Eテスト打ち合わせ',
      start_offset_hours = 24,
      duration_minutes = 60
    } = body as {
      invitee_name?: string;
      invitee_email?: string;
      title?: string;
      start_offset_hours?: number;
      duration_minutes?: number;
    };

    const now = new Date();
    const nowISO = now.toISOString();
    
    // 日時計算
    const startAt = new Date(now.getTime() + start_offset_hours * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + duration_minutes * 60 * 1000);
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7日後
    
    // IDs生成
    const threadId = uuidv4();
    const slotId = `slot-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const inviteId = uuidv4();
    const token = `e2e-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const inviteeKey = `ik-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // E2Eテスト用の固定user_id（存在しなくてもOK、FKなしで動作）
    const testUserId = 'e2e-test-user-' + Math.random().toString(36).substring(7);

    // 1. scheduling_threads 作成
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, organizer_user_id, title, description, status, mode, 
        proposal_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sent', 'one_on_one', 1, ?, ?)
    `).bind(
      threadId,
      testUserId,
      title,
      `E2Eテスト用fixture - ${formatDateTimeJP(startAt.toISOString())}`,
      nowISO,
      nowISO
    ).run();

    // 2. scheduling_slots 作成（固定1枠）
    await env.DB.prepare(`
      INSERT INTO scheduling_slots (
        slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
      ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
    `).bind(
      slotId,
      threadId,
      startAt.toISOString(),
      endAt.toISOString(),
      title,
      nowISO
    ).run();

    // 3. thread_invites 作成
    await env.DB.prepare(`
      INSERT INTO thread_invites (
        id, thread_id, token, email, candidate_name, candidate_reason,
        invitee_key, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      inviteId,
      threadId,
      token,
      invitee_email,
      invitee_name,
      'E2Eテスト用の招待です',
      inviteeKey,
      expiresAt.toISOString(),
      nowISO
    ).run();

    log.debug('E2E fixture created', { threadId, slotId, inviteId, token });

    // レスポンス
    const baseUrl = env.ENVIRONMENT === 'development' 
      ? 'http://localhost:3000' 
      : 'https://app.tomoniwao.jp';

    return c.json({
      success: true,
      token,
      thread_id: threadId,
      slot_id: slotId,
      invite_id: inviteId,
      share_url: `${baseUrl}/i/${token}`,
      slot: {
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString()
      },
      invitee: {
        name: invitee_name,
        email: invitee_email
      }
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Cleanup E2E Fixtures
 * 
 * テスト後のクリーンアップ用
 * 
 * @route DELETE /test/fixtures/one-on-one/:token
 */
app.delete('/one-on-one/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'cleanup' });
  const token = c.req.param('token');

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    // token から invite を取得
    const invite = await env.DB.prepare(`
      SELECT id, thread_id FROM thread_invites WHERE token = ?
    `).bind(token).first<{ id: string; thread_id: string }>();

    if (!invite) {
      return c.json({ error: 'Fixture not found' }, 404);
    }

    // 関連データを削除（順序重要）
    await env.DB.prepare(`DELETE FROM thread_selections WHERE thread_id = ?`).bind(invite.thread_id).run();
    await env.DB.prepare(`DELETE FROM thread_invites WHERE thread_id = ?`).bind(invite.thread_id).run();
    await env.DB.prepare(`DELETE FROM scheduling_slots WHERE thread_id = ?`).bind(invite.thread_id).run();
    await env.DB.prepare(`DELETE FROM scheduling_threads WHERE id = ?`).bind(invite.thread_id).run();

    log.debug('E2E fixture cleaned up', { token, thread_id: invite.thread_id });

    return c.json({ success: true, deleted_thread_id: invite.thread_id });

  } catch (error) {
    log.error('Failed to cleanup E2E fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Health check for test fixtures
 * 
 * @route GET /test/fixtures/health
 */
app.get('/health', (c) => {
  const env = c.env as Env;
  
  return c.json({
    status: 'ok',
    module: 'test-fixtures',
    environment: env.ENVIRONMENT || 'unknown',
    available: env.ENVIRONMENT !== 'production'
  });
});

export default app;
