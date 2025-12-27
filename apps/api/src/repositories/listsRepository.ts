/**
 * Lists Repository
 * 
 * 予定調整の一括送信用セグメント（送信先の束）
 * - Contacts を参照して list_members を管理
 * - workspace境界の強制
 * - 一括invite作成の起点
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface List {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListMember {
  id: string;
  workspace_id: string;
  list_id: string;
  contact_id: string;
  created_at: string;
}

export interface ListMemberWithContact {
  id: string;
  workspace_id: string;
  list_id: string;
  contact_id: string;
  created_at: string;
  // Contact details
  contact_kind: string;
  contact_user_id: string | null;
  contact_email: string | null;
  contact_display_name: string | null;
  contact_relationship_type: string;
  contact_tags_json: string;
  contact_notes: string | null;
  contact_summary: string | null;
}

export interface CreateListInput {
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description?: string | null;
}

export interface UpdateListInput {
  name?: string;
  description?: string | null;
}

export class ListsRepository {
  constructor(private db: D1Database) {}

  /**
   * Create a new list
   */
  async create(input: CreateListInput): Promise<List> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO lists (
          id, workspace_id, owner_user_id, name, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.workspace_id,
        input.owner_user_id,
        input.name,
        input.description || null,
        now,
        now
      )
      .run();

    const result = await this.db
      .prepare(`SELECT * FROM lists WHERE id = ?`)
      .bind(id)
      .first<List>();

    if (!result) {
      throw new Error('Failed to create list');
    }

    return result;
  }

  /**
   * Get list by ID
   */
  async getById(id: string, workspace_id: string, owner_user_id: string): Promise<List | null> {
    const result = await this.db
      .prepare(
        `SELECT * FROM lists 
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(id, workspace_id, owner_user_id)
      .first<List>();

    return result || null;
  }

  /**
   * Get all lists for user
   */
  async getAll(
    workspace_id: string,
    owner_user_id: string,
    limit = 50,
    offset = 0
  ): Promise<{ lists: List[]; total: number }> {
    // Get total count
    const countResult = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM lists 
         WHERE workspace_id = ? AND owner_user_id = ?`
      )
      .bind(workspace_id, owner_user_id)
      .first<{ count: number }>();

    const total = countResult?.count || 0;

    // Get paginated results
    const result = await this.db
      .prepare(
        `SELECT * FROM lists 
         WHERE workspace_id = ? AND owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(workspace_id, owner_user_id, limit, offset)
      .all<List>();

    return {
      lists: result.results || [],
      total,
    };
  }

  /**
   * Update list
   */
  async update(
    id: string,
    workspace_id: string,
    owner_user_id: string,
    input: UpdateListInput
  ): Promise<List> {
    const updates: string[] = [];
    const bindings: any[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      bindings.push(input.name);
    }

    if (input.description !== undefined) {
      updates.push('description = ?');
      bindings.push(input.description);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    updates.push('updated_at = ?');
    bindings.push(new Date().toISOString());

    bindings.push(id, workspace_id, owner_user_id);

    await this.db
      .prepare(
        `UPDATE lists SET ${updates.join(', ')}
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(...bindings)
      .run();

    const result = await this.getById(id, workspace_id, owner_user_id);
    if (!result) {
      throw new Error('List not found after update');
    }

    return result;
  }

  /**
   * Delete list
   */
  async delete(id: string, workspace_id: string, owner_user_id: string): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM lists 
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(id, workspace_id, owner_user_id)
      .run();
  }

  /**
   * Add contact to list
   * UNIQUE(list_id, contact_id) prevents duplicates automatically
   */
  async addMember(
    list_id: string,
    contact_id: string,
    workspace_id: string
  ): Promise<ListMember> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await this.db
        .prepare(
          `INSERT INTO list_members (
            id, workspace_id, list_id, contact_id, created_at
          ) VALUES (?, ?, ?, ?, ?)`
        )
        .bind(id, workspace_id, list_id, contact_id, now)
        .run();

      const result = await this.db
        .prepare(`SELECT * FROM list_members WHERE id = ?`)
        .bind(id)
        .first<ListMember>();

      if (!result) {
        throw new Error('Failed to add member');
      }

      return result;
    } catch (error) {
      // UNIQUE constraint violation
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new Error('Contact is already a member of this list');
      }
      throw error;
    }
  }

  /**
   * Remove contact from list
   */
  async removeMember(
    list_id: string,
    contact_id: string,
    workspace_id: string
  ): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM list_members 
         WHERE list_id = ? AND contact_id = ? AND workspace_id = ?`
      )
      .bind(list_id, contact_id, workspace_id)
      .run();
  }

  /**
   * Get list members with contact details
   */
  async getMembers(
    list_id: string,
    workspace_id: string,
    limit = 100,
    offset = 0
  ): Promise<{ members: ListMemberWithContact[]; total: number }> {
    // Get total count
    const countResult = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM list_members 
         WHERE list_id = ? AND workspace_id = ?`
      )
      .bind(list_id, workspace_id)
      .first<{ count: number }>();

    const total = countResult?.count || 0;

    // Get members with contact details
    const result = await this.db
      .prepare(
        `SELECT 
          lm.id,
          lm.workspace_id,
          lm.list_id,
          lm.contact_id,
          lm.created_at,
          c.kind as contact_kind,
          c.user_id as contact_user_id,
          c.email as contact_email,
          c.display_name as contact_display_name,
          c.relationship_type as contact_relationship_type,
          c.tags_json as contact_tags_json,
          c.notes as contact_notes,
          c.summary as contact_summary
         FROM list_members lm
         INNER JOIN contacts c ON lm.contact_id = c.id
         WHERE lm.list_id = ? AND lm.workspace_id = ?
         ORDER BY lm.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(list_id, workspace_id, limit, offset)
      .all<ListMemberWithContact>();

    return {
      members: result.results || [],
      total,
    };
  }

  /**
   * Get member count for a list
   */
  async getMemberCount(list_id: string, workspace_id: string): Promise<number> {
    const result = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM list_members 
         WHERE list_id = ? AND workspace_id = ?`
      )
      .bind(list_id, workspace_id)
      .first<{ count: number }>();

    return result?.count || 0;
  }
}
