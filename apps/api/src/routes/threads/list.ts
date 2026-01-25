/**
 * Threads List Routes - Phase 2-2
 * 
 * threads.ts から GET 系ルートを分離
 * - GET / (一覧)
 * - GET /:id (詳細)
 * 
 * Note: ロジック変更なし（純移動）
 */

import { Hono } from 'hono';
import { getUserIdFromContext } from '../../middleware/auth';
import type { Env } from '../../../../../packages/shared/src/types/env';
import { THREAD_STATUS, isValidThreadStatus } from '../../../../../packages/shared/src/types/thread';
import { getTenant } from '../../utils/workspaceContext';
import { encodeCursor, decodeCursor } from '../../utils/cursor';
import type { Variables } from './index';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Get user's threads (P0-2: cursor pagination only)
 * 
 * @route GET /threads
 * @query status?: 'draft' | 'sent' | 'confirmed' | 'cancelled'
 * @query limit?: number (default: 50, max: 100)
 * @query cursor?: string (encoded: created_at|id)
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const status = c.req.query('status');
    const rawLimit = parseInt(c.req.query('limit') || '50', 10);
    const limit = Math.min(Math.max(1, rawLimit), 100); // clamp: 1-100
    const cursorParam = c.req.query('cursor');

    // P0-2: Decode cursor (using cursor.ts for format safety)
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;

    if (cursorParam) {
      const decoded = decodeCursor(cursorParam);
      if (!decoded) {
        return c.json({ error: 'Invalid cursor format' }, 400);
      }
      cursorCreatedAt = decoded.timestamp;
      cursorId = decoded.id;
    }
    
    // Get threads for user (P0-1: tenant isolation + P0-2: cursor pagination)
    let query = `
      SELECT 
        t.id,
        t.organizer_user_id,
        t.title,
        t.description,
        t.status,
        t.mode,
        t.created_at,
        t.updated_at,
        COUNT(DISTINCT ti.id) as invite_count,
        COUNT(DISTINCT CASE WHEN ti.status = 'accepted' THEN ti.id END) as accepted_count
      FROM scheduling_threads t
      LEFT JOIN thread_invites ti ON ti.thread_id = t.id
      WHERE t.workspace_id = ?
        AND t.organizer_user_id = ?
    `;
    
    const params: any[] = [workspaceId, ownerUserId];
    
    // Validate status parameter
    if (status) {
      if (!isValidThreadStatus(status)) {
        return c.json({ 
          error: 'Invalid status',
          message: `Status must be one of: ${Object.values(THREAD_STATUS).join(', ')}`
        }, 400);
      }
      query += ` AND t.status = ?`;
      params.push(status);
    }

    // P0-2: Cursor pagination
    if (cursorCreatedAt && cursorId) {
      query += ` AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))`;
      params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }
    
    query += ` 
      GROUP BY t.id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ?
    `;
    params.push(limit + 1); // +1 for hasMore detection

    const { results } = await env.DB.prepare(query).bind(...params).all();

    // P0-2: Detect hasMore
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    // P0-2: Generate next cursor (using cursor.ts for format safety)
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1] as any;
      nextCursor = encodeCursor({
        timestamp: last.created_at,
        id: last.id,
      });
    }

    return c.json({
      threads: items,
      pagination: {
        limit,
        cursor: nextCursor,
        has_more: hasMore,
      },
    });
  } catch (error) {
    console.error('[Threads] List error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get thread details
 * 
 * @route GET /threads/:id
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    // Get thread from scheduling_threads (P0-1: tenant isolation)
    const thread = await env.DB.prepare(`
      SELECT * FROM scheduling_threads 
      WHERE id = ?
        AND workspace_id = ?
        AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first();

    if (!thread) {
      // P0-1: 404 で存在を隠す
      return c.json({ error: 'Thread not found' }, 404);
    }

    // Get invites
    const { results: invites } = await env.DB.prepare(`
      SELECT 
        ti.id,
        ti.thread_id,
        ti.candidate_name,
        ti.candidate_email,
        ti.candidate_reason,
        ti.invite_token,
        ti.status,
        ti.accepted_at,
        ti.created_at
      FROM thread_invites ti
      WHERE ti.thread_id = ?
      ORDER BY ti.created_at DESC
    `).bind(threadId).all();

    return c.json({
      thread,
      invites,
    });
  } catch (error) {
    console.error('[Threads] Get details error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
