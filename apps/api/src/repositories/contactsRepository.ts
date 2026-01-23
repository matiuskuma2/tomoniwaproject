/**
 * Contacts Repository
 * 
 * 予定調整ツールの台帳（Source of Truth）
 * - 内部ユーザー（internal_user）と外部（external_person/list_member）を統合管理
 * - workspace境界の強制
 * - InviteeKey生成（u:<user_id> / e:<sha256_16(email)>）
 */

import type { D1Database } from '@cloudflare/workers-types';

export type ContactKind = 'internal_user' | 'external_person' | 'list_member';
export type RelationshipType = 'family' | 'coworker' | 'external';

export interface Contact {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  kind: ContactKind;
  user_id: string | null;
  email: string | null;
  display_name: string | null;
  relationship_type: RelationshipType;
  tags_json: string; // JSON array
  notes: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateContactInput {
  workspace_id: string;
  owner_user_id: string;
  kind: ContactKind;
  user_id?: string | null;
  email?: string | null;
  display_name?: string | null;
  relationship_type?: RelationshipType;
  tags?: string[];
  notes?: string | null;
  summary?: string | null;
}

export interface UpdateContactInput {
  display_name?: string | null;
  relationship_type?: RelationshipType;
  tags?: string[];
  notes?: string | null;
  summary?: string | null;
}

export interface ContactSearchParams {
  workspace_id: string;
  owner_user_id: string;
  q?: string;
  kind?: ContactKind;
  relationship_type?: RelationshipType;
  limit?: number;
  offset?: number;
}

export class ContactsRepository {
  constructor(private db: D1Database) {}

  /**
   * Generate invitee_key from contact
   * - internal_user: u:<user_id>
   * - external: e:<sha256_16(lower(email))>
   */
  static async generateInviteeKey(contact: Contact): Promise<string | null> {
    if (contact.kind === 'internal_user' && contact.user_id) {
      return `u:${contact.user_id}`;
    }
    if ((contact.kind === 'external_person' || contact.kind === 'list_member') && contact.email) {
      const emailLower = contact.email.toLowerCase();
      const encoder = new TextEncoder();
      const data = encoder.encode(emailLower);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return `e:${hashHex.substring(0, 16)}`;
    }
    return null;
  }

  /**
   * Create a new contact
   */
  async create(input: CreateContactInput): Promise<Contact> {
    const id = crypto.randomUUID();
    const tags_json = JSON.stringify(input.tags || []);
    const now = new Date().toISOString();

    // Normalize email to lowercase
    const email = input.email ? input.email.toLowerCase() : null;

    await this.db
      .prepare(
        `INSERT INTO contacts (
          id, workspace_id, owner_user_id, kind, user_id, email, display_name,
          relationship_type, tags_json, notes, summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.workspace_id,
        input.owner_user_id,
        input.kind,
        input.user_id || null,
        email,
        input.display_name || null,
        input.relationship_type || 'external',
        tags_json,
        input.notes || null,
        input.summary || null,
        now,
        now
      )
      .run();

    const result = await this.db
      .prepare(`SELECT * FROM contacts WHERE id = ?`)
      .bind(id)
      .first<Contact>();

    if (!result) {
      throw new Error('Failed to create contact');
    }

    return result;
  }

  /**
   * Get contact by ID
   */
  async getById(id: string, workspace_id: string, owner_user_id: string): Promise<Contact | null> {
    const result = await this.db
      .prepare(
        `SELECT * FROM contacts 
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(id, workspace_id, owner_user_id)
      .first<Contact>();

    return result || null;
  }

  /**
   * Search contacts
   */
  async search(params: ContactSearchParams): Promise<{ contacts: Contact[]; total: number }> {
    const {
      workspace_id,
      owner_user_id,
      q,
      kind,
      relationship_type,
      limit = 50,
      offset = 0,
    } = params;

    let query = `SELECT * FROM contacts WHERE workspace_id = ? AND owner_user_id = ?`;
    const bindings: any[] = [workspace_id, owner_user_id];

    if (q) {
      query += ` AND (
        display_name LIKE ? OR
        email LIKE ? OR
        notes LIKE ?
      )`;
      const searchTerm = `%${q}%`;
      bindings.push(searchTerm, searchTerm, searchTerm);
    }

    if (kind) {
      query += ` AND kind = ?`;
      bindings.push(kind);
    }

    if (relationship_type) {
      query += ` AND relationship_type = ?`;
      bindings.push(relationship_type);
    }

    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countResult = await this.db
      .prepare(countQuery)
      .bind(...bindings)
      .first<{ count: number }>();

    const total = countResult?.count || 0;

    // Get paginated results
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const result = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<Contact>();

    return {
      contacts: result.results || [],
      total,
    };
  }

  /**
   * Update contact
   */
  async update(
    id: string,
    workspace_id: string,
    owner_user_id: string,
    input: UpdateContactInput
  ): Promise<Contact> {
    const updates: string[] = [];
    const bindings: any[] = [];

    if (input.display_name !== undefined) {
      updates.push('display_name = ?');
      bindings.push(input.display_name);
    }

    if (input.relationship_type) {
      updates.push('relationship_type = ?');
      bindings.push(input.relationship_type);
    }

    if (input.tags !== undefined) {
      updates.push('tags_json = ?');
      bindings.push(JSON.stringify(input.tags));
    }

    if (input.notes !== undefined) {
      updates.push('notes = ?');
      bindings.push(input.notes);
    }

    if (input.summary !== undefined) {
      updates.push('summary = ?');
      bindings.push(input.summary);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    updates.push('updated_at = ?');
    bindings.push(new Date().toISOString());

    bindings.push(id, workspace_id, owner_user_id);

    await this.db
      .prepare(
        `UPDATE contacts SET ${updates.join(', ')}
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(...bindings)
      .run();

    const result = await this.getById(id, workspace_id, owner_user_id);
    if (!result) {
      throw new Error('Contact not found after update');
    }

    return result;
  }

  /**
   * Delete contact
   */
  async delete(id: string, workspace_id: string, owner_user_id: string): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM contacts 
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(id, workspace_id, owner_user_id)
      .run();
  }

  /**
   * Get contact by email (for external lookup)
   */
  async getByEmail(
    email: string,
    workspace_id: string,
    owner_user_id: string
  ): Promise<Contact | null> {
    const emailLower = email.toLowerCase();
    const result = await this.db
      .prepare(
        `SELECT * FROM contacts 
         WHERE email = ? AND workspace_id = ? AND owner_user_id = ?
         LIMIT 1`
      )
      .bind(emailLower, workspace_id, owner_user_id)
      .first<Contact>();

    return result || null;
  }

  /**
   * Get contact by user_id (for internal lookup)
   */
  async getByUserId(
    user_id: string,
    workspace_id: string,
    owner_user_id: string
  ): Promise<Contact | null> {
    const result = await this.db
      .prepare(
        `SELECT * FROM contacts 
         WHERE user_id = ? AND workspace_id = ? AND owner_user_id = ?
         LIMIT 1`
      )
      .bind(user_id, workspace_id, owner_user_id)
      .first<Contact>();

    return result || null;
  }

  /**
   * P2-E2: Upsert contact by email (create or update phone)
   * - If contact exists: update phone only
   * - If contact doesn't exist: create as external_person with phone
   */
  async upsertByEmail(
    workspace_id: string,
    owner_user_id: string,
    email: string,
    phone: string,
    display_name?: string
  ): Promise<Contact> {
    const emailLower = email.toLowerCase();
    const now = new Date().toISOString();

    // Check existing contact
    const existing = await this.getByEmail(emailLower, workspace_id, owner_user_id);

    if (existing) {
      // Update phone only
      await this.db
        .prepare(
          `UPDATE contacts SET phone = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
        )
        .bind(phone, now, existing.id, workspace_id, owner_user_id)
        .run();

      const updated = await this.getById(existing.id, workspace_id, owner_user_id);
      if (!updated) {
        throw new Error('Contact not found after update');
      }
      return updated;
    }

    // Create new external_person contact
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO contacts (
          id, workspace_id, owner_user_id, kind, user_id, email, phone, display_name,
          relationship_type, tags_json, notes, summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        workspace_id,
        owner_user_id,
        'external_person',
        null,
        emailLower,
        phone,
        display_name || null,
        'external',
        '[]',
        null,
        null,
        now,
        now
      )
      .run();

    const created = await this.getById(id, workspace_id, owner_user_id);
    if (!created) {
      throw new Error('Failed to create contact');
    }
    return created;
  }

  /**
   * P2-E2: Get phone numbers for multiple emails
   * - Used for SMS sending
   */
  async getPhonesByEmails(
    workspace_id: string,
    owner_user_id: string,
    emails: string[]
  ): Promise<Map<string, string>> {
    if (emails.length === 0) {
      return new Map();
    }

    const emailsLower = emails.map(e => e.toLowerCase());
    const placeholders = emailsLower.map(() => '?').join(',');

    const result = await this.db
      .prepare(
        `SELECT email, phone FROM contacts 
         WHERE email IN (${placeholders}) 
         AND workspace_id = ? AND owner_user_id = ?
         AND phone IS NOT NULL AND phone != ''`
      )
      .bind(...emailsLower, workspace_id, owner_user_id)
      .all<{ email: string; phone: string }>();

    const phoneMap = new Map<string, string>();
    for (const row of result.results || []) {
      phoneMap.set(row.email, row.phone);
    }

    return phoneMap;
  }
}
