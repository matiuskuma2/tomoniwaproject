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
import { getTenant, ensureOwnedOr404, filterOwnedContactIds } from '../utils/workspaceContext';

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

    // P0-1: Ensure list is owned by current tenant (404 if not)
    const isOwned = await ensureOwnedOr404(c, { table: 'lists', id: listId });
    if (!isOwned) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    const { workspaceId, ownerUserId } = getTenant(c);

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

    // P0-1: Ensure list is owned by current tenant (404 if not)
    const isOwned = await ensureOwnedOr404(c, { table: 'lists', id: listId });
    if (!isOwned) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    const { workspaceId, ownerUserId } = getTenant(c);

    // P0-2: Filter owned contact IDs (batch, chunk splitting, O(1) per chunk)
    const validContactIdsSet = await filterOwnedContactIds(c, contactIds);
    const invalidContactIds = contactIds.filter(id => !validContactIdsSet.has(id));
    
    if (invalidContactIds.length > 0) {
      // Log security incident: attempted cross-tenant access
      await writeLedgerAudit(c.env.DB, {
        workspaceId,
        ownerUserId,
        actorUserId: userId,
        targetType: 'list_member',
        targetId: listId,
        action: 'access_denied',
        payload: { 
          reason: 'invalid_contacts', 
          invalid_ids: invalidContactIds.slice(0, 50)  // Prevent log bloat
        },
        requestId,
        sourceIp: c.req.header('cf-connecting-ip'),
        userAgent: c.req.header('user-agent'),
      });

      return c.json({
        error: 'invalid_contacts',
        request_id: requestId
      }, 400);
    }

    // P0-1: Bulk insert with Transaction + Chunk (200件×N)
    // - Deduplicate contact_ids first (無駄なクエリを減らす)
    // - Split into 200-item chunks to avoid timeout
    // - Use db.batch() for transaction per chunk
    // - Track inserted/skipped/failed accurately via meta.changes
    
    const uniqueContactIds = Array.from(new Set(contactIds));
    const CHUNK_SIZE = 200;
    const inserted: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    
    for (let i = 0; i < uniqueContactIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueContactIds.slice(i, i + CHUNK_SIZE);
      
      try {
        // Prepare batch statements
        const statements = chunk.map((contactId) => {
          const memberId = crypto.randomUUID();
          return c.env.DB.prepare(
            `INSERT OR IGNORE INTO list_members (id, workspace_id, owner_user_id, list_id, contact_id, added_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(memberId, workspaceId, ownerUserId, listId, contactId, userId);
        });
        
        // Execute in transaction
        const results = await c.env.DB.batch(statements);
        
        // Process results
        const chunkInserted: string[] = [];
        const chunkSkipped: string[] = [];
        
        results.forEach((result, idx) => {
          const contactId = chunk[idx];
          if (result.meta.changes > 0) {
            inserted.push(contactId);
            chunkInserted.push(contactId);
          } else {
            skipped.push(contactId);
            chunkSkipped.push(contactId);
          }
        });
        
        // Audit log per chunk (肥大防止: chunk単位で1行)
        if (chunkInserted.length > 0 || chunkSkipped.length > 0) {
          await writeLedgerAudit(c.env.DB, {
            workspaceId,
            ownerUserId,
            actorUserId: userId,
            targetType: 'list_member',
            targetId: listId,
            action: 'create',
            payload: { 
              batch_operation: 'add_members',
              list_id: listId, 
              inserted_count: chunkInserted.length,
              skipped_count: chunkSkipped.length,
              chunk_index: Math.floor(i / CHUNK_SIZE),
              total_chunks: Math.ceil(uniqueContactIds.length / CHUNK_SIZE),
            },
            requestId,
          });
        }
        
        console.log(`[listMembers.batch] Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: inserted=${chunkInserted.length}, skipped=${chunkSkipped.length}`);
      } catch (err) {
        console.error('[listMembers.batch] Chunk failed:', i, err);
        // Mark entire chunk as failed
        chunk.forEach((contactId) => failed.push(contactId));
      }
    }

    return c.json({
      request_id: requestId,
      success: true,
      inserted: inserted.length,
      skipped: skipped.length,
      failed: failed.length,
      total: uniqueContactIds.length,
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

    // P0-1: Ensure list is owned
    const isOwned = await ensureOwnedOr404(c, { table: 'lists', id: listId });
    if (!isOwned) {
      return c.json({ error: 'not_found', request_id: requestId }, 404);
    }

    const { workspaceId, ownerUserId } = getTenant(c);

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
