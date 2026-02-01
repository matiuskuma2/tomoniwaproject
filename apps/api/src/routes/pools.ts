/**
 * Pools API Routes
 * 
 * G2-A Pool Booking - 受付プール管理
 * - POST /api/pools: プール作成（workspace admin only）
 * - GET /api/pools: プール一覧
 * - GET /api/pools/:id: プール詳細
 * - PATCH /api/pools/:id: プール更新
 * - DELETE /api/pools/:id: プール削除
 * - POST /api/pools/:id/members: メンバー追加
 * - GET /api/pools/:id/members: メンバー一覧
 * - DELETE /api/pools/:id/members/:memberId: メンバー削除
 * - POST /api/pools/:id/slots: 枠作成
 * - GET /api/pools/:id/slots: 枠一覧
 * - DELETE /api/pools/:id/slots/:slotId: 枠削除
 * - POST /api/pools/:id/book: 予約（Reserve → Assign）
 */

import { Hono } from 'hono';
import { getTenant } from '../utils/workspaceContext';
import type { Env } from '../../../../packages/shared/src/types/env';
import { PoolsRepository } from '../repositories/poolsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import type { PoolSlotStatus, PoolBooking, Pool, PoolSlot } from '../../../../packages/shared/src/types/poolBooking';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Helper: Check workspace admin
// MVP: owner_user_id == userId で判定（シンプル）
// ============================================================
function isWorkspaceAdmin(ownerUserId: string, userId: string): boolean {
  // MVP: 作成者 = 管理者として扱う
  // 将来: workspace_members.role == 'admin' などで判定
  return true; // MVP では全員が自分の workspace では admin
}

// ============================================================
// Helper: Send booking notifications
// ============================================================

/**
 * 予約成立時の通知を送信
 * - 担当者向け: pool_booking_assigned
 * - 管理者向け: pool_booking_created
 * 
 * 通知失敗時はログのみ（booking自体は成立）
 */
async function sendBookingNotifications(
  inboxRepo: InboxRepository,
  pool: Pool,
  slot: PoolSlot,
  booking: PoolBooking,
  requesterUserId: string
): Promise<void> {
  const slotLabel = slot.label || formatSlotTime(slot.start_at, slot.end_at);
  
  try {
    // 1. 担当者への通知 (pool_booking_assigned)
    await inboxRepo.create({
      user_id: booking.assignee_user_id,
      type: 'pool_booking_assigned',
      title: '新しい予約が割り当てられました',
      message: `プール: ${pool.name}\n枠: ${slotLabel}\n申込者: ${requesterUserId}`,
      action_type: 'view_booking',
      action_target_id: booking.id,
      action_url: `/pools/${pool.id}/bookings/${booking.id}`,
      priority: 'high',
    });
    console.log(`[Pools] Notification sent to assignee: ${booking.assignee_user_id}`);
  } catch (error) {
    // 通知失敗はログのみ（booking 成立には影響しない）
    console.error('[Pools] Failed to send assignee notification:', error);
  }

  try {
    // 2. 管理者（Pool オーナー）への通知 (pool_booking_created)
    // 担当者と管理者が同じ場合はスキップ
    if (pool.owner_user_id !== booking.assignee_user_id) {
      await inboxRepo.create({
        user_id: pool.owner_user_id,
        type: 'pool_booking_created',
        title: '予約が成立しました',
        message: `プール: ${pool.name}\n枠: ${slotLabel}\n担当: ${booking.assignee_user_id}\n申込者: ${requesterUserId}`,
        action_type: 'view_booking',
        action_target_id: booking.id,
        action_url: `/pools/${pool.id}/bookings/${booking.id}`,
        priority: 'normal',
      });
      console.log(`[Pools] Notification sent to owner: ${pool.owner_user_id}`);
    }
  } catch (error) {
    // 通知失敗はログのみ（booking 成立には影響しない）
    console.error('[Pools] Failed to send owner notification:', error);
  }
}

/**
 * スロット時間のフォーマット（簡易）
 */
function formatSlotTime(startAt: string, endAt: string): string {
  try {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const dateStr = start.toLocaleDateString('ja-JP', { 
      month: 'numeric', 
      day: 'numeric',
      weekday: 'short'
    });
    const startTime = start.toLocaleTimeString('ja-JP', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    const endTime = end.toLocaleTimeString('ja-JP', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    return `${dateStr} ${startTime}〜${endTime}`;
  } catch {
    return `${startAt} - ${endAt}`;
  }
}

// ============================================================
// Pool CRUD
// ============================================================

/**
 * POST /api/pools
 * Create a new pool (workspace admin only)
 */
app.post('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  if (!isWorkspaceAdmin(ownerUserId, userId)) {
    return c.json({ error: 'Forbidden: workspace admin only' }, 403);
  }

  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
    }>();

    if (!body.name) {
      return c.json({ error: 'name is required' }, 400);
    }

    const repo = new PoolsRepository(env.DB);

    const pool = await repo.createPool({
      workspace_id: workspaceId,
      owner_user_id: userId,
      name: body.name,
      description: body.description,
    });

    console.log(`[Pools] Pool created: ${pool.id} by ${userId}`);

    return c.json({ pool }, 201);
  } catch (error) {
    console.error('[Pools] Error creating pool:', error);
    
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      return c.json({ error: 'Pool with this name already exists' }, 409);
    }

    return c.json(
      {
        error: 'Failed to create pool',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/pools
 * Get all pools for current user
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const query = c.req.query();
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const repo = new PoolsRepository(env.DB);
    const { pools, total } = await repo.getPoolsByOwner(
      workspaceId,
      ownerUserId,
      limit,
      offset
    );

    return c.json({
      pools,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + pools.length < total,
      },
    });
  } catch (error) {
    console.error('[Pools] Error listing pools:', error);
    return c.json(
      {
        error: 'Failed to list pools',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/pools/:id
 * Get pool details
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Get members count
    const members = await repo.getMembersByPool(workspaceId, poolId);

    // Get slots summary
    const { total: slotsTotal } = await repo.getSlotsByPool(workspaceId, poolId, { limit: 1 });

    return c.json({
      pool,
      summary: {
        members_count: members.length,
        slots_count: slotsTotal,
      },
    });
  } catch (error) {
    console.error('[Pools] Error getting pool:', error);
    return c.json(
      {
        error: 'Failed to get pool',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PATCH /api/pools/:id
 * Update pool
 */
app.patch('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const existing = await repo.getPoolById(workspaceId, poolId);

    if (!existing) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Check ownership
    if (existing.owner_user_id !== ownerUserId) {
      return c.json({ error: 'Forbidden: not pool owner' }, 403);
    }

    const body = await c.req.json<{
      name?: string;
      description?: string;
      is_active?: boolean;
    }>();

    const pool = await repo.updatePool(workspaceId, poolId, {
      name: body.name,
      description: body.description,
      is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : undefined,
    });

    console.log(`[Pools] Pool updated: ${poolId} by ${userId}`);

    return c.json({ pool });
  } catch (error) {
    console.error('[Pools] Error updating pool:', error);
    return c.json(
      {
        error: 'Failed to update pool',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/pools/:id
 * Delete pool
 */
app.delete('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const existing = await repo.getPoolById(workspaceId, poolId);

    if (!existing) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Check ownership
    if (existing.owner_user_id !== ownerUserId) {
      return c.json({ error: 'Forbidden: not pool owner' }, 403);
    }

    await repo.deletePool(workspaceId, poolId);

    console.log(`[Pools] Pool deleted: ${poolId} by ${userId}`);

    return c.json({ message: 'Pool deleted', id: poolId });
  } catch (error) {
    console.error('[Pools] Error deleting pool:', error);
    return c.json(
      {
        error: 'Failed to delete pool',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================
// Pool Members
// ============================================================

/**
 * POST /api/pools/:id/members
 * Add member to pool
 */
app.post('/:id/members', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Check ownership
    if (pool.owner_user_id !== ownerUserId) {
      return c.json({ error: 'Forbidden: not pool owner' }, 403);
    }

    const body = await c.req.json<{ user_id: string }>();

    if (!body.user_id) {
      return c.json({ error: 'user_id is required' }, 400);
    }

    // Check if already a member
    const isMember = await repo.isMember(poolId, body.user_id);
    if (isMember) {
      return c.json({ error: 'User is already a member of this pool' }, 409);
    }

    const member = await repo.addMember({
      workspace_id: workspaceId,
      pool_id: poolId,
      user_id: body.user_id,
    });

    console.log(`[Pools] Member added to pool ${poolId}: ${body.user_id}`);

    return c.json({ member }, 201);
  } catch (error) {
    console.error('[Pools] Error adding member:', error);
    return c.json(
      {
        error: 'Failed to add member',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/pools/:id/members
 * Get all members of pool
 */
app.get('/:id/members', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    const members = await repo.getMembersByPool(workspaceId, poolId);

    return c.json({ members, count: members.length });
  } catch (error) {
    console.error('[Pools] Error listing members:', error);
    return c.json(
      {
        error: 'Failed to list members',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/pools/:id/members/:memberId
 * Remove member from pool
 */
app.delete('/:id/members/:memberId', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');
  const memberId = c.req.param('memberId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Check ownership
    if (pool.owner_user_id !== ownerUserId) {
      return c.json({ error: 'Forbidden: not pool owner' }, 403);
    }

    const deleted = await repo.removeMember(workspaceId, memberId);

    if (!deleted) {
      return c.json({ error: 'Member not found' }, 404);
    }

    console.log(`[Pools] Member removed from pool ${poolId}: ${memberId}`);

    return c.json({ message: 'Member removed', id: memberId });
  } catch (error) {
    console.error('[Pools] Error removing member:', error);
    return c.json(
      {
        error: 'Failed to remove member',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================
// Pool Slots
// ============================================================

/**
 * POST /api/pools/:id/slots
 * Create slot(s) for pool
 */
app.post('/:id/slots', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Check ownership
    if (pool.owner_user_id !== ownerUserId) {
      return c.json({ error: 'Forbidden: not pool owner' }, 403);
    }

    const body = await c.req.json<{
      // Single slot
      start_at?: string;
      end_at?: string;
      timezone?: string;
      label?: string;
      // Bulk slots
      slots?: Array<{
        start_at: string;
        end_at: string;
        timezone?: string;
        label?: string;
      }>;
    }>();

    let createdSlots;

    if (body.slots && Array.isArray(body.slots)) {
      // Bulk create
      const inputs = body.slots.map((s) => ({
        workspace_id: workspaceId,
        pool_id: poolId,
        start_at: s.start_at,
        end_at: s.end_at,
        timezone: s.timezone,
        label: s.label,
      }));
      createdSlots = await repo.createSlotsBulk(inputs);
    } else if (body.start_at && body.end_at) {
      // Single create
      const slot = await repo.createSlot({
        workspace_id: workspaceId,
        pool_id: poolId,
        start_at: body.start_at,
        end_at: body.end_at,
        timezone: body.timezone,
        label: body.label,
      });
      createdSlots = [slot];
    } else {
      return c.json({ error: 'start_at and end_at are required' }, 400);
    }

    console.log(`[Pools] ${createdSlots.length} slot(s) created for pool ${poolId}`);

    return c.json({ slots: createdSlots, count: createdSlots.length }, 201);
  } catch (error) {
    console.error('[Pools] Error creating slots:', error);
    return c.json(
      {
        error: 'Failed to create slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/pools/:id/slots
 * Get slots for pool
 */
app.get('/:id/slots', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    const query = c.req.query();
    const { slots, total } = await repo.getSlotsByPool(workspaceId, poolId, {
      from: query.from,
      to: query.to,
      status: query.status as PoolSlotStatus | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    return c.json({
      slots,
      pagination: {
        total,
        limit: query.limit ? parseInt(query.limit, 10) : 100,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
        has_more: (query.offset ? parseInt(query.offset, 10) : 0) + slots.length < total,
      },
    });
  } catch (error) {
    console.error('[Pools] Error listing slots:', error);
    return c.json(
      {
        error: 'Failed to list slots',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/pools/:id/slots/:slotId
 * Delete slot (only if status is 'open')
 */
app.delete('/:id/slots/:slotId', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');
  const slotId = c.req.param('slotId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    // Check ownership
    if (pool.owner_user_id !== ownerUserId) {
      return c.json({ error: 'Forbidden: not pool owner' }, 403);
    }

    const slot = await repo.getSlotById(workspaceId, slotId);
    if (!slot) {
      return c.json({ error: 'Slot not found' }, 404);
    }

    if (slot.status !== 'open') {
      return c.json({ error: 'Cannot delete slot with status: ' + slot.status }, 400);
    }

    await repo.deleteSlot(workspaceId, slotId);

    console.log(`[Pools] Slot deleted from pool ${poolId}: ${slotId}`);

    return c.json({ message: 'Slot deleted', id: slotId });
  } catch (error) {
    console.error('[Pools] Error deleting slot:', error);
    return c.json(
      {
        error: 'Failed to delete slot',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ============================================================
// Booking (Reserve → Assign)
// ============================================================

/**
 * POST /api/pools/:id/book
 * Book a slot (Reserve → Assign flow)
 * 
 * Body:
 * - slot_id: string (required)
 * - note?: string (optional)
 * 
 * Returns:
 * - booking_id: string
 * - pool_id: string
 * - slot_id: string
 * - assignee_user_id: string
 * - status: 'confirmed'
 * 
 * Error codes:
 * - 409 SLOT_TAKEN: Slot already reserved/booked by another user
 * - 409 NO_MEMBER_AVAILABLE: No active members in pool
 * - 404 SLOT_NOT_FOUND: Slot does not exist or is not open
 * - 404 POOL_NOT_FOUND: Pool does not exist
 */
app.post('/:id/book', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId } = getTenant(c);

  try {
    const body = await c.req.json<{
      slot_id: string;
      note?: string;
    }>();

    if (!body.slot_id) {
      return c.json({ error: 'slot_id is required', code: 'INVALID_REQUEST' }, 400);
    }

    const repo = new PoolsRepository(env.DB);
    const inboxRepo = new InboxRepository(env.DB);

    // Execute booking flow: Reserve → Assign
    const result = await repo.bookSlot(
      workspaceId,
      poolId,
      body.slot_id,
      userId,
      body.note
    );

    if (!result.success) {
      // Map error codes to HTTP status
      switch (result.error) {
        case 'SLOT_TAKEN':
          return c.json({ 
            error: 'Slot is already reserved or booked', 
            code: 'SLOT_TAKEN' 
          }, 409);
        case 'NO_MEMBER_AVAILABLE':
          return c.json({ 
            error: 'No members available for assignment', 
            code: 'NO_MEMBER_AVAILABLE' 
          }, 409);
        case 'SLOT_NOT_FOUND':
          return c.json({ 
            error: 'Slot not found or not open', 
            code: 'SLOT_NOT_FOUND' 
          }, 404);
        case 'POOL_NOT_FOUND':
          return c.json({ 
            error: 'Pool not found', 
            code: 'POOL_NOT_FOUND' 
          }, 404);
        default:
          return c.json({ 
            error: 'Booking failed', 
            code: result.error || 'UNKNOWN_ERROR' 
          }, 500);
      }
    }

    const booking = result.booking!;

    console.log(`[Pools] Slot booked: pool=${poolId}, slot=${body.slot_id}, assignee=${booking.assignee_user_id}, requester=${userId}`);

    // Send notifications (fire-and-forget, errors are logged but don't fail the booking)
    const pool = await repo.getPoolById(workspaceId, poolId);
    const slot = await repo.getSlotById(workspaceId, body.slot_id);
    
    if (pool && slot) {
      // Don't await - notifications are sent in background
      sendBookingNotifications(inboxRepo, pool, slot, booking, userId)
        .catch(err => console.error('[Pools] Notification error (non-fatal):', err));
    }

    return c.json({
      booking_id: booking.id,
      pool_id: booking.pool_id,
      slot_id: booking.slot_id,
      assignee_user_id: booking.assignee_user_id,
      status: booking.status,
    }, 201);

  } catch (error) {
    console.error('[Pools] Error booking slot:', error);
    return c.json(
      {
        error: 'Failed to book slot',
        code: 'INTERNAL_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/pools/:id/bookings
 * Get bookings for a pool (optional: filter by slot)
 */
app.get('/:id/bookings', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const poolId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId } = getTenant(c);

  try {
    const repo = new PoolsRepository(env.DB);
    const pool = await repo.getPoolById(workspaceId, poolId);

    if (!pool) {
      return c.json({ error: 'Pool not found' }, 404);
    }

    const query = c.req.query();
    
    // Get bookings - for now just get all by iterating slots
    // TODO: Add getBookingsByPool method for better performance
    const { slots } = await repo.getSlotsByPool(workspaceId, poolId, { limit: 1000 });
    
    const bookings: any[] = [];
    for (const slot of slots) {
      if (slot.status === 'booked') {
        const slotBookings = await repo.getBookingsBySlot(workspaceId, slot.id);
        bookings.push(...slotBookings);
      }
    }

    return c.json({ 
      bookings, 
      count: bookings.length,
      pool_id: poolId,
    });
  } catch (error) {
    console.error('[Pools] Error listing bookings:', error);
    return c.json(
      {
        error: 'Failed to list bookings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
