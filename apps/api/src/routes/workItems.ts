/**
 * WorkItems API Routes (Ticket 07)
 * 
 * CRUD operations for work items (tasks and scheduled events).
 */

import { Hono } from 'hono';
import { WorkItemsRepository } from '../repositories/workItemsRepository';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

// TODO: Add authentication middleware
// For now, accept user_id from query/header for testing

/**
 * List work items
 * 
 * @route GET /work-items
 * @query scope: 'my' | 'room' (default: 'my')
 * @query room_id: string (required if scope=room)
 * @query status: 'pending' | 'completed' | 'cancelled'
 * @query type: 'task' | 'scheduled'
 * @query limit: number (default: 50)
 * @query offset: number (default: 0)
 */
app.get('/', async (c) => {
  const { env } = c;
  const repo = new WorkItemsRepository(env.DB);

  // TODO: Get user_id from auth context
  const userId = c.req.header('x-user-id') || 'test-user-id';
  
  const scope = c.req.query('scope') || 'my';
  const roomId = c.req.query('room_id');
  const status = c.req.query('status') as 'pending' | 'completed' | 'cancelled' | undefined;
  const type = c.req.query('type') as 'task' | 'scheduled' | undefined;
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    let items;

    if (scope === 'room') {
      if (!roomId) {
        return c.json({ error: 'room_id is required for scope=room' }, 400);
      }
      
      // SECURITY: Check room membership before listing
      const isMember = await repo.isRoomMember(userId, roomId);
      if (!isMember) {
        return c.json({ error: 'Access denied: not a member of this room' }, 403);
      }
      
      items = await repo.listByRoom(roomId, { status, type, limit, offset });
    } else {
      items = await repo.listByUser(userId, { status, type, limit, offset });
    }

    return c.json({
      items,
      count: items.length,
      scope,
      ...(roomId && { room_id: roomId }),
    });
  } catch (error) {
    console.error('[WorkItems] Error listing items:', error);
    return c.json({ error: 'Failed to list work items' }, 500);
  }
});

/**
 * Get single work item
 * 
 * @route GET /work-items/:id
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const repo = new WorkItemsRepository(env.DB);

  // TODO: Get user_id from auth context
  const userId = c.req.header('x-user-id') || 'test-user-id';
  const id = c.req.param('id');

  try {
    const item = await repo.findById(id);
    
    if (!item) {
      return c.json({ error: 'Work item not found' }, 404);
    }

    // Check access permission
    const canAccess = await repo.canAccess(id, userId, item.room_id || undefined);
    if (!canAccess) {
      return c.json({ error: 'Access denied' }, 403);
    }

    return c.json(item);
  } catch (error) {
    console.error('[WorkItems] Error getting item:', error);
    return c.json({ error: 'Failed to get work item' }, 500);
  }
});

/**
 * Create work item
 * 
 * @route POST /work-items
 * @body {
 *   type: 'task' | 'scheduled',
 *   title: string,
 *   description?: string,
 *   start_at?: string (ISO 8601),
 *   end_at?: string (ISO 8601),
 *   all_day?: boolean,
 *   recurrence_rule?: string,
 *   location?: string,
 *   visibility_scope?: 'private' | 'room' | 'quest' | 'squad',
 *   room_id?: string,
 *   status?: 'pending' | 'completed' | 'cancelled'
 * }
 */
app.post('/', async (c) => {
  const { env } = c;
  const repo = new WorkItemsRepository(env.DB);

  // TODO: Get user_id from auth context
  const userId = c.req.header('x-user-id') || 'test-user-id';

  try {
    const body = await c.req.json();
    
    // Validate required fields
    if (!body.type || !body.title) {
      return c.json({ error: 'Missing required fields: type, title' }, 400);
    }

    // Validate type
    if (!['task', 'scheduled'].includes(body.type)) {
      return c.json({ error: 'Invalid type. Must be task or scheduled' }, 400);
    }

    // Validate visibility_scope
    if (body.visibility_scope && !['private', 'room', 'quest', 'squad'].includes(body.visibility_scope)) {
      return c.json({ error: 'Invalid visibility_scope' }, 400);
    }

    // If visibility_scope is room, room_id is required
    if (body.visibility_scope === 'room' && !body.room_id) {
      return c.json({ error: 'room_id is required for visibility_scope=room' }, 400);
    }

    const item = await repo.create({
      user_id: userId,
      type: body.type,
      title: body.title,
      description: body.description,
      start_at: body.start_at,
      end_at: body.end_at,
      all_day: body.all_day,
      recurrence_rule: body.recurrence_rule,
      location: body.location,
      visibility_scope: body.visibility_scope || 'private',
      room_id: body.room_id,
      status: body.status,
    });

    return c.json(item, 201);
  } catch (error) {
    console.error('[WorkItems] Error creating item:', error);
    return c.json({ error: 'Failed to create work item' }, 500);
  }
});

/**
 * Update work item
 * 
 * @route PATCH /work-items/:id
 * @body {
 *   title?: string,
 *   description?: string,
 *   start_at?: string,
 *   end_at?: string,
 *   all_day?: boolean,
 *   recurrence_rule?: string,
 *   location?: string,
 *   visibility_scope?: 'private' | 'room' | 'quest' | 'squad',
 *   room_id?: string,
 *   status?: 'pending' | 'completed' | 'cancelled'
 * }
 */
app.patch('/:id', async (c) => {
  const { env } = c;
  const repo = new WorkItemsRepository(env.DB);

  // TODO: Get user_id from auth context
  const userId = c.req.header('x-user-id') || 'test-user-id';
  const id = c.req.param('id');

  try {
    // Check if item exists
    const existing = await repo.findById(id);
    if (!existing) {
      return c.json({ error: 'Work item not found' }, 404);
    }

    // Check modify permission (only owner can modify)
    const canModify = await repo.canModify(id, userId);
    if (!canModify) {
      return c.json({ error: 'Only the owner can modify this work item' }, 403);
    }

    const body = await c.req.json();

    // SECURITY: Prevent visibility_scope changes (MVP restriction)
    if (body.visibility_scope !== undefined && body.visibility_scope !== existing.visibility_scope) {
      return c.json({ error: 'Changing visibility_scope is not allowed' }, 400);
    }

    // SECURITY: Prevent room_id changes (MVP restriction)
    if (body.room_id !== undefined && body.room_id !== existing.room_id) {
      return c.json({ error: 'Changing room_id is not allowed' }, 400);
    }

    // Validate visibility_scope (if somehow passed)
    if (body.visibility_scope && !['private', 'room', 'quest', 'squad'].includes(body.visibility_scope)) {
      return c.json({ error: 'Invalid visibility_scope' }, 400);
    }

    const updated = await repo.update(id, {
      title: body.title,
      description: body.description,
      start_at: body.start_at,
      end_at: body.end_at,
      all_day: body.all_day,
      recurrence_rule: body.recurrence_rule,
      location: body.location,
      visibility_scope: body.visibility_scope,
      room_id: body.room_id,
      status: body.status,
    });

    return c.json(updated);
  } catch (error) {
    console.error('[WorkItems] Error updating item:', error);
    return c.json({ error: 'Failed to update work item' }, 500);
  }
});

/**
 * Delete work item
 * 
 * @route DELETE /work-items/:id
 */
app.delete('/:id', async (c) => {
  const { env } = c;
  const repo = new WorkItemsRepository(env.DB);

  // TODO: Get user_id from auth context
  const userId = c.req.header('x-user-id') || 'test-user-id';
  const id = c.req.param('id');

  try {
    // Check if item exists
    const existing = await repo.findById(id);
    if (!existing) {
      return c.json({ error: 'Work item not found' }, 404);
    }

    // Check modify permission (only owner can delete)
    const canModify = await repo.canModify(id, userId);
    if (!canModify) {
      return c.json({ error: 'Only the owner can delete this work item' }, 403);
    }

    await repo.delete(id);

    return c.json({ message: 'Work item deleted successfully' });
  } catch (error) {
    console.error('[WorkItems] Error deleting item:', error);
    return c.json({ error: 'Failed to delete work item' }, 500);
  }
});

export default app;
