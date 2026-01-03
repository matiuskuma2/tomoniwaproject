/**
 * Threads Repository
 * 
 * Manages threads, invites, and participants
 */

import { v4 as uuidv4 } from 'uuid';

export interface Thread {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  description: string | null;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
}

// SchedulingThread interface (from scheduling_threads table)
export interface SchedulingThread {
  id: string;
  organizer_user_id: string;
  title: string | null;
  description: string | null;
  status: 'draft' | 'sent' | 'confirmed' | 'cancelled';
  mode: 'one_on_one' | 'group' | 'public';
  created_at: string;
  updated_at: string;
}

export interface ThreadInvite {
  id: string;
  thread_id: string;
  token: string;
  email: string;
  candidate_name: string;
  candidate_reason: string | null;
  invitee_key: string | null; // Phase B: InviteeKey for attendance tracking
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface ThreadParticipant {
  id: string;
  thread_id: string;
  user_id: string | null;
  email: string | null;
  role: 'owner' | 'member';
  joined_at: string;
}

export class ThreadsRepository {
  constructor(private db: D1Database) {}

  /**
   * Create a new thread
   */
  async create(data: {
    user_id: string;
    workspace_id?: string | null;
    title: string;
    description?: string | null;
  }): Promise<Thread> {
    const id = uuidv4();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO threads (id, user_id, workspace_id, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .bind(id, data.user_id, data.workspace_id || null, data.title, data.description || null, now, now)
      .run();

    // Add owner as participant
    await this.addParticipant({
      thread_id: id,
      user_id: data.user_id,
      role: 'owner',
    });

    const thread = await this.getById(id);
    if (!thread) {
      throw new Error('Failed to create thread');
    }

    return thread;
  }

  /**
   * Get thread by ID
   */
  async getById(id: string): Promise<Thread | null> {
    const result = await this.db
      .prepare('SELECT * FROM threads WHERE id = ?')
      .bind(id)
      .first<Thread>();

    return result || null;
  }

  /**
   * Create invite for a candidate
   */
  async createInvite(data: {
    thread_id: string;
    email: string;
    candidate_name: string;
    candidate_reason?: string | null;
    expires_in_hours?: number;
  }): Promise<ThreadInvite> {
    const id = uuidv4();
    const token = this.generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (data.expires_in_hours || 72) * 60 * 60 * 1000);

    // Generate invitee_key (e: prefix for email-based invites)
    // Use Web Crypto API for hashing (Cloudflare Workers compatible)
    const encoder = new TextEncoder();
    const emailData = encoder.encode(data.email.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', emailData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const emailHash = hashHex.substring(0, 16);
    const inviteeKey = `e:${emailHash}`;

    await this.db
      .prepare(
        `INSERT INTO thread_invites (id, thread_id, token, email, candidate_name, candidate_reason, invitee_key, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(
        id,
        data.thread_id,
        token,
        data.email,
        data.candidate_name,
        data.candidate_reason || null,
        inviteeKey,
        expiresAt.toISOString(),
        now.toISOString()
      )
      .run();

    const invite = await this.getInviteByToken(token);
    if (!invite) {
      throw new Error('Failed to create invite');
    }

    return invite;
  }

  /**
   * Create invites in batch (P0-1: Transaction for performance)
   * - Splits into chunks of 200 to avoid timeout
   * - Uses INSERT OR IGNORE for idempotency
   * - Returns { inserted, skipped, total }
   */
  async createInvitesBatch(
    invites: Array<{
      thread_id: string;
      email: string;
      candidate_name: string;
      candidate_reason?: string | null;
      expires_in_hours?: number;
    }>
  ): Promise<{ inserted: number; skipped: number; total: number }> {
    const CHUNK_SIZE = 200;
    let totalInserted = 0;
    let totalSkipped = 0;

    // Split into chunks
    for (let i = 0; i < invites.length; i += CHUNK_SIZE) {
      const chunk = invites.slice(i, i + CHUNK_SIZE);

      // Process chunk in transaction
      const result = await this.db.batch(
        await Promise.all(
          chunk.map(async (data) => {
            const id = uuidv4();
            const token = this.generateToken();
            const now = new Date();
            const expiresAt = new Date(
              now.getTime() + (data.expires_in_hours || 72) * 60 * 60 * 1000
            );

            // Generate invitee_key
            const encoder = new TextEncoder();
            const emailData = encoder.encode(data.email.toLowerCase());
            const hashBuffer = await crypto.subtle.digest('SHA-256', emailData);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
            const emailHash = hashHex.substring(0, 16);
            const inviteeKey = `e:${emailHash}`;

            return this.db.prepare(
              `INSERT OR IGNORE INTO thread_invites (id, thread_id, token, email, candidate_name, candidate_reason, invitee_key, status, expires_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
            ).bind(
              id,
              data.thread_id,
              token,
              data.email,
              data.candidate_name,
              data.candidate_reason || null,
              inviteeKey,
              expiresAt.toISOString(),
              now.toISOString()
            );
          })
        )
      );

      // Count inserted vs skipped
      const inserted = result.filter((r) => r.meta.changes > 0).length;
      const skipped = chunk.length - inserted;

      totalInserted += inserted;
      totalSkipped += skipped;

      console.log(`[ThreadsRepository] Batch chunk ${i / CHUNK_SIZE + 1}: inserted=${inserted}, skipped=${skipped}`);
    }

    return {
      inserted: totalInserted,
      skipped: totalSkipped,
      total: invites.length,
    };
  }

  /**
   * Get invite by token
   */
  async getInviteByToken(token: string): Promise<ThreadInvite | null> {
    const result = await this.db
      .prepare('SELECT * FROM thread_invites WHERE token = ?')
      .bind(token)
      .first<ThreadInvite>();

    return result || null;
  }

  /**
   * Accept invite
   */
  async acceptInvite(token: string, user_id?: string): Promise<ThreadInvite> {
    const invite = await this.getInviteByToken(token);
    if (!invite) {
      throw new Error('Invite not found');
    }

    if (invite.status !== 'pending') {
      throw new Error('Invite already processed');
    }

    if (new Date(invite.expires_at) < new Date()) {
      throw new Error('Invite expired');
    }

    const now = new Date().toISOString();

    // Update invite status
    await this.db
      .prepare('UPDATE thread_invites SET status = ?, accepted_at = ? WHERE token = ?')
      .bind('accepted', now, token)
      .run();

    // Add as participant
    await this.addParticipant({
      thread_id: invite.thread_id,
      user_id: user_id || null,
      email: invite.email,
      role: 'member',
    });

    const updated = await this.getInviteByToken(token);
    if (!updated) {
      throw new Error('Failed to accept invite');
    }

    return updated;
  }

  /**
   * Add participant to thread
   */
  async addParticipant(data: {
    thread_id: string;
    user_id?: string | null;
    email?: string | null;
    role?: 'owner' | 'member';
  }): Promise<ThreadParticipant> {
    const id = uuidv4();
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO thread_participants (id, thread_id, user_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, user_id) DO NOTHING`
      )
      .bind(
        id,
        data.thread_id,
        data.user_id || null,
        data.email || null,
        data.role || 'member',
        now
      )
      .run();

    const participant = await this.db
      .prepare('SELECT * FROM thread_participants WHERE id = ?')
      .bind(id)
      .first<ThreadParticipant>();

    if (!participant) {
      throw new Error('Failed to add participant');
    }

    return participant;
  }

  /**
   * Get thread participants
   */
  async getParticipants(thread_id: string): Promise<ThreadParticipant[]> {
    const result = await this.db
      .prepare('SELECT * FROM thread_participants WHERE thread_id = ? ORDER BY joined_at ASC')
      .bind(thread_id)
      .all<ThreadParticipant>();

    return result.results || [];
  }

  /**
   * List invites for a thread
   */
  async listInvites(thread_id: string): Promise<ThreadInvite[]> {
    const result = await this.db
      .prepare('SELECT * FROM thread_invites WHERE thread_id = ? ORDER BY created_at DESC')
      .bind(thread_id)
      .all<ThreadInvite>();

    return result.results || [];
  }

  /**
   * Update invite status
   */
  async updateInviteStatus(inviteId: string, newStatus: 'pending' | 'accepted' | 'declined' | 'expired'): Promise<void> {
    const now = new Date().toISOString();
    const updateField = newStatus === 'accepted' ? ', accepted_at = ?' : '';
    const bindings = newStatus === 'accepted' 
      ? [newStatus, now, inviteId]
      : [newStatus, inviteId];

    await this.db
      .prepare(`UPDATE thread_invites SET status = ?${updateField} WHERE id = ?`)
      .bind(...bindings)
      .run();
  }

  /**
   * Get scheduling thread by ID (from scheduling_threads table)
   */
  async getSchedulingThreadById(id: string): Promise<SchedulingThread | null> {
    const result = await this.db
      .prepare('SELECT * FROM scheduling_threads WHERE id = ?')
      .bind(id)
      .first<SchedulingThread>();

    return result || null;
  }

  /**
   * Generate random token
   */
  private generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
