/**
 * List Members API (参加者解決の正)
 * - GET /api/lists/:listId/members (cursor paging)
 * - POST /api/lists/:listId/members/batch (bulk add)
 * - DELETE /api/lists/:listId/members/:memberId
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { decodeCursor, encodeCursor, clampLimit } from '../utils/cursor';
import { writeLedgerAudit } from '../utils/ledgerAudit';
import { getWorkspaceId } from '../utils/tenant';

type AppContext = { Bindings: Env; Variables: Variables };

export const listMembersRoutes = new Hono<AppContext>();

function mustUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('unauthorized');
  return userId;
}

/**
 * GET /api/lists/:listId/members?limit=20&cursor=...
 * Tenant isolation: workspace_id + owner_user_id
 * Order: added_at DESC, id DESC
 */
listMembersRoutes.get('/lists/:listId/members', async (c) => {
  const requestId = crypto.randomUUID();
  
  try {
    const userId = mustUserId(c);
    const listId = c.req.param('listId');
    const limit = clampLimit(c.req.query('limit'));
    const cursor = c.req.query('cursor');
    const cur = cursor ? decodeCursor(cursor) : null;

    const workspaceId = getWorkspaceId(userId);
    const ownerUserId = userId;

    // P0-4: list_id の tenant整合性チェック（越境防止）
    const listRow = await c.env.DB.prepare(
      `SELECT id FROM lists WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
    ).bind(listId, workspaceId, ownerUserId).first();
    
    if (!listRow) {
      return c.json({ error: 'list_not_found_or_no_access', request_id: requestId }, 404);
    }

    let sql = `
      SELECT lm.id, lm.list_id, lm.contact_id, lm.added_at, lm.added_by,
             c.display_name, c.email, c.relationship_type
      FROM list_members lm
      LEFT JOIN contacts c ON lm.contact_id = c.id
      WHERE lm.workspace_id = ? AND lm.owner_user_id = ? AND lm.list_id = ?
    `;
    const binds: any[] = [workspaceId, ownerUserId, listId];

    // Cursor condition for DESC order
    if (cur) {
      sql += ` AND (lm.added_at < ? OR (lm.added_at = ? AND lm.id < ?)) `;
      binds.push(cur.timestamp, cur.timestamp, cur.id);
    }

    sql += ` ORDER BY lm.added_at DESC, lm.id DESC LIMIT ? `;
    binds.push(limit + 1);

    const rows = await c.env.DB.prepare(sql).bind(...binds).all<any>();
    const items = rows.results ?? [];
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const nextCursor = hasMore
      ? encodeCursor({ timestamp: page[page.length - 1].added_at, id: page[page.length - 1].id })
      : null;

    return c.json({
      request_id: requestId,
      members: page,
      pagination: {
        limit,
        cursor: cursor ?? null,
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    });
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listMembers.get]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

/**
 * POST /api/lists/:listId/members/batch
 * Body: { contact_ids: string[] }
 * Bulk add with INSERT OR IGNORE (冪等性)
 */
listMembersRoutes.post('/lists/:listId/members/batch', async (c) => {
  const requestId = crypto.randomUUID();
  
  try {
    const userId = mustUserId(c);
    const listId = c.req.param('listId');

    const body = await c.req.json<{ contact_ids: string[] }>();
    const contactIds = body.contact_ids ?? [];

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return c.json({ error: 'invalid_contact_ids', request_id: requestId }, 400);
    }

    if (contactIds.length > 1000) {
      return c.json({ error: 'too_many_contacts', max: 1000, request_id: requestId }, 400);
    }

    const workspaceId = getWorkspaceId(userId);
    const ownerUserId = userId;

    // P0-4: list_id の tenant整合性チェック
    const listRow = await c.env.DB.prepare(
      `SELECT id FROM lists WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
    ).bind(listId, workspaceId, ownerUserId).first();
    
    if (!listRow) {
      return c.json({ error: 'list_not_found_or_no_access', request_id: requestId }, 404);
    }

    // P0-4: contact_ids の tenant整合性チェック（batch検証）
    const contactCheckSql = `
      SELECT id FROM contacts 
      WHERE workspace_id = ? AND owner_user_id = ? AND id IN (${contactIds.map(() => '?').join(',')})
    `;
    const contactRows = await c.env.DB.prepare(contactCheckSql)
      .bind(workspaceId, ownerUserId, ...contactIds)
      .all<{ id: string }>();
    
    const validContactIds = new Set((contactRows.results ?? []).map(r => r.id));
    const invalidContactIds = contactIds.filter(id => !validContactIds.has(id));
    
    if (invalidContactIds.length > 0) {
      return c.json({
        error: 'invalid_contacts',
        invalid_ids: invalidContactIds,
        request_id: requestId
      }, 400);
    }

    // Bulk insert with INSERT OR IGNORE (重複防止)
    const inserted: string[] = [];
    const skipped: string[] = [];
    
    for (const contactId of contactIds) {
      const memberId = crypto.randomUUID();
      try {
        const result = await c.env.DB.prepare(
          `INSERT OR IGNORE INTO list_members (id, workspace_id, owner_user_id, list_id, contact_id, added_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(memberId, workspaceId, ownerUserId, listId, contactId, userId)
          .run();

        // P0-4: INSERT OR IGNORE の結果を正確に判定
        // D1の場合、changes が 0 なら既存レコード（スキップ）
        if (result.meta.changes > 0) {
          inserted.push(contactId);

          // Audit log
          await writeLedgerAudit(c.env.DB, {
            workspaceId,
            ownerUserId,
            actorUserId: userId,
            targetType: 'list_member',
            targetId: memberId,
            action: 'create',
            payload: { list_id: listId, contact_id: contactId },
            requestId,
          });
        } else {
          skipped.push(contactId);
        }
      } catch (err) {
        console.error('[listMembers.batch] insert failed', contactId, err);
        skipped.push(contactId);
      }
    }

    return c.json({
      request_id: requestId,
      success: true,
      inserted: inserted.length,
      skipped: skipped.length,
      total: contactIds.length,
    }, 201);
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listMembers.batch]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

/**
 * DELETE /api/lists/:listId/members/:memberId
 * Physical delete (soft delete 不要)
 */
listMembersRoutes.delete('/lists/:listId/members/:memberId', async (c) => {
  const requestId = crypto.randomUUID();
  
  try {
    const userId = mustUserId(c);
    const listId = c.req.param('listId');
    const memberId = c.req.param('memberId');

    const workspaceId = getWorkspaceId(userId);
    const ownerUserId = userId;

    // Get member info before delete (for audit)
    const member = await c.env.DB.prepare(
      `SELECT contact_id FROM list_members 
       WHERE id = ? AND workspace_id = ? AND owner_user_id = ? AND list_id = ?`
    )
      .bind(memberId, workspaceId, ownerUserId, listId)
      .first<{ contact_id: string }>();

    if (!member) {
      return c.json({ error: 'member_not_found', request_id: requestId }, 404);
    }

    // Delete
    await c.env.DB.prepare(
      `DELETE FROM list_members 
       WHERE id = ? AND workspace_id = ? AND owner_user_id = ? AND list_id = ?`
    )
      .bind(memberId, workspaceId, ownerUserId, listId)
      .run();

    // Audit log
    await writeLedgerAudit(c.env.DB, {
      workspaceId,
      ownerUserId,
      actorUserId: userId,
      targetType: 'list_member',
      targetId: memberId,
      action: 'delete',
      payload: { list_id: listId, contact_id: member.contact_id },
      requestId,
    });

    return c.json({ request_id: requestId, success: true });
  } catch (e: any) {
    if (String(e?.message) === 'unauthorized') {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }
    console.error('[listMembers.delete]', requestId, e);
    return c.json({ error: 'internal_error', request_id: requestId }, 500);
  }
});

export default listMembersRoutes;
