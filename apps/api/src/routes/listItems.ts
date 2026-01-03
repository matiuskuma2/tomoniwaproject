/**
 * Phase Next-8 Day2: List Items API
 * 
 * Purpose: タスク/TODO/リストアイテムの管理
 * Scale: 1億行前提の cursor pagination
 * 
 * API:
 * - GET /api/lists/:listId/items?limit=20&cursor=xxx
 * - POST /api/lists/:listId/items
 * - PATCH /api/list-items/:id
 * - DELETE /api/list-items/:id (soft delete)
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { decodeCursor, encodeCursor, clampLimit, buildCursorCondition } from '../utils/cursor';
import { writeListItemEvent } from '../utils/audit';

type AppContext = { Bindings: Env; Variables: Variables };

const app = new Hono<AppContext>();

/**
 * Get userId from context (throw if not authenticated)
 */
function mustUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('unauthorized');
  return userId;
}

/**
 * Get workspace_id and owner_user_id
 * 
 * Note: Phase Next-8では workspace_id = 'ws-default' を固定
 * 将来的にマルチワークスペース対応時に変更
 */
function getWorkspaceContext(userId: string) {
  return {
    workspaceId: 'ws-default',
    ownerUserId: userId,
  };
}

/**
 * GET /api/lists/:listId/items?limit=20&cursor=xxx
 * 
 * Purpose: リスト内のアイテム一覧を取得（cursor pagination）
 * Order: created_at DESC, id DESC
 * Cursor: base64url(created_at|id)
 */
app.get('/lists/:listId/items', async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const userId = mustUserId(c);
    const { workspaceId, ownerUserId } = getWorkspaceContext(userId);
    const listId = c.req.param('listId');
    const limit = clampLimit(c.req.query('limit'));
    const cursorStr = c.req.query('cursor');
    const cursor = cursorStr ? decodeCursor(cursorStr) : null;

    // Build SQL
    let sql = `
      SELECT 
        id, workspace_id, owner_user_id, list_id, contact_id,
        title, note, status, priority, due_at,
        created_at, updated_at
      FROM list_items
      WHERE workspace_id = ? AND owner_user_id = ? AND list_id = ? AND deleted_at IS NULL
    `;
    const binds: any[] = [workspaceId, ownerUserId, listId];

    // Cursor condition for DESC order
    const cursorCond = buildCursorCondition(cursor);
    sql += cursorCond.sql;
    binds.push(...cursorCond.binds);

    sql += ` ORDER BY created_at DESC, id DESC LIMIT ? `;
    binds.push(limit + 1); // fetch one extra to know has_more

    // Execute
    const rows = await c.env.DB.prepare(sql).bind(...binds).all<any>();
    const items = rows.results ?? [];
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const nextCursor = hasMore
      ? encodeCursor({ 
          createdAt: page[page.length - 1].created_at, 
          id: page[page.length - 1].id 
        })
      : null;

    return c.json({
      request_id: requestId,
      items: page,
      pagination: {
        limit,
        cursor: cursorStr ?? null,
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    });
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listItems.get]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

/**
 * POST /api/lists/:listId/items
 * 
 * Body: {
 *   title: string,
 *   note?: string,
 *   priority?: number (0..3),
 *   due_at?: string (ISO8601),
 *   contact_id?: string
 * }
 * 
 * NOTE: idempotency_key は Week2/3 で追加予定
 */
app.post('/lists/:listId/items', async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const userId = mustUserId(c);
    const { workspaceId, ownerUserId } = getWorkspaceContext(userId);
    const listId = c.req.param('listId');

    const body = await c.req.json<{
      title: string;
      note?: string;
      priority?: number;
      due_at?: string | null;
      contact_id?: string | null;
    }>();

    // Validation
    const title = (body.title ?? '').trim();
    if (!title || title.length > 200) {
      return c.json({ 
        error: 'invalid_title', 
        message: 'Title is required and must be <= 200 characters',
        request_id: requestId 
      }, 400);
    }

    const id = crypto.randomUUID();
    const priority = Number.isFinite(body.priority) 
      ? Math.max(0, Math.min(3, Math.floor(body.priority!))) 
      : 0;
    const dueAt = body.due_at ?? null;
    const contactId = body.contact_id ?? null;
    const note = body.note ?? null;

    // Note長制限: 10KB程度（超えたらR2へ）
    if (note && note.length > 10000) {
      return c.json({
        error: 'note_too_long',
        message: 'Note must be <= 10,000 characters. Use R2 for longer content.',
        request_id: requestId
      }, 400);
    }

    // Insert
    await c.env.DB.prepare(`
      INSERT INTO list_items (
        id, workspace_id, owner_user_id, list_id, contact_id,
        title, note, status, priority, due_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `)
      .bind(id, workspaceId, ownerUserId, listId, contactId, title, note, priority, dueAt)
      .run();

    // Audit log
    await writeListItemEvent(c.env.DB, {
      userId,
      workspaceId,
      ownerUserId,
      listItemId: id,
      action: 'created',
      payload: { list_id: listId, title, priority, due_at: dueAt, contact_id: contactId },
      requestId,
    });

    return c.json({ 
      request_id: requestId, 
      id, 
      success: true 
    }, 201);
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listItems.post]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

/**
 * PATCH /api/list-items/:id
 * 
 * Body: {
 *   title?: string,
 *   note?: string,
 *   status?: number (0=open, 1=done, 2=archived),
 *   priority?: number (0..3),
 *   due_at?: string | null
 * }
 */
app.patch('/list-items/:id', async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const userId = mustUserId(c);
    const { workspaceId, ownerUserId } = getWorkspaceContext(userId);
    const id = c.req.param('id');

    const body = await c.req.json<{
      title?: string;
      note?: string;
      status?: number;
      priority?: number;
      due_at?: string | null;
    }>();

    // Fetch existing item
    const existing = await c.env.DB.prepare(`
      SELECT * FROM list_items
      WHERE id = ? AND workspace_id = ? AND owner_user_id = ? AND deleted_at IS NULL
    `)
      .bind(id, workspaceId, ownerUserId)
      .first<any>();

    if (!existing) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // Build UPDATE
    const updates: string[] = [];
    const binds: any[] = [];
    const diff: any = { old: {}, new: {} };

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title || title.length > 200) {
        return c.json({ 
          error: 'invalid_title', 
          message: 'Title must be 1-200 characters',
          request_id: requestId 
        }, 400);
      }
      updates.push('title = ?');
      binds.push(title);
      diff.old.title = existing.title;
      diff.new.title = title;
    }

    if (body.note !== undefined) {
      if (body.note && body.note.length > 10000) {
        return c.json({
          error: 'note_too_long',
          message: 'Note must be <= 10,000 characters',
          request_id: requestId
        }, 400);
      }
      updates.push('note = ?');
      binds.push(body.note);
      diff.old.note = existing.note;
      diff.new.note = body.note;
    }

    if (body.status !== undefined) {
      const status = Math.max(0, Math.min(2, Math.floor(body.status)));
      updates.push('status = ?');
      binds.push(status);
      diff.old.status = existing.status;
      diff.new.status = status;
    }

    if (body.priority !== undefined) {
      const priority = Math.max(0, Math.min(3, Math.floor(body.priority)));
      updates.push('priority = ?');
      binds.push(priority);
      diff.old.priority = existing.priority;
      diff.new.priority = priority;
    }

    if (body.due_at !== undefined) {
      updates.push('due_at = ?');
      binds.push(body.due_at);
      diff.old.due_at = existing.due_at;
      diff.new.due_at = body.due_at;
    }

    if (updates.length === 0) {
      return c.json({ 
        error: 'no_changes', 
        message: 'No fields to update',
        request_id: requestId 
      }, 400);
    }

    updates.push("updated_at = datetime('now')");

    // Execute UPDATE
    const sql = `UPDATE list_items SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`;
    binds.push(id, workspaceId, ownerUserId);
    await c.env.DB.prepare(sql).bind(...binds).run();

    // Audit log
    const action = diff.new.status !== undefined ? 'status_changed' : 'updated';
    await writeListItemEvent(c.env.DB, {
      userId,
      workspaceId,
      ownerUserId,
      listItemId: id,
      action,
      payload: diff,
      requestId,
    });

    return c.json({ 
      request_id: requestId, 
      success: true 
    });
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listItems.patch]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

/**
 * DELETE /api/list-items/:id
 * 
 * Purpose: Soft delete（deleted_at を設定）
 * 物理削除は別ジョブで行う
 */
app.delete('/list-items/:id', async (c) => {
  const requestId = crypto.randomUUID();
  try {
    const userId = mustUserId(c);
    const { workspaceId, ownerUserId } = getWorkspaceContext(userId);
    const id = c.req.param('id');

    // Check if exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM list_items
      WHERE id = ? AND workspace_id = ? AND owner_user_id = ? AND deleted_at IS NULL
    `)
      .bind(id, workspaceId, ownerUserId)
      .first<any>();

    if (!existing) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    // Soft delete
    await c.env.DB.prepare(`
      UPDATE list_items 
      SET deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND workspace_id = ? AND owner_user_id = ?
    `)
      .bind(id, workspaceId, ownerUserId)
      .run();

    // Audit log
    await writeListItemEvent(c.env.DB, {
      userId,
      workspaceId,
      ownerUserId,
      listItemId: id,
      action: 'deleted',
      payload: {},
      requestId,
    });

    return c.json({ 
      request_id: requestId, 
      success: true 
    });
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listItems.delete]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

export default app;
