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
  PoolAssignmentPolicy,
  PoolSlotStatus,
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
}
