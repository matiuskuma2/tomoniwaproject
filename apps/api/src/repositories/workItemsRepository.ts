/**
 * WorkItems Repository (Ticket 07)
 * 
 * Database operations for work_items table.
 * Uses visibility_scope as source of truth.
 */

export interface WorkItem {
  id: string;
  user_id: string;
  room_id: string | null;
  type: 'task' | 'scheduled';
  title: string;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: number;
  recurrence_rule: string | null;
  location: string | null;
  visibility_scope: 'private' | 'room' | 'quest' | 'squad';
  status: 'pending' | 'completed' | 'cancelled';
  google_event_id: string | null;
  source: 'user' | 'google_calendar' | 'scheduling_thread' | 'auto_generated';
  created_at: string;
  updated_at: string;
}

export interface CreateWorkItemInput {
  user_id: string;
  room_id?: string | null;
  type: 'task' | 'scheduled';
  title: string;
  description?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  all_day?: boolean;
  recurrence_rule?: string | null;
  location?: string | null;
  visibility_scope?: 'private' | 'room' | 'quest' | 'squad';
  status?: 'pending' | 'completed' | 'cancelled';
  source?: 'user' | 'google_calendar' | 'scheduling_thread' | 'auto_generated';
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  all_day?: boolean;
  recurrence_rule?: string | null;
  location?: string | null;
  visibility_scope?: 'private' | 'room' | 'quest' | 'squad';
  room_id?: string | null;
  status?: 'pending' | 'completed' | 'cancelled';
}

export class WorkItemsRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Check if user is member of room
   */
  async isRoomMember(userId: string, roomId: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
      .bind(roomId, userId)
      .first<{ '1': number }>();
    
    return result !== null;
  }

  /**
   * Get user's role in room
   */
  async getRoomRole(userId: string, roomId: string): Promise<string | null> {
    const result = await this.db
      .prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
      .bind(roomId, userId)
      .first<{ role: string }>();
    
    return result?.role || null;
  }

  /**
   * List work items by user (my items)
   * SECURITY: Only returns private items owned by user
   */
  async listByUser(userId: string, options?: {
    status?: 'pending' | 'completed' | 'cancelled';
    type?: 'task' | 'scheduled';
    limit?: number;
    offset?: number;
  }): Promise<WorkItem[]> {
    let query = `
      SELECT * FROM work_items
      WHERE user_id = ? AND visibility_scope = 'private'
    `;
    const params: any[] = [userId];

    if (options?.status) {
      query += ` AND status = ?`;
      params.push(options.status);
    }

    if (options?.type) {
      query += ` AND type = ?`;
      params.push(options.type);
    }

    query += ` ORDER BY created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
      
      if (options?.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const result = await this.db.prepare(query).bind(...params).all<WorkItem>();
    return result.results || [];
  }

  /**
   * List work items by room (shared items)
   */
  async listByRoom(roomId: string, options?: {
    status?: 'pending' | 'completed' | 'cancelled';
    type?: 'task' | 'scheduled';
    limit?: number;
    offset?: number;
  }): Promise<WorkItem[]> {
    let query = `
      SELECT * FROM work_items
      WHERE room_id = ? AND visibility_scope = 'room'
    `;
    const params: any[] = [roomId];

    if (options?.status) {
      query += ` AND status = ?`;
      params.push(options.status);
    }

    if (options?.type) {
      query += ` AND type = ?`;
      params.push(options.type);
    }

    query += ` ORDER BY created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
      
      if (options?.offset) {
        query += ` OFFSET ?`;
        params.push(options.offset);
      }
    }

    const result = await this.db.prepare(query).bind(...params).all<WorkItem>();
    return result.results || [];
  }

  /**
   * Get work item by ID
   */
  async findById(id: string): Promise<WorkItem | null> {
    const result = await this.db
      .prepare('SELECT * FROM work_items WHERE id = ?')
      .bind(id)
      .first<WorkItem>();
    
    return result || null;
  }

  /**
   * Create work item
   */
  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO work_items (
          id, user_id, room_id, type, title, description,
          start_at, end_at, all_day, recurrence_rule, location,
          visibility_scope, status, source,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.user_id,
        input.room_id || null,
        input.type,
        input.title,
        input.description || null,
        input.start_at || null,
        input.end_at || null,
        input.all_day ? 1 : 0,
        input.recurrence_rule || null,
        input.location || null,
        input.visibility_scope || 'private',
        input.status || 'pending',
        input.source || 'user',
        now,
        now
      )
      .run();

    const created = await this.findById(id);
    if (!created) {
      throw new Error('Failed to create work item');
    }

    return created;
  }

  /**
   * Update work item
   */
  async update(id: string, input: UpdateWorkItemInput): Promise<WorkItem> {
    const setClauses: string[] = [];
    const params: any[] = [];

    if (input.title !== undefined) {
      setClauses.push('title = ?');
      params.push(input.title);
    }

    if (input.description !== undefined) {
      setClauses.push('description = ?');
      params.push(input.description);
    }

    if (input.start_at !== undefined) {
      setClauses.push('start_at = ?');
      params.push(input.start_at);
    }

    if (input.end_at !== undefined) {
      setClauses.push('end_at = ?');
      params.push(input.end_at);
    }

    if (input.all_day !== undefined) {
      setClauses.push('all_day = ?');
      params.push(input.all_day ? 1 : 0);
    }

    if (input.recurrence_rule !== undefined) {
      setClauses.push('recurrence_rule = ?');
      params.push(input.recurrence_rule);
    }

    if (input.location !== undefined) {
      setClauses.push('location = ?');
      params.push(input.location);
    }

    if (input.visibility_scope !== undefined) {
      setClauses.push('visibility_scope = ?');
      params.push(input.visibility_scope);
    }

    if (input.room_id !== undefined) {
      setClauses.push('room_id = ?');
      params.push(input.room_id);
    }

    if (input.status !== undefined) {
      setClauses.push('status = ?');
      params.push(input.status);
    }

    if (setClauses.length === 0) {
      // No updates, return existing
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error('Work item not found');
      }
      return existing;
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await this.db
      .prepare(
        `UPDATE work_items SET ${setClauses.join(', ')} WHERE id = ?`
      )
      .bind(...params)
      .run();

    const updated = await this.findById(id);
    if (!updated) {
      throw new Error('Failed to update work item');
    }

    return updated;
  }

  /**
   * Delete work item
   */
  async delete(id: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM work_items WHERE id = ?')
      .bind(id)
      .run();
  }

  /**
   * Check if user can access work item
   */
  async canAccess(workItemId: string, userId: string, roomId?: string): Promise<boolean> {
    const workItem = await this.findById(workItemId);
    if (!workItem) {
      return false;
    }

    // Owner can always access
    if (workItem.user_id === userId) {
      return true;
    }

    // Room-shared items: check room membership
    if (workItem.visibility_scope === 'room' && workItem.room_id === roomId) {
      return true;
    }

    return false;
  }

  /**
   * Check if user can modify work item
   * SECURITY:
   * - private: only owner
   * - room: owner OR room admin/owner
   */
  async canModify(workItemId: string, userId: string): Promise<boolean> {
    const workItem = await this.findById(workItemId);
    if (!workItem) {
      return false;
    }

    // Owner can always modify
    if (workItem.user_id === userId) {
      return true;
    }

    // For room items: check if user is admin/owner of room
    if (workItem.visibility_scope === 'room' && workItem.room_id) {
      const role = await this.getRoomRole(userId, workItem.room_id);
      return role === 'admin' || role === 'owner';
    }

    return false;
  }
}
