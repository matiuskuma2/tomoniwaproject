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
    
    // ========================================
    // フレーク防止: 「翌日」基準 + start_offset_hours
    // CIの実行日時に関わらず常に「未来」になる
    // ========================================
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0); // 翌日10:00基準
    
    // start_offset_hours は「翌日10:00」からのオフセットとして使用
    const startAt = new Date(tomorrow.getTime() + start_offset_hours * 60 * 60 * 1000);
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
 * Create 1-on-1 Candidates Schedule Fixture (Phase B-1)
 * 
 * E2Eテスト用に候補3つのスケジュールを作成
 * 
 * @route POST /test/fixtures/one-on-one-candidates
 * @body {
 *   invitee_name?: string,
 *   invitee_email?: string,
 *   title?: string,
 *   slot_count?: number,      // デフォルト: 3
 *   start_offset_hours?: number,
 *   duration_minutes?: number
 * }
 */
app.post('/one-on-one-candidates', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'one-on-one-candidates' });

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      invitee_name = 'テスト太郎',
      invitee_email = 'test@example.com',
      title = 'E2E候補3つテスト',
      slot_count = 3,
      start_offset_hours = 24,
      duration_minutes = 60,
      additional_propose_count = 0  // B-5: 既存の再提案回数を設定（0 = 未再提案）
    } = body as {
      invitee_name?: string;
      invitee_email?: string;
      title?: string;
      slot_count?: number;
      start_offset_hours?: number;
      duration_minutes?: number;
      additional_propose_count?: number;
    };

    const now = new Date();
    const nowISO = now.toISOString();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7日後
    
    // IDs生成
    const threadId = uuidv4();
    const inviteId = uuidv4();
    const token = `e2e-multi-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const inviteeKey = `ik-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const testUserId = 'e2e-test-user-' + Math.random().toString(36).substring(7);

    // ========================================
    // フレーク防止: 「翌日00:00」基準 + 固定時刻
    // CIの実行日時に関わらず常に「未来」になる
    // ========================================
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // 翌日00:00に丸める
    
    // 固定時刻パターン（10:00, 14:00, 16:00, 11:00, 15:00）
    const SLOT_HOURS = [10, 14, 16, 11, 15];

    // 1. scheduling_threads 作成 (slot_policy = 'fixed_multi')
    // B-5: additional_propose_count を設定可能にして3回目の別日希望テストを可能にする
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, organizer_user_id, title, description, status, mode, 
        slot_policy, proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sent', 'one_on_one', 'fixed_multi', 1, ?, ?, ?)
    `).bind(
      threadId,
      testUserId,
      title,
      `E2Eテスト用fixture - 候補${slot_count}件`,
      additional_propose_count,
      nowISO,
      nowISO
    ).run();

    // 2. scheduling_slots 作成（複数枠）
    // 各スロットは「翌日+i日」の固定時刻に配置
    const createdSlots: Array<{ slot_id: string; start_at: string; end_at: string }> = [];
    for (let i = 0; i < Math.min(slot_count, 5); i++) {
      const slotId = `slot-${Date.now()}-${i}-${Math.random().toString(36).substring(7)}`;
      // 翌日 + i日 + 固定時刻
      const slotDate = new Date(tomorrow);
      slotDate.setDate(slotDate.getDate() + i);
      slotDate.setHours(SLOT_HOURS[i % SLOT_HOURS.length], 0, 0, 0);
      const startAt = slotDate;
      const endAt = new Date(startAt.getTime() + duration_minutes * 60 * 1000);
      
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
      
      createdSlots.push({ 
        slot_id: slotId, 
        start_at: startAt.toISOString(), 
        end_at: endAt.toISOString() 
      });
    }

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
      'E2E候補3つテスト用の招待です',
      inviteeKey,
      expiresAt.toISOString(),
      nowISO
    ).run();

    log.debug('E2E candidates fixture created', { threadId, slot_count: createdSlots.length, inviteId, token });

    // レスポンス
    const baseUrl = env.ENVIRONMENT === 'development' 
      ? 'http://localhost:3000' 
      : 'https://app.tomoniwao.jp';

    return c.json({
      success: true,
      token,
      thread_id: threadId,
      invite_id: inviteId,
      share_url: `${baseUrl}/i/${token}`,
      slots: createdSlots,
      invitee: {
        name: invitee_name,
        email: invitee_email
      }
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E candidates fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Create Freebusy Context Fixture (PR-B2-E2E)
 * 
 * E2Eテスト用に freebusy/prepare API のコンテキストを固定化
 * Google Calendar API を呼ばず、決定論的なbusyデータを使用
 * 
 * @route POST /test/fixtures/freebusy-context
 * @body {
 *   busy_pattern?: 'standard' | 'all_busy' | 'all_free',  // デフォルト: 'standard'
 *   invitee_name?: string,      // デフォルト: "フリービジーテスト太郎"
 *   invitee_email?: string,     // デフォルト: "freebusy-test@example.com"
 *   title?: string,             // デフォルト: "E2E freebusy テスト"
 *   prefer?: 'morning' | 'afternoon' | 'evening' | 'business' | 'any',  // デフォルト: 'afternoon'
 *   candidate_count?: number    // デフォルト: 3
 * }
 * @returns {
 *   success: true,
 *   fixture_id: string,
 *   token: string,
 *   thread_id: string,
 *   share_url: string,
 *   slots: Array<{ slot_id: string; start_at: string; end_at: string }>,
 *   busy_pattern: string,
 *   constraints: { time_min: string; time_max: string; prefer: string; duration: number }
 * }
 */
app.post('/freebusy-context', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'freebusy-context' });

  // 本番環境での実行を絶対に阻止（二重ガード）
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      busy_pattern = 'standard',
      invitee_name = 'フリービジーテスト太郎',
      invitee_email = 'freebusy-test@example.com',
      title = 'E2E freebusy テスト',
      prefer = 'afternoon',
      candidate_count = 3
    } = body as {
      busy_pattern?: 'standard' | 'all_busy' | 'all_free';
      invitee_name?: string;
      invitee_email?: string;
      title?: string;
      prefer?: 'morning' | 'afternoon' | 'evening' | 'business' | 'any';
      candidate_count?: number;
    };

    const now = new Date();
    const nowISO = now.toISOString();
    
    // ========================================
    // フレーク防止: 「翌営業日」基準 + 固定時刻
    // ========================================
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    // 土日をスキップして翌営業日を取得
    let dayOfWeek = tomorrow.getDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
      dayOfWeek = tomorrow.getDay();
    }
    
    // time_min: 翌営業日 09:00, time_max: 2週間後
    const timeMin = new Date(tomorrow);
    timeMin.setHours(9, 0, 0, 0);
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    // ========================================
    // busyパターンに応じた空き枠を生成
    // ========================================
    const duration = 60; // 60分固定
    const createdSlots: Array<{ slot_id: string; start_at: string; end_at: string }> = [];
    
    // 午後の時間帯（13:00, 14:00, 15:00, 16:00, 17:00）
    const AFTERNOON_HOURS = [13, 14, 15, 16, 17];
    
    if (busy_pattern === 'all_busy') {
      // 全て埋まっている場合は空きなし（0件）
      // createdSlots は空のまま
    } else if (busy_pattern === 'all_free') {
      // 全て空いている場合は連続した枠を生成
      for (let i = 0; i < Math.min(candidate_count, 5); i++) {
        const slotDate = new Date(tomorrow);
        slotDate.setDate(slotDate.getDate() + i);
        // 平日をスキップ
        while (slotDate.getDay() === 0 || slotDate.getDay() === 6) {
          slotDate.setDate(slotDate.getDate() + 1);
        }
        slotDate.setHours(AFTERNOON_HOURS[i % AFTERNOON_HOURS.length], 0, 0, 0);
        const startAt = new Date(slotDate);
        const endAt = new Date(startAt.getTime() + duration * 60 * 1000);
        
        const slotId = `slot-fb-${Date.now()}-${i}-${Math.random().toString(36).substring(7)}`;
        createdSlots.push({
          slot_id: slotId,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString()
        });
      }
    } else {
      // standard: 決定論的な空き枠を生成
      // 翌営業日からcandidate_count件の午後枠を作成
      for (let i = 0; i < Math.min(candidate_count, 5); i++) {
        const slotDate = new Date(tomorrow);
        slotDate.setDate(slotDate.getDate() + i);
        // 平日のみ
        while (slotDate.getDay() === 0 || slotDate.getDay() === 6) {
          slotDate.setDate(slotDate.getDate() + 1);
        }
        // 午後の決定論的時刻: prefer=afternoon なら 14:00, 15:00, 16:00
        slotDate.setHours(14 + i, 0, 0, 0);
        const startAt = new Date(slotDate);
        const endAt = new Date(startAt.getTime() + duration * 60 * 1000);
        
        const slotId = `slot-fb-${Date.now()}-${i}-${Math.random().toString(36).substring(7)}`;
        createdSlots.push({
          slot_id: slotId,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString()
        });
      }
    }
    
    // IDs生成
    const fixtureId = `fixture-fb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const threadId = uuidv4();
    const inviteId = uuidv4();
    const token = `e2e-fb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const inviteeKey = `ik-fb-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const testUserId = 'e2e-test-user-' + Math.random().toString(36).substring(7);
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7日後
    
    // constraints_json に制約を保存
    const constraintsJson = JSON.stringify({
      time_min: timeMin.toISOString(),
      time_max: timeMax.toISOString(),
      prefer,
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      duration,
      source: 'freebusy',
      fixture_id: fixtureId, // E2E識別用
    });
    
    // ========================================
    // DB操作（all_busy以外の場合のみ）
    // ========================================
    if (busy_pattern !== 'all_busy') {
      // 1. scheduling_threads 作成 (slot_policy = 'freebusy_multi')
      await env.DB.prepare(`
        INSERT INTO scheduling_threads (
          id, organizer_user_id, title, description, status, mode, 
          slot_policy, constraints_json, proposal_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'sent', 'one_on_one', 'freebusy_multi', ?, 1, ?, ?)
      `).bind(
        threadId,
        testUserId,
        title,
        `E2E freebusy テスト用fixture - ${busy_pattern}`,
        constraintsJson,
        nowISO,
        nowISO
      ).run();

      // 2. scheduling_slots 作成（複数枠）
      for (const slot of createdSlots) {
        await env.DB.prepare(`
          INSERT INTO scheduling_slots (
            slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
          ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
        `).bind(
          slot.slot_id,
          threadId,
          slot.start_at,
          slot.end_at,
          title,
          nowISO
        ).run();
      }

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
        'E2E freebusy テスト用の招待です',
        inviteeKey,
        expiresAt.toISOString(),
        nowISO
      ).run();
    }

    log.debug('E2E freebusy fixture created', { 
      fixtureId, threadId, slotCount: createdSlots.length, token, busy_pattern 
    });

    // レスポンス
    const baseUrl = env.ENVIRONMENT === 'development' 
      ? 'http://localhost:3000' 
      : 'https://app.tomoniwao.jp';

    // all_busy の場合は特別なレスポンス
    if (busy_pattern === 'all_busy') {
      return c.json({
        success: true,
        fixture_id: fixtureId,
        busy_pattern,
        no_slots: true,
        message: '全ての時間が埋まっているため、空き枠がありません',
        constraints: {
          time_min: timeMin.toISOString(),
          time_max: timeMax.toISOString(),
          prefer,
          duration
        }
      }, 201);
    }

    return c.json({
      success: true,
      fixture_id: fixtureId,
      token,
      thread_id: threadId,
      invite_id: inviteId,
      share_url: `${baseUrl}/i/${token}`,
      slots: createdSlots,
      busy_pattern,
      invitee: {
        name: invitee_name,
        email: invitee_email
      },
      constraints: {
        time_min: timeMin.toISOString(),
        time_max: timeMax.toISOString(),
        prefer,
        duration
      }
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E freebusy fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Cleanup Freebusy Context Fixture
 * 
 * @route DELETE /test/fixtures/freebusy-context/:token
 */
app.delete('/freebusy-context/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'cleanup-freebusy' });
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

    log.debug('E2E freebusy fixture cleaned up', { token, thread_id: invite.thread_id });

    return c.json({ success: true, deleted_thread_id: invite.thread_id });

  } catch (error) {
    log.error('Failed to cleanup E2E freebusy fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Create Open Slots Fixture (PR-B4-E2E)
 * 
 * E2Eテスト用に open_slots + open_slot_items を作成
 * TimeRex型の空き枠公開ページをテストするためのフィクスチャ
 * 
 * @route POST /test/fixtures/open-slots
 * @body {
 *   invitee_name?: string,      // デフォルト: "オープンスロットテスト太郎"
 *   invitee_email?: string,     // デフォルト: "open-slots-test@example.com"
 *   title?: string,             // デフォルト: "E2E Open Slots テスト"
 *   slot_count?: number,        // デフォルト: 5（1〜10）
 *   prefer?: 'morning' | 'afternoon' | 'evening' | 'any',  // デフォルト: 'afternoon'
 *   duration_minutes?: number   // デフォルト: 60
 * }
 * @returns {
 *   success: true,
 *   token: string,
 *   thread_id: string,
 *   open_slots_id: string,
 *   share_url: string,
 *   slots: Array<{ item_id: string; start_at: string; end_at: string }>,
 *   invitee: { name: string; email: string }
 * }
 */
app.post('/open-slots', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'open-slots' });

  // 本番環境での実行を絶対に阻止（二重ガード）
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      invitee_name = 'オープンスロットテスト太郎',
      invitee_email = 'open-slots-test@example.com',
      title = 'E2E Open Slots テスト',
      slot_count = 5,
      prefer = 'afternoon',
      duration_minutes = 60
    } = body as {
      invitee_name?: string;
      invitee_email?: string;
      title?: string;
      slot_count?: number;
      prefer?: 'morning' | 'afternoon' | 'evening' | 'any';
      duration_minutes?: number;
    };

    const now = new Date();
    const nowISO = now.toISOString();
    
    // ========================================
    // フレーク防止: 「翌営業日」基準 + 固定時刻
    // ========================================
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    // 土日をスキップして翌営業日を取得
    let dayOfWeek = tomorrow.getDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
      dayOfWeek = tomorrow.getDay();
    }
    
    // time_min: 翌営業日 09:00, time_max: 2週間後
    const timeMin = new Date(tomorrow);
    timeMin.setHours(9, 0, 0, 0);
    const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    // IDs
    const threadId = uuidv4();
    const openSlotsId = uuidv4();
    const token = `open-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7日後
    
    // デフォルト workspace/user（テスト用）
    const testWorkspaceId = 'test-workspace-001';
    const testOwnerUserId = 'test-user-001';
    
    // constraints_json
    const constraintsJson = JSON.stringify({
      time_min: timeMin.toISOString(),
      time_max: timeMax.toISOString(),
      prefer,
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      duration: duration_minutes,
      slot_interval: 30,
      source: 'open_slots_fixture'
    });

    // ========================================
    // 1. scheduling_threads 作成
    // ========================================
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description, status, mode, 
        slot_policy, constraints_json, proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'one_on_one', 'open_slots', ?, 1, 0, ?, ?)
    `).bind(
      threadId,
      testWorkspaceId,
      testOwnerUserId,
      title,
      'E2E Open Slots テスト用',
      constraintsJson,
      nowISO,
      nowISO
    ).run();

    // ========================================
    // 2. open_slots 作成
    // ========================================
    await env.DB.prepare(`
      INSERT INTO open_slots (
        id, thread_id, token, workspace_id, owner_user_id,
        time_min, time_max, duration_minutes, prefer, days_json,
        invitee_name, invitee_email, title, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).bind(
      openSlotsId,
      threadId,
      token,
      testWorkspaceId,
      testOwnerUserId,
      timeMin.toISOString(),
      timeMax.toISOString(),
      duration_minutes,
      prefer,
      JSON.stringify(['mon', 'tue', 'wed', 'thu', 'fri']),
      invitee_name,
      invitee_email,
      title,
      expiresAt.toISOString(),
      nowISO,
      nowISO
    ).run();

    // ========================================
    // 3. open_slot_items 作成（午後の枠を生成）
    // ========================================
    const createdSlots: Array<{ item_id: string; start_at: string; end_at: string }> = [];
    
    // 午後の時間帯（13:00, 14:00, 15:00, 16:00, 17:00）
    const AFTERNOON_HOURS = [13, 14, 15, 16, 17];
    const effectiveSlotCount = Math.min(slot_count, 10);
    
    for (let i = 0; i < effectiveSlotCount; i++) {
      const slotDate = new Date(tomorrow);
      slotDate.setDate(slotDate.getDate() + Math.floor(i / AFTERNOON_HOURS.length));
      // 平日のみ
      while (slotDate.getDay() === 0 || slotDate.getDay() === 6) {
        slotDate.setDate(slotDate.getDate() + 1);
      }
      slotDate.setHours(AFTERNOON_HOURS[i % AFTERNOON_HOURS.length], 0, 0, 0);
      
      const startAt = new Date(slotDate);
      const endAt = new Date(startAt.getTime() + duration_minutes * 60 * 1000);
      const itemId = uuidv4();
      
      await env.DB.prepare(`
        INSERT INTO open_slot_items (
          id, open_slots_id, start_at, end_at, status, created_at
        ) VALUES (?, ?, ?, ?, 'available', ?)
      `).bind(
        itemId,
        openSlotsId,
        startAt.toISOString(),
        endAt.toISOString(),
        nowISO
      ).run();
      
      createdSlots.push({
        item_id: itemId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString()
      });
    }

    log.debug('E2E open slots fixture created', { 
      threadId, 
      openSlotsId, 
      token,
      slot_count: createdSlots.length 
    });

    // レスポンス
    const baseUrl = env.ENVIRONMENT === 'development' 
      ? 'http://localhost:3000' 
      : 'https://app.tomoniwao.jp';

    return c.json({
      success: true,
      token,
      thread_id: threadId,
      open_slots_id: openSlotsId,
      share_url: `${baseUrl}/open/${token}`,
      slots: createdSlots,
      invitee: {
        name: invitee_name,
        email: invitee_email
      },
      constraints: {
        time_min: timeMin.toISOString(),
        time_max: timeMax.toISOString(),
        prefer,
        duration: duration_minutes
      }
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E open slots fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Cleanup Open Slots Fixture
 * 
 * @route DELETE /test/fixtures/open-slots/:token
 */
app.delete('/open-slots/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'cleanup-open-slots' });
  const token = c.req.param('token');

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    // token から open_slots を取得
    const openSlots = await env.DB.prepare(`
      SELECT id, thread_id FROM open_slots WHERE token = ?
    `).bind(token).first<{ id: string; thread_id: string }>();

    if (!openSlots) {
      return c.json({ error: 'Fixture not found' }, 404);
    }

    // 関連データを削除（順序重要: 子から親へ）
    await env.DB.prepare(`DELETE FROM thread_selections WHERE thread_id = ?`).bind(openSlots.thread_id).run();
    await env.DB.prepare(`DELETE FROM open_slot_items WHERE open_slots_id = ?`).bind(openSlots.id).run();
    await env.DB.prepare(`DELETE FROM open_slots WHERE id = ?`).bind(openSlots.id).run();
    await env.DB.prepare(`DELETE FROM scheduling_threads WHERE id = ?`).bind(openSlots.thread_id).run();

    log.debug('E2E open slots fixture cleaned up', { token, thread_id: openSlots.thread_id });

    return c.json({ success: true, deleted_thread_id: openSlots.thread_id, deleted_open_slots_id: openSlots.id });

  } catch (error) {
    log.error('Failed to cleanup E2E open slots fixture', { 
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
/**
 * Create User Pair Fixture (PR-D1-E2E)
 * 
 * E2Eテスト用に2ユーザーを作成し、それぞれのログイントークンを発行
 * 
 * @route POST /test/fixtures/users/pair
 * @body {
 *   user_a?: { email?: string; display_name?: string },
 *   user_b?: { email?: string; display_name?: string }
 * }
 * @returns {
 *   success: true,
 *   fixture_id: string,
 *   user_a: { id: string, email: string, display_name: string, token: string },
 *   user_b: { id: string, email: string, display_name: string, token: string }
 * }
 */
app.post('/users/pair', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'users-pair' });

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      user_a = {},
      user_b = {}
    } = body as {
      user_a?: { email?: string; display_name?: string };
      user_b?: { email?: string; display_name?: string };
    };

    const now = new Date();
    const nowISO = now.toISOString();
    const fixtureId = `fixture-pair-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // ユーザーA
    const userAId = `e2e-user-a-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const userAEmail = user_a.email || `e2e-a-${Date.now()}@example.com`;
    const userADisplayName = user_a.display_name || 'E2Eテスト ユーザーA';
    const userAToken = `e2e-token-a-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // ユーザーB
    const userBId = `e2e-user-b-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const userBEmail = user_b.email || `e2e-b-${Date.now()}@example.com`;
    const userBDisplayName = user_b.display_name || 'E2Eテスト ユーザーB';
    const userBToken = `e2e-token-b-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // デフォルトワークスペース
    const testWorkspaceId = 'test-workspace-e2e';

    // ワークスペースが存在しない場合は作成
    const existingWorkspace = await env.DB.prepare(
      `SELECT id FROM workspaces WHERE id = ?`
    ).bind(testWorkspaceId).first();
    
    if (!existingWorkspace) {
      await env.DB.prepare(`
        INSERT INTO workspaces (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).bind(testWorkspaceId, 'E2E Test Workspace', nowISO, nowISO).run();
    }

    // ユーザーA作成
    await env.DB.prepare(`
      INSERT INTO users (id, workspace_id, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userAId, testWorkspaceId, userAEmail, userADisplayName, nowISO, nowISO).run();

    // ユーザーB作成
    await env.DB.prepare(`
      INSERT INTO users (id, workspace_id, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userBId, testWorkspaceId, userBEmail, userBDisplayName, nowISO, nowISO).run();

    // セッショントークンをsessionsテーブルに保存（1時間有効）
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    
    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`sess-a-${Date.now()}`, userAId, userAToken, expiresAt, nowISO).run();

    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`sess-b-${Date.now()}`, userBId, userBToken, expiresAt, nowISO).run();

    log.debug('E2E user pair created', { 
      fixtureId, 
      userAId, userAEmail,
      userBId, userBEmail 
    });

    return c.json({
      success: true,
      fixture_id: fixtureId,
      user_a: {
        id: userAId,
        email: userAEmail,
        display_name: userADisplayName,
        token: userAToken
      },
      user_b: {
        id: userBId,
        email: userBEmail,
        display_name: userBDisplayName,
        token: userBToken
      }
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E user pair', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Cleanup User Pair Fixture
 * 
 * @route DELETE /test/fixtures/users/pair/:fixtureId
 * @body { user_ids: string[] }
 */
app.delete('/users/pair', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'cleanup-users-pair' });

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const { user_ids = [] } = body as { user_ids?: string[] };

    if (user_ids.length === 0) {
      return c.json({ error: 'user_ids required' }, 400);
    }

    // E2E ユーザーのみ削除可能（e2e- プレフィックス必須）
    const validIds = user_ids.filter(id => id.startsWith('e2e-'));
    
    for (const userId of validIds) {
      // 関連データを削除（順序重要）
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
      await env.DB.prepare(`DELETE FROM inbox WHERE user_id = ?`).bind(userId).run();
      await env.DB.prepare(`DELETE FROM relationships WHERE user_a_id = ? OR user_b_id = ?`).bind(userId, userId).run();
      await env.DB.prepare(`DELETE FROM relationship_requests WHERE inviter_user_id = ? OR invitee_user_id = ?`).bind(userId, userId).run();
      await env.DB.prepare(`DELETE FROM contacts WHERE owner_user_id = ?`).bind(userId).run();
      await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
    }

    log.debug('E2E user pair cleaned up', { deleted_user_ids: validIds });

    return c.json({ success: true, deleted_user_ids: validIds });

  } catch (error) {
    log.error('Failed to cleanup E2E user pair', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Clear inbox for user
 * 
 * @route DELETE /test/fixtures/inbox/:userId
 */
app.delete('/inbox/:userId', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'clear-inbox' });
  const userId = c.req.param('userId');

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  // E2E ユーザーのみ削除可能
  if (!userId.startsWith('e2e-')) {
    return c.json({ error: 'Only e2e- prefixed users allowed' }, 403);
  }

  try {
    const result = await env.DB.prepare(`DELETE FROM inbox WHERE user_id = ?`).bind(userId).run();
    
    log.debug('Inbox cleared', { userId, deleted_count: result.meta.changes });

    return c.json({ 
      success: true, 
      user_id: userId,
      deleted_count: result.meta.changes 
    });

  } catch (error) {
    log.error('Failed to clear inbox', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Create Relationship Between Users (PR-D1-ACCESS-E2E)
 * 
 * E2Eテスト用に2ユーザー間の関係を直接作成（リクエスト/承認をスキップ）
 * 
 * @route POST /test/fixtures/relationships
 * @body {
 *   user_a_id: string,           // ユーザーA ID (e2e- prefix required)
 *   user_b_id: string,           // ユーザーB ID (e2e- prefix required)
 *   relation_type: 'workmate' | 'family',
 *   permission_preset: 'workmate_default' | 'family_view_freebusy' | 'family_can_write'
 * }
 * @returns {
 *   success: true,
 *   relationship_id: string,
 *   relation_type: string,
 *   permission_preset: string
 * }
 */
app.post('/relationships', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'create-relationship' });

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json();
    const {
      user_a_id,
      user_b_id,
      relation_type,
      permission_preset
    } = body as {
      user_a_id: string;
      user_b_id: string;
      relation_type: 'workmate' | 'family';
      permission_preset: 'workmate_default' | 'family_view_freebusy' | 'family_can_write';
    };

    // Validate required fields
    if (!user_a_id || !user_b_id || !relation_type || !permission_preset) {
      return c.json({ 
        error: 'invalid_request', 
        message: 'user_a_id, user_b_id, relation_type, permission_preset are required' 
      }, 400);
    }

    // E2E ユーザーのみ許可
    if (!user_a_id.startsWith('e2e-') || !user_b_id.startsWith('e2e-')) {
      return c.json({ error: 'Only e2e- prefixed users allowed' }, 403);
    }

    const now = new Date();
    const nowISO = now.toISOString();
    
    // Normalize user pair (alphabetical order)
    const [normalizedA, normalizedB] = [user_a_id, user_b_id].sort();
    const relationshipId = `e2e-rel-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // 既存の関係を削除
    await env.DB.prepare(`
      DELETE FROM relationships 
      WHERE (user_a_id = ? AND user_b_id = ?) OR (user_a_id = ? AND user_b_id = ?)
    `).bind(normalizedA, normalizedB, normalizedB, normalizedA).run();

    // 関係を作成
    await env.DB.prepare(`
      INSERT INTO relationships (id, user_a_id, user_b_id, relation_type, status, permission_preset, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).bind(relationshipId, normalizedA, normalizedB, relation_type, permission_preset, nowISO, nowISO).run();

    log.debug('E2E relationship created', { 
      relationshipId, 
      user_a_id: normalizedA, 
      user_b_id: normalizedB,
      relation_type,
      permission_preset
    });

    return c.json({
      success: true,
      relationship_id: relationshipId,
      user_a_id: normalizedA,
      user_b_id: normalizedB,
      relation_type,
      permission_preset
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E relationship', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Delete Relationship Between Users (PR-D1-ACCESS-E2E)
 * 
 * @route DELETE /test/fixtures/relationships
 * @body { user_a_id: string, user_b_id: string }
 */
app.delete('/relationships', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'delete-relationship' });

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json();
    const { user_a_id, user_b_id } = body as { user_a_id: string; user_b_id: string };

    if (!user_a_id || !user_b_id) {
      return c.json({ error: 'user_a_id and user_b_id required' }, 400);
    }

    // E2E ユーザーのみ許可
    if (!user_a_id.startsWith('e2e-') || !user_b_id.startsWith('e2e-')) {
      return c.json({ error: 'Only e2e- prefixed users allowed' }, 403);
    }

    // Normalize user pair (alphabetical order)
    const [normalizedA, normalizedB] = [user_a_id, user_b_id].sort();

    const result = await env.DB.prepare(`
      DELETE FROM relationships 
      WHERE user_a_id = ? AND user_b_id = ?
    `).bind(normalizedA, normalizedB).run();

    log.debug('E2E relationship deleted', { 
      user_a_id: normalizedA, 
      user_b_id: normalizedB,
      deleted_count: result.meta.changes
    });

    return c.json({ 
      success: true, 
      deleted_count: result.meta.changes 
    });

  } catch (error) {
    log.error('Failed to delete E2E relationship', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.get('/health', (c) => {
  const env = c.env as Env;
  
  return c.json({
    status: 'ok',
    module: 'test-fixtures',
    environment: env.ENVIRONMENT || 'unknown',
    available: env.ENVIRONMENT !== 'production',
    endpoints: [
      'POST /one-on-one',
      'POST /one-on-one-candidates',
      'POST /freebusy-context',
      'POST /open-slots',
      'POST /one-to-many-candidates',
      'POST /users/pair',
      'POST /relationships',
      'DELETE /one-on-one/:token',
      'DELETE /freebusy-context/:token',
      'DELETE /open-slots/:token',
      'DELETE /one-to-many/:threadId',
      'DELETE /users/pair',
      'DELETE /inbox/:userId',
      'DELETE /relationships'
    ]
  });
});

// ============================================================
// G1: 1対N (Broadcast Scheduling) Fixtures
// ============================================================

/**
 * Create 1-to-N Candidates Schedule Fixture
 * 
 * E2Eテスト用に 1対N scheduling_thread + scheduling_slots + thread_invites を作成
 * 
 * @route POST /test/fixtures/one-to-many-candidates
 * @body {
 *   organizer_user_id?: string,   // デフォルト: 自動生成 (e2e-organizer-xxx)
 *   invitee_count?: number,       // デフォルト: 3
 *   title?: string,               // デフォルト: "E2E 1対Nテスト"
 *   slot_count?: number,          // デフォルト: 3
 *   start_offset_hours?: number,  // デフォルト: 48
 *   duration_minutes?: number,    // デフォルト: 60
 *   deadline_hours?: number       // デフォルト: 72
 * }
 * @returns {
 *   success: true,
 *   thread_id: string,
 *   organizer_user_id: string,
 *   invites: Array<{ token: string, email: string, name: string }>,
 *   slots: Array<{ slot_id: string, start_at: string, end_at: string }>,
 *   group_policy: { mode: string, deadline_at: string, finalize_policy: string }
 * }
 */
app.post('/one-to-many-candidates', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'one-to-many-candidates' });

  // 本番環境での実行を絶対に阻止
  if (env.ENVIRONMENT === 'production') {
    log.warn('Attempted to use test fixtures in production');
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      organizer_user_id,
      invitee_count = 3,
      title = 'E2E 1対Nテスト',
      slot_count = 3,
      start_offset_hours = 48,
      duration_minutes = 60,
      deadline_hours = 72,
      mode = 'candidates'  // 'candidates' | 'open_slots'
    } = body as {
      organizer_user_id?: string;
      invitee_count?: number;
      title?: string;
      slot_count?: number;
      start_offset_hours?: number;
      duration_minutes?: number;
      deadline_hours?: number;
      mode?: 'candidates' | 'open_slots';
    };

    const now = new Date();
    const nowISO = now.toISOString();
    
    // ========================================
    // Organizer ユーザー作成（なければ作成）
    // ========================================
    const organizerId = organizer_user_id || `e2e-organizer-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // ユーザーが存在しなければ作成
    const existingUser = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(organizerId).first();
    if (!existingUser) {
      await env.DB.prepare(`
        INSERT INTO users (id, email, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        organizerId,
        `${organizerId}@e2e-test.example.com`,
        'E2E Organizer',
        nowISO,
        nowISO
      ).run();
    }

    // ========================================
    // Thread 作成
    // ========================================
    const threadId = uuidv4();
    const deadlineAt = new Date(now.getTime() + deadline_hours * 60 * 60 * 1000).toISOString();
    
    const groupPolicy = {
      mode: mode,  // 'candidates' or 'open_slots'
      deadline_at: deadlineAt,
      finalize_policy: 'organizer_decides',
      auto_finalize: false,
      max_reproposals: 2,
      reproposal_count: 0
    };

    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, organizer_user_id, title, description, status, mode, kind, topology, group_policy_json, workspace_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sent', 'group', 'external', 'one_to_many', ?, 'ws-default', ?, ?)
    `).bind(
      threadId,
      organizerId,
      title,
      'E2Eテスト用の1対Nスケジュールです',
      JSON.stringify(groupPolicy),
      nowISO,
      nowISO
    ).run();

    // ========================================
    // Slots 作成
    // ========================================
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    const createdSlots: Array<{ slot_id: string; start_at: string; end_at: string; label: string }> = [];
    
    for (let i = 0; i < slot_count; i++) {
      const slotId = uuidv4();
      const startAt = new Date(tomorrow.getTime() + (start_offset_hours + i * 24) * 60 * 60 * 1000);
      const endAt = new Date(startAt.getTime() + duration_minutes * 60 * 1000);
      const label = formatDateTimeJP(startAt.toISOString());
      
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label, created_at)
        VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, ?)
      `).bind(slotId, threadId, startAt.toISOString(), endAt.toISOString(), label, nowISO).run();
      
      createdSlots.push({
        slot_id: slotId,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        label
      });
    }

    // ========================================
    // Invites 作成
    // ========================================
    const createdInvites: Array<{ token: string; email: string; name: string; invite_id: string }> = [];
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    
    for (let i = 0; i < invitee_count; i++) {
      const inviteId = uuidv4();
      const token = `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const email = `e2e-invitee-${i + 1}@e2e-test.example.com`;
      const name = `E2Eテスト参加者${i + 1}`;
      // Cloudflare Workers compatible invitee key generation
      const encoder = new TextEncoder();
      const data = encoder.encode(email.toLowerCase());
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const inviteeKey = `e:${hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')}`;
      
      await env.DB.prepare(`
        INSERT INTO thread_invites (
          id, thread_id, token, email, candidate_name, candidate_reason,
          invitee_key, status, expires_at, channel_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'email', ?)
      `).bind(
        inviteId,
        threadId,
        token,
        email,
        name,
        'E2E 1対Nテスト用の招待',
        inviteeKey,
        expiresAt,
        nowISO
      ).run();
      
      createdInvites.push({ token, email, name, invite_id: inviteId });
    }

    log.debug('E2E 1-to-N candidates fixture created', { 
      threadId, 
      organizerId,
      slot_count: createdSlots.length, 
      invitee_count: createdInvites.length 
    });

    return c.json({
      success: true,
      thread_id: threadId,
      organizer_user_id: organizerId,
      invites: createdInvites,
      slots: createdSlots,
      group_policy: groupPolicy,
      deadline_at: deadlineAt
    }, 201);

  } catch (error) {
    log.error('Failed to create E2E 1-to-N candidates fixture', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Delete 1-to-N Thread Fixture
 * 
 * @route DELETE /test/fixtures/one-to-many/:threadId
 */
app.delete('/one-to-many/:threadId', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'TestFixtures', handler: 'delete-one-to-many' });

  if (env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Forbidden in production' }, 403);
  }

  const threadId = c.req.param('threadId');
  
  try {
    // CASCADE により関連データも削除される
    await env.DB.prepare(`DELETE FROM scheduling_threads WHERE id = ?`).bind(threadId).run();
    
    log.debug('E2E 1-to-N fixture deleted', { threadId });
    
    return c.json({ success: true, deleted_thread_id: threadId });
  } catch (error) {
    log.error('Failed to delete E2E 1-to-N fixture', { 
      threadId,
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
