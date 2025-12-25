/**
 * AI Provider Keys Repository
 * Handles CRUD operations for ai_provider_keys table
 * SECURITY: Never return decrypted api_key_enc, only masked_preview
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { AIProviderKey, AIProvider } from '../../../../packages/shared/src/types/ai';
import { randomUUID } from 'crypto';

export interface AIProviderKeyResponse {
  id: string;
  provider: AIProvider;
  key_name: string;
  is_active: boolean;
  masked_preview: string | null;
  created_at: number;
  updated_at: number;
}

export class AIProviderKeysRepository {
  constructor(private db: D1Database) {}

  /**
   * Get all provider keys (returns masked_preview only, never decrypted key)
   */
  async getAll(): Promise<AIProviderKeyResponse[]> {
    const result = await this.db
      .prepare(
        `SELECT 
          id, provider, key_name, is_active, masked_preview, created_at, updated_at
        FROM ai_provider_keys
        ORDER BY provider, created_at DESC`
      )
      .all<AIProviderKeyResponse>();

    return (result.results || []).map(row => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  }

  /**
   * Get keys by provider (active only)
   */
  async getByProvider(provider: AIProvider, activeOnly: boolean = true): Promise<AIProviderKeyResponse[]> {
    const query = activeOnly
      ? `SELECT id, provider, key_name, is_active, masked_preview, created_at, updated_at
         FROM ai_provider_keys
         WHERE provider = ? AND is_active = 1
         ORDER BY created_at DESC`
      : `SELECT id, provider, key_name, is_active, masked_preview, created_at, updated_at
         FROM ai_provider_keys
         WHERE provider = ?
         ORDER BY created_at DESC`;

    const result = await this.db
      .prepare(query)
      .bind(provider)
      .all<AIProviderKeyResponse>();

    return (result.results || []).map(row => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  }

  /**
   * Get encrypted key by ID (for internal use only - decryption happens elsewhere)
   */
  async getEncryptedKeyById(id: string): Promise<string | null> {
    const result = await this.db
      .prepare(
        `SELECT api_key_enc FROM ai_provider_keys WHERE id = ? AND is_active = 1`
      )
      .bind(id)
      .first<{ api_key_enc: string }>();

    return result?.api_key_enc || null;
  }

  /**
   * Create a new provider key
   * @param apiKeyEnc - Encrypted API key (encryption must be done before calling this)
   * @param maskedPreview - Masked preview (e.g., "sk-****...****abcd")
   */
  async create(
    provider: AIProvider,
    keyName: string,
    apiKeyEnc: string,
    maskedPreview: string
  ): Promise<AIProviderKeyResponse> {
    const id = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(
        `INSERT INTO ai_provider_keys 
          (id, provider, key_name, api_key_enc, masked_preview, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(id, provider, keyName, apiKeyEnc, maskedPreview, timestamp, timestamp)
      .run();

    return {
      id,
      provider,
      key_name: keyName,
      is_active: true,
      masked_preview: maskedPreview,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  /**
   * Update key metadata (name, is_active)
   * Does NOT update api_key_enc (rotation should create new key)
   */
  async update(
    id: string,
    updates: {
      key_name?: string;
      is_active?: boolean;
    }
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const setParts: string[] = [];
    const bindings: any[] = [];

    if (updates.key_name !== undefined) {
      setParts.push('key_name = ?');
      bindings.push(updates.key_name);
    }
    if (updates.is_active !== undefined) {
      setParts.push('is_active = ?');
      bindings.push(updates.is_active ? 1 : 0);
    }

    if (setParts.length === 0) return;

    setParts.push('updated_at = ?');
    bindings.push(timestamp);
    bindings.push(id);

    await this.db
      .prepare(
        `UPDATE ai_provider_keys 
        SET ${setParts.join(', ')}
        WHERE id = ?`
      )
      .bind(...bindings)
      .run();
  }

  /**
   * Delete a key (soft delete by setting is_active = 0)
   */
  async softDelete(id: string): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    await this.db
      .prepare(
        `UPDATE ai_provider_keys 
        SET is_active = 0, updated_at = ?
        WHERE id = ?`
      )
      .bind(timestamp, id)
      .run();
  }

  /**
   * Hard delete (permanent removal - use with caution)
   */
  async hardDelete(id: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM ai_provider_keys WHERE id = ?`)
      .bind(id)
      .run();
  }
}

/**
 * Utility: Create masked preview from API key
 * Example: "sk-proj-1234567890abcdef" -> "sk-****...****cdef"
 */
export function createMaskedPreview(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '****';
  }
  const prefix = apiKey.slice(0, 3);
  const suffix = apiKey.slice(-4);
  return `${prefix}****...****${suffix}`;
}
