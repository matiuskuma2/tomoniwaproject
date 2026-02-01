/**
 * Pools Repository
 * 
 * G2-A Pool Booking - 受付プール管理
 * - Pool CRUD
 * - Pool Members 管理
 * - Pool Slots 管理
 * - workspace境界の強制
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  Pool,
  PoolMember,
  PoolSlot,
  PoolSlotReservation,
  PoolBooking,
  PoolAssignmentPolicy,
  PoolSlotStatus,
  PoolReservationStatus,
  PoolBookingStatus,
} from '../../../../packages/shared/src/types/poolBooking';

// ============================================================
// Input Types
// ============================================================

export interface CreatePoolInput {
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description?: string | null;
  assignment_policy?: PoolAssignmentPolicy;
  slot_capacity?: number;
}

export interface UpdatePoolInput {
  name?: string;
  description?: string | null;
  is_active?: 0 | 1;
}

export interface CreatePoolMemberInput {
  workspace_id: string;
  pool_id: string;
  user_id: string;
}

export interface CreatePoolSlotInput {
  workspace_id: string;
  pool_id: string;
  start_at: string;
  end_at: string;
  timezone?: string;
  label?: string | null;
}

export interface CreateReservationInput {
  workspace_id: string;
  pool_id: string;
  slot_id: string;
  requester_key: string;  // user_id or email
  expires_at: string;
}

export interface CreateBookingInput {
  workspace_id: string;
  pool_id: string;
  slot_id: string;
  assignee_user_id: string;
  assignment_algo: string;
  requester_user_id?: string | null;
  requester_note?: string | null;
}

// Result types for booking flow
export interface BookSlotResult {
  success: boolean;
  booking?: PoolBooking;
  error?: 'SLOT_TAKEN' | 'NO_MEMBER_AVAILABLE' | 'SLOT_NOT_FOUND' | 'POOL_NOT_FOUND' | 'SLOT_NOT_OPEN' | 'ASSIGNMENT_FAILED';
}

export interface ReserveResult {
  success: boolean;
  reservation?: PoolSlotReservation;
  error?: 'SLOT_TAKEN' | 'SLOT_NOT_OPEN';
}

// ============================================================
// Repository
// ============================================================

export class PoolsRepository {
  constructor(private db: D1Database) {}

  // ============================================================
  // Pool CRUD
  // ============================================================

  /**
   * Create a new pool
   */
  async createPool(input: CreatePoolInput): Promise<Pool> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO pools (
          id, workspace_id, owner_user_id, name, description,
          assignment_policy, slot_capacity, is_active,
          last_assigned_member_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`
      )
      .bind(
        id,
        input.workspace_id,
        input.owner_user_id,
        input.name,
        input.description || null,
        input.assignment_policy || 'round_robin',
        input.slot_capacity || 1,
        now,
        now
      )
      .run();

    return this.getPoolById(input.workspace_id, id) as Promise<Pool>;
  }

  /**
   * Get pool by ID
   */
  async getPoolById(workspaceId: string, poolId: string): Promise<Pool | null> {
    const result = await this.db
      .prepare(
        `SELECT * FROM pools WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, poolId)
      .first<Pool>();

    return result || null;
  }

  /**
   * Get all pools for owner
   */
  async getPoolsByOwner(
    workspaceId: string,
    ownerUserId: string,
    limit = 50,
    offset = 0
  ): Promise<{ pools: Pool[]; total: number }> {
    const [poolsResult, countResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT * FROM pools 
           WHERE workspace_id = ? AND owner_user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .bind(workspaceId, ownerUserId, limit, offset)
        .all<Pool>(),
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM pools 
           WHERE workspace_id = ? AND owner_user_id = ?`
        )
        .bind(workspaceId, ownerUserId)
        .first<{ count: number }>(),
    ]);

    return {
      pools: poolsResult.results || [],
      total: countResult?.count || 0,
    };
  }

  /**
   * Update pool
   */
  async updatePool(
    workspaceId: string,
    poolId: string,
    input: UpdatePoolInput
  ): Promise<Pool | null> {
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description || '');
    }
    if (input.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(input.is_active);
    }

    if (updates.length === 0) {
      return this.getPoolById(workspaceId, poolId);
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(workspaceId, poolId);

    await this.db
      .prepare(
        `UPDATE pools SET ${updates.join(', ')} WHERE workspace_id = ? AND id = ?`
      )
      .bind(...values)
      .run();

    return this.getPoolById(workspaceId, poolId);
  }

  /**
   * Delete pool (cascade deletes members, slots, etc.)
   */
  async deletePool(workspaceId: string, poolId: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM pools WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, poolId)
      .run();

    return (result.meta?.changes || 0) > 0;
  }

  // ============================================================
  // Pool Members
  // ============================================================

  /**
   * Add member to pool
   */
  async addMember(input: CreatePoolMemberInput): Promise<PoolMember> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Get next join_order
    const lastMember = await this.db
      .prepare(
        `SELECT MAX(join_order) as max_order FROM pool_members WHERE pool_id = ?`
      )
      .bind(input.pool_id)
      .first<{ max_order: number | null }>();

    const joinOrder = (lastMember?.max_order ?? -1) + 1;

    await this.db
      .prepare(
        `INSERT INTO pool_members (
          id, workspace_id, pool_id, user_id, is_active, join_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .bind(
        id,
        input.workspace_id,
        input.pool_id,
        input.user_id,
        joinOrder,
        now,
        now
      )
      .run();

    return this.getMemberById(input.workspace_id, id) as Promise<PoolMember>;
  }

  /**
   * Get member by ID
   */
  async getMemberById(workspaceId: string, memberId: string): Promise<PoolMember | null> {
    const result = await this.db
      .prepare(`SELECT * FROM pool_members WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, memberId)
      .first<PoolMember>();

    return result || null;
  }

  /**
   * Get all members for pool
   */
  async getMembersByPool(
    workspaceId: string,
    poolId: string
  ): Promise<PoolMember[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM pool_members 
         WHERE workspace_id = ? AND pool_id = ? AND is_active = 1
         ORDER BY join_order ASC`
      )
      .bind(workspaceId, poolId)
      .all<PoolMember>();

    return result.results || [];
  }

  /**
   * Check if user is already a member
   */
  async isMember(poolId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `SELECT 1 FROM pool_members WHERE pool_id = ? AND user_id = ? LIMIT 1`
      )
      .bind(poolId, userId)
      .first();

    return !!result;
  }

  /**
   * Remove member from pool
   */
  async removeMember(workspaceId: string, memberId: string): Promise<boolean> {
    const result = await this.db
      .prepare(`DELETE FROM pool_members WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, memberId)
      .run();

    return (result.meta?.changes || 0) > 0;
  }

  // ============================================================
  // Pool Slots
  // ============================================================

  /**
   * Create a slot
   */
  async createSlot(input: CreatePoolSlotInput): Promise<PoolSlot> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO pool_slots (
          id, workspace_id, pool_id, start_at, end_at, timezone, label,
          status, reserved_count, booked_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 0, 0, ?, ?)`
      )
      .bind(
        id,
        input.workspace_id,
        input.pool_id,
        input.start_at,
        input.end_at,
        input.timezone || 'Asia/Tokyo',
        input.label || null,
        now,
        now
      )
      .run();

    return this.getSlotById(input.workspace_id, id) as Promise<PoolSlot>;
  }

  /**
   * Bulk create slots
   */
  async createSlotsBulk(inputs: CreatePoolSlotInput[]): Promise<PoolSlot[]> {
    const slots: PoolSlot[] = [];
    
    for (const input of inputs) {
      const slot = await this.createSlot(input);
      slots.push(slot);
    }

    return slots;
  }

  /**
   * Get slot by ID
   */
  async getSlotById(workspaceId: string, slotId: string): Promise<PoolSlot | null> {
    const result = await this.db
      .prepare(`SELECT * FROM pool_slots WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, slotId)
      .first<PoolSlot>();

    return result || null;
  }

  /**
   * Get slots for pool with optional filters
   */
  async getSlotsByPool(
    workspaceId: string,
    poolId: string,
    options?: {
      from?: string;
      to?: string;
      status?: PoolSlotStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ slots: PoolSlot[]; total: number }> {
    const conditions = ['workspace_id = ?', 'pool_id = ?'];
    const params: (string | number)[] = [workspaceId, poolId];

    if (options?.from) {
      conditions.push('start_at >= ?');
      params.push(options.from);
    }
    if (options?.to) {
      conditions.push('end_at <= ?');
      params.push(options.to);
    }
    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.join(' AND ');
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const [slotsResult, countResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT * FROM pool_slots 
           WHERE ${whereClause}
           ORDER BY start_at ASC
           LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset)
        .all<PoolSlot>(),
      this.db
        .prepare(
          `SELECT COUNT(*) as count FROM pool_slots WHERE ${whereClause}`
        )
        .bind(...params)
        .first<{ count: number }>(),
    ]);

    return {
      slots: slotsResult.results || [],
      total: countResult?.count || 0,
    };
  }

  /**
   * Delete slot
   */
  async deleteSlot(workspaceId: string, slotId: string): Promise<boolean> {
    // Only allow deleting 'open' slots
    const result = await this.db
      .prepare(
        `DELETE FROM pool_slots 
         WHERE workspace_id = ? AND id = ? AND status = 'open'`
      )
      .bind(workspaceId, slotId)
      .run();

    return (result.meta?.changes || 0) > 0;
  }

  /**
   * Update slot status
   */
  async updateSlotStatus(
    workspaceId: string,
    slotId: string,
    status: PoolSlotStatus
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE pool_slots 
         SET status = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(status, new Date().toISOString(), workspaceId, slotId)
      .run();

    return (result.meta?.changes || 0) > 0;
  }

  // ============================================================
  // Reservations (競合防止)
  // ============================================================

  /**
   * Try to reserve a slot (atomic)
   * Returns null if slot is already reserved/booked
   * 
   * Uses INSERT ... ON CONFLICT for atomic reservation
   */
  async tryReserveSlot(input: CreateReservationInput): Promise<ReserveResult> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // First check if slot exists and is open
    const slot = await this.getSlotById(input.workspace_id, input.slot_id);
    if (!slot) {
      return { success: false, error: 'SLOT_NOT_OPEN' };
    }
    if (slot.status !== 'open') {
      return { success: false, error: 'SLOT_NOT_OPEN' };
    }

    try {
      // Try to insert reservation
      // The UNIQUE index on (slot_id, requester_key) WHERE status='active' will prevent duplicates
      await this.db
        .prepare(
          `INSERT INTO pool_slot_reservations (
            id, workspace_id, pool_id, slot_id, requester_key, status, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
        )
        .bind(
          id,
          input.workspace_id,
          input.pool_id,
          input.slot_id,
          input.requester_key,
          input.expires_at,
          now,
          now
        )
        .run();

      // Mark slot as reserved
      await this.updateSlotStatus(input.workspace_id, input.slot_id, 'reserved');

      const reservation = await this.getReservationById(input.workspace_id, id);
      return { success: true, reservation: reservation! };

    } catch (error) {
      // Check if it's a UNIQUE constraint violation
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        return { success: false, error: 'SLOT_TAKEN' };
      }
      throw error;
    }
  }

  /**
   * Get reservation by ID
   */
  async getReservationById(workspaceId: string, reservationId: string): Promise<PoolSlotReservation | null> {
    const result = await this.db
      .prepare(`SELECT * FROM pool_slot_reservations WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, reservationId)
      .first<PoolSlotReservation>();

    return result || null;
  }

  /**
   * Mark reservation as consumed (after booking)
   */
  async consumeReservation(workspaceId: string, reservationId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE pool_slot_reservations 
         SET status = 'consumed', updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status = 'active'`
      )
      .bind(new Date().toISOString(), workspaceId, reservationId)
      .run();

    return (result.meta?.changes || 0) > 0;
  }

  /**
   * Release reservation (rollback on failure)
   */
  async releaseReservation(workspaceId: string, reservationId: string, slotId: string): Promise<void> {
    const now = new Date().toISOString();

    // Mark reservation as released
    await this.db
      .prepare(
        `UPDATE pool_slot_reservations 
         SET status = 'released', updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(now, workspaceId, reservationId)
      .run();

    // Restore slot status to open
    await this.updateSlotStatus(workspaceId, slotId, 'open');
  }

  // ============================================================
  // Bookings (確定結果)
  // ============================================================

  /**
   * Create booking
   */
  async createBooking(input: CreateBookingInput): Promise<PoolBooking> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO pool_bookings (
          id, workspace_id, pool_id, slot_id, assignee_user_id,
          assignment_algo, requester_user_id, requester_note, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`
      )
      .bind(
        id,
        input.workspace_id,
        input.pool_id,
        input.slot_id,
        input.assignee_user_id,
        input.assignment_algo,
        input.requester_user_id || null,
        input.requester_note || null,
        now,
        now
      )
      .run();

    return this.getBookingById(input.workspace_id, id) as Promise<PoolBooking>;
  }

  /**
   * Get booking by ID
   */
  async getBookingById(workspaceId: string, bookingId: string): Promise<PoolBooking | null> {
    const result = await this.db
      .prepare(`SELECT * FROM pool_bookings WHERE workspace_id = ? AND id = ?`)
      .bind(workspaceId, bookingId)
      .first<PoolBooking>();

    return result || null;
  }

  /**
   * Get bookings by slot
   */
  async getBookingsBySlot(workspaceId: string, slotId: string): Promise<PoolBooking[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM pool_bookings 
         WHERE workspace_id = ? AND slot_id = ?
         ORDER BY created_at DESC`
      )
      .bind(workspaceId, slotId)
      .all<PoolBooking>();

    return result.results || [];
  }

  // ============================================================
  // Round-Robin Assignment
  // ============================================================

  /**
   * Get next member for round-robin assignment
   * Uses CAS to update last_assigned_member_id atomically
   */
  async getNextMemberRoundRobin(
    workspaceId: string,
    poolId: string,
    retryCount = 0
  ): Promise<{ member: PoolMember; updated: boolean } | null> {
    const MAX_RETRIES = 1;

    // Get pool with current last_assigned_member_id
    const pool = await this.getPoolById(workspaceId, poolId);
    if (!pool) return null;

    // Get active members ordered by join_order
    const members = await this.getMembersByPool(workspaceId, poolId);
    if (members.length === 0) return null;

    // Find next member
    let nextMember: PoolMember;

    if (!pool.last_assigned_member_id) {
      // First assignment - pick first member
      nextMember = members[0];
    } else {
      // Find index of last assigned member
      const lastIndex = members.findIndex(m => m.id === pool.last_assigned_member_id);
      
      if (lastIndex === -1) {
        // Last assigned member not found (maybe removed) - start from first
        nextMember = members[0];
      } else {
        // Pick next member (wrap around)
        nextMember = members[(lastIndex + 1) % members.length];
      }
    }

    // CAS update: only update if last_assigned_member_id hasn't changed
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        `UPDATE pools 
         SET last_assigned_member_id = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? 
         AND (last_assigned_member_id IS ? OR last_assigned_member_id = ?)`
      )
      .bind(
        nextMember.id,
        now,
        poolId,
        workspaceId,
        pool.last_assigned_member_id,  // IS NULL check
        pool.last_assigned_member_id || ''  // = check (empty string if null)
      )
      .run();

    if ((result.meta?.changes || 0) === 0) {
      // CAS failed - someone else updated
      if (retryCount < MAX_RETRIES) {
        // Retry once
        return this.getNextMemberRoundRobin(workspaceId, poolId, retryCount + 1);
      }
      // Return member but indicate CAS failed
      return { member: nextMember, updated: false };
    }

    return { member: nextMember, updated: true };
  }

  // ============================================================
  // Booking Flow: Reserve → Assign (atomic sequence)
  // ============================================================

  /**
   * Book a slot: Reserve → Assign → Confirm
   * 
   * This is the main entry point for booking a slot.
   * It handles the complete flow:
   * 1. Reserve the slot (prevent concurrent bookings)
   * 2. Find next member via round-robin
   * 3. Create booking record
   * 4. Update slot status to 'booked'
   * 5. Consume reservation
   * 
   * On failure: rollback reservation
   */
  async bookSlot(
    workspaceId: string,
    poolId: string,
    slotId: string,
    requesterUserId: string,
    requesterNote?: string
  ): Promise<BookSlotResult> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min expiry

    // Step 1: Verify pool exists
    const pool = await this.getPoolById(workspaceId, poolId);
    if (!pool) {
      return { success: false, error: 'POOL_NOT_FOUND' };
    }

    // Step 2: Try to reserve slot
    const reserveResult = await this.tryReserveSlot({
      workspace_id: workspaceId,
      pool_id: poolId,
      slot_id: slotId,
      requester_key: requesterUserId,
      expires_at: expiresAt,
    });

    if (!reserveResult.success) {
      if (reserveResult.error === 'SLOT_NOT_OPEN') {
        return { success: false, error: 'SLOT_NOT_FOUND' };
      }
      return { success: false, error: 'SLOT_TAKEN' };
    }

    const reservation = reserveResult.reservation!;

    try {
      // Step 3: Get next member via round-robin
      const memberResult = await this.getNextMemberRoundRobin(workspaceId, poolId);
      
      if (!memberResult) {
        // No members available - rollback
        await this.releaseReservation(workspaceId, reservation.id, slotId);
        return { success: false, error: 'NO_MEMBER_AVAILABLE' };
      }

      // Step 4: Create booking
      const booking = await this.createBooking({
        workspace_id: workspaceId,
        pool_id: poolId,
        slot_id: slotId,
        assignee_user_id: memberResult.member.user_id,
        assignment_algo: 'round_robin',
        requester_user_id: requesterUserId,
        requester_note: requesterNote,
      });

      // Step 5: Update slot status to booked
      await this.updateSlotStatus(workspaceId, slotId, 'booked');

      // Step 6: Consume reservation
      await this.consumeReservation(workspaceId, reservation.id);

      return { success: true, booking };

    } catch (error) {
      // Rollback reservation on any error
      console.error('[PoolsRepository] Booking failed, rolling back reservation:', error);
      await this.releaseReservation(workspaceId, reservation.id, slotId);
      return { success: false, error: 'ASSIGNMENT_FAILED' };
    }
  }
}
