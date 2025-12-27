/**
 * BusinessCardsRepository
 * 
 * 名刺画像のメタデータ管理
 * - 画像はR2に保存、DBにはメタデータのみ
 * - contacts との紐付け管理
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface BusinessCard {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  contact_id: string | null;
  r2_object_key: string;
  original_filename: string | null;
  mime_type: string;
  byte_size: number;
  occurred_at: string;
  source: string;
  extracted_json: string;
  extraction_status: 'none' | 'queued' | 'done' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface ContactTouchpoint {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  contact_id: string;
  occurred_at: string;
  channel: 'business_card' | 'manual' | 'import' | 'scheduling_thread' | 'room' | 'referral';
  note: string | null;
  metadata_json: string;
  created_at: string;
}

export class BusinessCardsRepository {
  constructor(private db: D1Database) {}

  /**
   * Create business card record
   */
  async create(card: {
    workspace_id: string;
    owner_user_id: string;
    contact_id?: string | null;
    r2_object_key: string;
    original_filename?: string | null;
    mime_type: string;
    byte_size: number;
    occurred_at: string;
  }): Promise<BusinessCard> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO business_cards (
          id, workspace_id, owner_user_id, contact_id,
          r2_object_key, original_filename, mime_type, byte_size,
          occurred_at, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'business_card', ?, ?)`
      )
      .bind(
        id,
        card.workspace_id,
        card.owner_user_id,
        card.contact_id || null,
        card.r2_object_key,
        card.original_filename || null,
        card.mime_type,
        card.byte_size,
        card.occurred_at,
        now,
        now
      )
      .run();

    const result = await this.db
      .prepare('SELECT * FROM business_cards WHERE id = ?')
      .bind(id)
      .first<BusinessCard>();

    if (!result) {
      throw new Error('Failed to create business card');
    }

    return result;
  }

  /**
   * Get business card by ID
   */
  async getById(
    id: string,
    workspace_id: string,
    owner_user_id: string
  ): Promise<BusinessCard | null> {
    const result = await this.db
      .prepare(
        `SELECT * FROM business_cards 
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(id, workspace_id, owner_user_id)
      .first<BusinessCard>();

    return result || null;
  }

  /**
   * Link business card to contact
   */
  async linkContact(
    id: string,
    contact_id: string,
    workspace_id: string,
    owner_user_id: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE business_cards 
         SET contact_id = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND owner_user_id = ?`
      )
      .bind(contact_id, now, id, workspace_id, owner_user_id)
      .run();
  }

  /**
   * Create contact touchpoint
   */
  async createTouchpoint(touchpoint: {
    workspace_id: string;
    owner_user_id: string;
    contact_id: string;
    occurred_at: string;
    channel?: 'business_card' | 'manual' | 'import' | 'scheduling_thread' | 'room' | 'referral';
    note?: string | null;
    metadata_json?: string;
  }): Promise<ContactTouchpoint> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO contact_touchpoints (
          id, workspace_id, owner_user_id, contact_id,
          occurred_at, channel, note, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        touchpoint.workspace_id,
        touchpoint.owner_user_id,
        touchpoint.contact_id,
        touchpoint.occurred_at,
        touchpoint.channel || 'business_card',
        touchpoint.note || null,
        touchpoint.metadata_json || '{}',
        now
      )
      .run();

    const result = await this.db
      .prepare('SELECT * FROM contact_touchpoints WHERE id = ?')
      .bind(id)
      .first<ContactTouchpoint>();

    if (!result) {
      throw new Error('Failed to create touchpoint');
    }

    return result;
  }

  /**
   * List business cards by owner
   */
  async listByOwner(
    workspace_id: string,
    owner_user_id: string,
    limit = 50,
    offset = 0
  ): Promise<{ cards: BusinessCard[]; total: number }> {
    // Get total count
    const countResult = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM business_cards 
         WHERE workspace_id = ? AND owner_user_id = ?`
      )
      .bind(workspace_id, owner_user_id)
      .first<{ count: number }>();

    const total = countResult?.count || 0;

    // Get cards
    const result = await this.db
      .prepare(
        `SELECT * FROM business_cards 
         WHERE workspace_id = ? AND owner_user_id = ?
         ORDER BY occurred_at DESC, created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(workspace_id, owner_user_id, limit, offset)
      .all<BusinessCard>();

    return {
      cards: result.results || [],
      total,
    };
  }
}
