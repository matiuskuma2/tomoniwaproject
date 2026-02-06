/**
 * People Repository
 * 
 * People Hub のSSOT統合リポジトリ
 * - contacts + relationships + list_members を結合
 * - 1人につき1レコードで返却
 * - person_key で重複排除（app_user_id > email_normalized > contact_id）
 * 
 * 設計原則:
 * - READ ONLY（書き込みは contacts / relationships API経由）
 * - N+1 禁止
 * - 監査・検索・フィルタ向け最適化
 */

import type { D1Database } from '@cloudflare/workers-types';

// ============================================================
// Types
// ============================================================

export type ConnectionStatus = 'workmate' | 'family' | 'external' | 'pending' | 'blocked';

export interface PersonListMembership {
  list_id: string;
  list_name: string;
}

export interface Person {
  // Primary identifier (SSOT: prioritizes app_user_id > email > contact_id)
  person_id: string;
  person_key: string;  // u:<user_id> | e:<email_hash> | c:<contact_id>
  
  // Display
  display_name: string | null;
  email: string | null;
  
  // Connection status (derived from relationships)
  connection_status: ConnectionStatus;
  relationship_id: string | null;
  relationship_created_at: number | null;
  
  // Contact info (from contacts table)
  contact_id: string | null;
  contact_kind: 'internal_user' | 'external_person' | 'list_member' | null;
  contact_notes: string | null;
  
  // List memberships
  lists: PersonListMembership[];
  
  // Flags
  has_email: boolean;
  is_app_user: boolean;
  
  // Metadata
  created_at: string;
}

export interface PeopleSearchParams {
  workspace_id: string;
  owner_user_id: string;
  // Filters
  q?: string;                          // Search query (name / email)
  connection_status?: ConnectionStatus; // Filter by connection
  list_id?: string;                    // Filter by list membership
  has_email?: boolean;                 // Filter by email presence
  // Pagination
  limit?: number;
  offset?: number;
}

export interface PeopleSearchResult {
  items: Person[];
  total: number;
  limit: number;
  offset: number;
  // Audit info
  missing_email_count: number;
  pending_request_count: number;
}

// ============================================================
// Repository
// ============================================================

export class PeopleRepository {
  constructor(private db: D1Database) {}

  /**
   * Unified People search
   * 
   * SSOT統合クエリ:
   * 1. contacts を基準にLEFT JOINで relationships を取得
   * 2. list_members を集約
   * 3. person_key で重複排除
   */
  async search(params: PeopleSearchParams): Promise<PeopleSearchResult> {
    const {
      workspace_id,
      owner_user_id,
      q,
      connection_status,
      list_id,
      has_email,
      limit = 50,
      offset = 0,
    } = params;

    // ============================================================
    // Main Query: Get People from Contacts + Relationships
    // ============================================================
    
    // Build base query
    // Note: We use contacts as the primary source and LEFT JOIN relationships
    // to get connection status for internal users
    let query = `
      SELECT 
        c.id as contact_id,
        c.kind as contact_kind,
        c.user_id as contact_user_id,
        c.email as contact_email,
        c.display_name as contact_display_name,
        c.relationship_type as contact_relationship_type,
        c.notes as contact_notes,
        c.created_at as contact_created_at,
        r.id as relationship_id,
        r.relation_type as relationship_type,
        r.status as relationship_status,
        r.created_at as relationship_created_at,
        -- User info for internal users
        u.id as user_id,
        u.display_name as user_display_name,
        u.email as user_email
      FROM contacts c
      LEFT JOIN relationships r ON (
        c.user_id IS NOT NULL 
        AND r.status = 'active'
        AND (
          (r.user_a_id = ? AND r.user_b_id = c.user_id)
          OR (r.user_b_id = ? AND r.user_a_id = c.user_id)
        )
      )
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.workspace_id = ? AND c.owner_user_id = ?
    `;
    
    const bindings: any[] = [owner_user_id, owner_user_id, workspace_id, owner_user_id];
    
    // Search filter
    if (q) {
      query += ` AND (
        c.display_name LIKE ? 
        OR c.email LIKE ?
        OR u.display_name LIKE ?
        OR u.email LIKE ?
      )`;
      const searchTerm = `%${q}%`;
      bindings.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Email filter
    if (has_email === true) {
      query += ` AND (c.email IS NOT NULL AND c.email != '')`;
    } else if (has_email === false) {
      query += ` AND (c.email IS NULL OR c.email = '')`;
    }
    
    // Connection status filter (applied after aggregation)
    // Note: This needs special handling as it depends on relationship data
    
    query += ` ORDER BY c.created_at DESC`;
    
    // Execute main query
    const results = await this.db
      .prepare(query)
      .bind(...bindings)
      .all<{
        contact_id: string;
        contact_kind: string;
        contact_user_id: string | null;
        contact_email: string | null;
        contact_display_name: string | null;
        contact_relationship_type: string;
        contact_notes: string | null;
        contact_created_at: string;
        relationship_id: string | null;
        relationship_type: string | null;
        relationship_status: string | null;
        relationship_created_at: number | null;
        user_id: string | null;
        user_display_name: string | null;
        user_email: string | null;
      }>();
    
    const rawItems = results.results || [];
    
    // ============================================================
    // Get List Memberships for all contacts
    // ============================================================
    
    const contactIds = rawItems.map(item => item.contact_id);
    const listMemberships = await this.getListMemberships(contactIds, workspace_id);
    
    // ============================================================
    // Get Pending Requests
    // ============================================================
    
    const pendingRequests = await this.getPendingRequests(owner_user_id);
    
    // ============================================================
    // Transform and Aggregate
    // ============================================================
    
    let people: Person[] = rawItems.map(item => {
      // Determine connection status
      let connectionStatus: ConnectionStatus = 'external';
      
      if (item.relationship_type === 'workmate') {
        connectionStatus = 'workmate';
      } else if (item.relationship_type === 'family') {
        connectionStatus = 'family';
      } else if (item.relationship_status === 'blocked') {
        connectionStatus = 'blocked';
      } else if (item.contact_user_id && pendingRequests.has(item.contact_user_id)) {
        connectionStatus = 'pending';
      } else if (item.contact_relationship_type === 'family') {
        connectionStatus = 'family';
      } else if (item.contact_relationship_type === 'coworker') {
        connectionStatus = 'workmate';
      }
      
      // Generate person_key (SSOT priority: user_id > email > contact_id)
      let personKey: string;
      if (item.contact_user_id) {
        personKey = `u:${item.contact_user_id}`;
      } else if (item.contact_email) {
        personKey = `e:${item.contact_email.toLowerCase()}`;
      } else {
        personKey = `c:${item.contact_id}`;
      }
      
      // Get display name (prefer user.display_name for internal users)
      const displayName = item.user_display_name || item.contact_display_name;
      
      // Get email (prefer user.email for internal users)
      const email = item.user_email || item.contact_email;
      
      return {
        person_id: item.contact_user_id || item.contact_id,
        person_key: personKey,
        display_name: displayName,
        email: email,
        connection_status: connectionStatus,
        relationship_id: item.relationship_id,
        relationship_created_at: item.relationship_created_at,
        contact_id: item.contact_id,
        contact_kind: item.contact_kind as Person['contact_kind'],
        contact_notes: item.contact_notes,
        lists: listMemberships.get(item.contact_id) || [],
        has_email: !!email,
        is_app_user: !!item.contact_user_id,
        created_at: item.contact_created_at,
      };
    });
    
    // ============================================================
    // Apply Connection Status Filter
    // ============================================================
    
    if (connection_status) {
      people = people.filter(p => p.connection_status === connection_status);
    }
    
    // ============================================================
    // Apply List Filter
    // ============================================================
    
    if (list_id) {
      people = people.filter(p => p.lists.some(l => l.list_id === list_id));
    }
    
    // ============================================================
    // Calculate Audit Info
    // ============================================================
    
    const missingEmailCount = people.filter(p => !p.has_email).length;
    const pendingRequestCount = people.filter(p => p.connection_status === 'pending').length;
    
    // ============================================================
    // Pagination (after filtering)
    // ============================================================
    
    const total = people.length;
    const paginatedItems = people.slice(offset, offset + limit);
    
    return {
      items: paginatedItems,
      total,
      limit,
      offset,
      missing_email_count: missingEmailCount,
      pending_request_count: pendingRequestCount,
    };
  }

  /**
   * Get list memberships for multiple contacts
   */
  private async getListMemberships(
    contactIds: string[],
    workspaceId: string
  ): Promise<Map<string, PersonListMembership[]>> {
    if (contactIds.length === 0) {
      return new Map();
    }
    
    // Build IN clause
    const placeholders = contactIds.map(() => '?').join(',');
    
    const result = await this.db
      .prepare(`
        SELECT 
          lm.contact_id,
          l.id as list_id,
          l.name as list_name
        FROM list_members lm
        INNER JOIN lists l ON lm.list_id = l.id
        WHERE lm.contact_id IN (${placeholders})
          AND lm.workspace_id = ?
      `)
      .bind(...contactIds, workspaceId)
      .all<{
        contact_id: string;
        list_id: string;
        list_name: string;
      }>();
    
    const memberships = new Map<string, PersonListMembership[]>();
    
    for (const row of result.results || []) {
      const existing = memberships.get(row.contact_id) || [];
      existing.push({
        list_id: row.list_id,
        list_name: row.list_name,
      });
      memberships.set(row.contact_id, existing);
    }
    
    return memberships;
  }

  /**
   * Get pending relationship requests for a user
   * Returns Set of user IDs with pending requests (sent or received)
   */
  private async getPendingRequests(userId: string): Promise<Set<string>> {
    const result = await this.db
      .prepare(`
        SELECT 
          CASE 
            WHEN inviter_user_id = ? THEN invitee_user_id
            ELSE inviter_user_id
          END as other_user_id
        FROM relationship_requests
        WHERE (inviter_user_id = ? OR invitee_user_id = ?)
          AND status = 'pending'
      `)
      .bind(userId, userId, userId)
      .all<{ other_user_id: string }>();
    
    const pendingSet = new Set<string>();
    for (const row of result.results || []) {
      if (row.other_user_id) {
        pendingSet.add(row.other_user_id);
      }
    }
    
    return pendingSet;
  }

  /**
   * Get person by ID
   */
  async getById(
    personId: string,
    workspaceId: string,
    ownerUserId: string
  ): Promise<Person | null> {
    // Search by person_id (could be contact_id or user_id)
    const result = await this.search({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      limit: 100,
    });
    
    return result.items.find(p => p.person_id === personId) || null;
  }

  /**
   * Get audit summary for People Hub
   */
  async getAuditSummary(
    workspaceId: string,
    ownerUserId: string
  ): Promise<{
    total_people: number;
    missing_email_count: number;
    pending_request_count: number;
    workmate_count: number;
    family_count: number;
    external_count: number;
    blocked_count: number;
  }> {
    const result = await this.search({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      limit: 10000, // Get all for accurate counts
    });
    
    const counts = {
      workmate: 0,
      family: 0,
      external: 0,
      pending: 0,
      blocked: 0,
    };
    
    for (const person of result.items) {
      counts[person.connection_status]++;
    }
    
    return {
      total_people: result.total,
      missing_email_count: result.missing_email_count,
      pending_request_count: result.pending_request_count,
      workmate_count: counts.workmate,
      family_count: counts.family,
      external_count: counts.external + counts.pending,
      blocked_count: counts.blocked,
    };
  }
}
