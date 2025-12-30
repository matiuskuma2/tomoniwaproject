/**
 * Rooms API Routes
 * Handles room creation, invitations, and membership management
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { getUserIdFromContext } from '../middleware/auth';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * Create a new room
 * 
 * @route POST /rooms
 * @body { name: string, description?: string, visibility?: 'private' | 'public' }
 */
app.post('/', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  try {
    const body = await c.req.json();
    const { name, description, visibility = 'private' } = body;

    if (!name || typeof name !== 'string') {
      return c.json({ error: 'Missing or invalid field: name' }, 400);
    }

    const roomId = uuidv4();
    const now = new Date().toISOString();

    // Create room
    await env.DB.prepare(`
      INSERT INTO rooms (id, name, description, owner_user_id, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(roomId, name, description || null, userId, visibility, now, now).run();

    // Add owner as member
    await env.DB.prepare(`
      INSERT INTO room_members (room_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)
    `).bind(roomId, userId, now).run();

    // Get created room
    const room = await env.DB.prepare(`
      SELECT * FROM rooms WHERE id = ?
    `).bind(roomId).first();

    return c.json({ room }, 201);
  } catch (error) {
    console.error('[Rooms] Create error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get user's rooms
 * 
 * @route GET /rooms
 * @query limit?: number (default: 50)
 * @query offset?: number (default: 0)
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);

  try {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    // Get rooms where user is a member
    const { results } = await env.DB.prepare(`
      SELECT 
        r.id,
        r.name,
        r.description,
        r.owner_user_id,
        r.visibility,
        r.created_at,
        r.updated_at,
        rm.role,
        COUNT(DISTINCT rm2.user_id) as member_count
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
      LEFT JOIN room_members rm2 ON rm2.room_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    // Get total count
    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
    `).bind(userId).first<{ total: number }>();
    
    const total = countResult?.total || 0;

    return c.json({
      rooms: results,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('[Rooms] List error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Get room details
 * 
 * @route GET /rooms/:id
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const roomId = c.req.param('id');

  try {
    // Check membership
    const membership = await env.DB.prepare(`
      SELECT role FROM room_members WHERE room_id = ? AND user_id = ?
    `).bind(roomId, userId).first<{ role: string }>();

    if (!membership) {
      return c.json({ error: 'Room not found or access denied' }, 404);
    }

    // Get room details
    const room = await env.DB.prepare(`
      SELECT * FROM rooms WHERE id = ?
    `).bind(roomId).first();

    // Get members
    const { results: members } = await env.DB.prepare(`
      SELECT 
        rm.user_id,
        rm.role,
        rm.joined_at,
        u.email,
        u.display_name,
        u.avatar_url
      FROM room_members rm
      LEFT JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY rm.joined_at ASC
    `).bind(roomId).all();

    return c.json({
      room,
      members,
      my_role: membership.role,
    });
  } catch (error) {
    console.error('[Rooms] Get details error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Invite user to room
 * 
 * @route POST /rooms/:id/invite
 * @body { user_id: string, role?: 'member' | 'admin' }
 */
app.post('/:id/invite', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const roomId = c.req.param('id');

  try {
    const body = await c.req.json();
    const { user_id: invitedUserId, role = 'member' } = body;

    if (!invitedUserId) {
      return c.json({ error: 'Missing field: user_id' }, 400);
    }

    // Check if inviter is owner or admin
    const membership = await env.DB.prepare(`
      SELECT role FROM room_members WHERE room_id = ? AND user_id = ?
    `).bind(roomId, userId).first<{ role: string }>();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return c.json({ error: 'Only room owners and admins can invite members' }, 403);
    }

    // Check if user is already a member
    const existing = await env.DB.prepare(`
      SELECT user_id FROM room_members WHERE room_id = ? AND user_id = ?
    `).bind(roomId, invitedUserId).first();

    if (existing) {
      return c.json({ error: 'User is already a member' }, 400);
    }

    // Add member
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO room_members (room_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?)
    `).bind(roomId, invitedUserId, role, now).run();

    return c.json({ 
      message: 'User invited successfully',
      room_id: roomId,
      user_id: invitedUserId,
      role,
    });
  } catch (error) {
    console.error('[Rooms] Invite error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * Leave room
 * 
 * @route DELETE /rooms/:id/leave
 */
app.delete('/:id/leave', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c as any);
  const roomId = c.req.param('id');

  try {
    // Check membership
    const membership = await env.DB.prepare(`
      SELECT role FROM room_members WHERE room_id = ? AND user_id = ?
    `).bind(roomId, userId).first<{ role: string }>();

    if (!membership) {
      return c.json({ error: 'Not a member of this room' }, 404);
    }

    // Owner cannot leave (must transfer ownership first)
    if (membership.role === 'owner') {
      return c.json({ error: 'Room owner cannot leave. Transfer ownership first.' }, 400);
    }

    // Remove member
    await env.DB.prepare(`
      DELETE FROM room_members WHERE room_id = ? AND user_id = ?
    `).bind(roomId, userId).run();

    return c.json({ message: 'Left room successfully' });
  } catch (error) {
    console.error('[Rooms] Leave error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
