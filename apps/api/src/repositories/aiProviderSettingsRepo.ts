/**
 * AI Provider Settings Repository
 * Handles CRUD operations for ai_provider_settings table
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { AIProviderSettings, AIProvider } from '../../../../packages/shared/src/types/ai';
import { randomUUID } from 'crypto';

export class AIProviderSettingsRepository {
  constructor(private db: D1Database) {}

  /**
   * Get all provider settings
   */
  async getAll(): Promise<AIProviderSettings[]> {
    const result = await this.db
      .prepare(
        `SELECT 
          id, provider, is_enabled, default_model, 
          fallback_provider, fallback_model, feature_routing_json,
          created_at, updated_at
        FROM ai_provider_settings
        ORDER BY provider`
      )
      .all<AIProviderSettings>();

    return (result.results || []).map(row => ({
      ...row,
      is_enabled: Boolean(row.is_enabled),
      feature_routing_json: this.parseJSON(row.feature_routing_json),
    }));
  }

  /**
   * Get settings for a specific provider
   */
  async getByProvider(provider: AIProvider): Promise<AIProviderSettings | null> {
    const result = await this.db
      .prepare(
        `SELECT 
          id, provider, is_enabled, default_model, 
          fallback_provider, fallback_model, feature_routing_json,
          created_at, updated_at
        FROM ai_provider_settings
        WHERE provider = ?`
      )
      .bind(provider)
      .first<AIProviderSettings>();

    if (!result) return null;

    return {
      ...result,
      is_enabled: Boolean(result.is_enabled),
      feature_routing_json: this.parseJSON(result.feature_routing_json),
    };
  }

  /**
   * Upsert multiple provider settings (batch update)
   * Uses ON CONFLICT(provider) DO UPDATE
   */
  async upsertMany(
    items: Array<{
      provider: AIProvider;
      is_enabled: boolean;
      default_model: string;
      fallback_provider?: AIProvider | null;
      fallback_model?: string | null;
      feature_routing_json?: Record<string, any>;
    }>
  ): Promise<AIProviderSettings[]> {
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Execute upserts in a batch
    const statements = items.map(item => {
      const id = randomUUID();
      const featureRouting = JSON.stringify(item.feature_routing_json || {});
      
      return this.db
        .prepare(
          `INSERT INTO ai_provider_settings 
            (id, provider, is_enabled, default_model, fallback_provider, fallback_model, feature_routing_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider) DO UPDATE SET
            is_enabled = excluded.is_enabled,
            default_model = excluded.default_model,
            fallback_provider = excluded.fallback_provider,
            fallback_model = excluded.fallback_model,
            feature_routing_json = excluded.feature_routing_json,
            updated_at = excluded.updated_at`
        )
        .bind(
          id,
          item.provider,
          item.is_enabled ? 1 : 0,
          item.default_model,
          item.fallback_provider || null,
          item.fallback_model || null,
          featureRouting,
          timestamp,
          timestamp
        );
    });

    // Execute all statements in batch
    await this.db.batch(statements);

    // Return updated settings
    return this.getAll();
  }

  /**
   * Helper: Parse JSON with fallback
   */
  private parseJSON(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value || {};
  }
}
