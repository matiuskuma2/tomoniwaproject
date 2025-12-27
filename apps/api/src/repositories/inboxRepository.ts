/**
 * Inbox Repository
 * Manages user notifications/inbox messages
 */

export interface InboxItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  action_type: string | null;
  action_target_id: string | null;
  action_url: string | null;
  priority: string;
  is_read: number;
  read_at: string | null;
  created_at: string;
  data?: any; // Optional JSON data for additional context
}

export interface InboxQueryParams {
  user_id: string;
  is_read?: boolean;
  type?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}

export class InboxRepository {
  constructor(private db: D1Database) {}

  /**
   * Get inbox items for a user with filters and pagination
   */
  async getInboxItems(params: InboxQueryParams): Promise<InboxItem[]> {
    const {
      user_id,
      is_read,
      type,
      priority,
      limit = 50,
      offset = 0,
    } = params;

    let query = `
      SELECT 
        id, user_id, type, title, message,
        action_type, action_target_id, action_url,
        priority, is_read, read_at, created_at
      FROM inbox
      WHERE user_id = ?
    `;
    const bindings: any[] = [user_id];

    // Filter by read status
    if (is_read !== undefined) {
      query += ' AND is_read = ?';
      bindings.push(is_read ? 1 : 0);
    }

    // Filter by type
    if (type) {
      query += ' AND type = ?';
      bindings.push(type);
    }

    // Filter by priority
    if (priority) {
      query += ' AND priority = ?';
      bindings.push(priority);
    }

    // Order by created_at DESC (newest first)
    query += ' ORDER BY created_at DESC';

    // Pagination
    query += ' LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<InboxItem>();

    return result.results || [];
  }

  /**
   * Get total count of inbox items (for pagination)
   */
  async getInboxCount(params: Omit<InboxQueryParams, 'limit' | 'offset'>): Promise<number> {
    const { user_id, is_read, type, priority } = params;

    let query = 'SELECT COUNT(*) as count FROM inbox WHERE user_id = ?';
    const bindings: any[] = [user_id];

    if (is_read !== undefined) {
      query += ' AND is_read = ?';
      bindings.push(is_read ? 1 : 0);
    }

    if (type) {
      query += ' AND type = ?';
      bindings.push(type);
    }

    if (priority) {
      query += ' AND priority = ?';
      bindings.push(priority);
    }

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .first<{ count: number }>();

    return result?.count || 0;
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(user_id: string): Promise<number> {
    const result = await this.db
      .prepare('SELECT COUNT(*) as count FROM inbox WHERE user_id = ? AND is_read = 0')
      .bind(user_id)
      .first<{ count: number }>();

    return result?.count || 0;
  }

  /**
   * Get a single inbox item by id
   */
  async getById(id: string, user_id: string): Promise<InboxItem | null> {
    const result = await this.db
      .prepare(
        `SELECT 
          id, user_id, type, title, message,
          action_type, action_target_id, action_url,
          priority, is_read, read_at, created_at
        FROM inbox
        WHERE id = ? AND user_id = ?`
      )
      .bind(id, user_id)
      .first<InboxItem>();

    return result || null;
  }

  /**
   * Mark an inbox item as read
   */
  async markAsRead(id: string, user_id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE inbox 
         SET is_read = 1, read_at = datetime('now')
         WHERE id = ? AND user_id = ?`
      )
      .bind(id, user_id)
      .run();

    return result.success && (result.meta?.changes || 0) > 0;
  }

  /**
   * Mark an inbox item as unread
   */
  async markAsUnread(id: string, user_id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE inbox 
         SET is_read = 0, read_at = NULL
         WHERE id = ? AND user_id = ?`
      )
      .bind(id, user_id)
      .run();

    return result.success && (result.meta?.changes || 0) > 0;
  }

  /**
   * Mark all inbox items as read for a user
   */
  async markAllAsRead(user_id: string): Promise<number> {
    const result = await this.db
      .prepare(
        `UPDATE inbox 
         SET is_read = 1, read_at = datetime('now')
         WHERE user_id = ? AND is_read = 0`
      )
      .bind(user_id)
      .run();

    return result.meta?.changes || 0;
  }

  /**
   * Delete an inbox item
   */
  async delete(id: string, user_id: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM inbox WHERE id = ? AND user_id = ?')
      .bind(id, user_id)
      .run();

    return result.success && (result.meta?.changes || 0) > 0;
  }

  /**
   * Delete all read items for a user
   */
  async deleteAllRead(user_id: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM inbox WHERE user_id = ? AND is_read = 1')
      .bind(user_id)
      .run();

    return result.meta?.changes || 0;
  }

  /**
   * Create a new inbox item
   */
  async create(item: Omit<InboxItem, 'id' | 'created_at' | 'is_read' | 'read_at'>): Promise<string> {
    const id = `inbox-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    await this.db
      .prepare(
        `INSERT INTO inbox (
          id, user_id, type, title, message,
          action_type, action_target_id, action_url, priority
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        item.user_id,
        item.type,
        item.title,
        item.message || null,
        item.action_type || null,
        item.action_target_id || null,
        item.action_url || null,
        item.priority || 'normal'
      )
      .run();

    return id;
  }
}
