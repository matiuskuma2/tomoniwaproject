/**
 * Session Repository
 * Handles session CRUD operations for authentication
 */

import { v4 as uuidv4 } from 'uuid';

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
  user_agent?: string;
  ip_address?: string;
}

export interface CreateSessionOptions {
  user_id: string;
  token_hash: string;
  expires_in_seconds: number;
  user_agent?: string;
  ip_address?: string;
}

export class SessionRepository {
  constructor(private db: D1Database) {}

  /**
   * Create a new session
   */
  async create(options: CreateSessionOptions): Promise<Session> {
    const id = uuidv4();
    const now = new Date();
    const expires_at = new Date(now.getTime() + options.expires_in_seconds * 1000);

    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        options.user_id,
        options.token_hash,
        expires_at.toISOString(),
        options.user_agent || null,
        options.ip_address || null
      )
      .run();

    return this.findById(id) as Promise<Session>;
  }

  /**
   * Find session by token hash
   */
  async findByTokenHash(token_hash: string): Promise<Session | null> {
    const result = await this.db
      .prepare(
        `SELECT * FROM sessions 
         WHERE token_hash = ? AND expires_at > datetime('now')`
      )
      .bind(token_hash)
      .first<Session>();

    return result || null;
  }

  /**
   * Find session by ID
   */
  async findById(id: string): Promise<Session | null> {
    const result = await this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(id)
      .first<Session>();

    return result || null;
  }

  /**
   * Update last_seen_at timestamp
   */
  async updateLastSeen(id: string): Promise<void> {
    await this.db
      .prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
      .bind(id)
      .run();
  }

  /**
   * Revoke (delete) a session
   */
  async revoke(id: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM sessions WHERE id = ?`)
      .bind(id)
      .run();
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllForUser(user_id: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM sessions WHERE user_id = ?`)
      .bind(user_id)
      .run();
  }

  /**
   * Clean up expired sessions (called by cron job)
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`)
      .run();

    return result.meta.changes || 0;
  }

  /**
   * Get active session count for a user
   */
  async getActiveSessionCount(user_id: string): Promise<number> {
    const result = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM sessions 
         WHERE user_id = ? AND expires_at > datetime('now')`
      )
      .bind(user_id)
      .first<{ count: number }>();

    return result?.count || 0;
  }
}
