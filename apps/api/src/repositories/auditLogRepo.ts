/**
 * Audit Log Repository
 * Records all administrative actions for compliance and debugging
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  actor_admin_id: string | null;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_json: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: number;
}

export class AuditLogRepository {
  constructor(private db: D1Database) {}

  /**
   * Create audit log entry
   */
  async create(entry: {
    actor_user_id?: string;
    actor_admin_id?: string;
    action_type: string;
    entity_type?: string;
    entity_id?: string;
    payload?: Record<string, any>;
    ip_address?: string;
    user_agent?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadJson = entry.payload ? JSON.stringify(entry.payload) : null;

    await this.db
      .prepare(
        `INSERT INTO audit_logs 
          (id, actor_user_id, actor_admin_id, action_type, entity_type, entity_id, payload_json, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        entry.actor_user_id || null,
        entry.actor_admin_id || null,
        entry.action_type,
        entry.entity_type || null,
        entry.entity_id || null,
        payloadJson,
        entry.ip_address || null,
        entry.user_agent || null,
        timestamp
      )
      .run();

    return id;
  }

  /**
   * Query audit logs
   */
  async query(filters: {
    from?: number;
    to?: number;
    action_type?: string;
    entity_type?: string;
    entity_id?: string;
    actor_admin_id?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const conditions: string[] = ['1=1'];
    const bindings: any[] = [];

    if (filters.from !== undefined) {
      conditions.push('created_at >= ?');
      bindings.push(filters.from);
    }
    if (filters.to !== undefined) {
      conditions.push('created_at < ?');
      bindings.push(filters.to);
    }
    if (filters.action_type) {
      conditions.push('action_type = ?');
      bindings.push(filters.action_type);
    }
    if (filters.entity_type) {
      conditions.push('entity_type = ?');
      bindings.push(filters.entity_type);
    }
    if (filters.entity_id) {
      conditions.push('entity_id = ?');
      bindings.push(filters.entity_id);
    }
    if (filters.actor_admin_id) {
      conditions.push('actor_admin_id = ?');
      bindings.push(filters.actor_admin_id);
    }

    const limit = Math.min(filters.limit || 100, 500);
    bindings.push(limit);

    const result = await this.db
      .prepare(
        `SELECT * FROM audit_logs
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(...bindings)
      .all<AuditLogEntry>();

    return result.results || [];
  }
}
