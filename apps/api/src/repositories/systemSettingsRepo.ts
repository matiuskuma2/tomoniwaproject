/**
 * System Settings Repository
 * Handles CRUD operations for system_settings table (key-value store)
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { SystemSetting, SystemSettingUpsertItem } from '../../../../packages/shared/src/types/system';

export class SystemSettingsRepository {
  constructor(private db: D1Database) {}

  /**
   * Get all system settings
   */
  async getAll(): Promise<SystemSetting[]> {
    const result = await this.db
      .prepare(
        `SELECT key, value_json, updated_by_admin_id, updated_at
        FROM system_settings
        ORDER BY key`
      )
      .all<SystemSetting>();

    return (result.results || []).map(row => ({
      ...row,
      value_json: this.parseJSON(row.value_json),
    }));
  }

  /**
   * Get a specific setting by key
   */
  async getByKey(key: string): Promise<SystemSetting | null> {
    const result = await this.db
      .prepare(
        `SELECT key, value_json, updated_by_admin_id, updated_at
        FROM system_settings
        WHERE key = ?`
      )
      .bind(key)
      .first<SystemSetting>();

    if (!result) return null;

    return {
      ...result,
      value_json: this.parseJSON(result.value_json),
    };
  }

  /**
   * Upsert multiple settings (batch update)
   * Uses ON CONFLICT(key) DO UPDATE
   */
  async upsertMany(
    items: SystemSettingUpsertItem[],
    updatedByAdminId?: string
  ): Promise<SystemSetting[]> {
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Execute upserts in a batch
    const statements = items.map(item => {
      const valueJson = JSON.stringify(item.value_json);
      
      return this.db
        .prepare(
          `INSERT INTO system_settings 
            (key, value_json, updated_by_admin_id, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_by_admin_id = excluded.updated_by_admin_id,
            updated_at = excluded.updated_at`
        )
        .bind(
          item.key,
          valueJson,
          updatedByAdminId || null,
          timestamp
        );
    });

    // Execute all statements in batch
    await this.db.batch(statements);

    // Return updated settings
    return this.getAll();
  }

  /**
   * Delete a setting by key
   */
  async delete(key: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM system_settings WHERE key = ?`)
      .bind(key)
      .run();
  }

  /**
   * Get settings by key prefix (e.g., "email.*")
   */
  async getByPrefix(prefix: string): Promise<SystemSetting[]> {
    const result = await this.db
      .prepare(
        `SELECT key, value_json, updated_by_admin_id, updated_at
        FROM system_settings
        WHERE key LIKE ?
        ORDER BY key`
      )
      .bind(`${prefix}%`)
      .all<SystemSetting>();

    return (result.results || []).map(row => ({
      ...row,
      value_json: this.parseJSON(row.value_json),
    }));
  }

  /**
   * Helper: Parse JSON with fallback
   */
  private parseJSON(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value; // Return as-is if not valid JSON
      }
    }
    return value;
  }
}
