/**
 * People API
 * 
 * People Hub のSSOT統合APIクライアント
 * - contacts + relationships + list_members を統合したPeople一覧
 * - READ ONLY（登録はチャット経由）
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export type ConnectionStatus = 'workmate' | 'family' | 'external' | 'pending' | 'blocked';

export interface PersonListMembership {
  list_id: string;
  list_name: string;
}

export interface Person {
  // Primary identifier
  person_id: string;
  person_key: string;  // u:<user_id> | e:<email_hash> | c:<contact_id>
  
  // Display
  display_name: string | null;
  email: string | null;
  
  // Connection status
  connection_status: ConnectionStatus;
  relationship_id: string | null;
  relationship_created_at: number | null;
  
  // Contact info
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

export interface PeopleListParams {
  q?: string;
  connection_status?: ConnectionStatus;
  list_id?: string;
  has_email?: boolean;
  limit?: number;
  offset?: number;
}

export interface PeopleListResponse {
  items: Person[];
  total: number;
  limit: number;
  offset: number;
  missing_email_count: number;
  pending_request_count: number;
}

export interface AuditSummary {
  total_people: number;
  missing_email_count: number;
  pending_request_count: number;
  workmate_count: number;
  family_count: number;
  external_count: number;
  blocked_count: number;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get display label for connection status
 */
export function getConnectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'workmate':
      return '仕事仲間';
    case 'family':
      return '家族';
    case 'external':
      return '外部';
    case 'pending':
      return '申請中';
    case 'blocked':
      return 'ブロック';
    default:
      return status;
  }
}

/**
 * Get badge class for connection status
 */
export function getConnectionStatusBadgeClass(status: ConnectionStatus): string {
  switch (status) {
    case 'workmate':
      return 'bg-blue-100 text-blue-800';
    case 'family':
      return 'bg-green-100 text-green-800';
    case 'external':
      return 'bg-gray-100 text-gray-800';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    case 'blocked':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

// ============================================================
// API Client
// ============================================================

export const peopleApi = {
  /**
   * List people with optional filters
   */
  async list(params?: PeopleListParams): Promise<PeopleListResponse> {
    const searchParams = new URLSearchParams();
    
    if (params?.q) searchParams.set('q', params.q);
    if (params?.connection_status) searchParams.set('connection_status', params.connection_status);
    if (params?.list_id) searchParams.set('list_id', params.list_id);
    if (params?.has_email !== undefined) searchParams.set('has_email', params.has_email.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.get(`/api/people${query ? `?${query}` : ''}`);
  },

  /**
   * Get person by ID
   */
  async get(personId: string): Promise<{ person: Person }> {
    return api.get(`/api/people/${personId}`);
  },

  /**
   * Get audit summary (for monitoring dashboard)
   */
  async getAudit(): Promise<AuditSummary> {
    return api.get('/api/people/audit');
  },
};
