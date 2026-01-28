/**
 * Relationships API - Phase D-1
 * 
 * Manage user relationships (workmate / family)
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export type RelationType = 'stranger' | 'workmate' | 'family' | 'partner';
export type PermissionPreset = 'workmate_default' | 'family_view_freebusy' | 'family_can_write';
export type RelationshipStatus = 'pending' | 'active' | 'blocked';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface Relationship {
  id: string;
  relation_type: RelationType;
  status: RelationshipStatus;
  permission_preset: PermissionPreset | null;
  created_at: number;
  other_user: {
    id: string;
    display_name: string;
    email: string;
  };
}

export interface RelationshipRequest {
  id: string;
  token: string;
  requested_type: RelationType;
  permission_preset: PermissionPreset | null;
  message: string | null;
  expires_at: string;
  created_at: string;
  inviter?: {
    id: string;
    display_name: string;
    email: string;
  };
  invitee?: {
    id: string;
    display_name: string;
    email: string;
  };
}

export interface RelationshipsListResponse {
  items: Relationship[];
  pagination: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
}

export interface PendingRequestsResponse {
  received: RelationshipRequest[];
  sent: RelationshipRequest[];
}

export interface RelationshipWithUserResponse {
  has_relationship: boolean;
  relation_type?: RelationType;
  relationship?: {
    id: string;
    relation_type: RelationType;
    status: RelationshipStatus;
    permission_preset: PermissionPreset | null;
    created_at: number;
  };
}

// ============================================================
// API Client
// ============================================================

export const relationshipsApi = {
  /**
   * List user's active relationships (cursor pagination)
   */
  async list(params?: {
    type?: RelationType;
    limit?: number;
    cursor?: string;
  }): Promise<RelationshipsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.cursor) searchParams.set('cursor', params.cursor);

    const query = searchParams.toString();
    return api.get(`/api/relationships${query ? `?${query}` : ''}`);
  },

  /**
   * List all relationships (auto-pagination for cache building)
   * Fetches all relationships by following cursors
   */
  async listAll(params?: { type?: RelationType }): Promise<Relationship[]> {
    const allItems: Relationship[] = [];
    let cursor: string | undefined;
    
    do {
      const response = await this.list({
        type: params?.type,
        limit: 100,
        cursor,
      });
      
      allItems.push(...response.items);
      cursor = response.pagination.next_cursor || undefined;
    } while (cursor);
    
    return allItems;
  },

  /**
   * Get pending requests (sent and received)
   */
  async pending(): Promise<PendingRequestsResponse> {
    return api.get('/api/relationships/pending');
  },

  /**
   * Get relationship with a specific user
   */
  async withUser(userId: string): Promise<RelationshipWithUserResponse> {
    return api.get(`/api/relationships/with/${userId}`);
  },

  /**
   * Create a relationship request
   */
  async request(data: {
    invitee_identifier: string;  // email or user_id
    requested_type: RelationType;
    permission_preset?: PermissionPreset;
    message?: string;
  }): Promise<{
    success: boolean;
    request_id: string;
    token: string;
    invitee: {
      id: string;
      display_name: string;
      email: string;
    };
    requested_type: RelationType;
    permission_preset: PermissionPreset | null;
    expires_at: string;
    message: string;
  }> {
    return api.post('/api/relationships/request', data);
  },

  /**
   * Accept a relationship request
   */
  async accept(token: string): Promise<{
    success: boolean;
    message: string;
    relationship_id: string;
    relation_type: RelationType;
    permission_preset: PermissionPreset | null;
  }> {
    return api.post(`/api/relationships/${token}/accept`, {});
  },

  /**
   * Decline a relationship request
   */
  async decline(token: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return api.post(`/api/relationships/${token}/decline`, {});
  },

  /**
   * Remove a relationship
   */
  async remove(relationshipId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return api.delete(`/api/relationships/${relationshipId}`);
  },

  /**
   * Search for users by email or display name
   */
  async search(query: string): Promise<UserSearchResponse> {
    const searchParams = new URLSearchParams({ q: query });
    return api.get(`/api/relationships/search?${searchParams.toString()}`);
  },
};

// ============================================================
// Search Types
// ============================================================

export interface UserSearchResult {
  id: string;
  email: string;
  display_name: string;
  relationship: {
    id: string;
    relation_type: RelationType;
    permission_preset: PermissionPreset | null;
  } | null;
  pending_request: {
    id: string;
    requested_type: string;
  } | null;
  can_request: boolean;
}

export interface UserSearchResponse {
  query: string;
  results: UserSearchResult[];
  count: number;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get display label for relation type
 */
export function getRelationTypeLabel(type: RelationType): string {
  switch (type) {
    case 'workmate':
      return '仕事仲間';
    case 'family':
      return '家族';
    case 'partner':
      return 'パートナー';
    case 'stranger':
    default:
      return '他人';
  }
}

/**
 * Get badge color class for relation type (Tailwind)
 */
export function getRelationTypeBadgeClass(type: RelationType): string {
  switch (type) {
    case 'workmate':
      return 'bg-blue-100 text-blue-800';
    case 'family':
      return 'bg-green-100 text-green-800';
    case 'partner':
      return 'bg-purple-100 text-purple-800';
    case 'stranger':
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

/**
 * Get permission preset label
 */
export function getPermissionPresetLabel(preset: PermissionPreset | null): string {
  switch (preset) {
    case 'workmate_default':
      return '空き時間を共有';
    case 'family_view_freebusy':
      return 'スケジュール詳細を共有';
    case 'family_can_write':
      return '予定の代理作成も可能';
    default:
      return '';
  }
}
