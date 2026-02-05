/**
 * Pools API - G2-A Pool Booking
 * 
 * Pool予約システムのAPIクライアント
 * - プール管理（作成/一覧/詳細/更新/削除）
 * - メンバー管理（追加/一覧/削除）
 * - スロット管理（作成/一覧/削除）
 * - 予約（book/cancel）
 * - 公開リンク
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export type PoolSlotStatus = 'open' | 'reserved' | 'booked';
export type BookingStatus = 'confirmed' | 'completed' | 'cancelled';

export interface Pool {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  is_active: number;
  public_link_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoolMember {
  id: string;
  workspace_id: string;
  pool_id: string;
  user_id: string;
  is_active: number;
  created_at: string;
  user?: {
    id: string;
    display_name: string;
    email: string;
  };
}

export interface PoolSlot {
  id: string;
  workspace_id: string;
  pool_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  label: string | null;
  status: PoolSlotStatus;
  created_at: string;
  updated_at: string;
}

export interface PoolBooking {
  id: string;
  workspace_id: string;
  pool_id: string;
  slot_id: string;
  requester_user_id: string;
  assignee_user_id: string;
  status: BookingStatus;
  requester_note: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoolWithSummary extends Pool {
  summary?: {
    members_count: number;
    slots_count: number;
  };
}

// ============================================================
// API Responses
// ============================================================

export interface PoolsListResponse {
  pools: Pool[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface SlotsListResponse {
  slots: PoolSlot[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface BookingResponse {
  booking_id: string;
  pool_id: string;
  slot_id: string;
  assignee_user_id: string;
  status: BookingStatus;
}

export interface PublicLinkResponse {
  pool_id: string;
  pool_name: string;
  public_link_token: string;
  public_url: string;
  is_active: boolean;
}

// ============================================================
// API Client
// ============================================================

export const poolsApi = {
  // -------------------- Pool CRUD --------------------

  /**
   * Create a new pool
   */
  async create(data: {
    name: string;
    description?: string;
  }): Promise<{ pool: Pool }> {
    return api.post('/api/pools', data);
  },

  /**
   * List pools for current user
   */
  async list(params?: {
    limit?: number;
    offset?: number;
  }): Promise<PoolsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.get(`/api/pools${query ? `?${query}` : ''}`);
  },

  /**
   * Get pool details
   */
  async get(poolId: string): Promise<{ pool: Pool; summary: { members_count: number; slots_count: number } }> {
    return api.get(`/api/pools/${poolId}`);
  },

  /**
   * Update pool
   */
  async update(poolId: string, data: {
    name?: string;
    description?: string;
    is_active?: boolean;
  }): Promise<{ pool: Pool }> {
    return api.patch(`/api/pools/${poolId}`, data);
  },

  /**
   * Delete pool
   */
  async delete(poolId: string): Promise<{ message: string; id: string }> {
    return api.delete(`/api/pools/${poolId}`);
  },

  // -------------------- Members --------------------

  /**
   * Add member to pool
   */
  async addMember(poolId: string, userId: string): Promise<{ member: PoolMember }> {
    return api.post(`/api/pools/${poolId}/members`, { user_id: userId });
  },

  /**
   * List pool members
   */
  async listMembers(poolId: string): Promise<{ members: PoolMember[]; count: number }> {
    return api.get(`/api/pools/${poolId}/members`);
  },

  /**
   * Remove member from pool
   */
  async removeMember(poolId: string, memberId: string): Promise<{ message: string; id: string }> {
    return api.delete(`/api/pools/${poolId}/members/${memberId}`);
  },

  // -------------------- Slots --------------------

  /**
   * Create slot(s) for pool
   */
  async createSlots(poolId: string, data: {
    start_at: string;
    end_at: string;
    timezone?: string;
    label?: string;
  } | {
    slots: Array<{
      start_at: string;
      end_at: string;
      timezone?: string;
      label?: string;
    }>;
  }): Promise<{ slots: PoolSlot[]; count: number }> {
    return api.post(`/api/pools/${poolId}/slots`, data);
  },

  /**
   * List slots for pool
   */
  async listSlots(poolId: string, params?: {
    from?: string;
    to?: string;
    status?: PoolSlotStatus;
    limit?: number;
    offset?: number;
  }): Promise<SlotsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.get(`/api/pools/${poolId}/slots${query ? `?${query}` : ''}`);
  },

  /**
   * Delete slot
   */
  async deleteSlot(poolId: string, slotId: string): Promise<{ message: string; id: string }> {
    return api.delete(`/api/pools/${poolId}/slots/${slotId}`);
  },

  // -------------------- Booking --------------------

  /**
   * Book a slot (Reserve → Assign flow)
   * 
   * @param poolId - Pool ID
   * @param slotId - Slot ID to book
   * @param note - Optional note from requester
   * @returns Booking result with assignee info
   */
  async book(poolId: string, slotId: string, note?: string): Promise<BookingResponse> {
    return api.post(`/api/pools/${poolId}/book`, {
      slot_id: slotId,
      note,
    });
  },

  /**
   * Cancel a booking
   */
  async cancelBooking(poolId: string, bookingId: string, reason?: string): Promise<{
    success: boolean;
    booking: {
      id: string;
      pool_id: string;
      slot_id: string;
      status: 'cancelled';
      cancelled_by: string;
      cancellation_reason: string | null;
    };
    message: string;
  }> {
    return api.patch(`/api/pools/${poolId}/bookings/${bookingId}/cancel`, { reason });
  },

  /**
   * List bookings for a pool
   */
  async listBookings(poolId: string): Promise<{ bookings: PoolBooking[]; count: number; pool_id: string }> {
    return api.get(`/api/pools/${poolId}/bookings`);
  },

  // -------------------- Public Link --------------------

  /**
   * Get or generate public booking link
   */
  async getPublicLink(poolId: string): Promise<PublicLinkResponse> {
    return api.get(`/api/pools/${poolId}/public-link`);
  },

  /**
   * Regenerate public booking link (invalidates old link)
   */
  async regeneratePublicLink(poolId: string): Promise<PublicLinkResponse & { message: string }> {
    return api.post(`/api/pools/${poolId}/public-link/regenerate`, {});
  },
};

// ============================================================
// Helpers
// ============================================================

/**
 * Format slot time for display (Japanese)
 */
export function formatSlotTime(startAt: string, endAt: string): string {
  try {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const dateStr = start.toLocaleDateString('ja-JP', { 
      month: 'numeric', 
      day: 'numeric',
      weekday: 'short'
    });
    const startTime = start.toLocaleTimeString('ja-JP', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    const endTime = end.toLocaleTimeString('ja-JP', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    return `${dateStr} ${startTime}〜${endTime}`;
  } catch {
    return `${startAt} - ${endAt}`;
  }
}

/**
 * Get slot status label (Japanese)
 */
export function getSlotStatusLabel(status: PoolSlotStatus): string {
  switch (status) {
    case 'open':
      return '空き';
    case 'reserved':
      return '予約中';
    case 'booked':
      return '確定';
    default:
      return status;
  }
}

/**
 * Get slot status badge class (Tailwind)
 */
export function getSlotStatusBadgeClass(status: PoolSlotStatus): string {
  switch (status) {
    case 'open':
      return 'bg-green-100 text-green-800';
    case 'reserved':
      return 'bg-yellow-100 text-yellow-800';
    case 'booked':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

/**
 * Get booking status label (Japanese)
 */
export function getBookingStatusLabel(status: BookingStatus): string {
  switch (status) {
    case 'confirmed':
      return '確定';
    case 'completed':
      return '完了';
    case 'cancelled':
      return 'キャンセル';
    default:
      return status;
  }
}
