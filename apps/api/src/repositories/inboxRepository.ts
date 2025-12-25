/**
 * Inbox Repository
 * 
 * Manages user inbox notifications
 */

import { v4 as uuidv4 } from 'uuid';

export interface InboxItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  action_url: string | null;
  is_read: number;
  dismissed_at: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
}

export class InboxRepository {
  constructor(private db: D1Database) {}

  /**
   * Create inbox item
   */
  async create(data: {
    user_id: string;
    type: string;
    title: string;
    description?: string | null;
    action_url?: string | null;
    related_entity_type?: string | null;
    related_entity_id?: string | null;
  }): Promise<InboxItem> {
    const id = uuidv4();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO inbox_items (id, user_id, type, title, description, action_url, related_entity_type, related_entity_id, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .bind(
        id,
        data.user_id,
        data.type,
        data.title,
        data.description || null,
        data.action_url || null,
        data.related_entity_type || null,
        data.related_entity_id || null,
        now
      )
      .run();

    const item = await this.db
      .prepare('SELECT * FROM inbox_items WHERE id = ?')
      .bind(id)
      .first<InboxItem>();

    if (!item) {
      throw new Error('Failed to create inbox item');
    }

    return item;
  }

  /**
   * Get inbox items for user
   */
  async listByUser(userId: string, options?: {
    unread_only?: boolean;
    limit?: number;
  }): Promise<InboxItem[]> {
    let query = 'SELECT * FROM inbox_items WHERE user_id = ?';
    const params: any[] = [userId];

    if (options?.unread_only) {
      query += ' AND is_read = 0';
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all<InboxItem>();

    return result.results || [];
  }

  /**
   * Mark as read
   */
  async markAsRead(id: string, userId: string): Promise<void> {
    await this.db
      .prepare('UPDATE inbox_items SET is_read = 1 WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
  }
}
