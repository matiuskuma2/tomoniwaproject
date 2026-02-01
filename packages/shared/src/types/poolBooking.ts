/**
 * G2-A Pool Booking Types
 * N対1 / 誰か1人に割当
 */

// ============================================================
// Enum Types
// ============================================================

export type PoolAssignmentPolicy = 'round_robin';

export type PoolSlotStatus = 'open' | 'reserved' | 'booked' | 'cancelled';
export type PoolReservationStatus = 'active' | 'released' | 'consumed' | 'expired';
export type PoolBookingStatus = 'confirmed' | 'cancelled';

// ============================================================
// Entity Types
// ============================================================

/**
 * Pool: 受付プール（担当者グループ）
 */
export interface Pool {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  is_active: 0 | 1;
  assignment_policy: PoolAssignmentPolicy;
  slot_capacity: number;
  /**
   * Round-robin state (MVP)
   * - null: no assignment yet (first assignment will pick first member)
   * - otherwise: last assigned pool_member.id
   */
  last_assigned_member_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * PoolMember: プールのメンバー（担当者）
 */
export interface PoolMember {
  id: string;
  workspace_id: string;
  pool_id: string;
  user_id: string;
  is_active: 0 | 1;
  join_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * PoolSlot: プール公開枠（時間スロット）
 */
export interface PoolSlot {
  id: string;
  workspace_id: string;
  pool_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  label: string | null;
  status: PoolSlotStatus;
  reserved_count: number;
  booked_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * PoolSlotReservation: 予約（競合防止用の一時確保）
 * Reserve → Assign の2段階
 */
export interface PoolSlotReservation {
  id: string;
  workspace_id: string;
  pool_id: string;
  slot_id: string;
  requester_key: string;
  status: PoolReservationStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * PoolBooking: 成立した予約（割当結果）
 */
export interface PoolBooking {
  id: string;
  workspace_id: string;
  pool_id: string;
  slot_id: string;
  assignee_user_id: string;
  assignment_algo: PoolAssignmentPolicy;
  requester_user_id: string;
  requester_note: string | null;
  status: PoolBookingStatus;
  created_at: string;
  updated_at: string;
}

// ============================================================
// API Request/Response Types
// ============================================================

/**
 * プール作成リクエスト
 */
export interface CreatePoolRequest {
  name: string;
  description?: string;
  assignment_policy?: PoolAssignmentPolicy;
  slot_capacity?: number;
}

/**
 * メンバー追加リクエスト
 */
export interface AddPoolMemberRequest {
  user_id: string;
}

/**
 * 枠生成リクエスト
 */
export interface GenerateSlotsRequest {
  start_date: string;  // YYYY-MM-DD
  end_date: string;    // YYYY-MM-DD
  timezone?: string;
  business_hours?: {
    [day: string]: { start: string; end: string }[];
  };
  slot_duration_minutes?: number;
}

/**
 * 申込リクエスト
 */
export interface BookSlotRequest {
  slot_id: string;
  note?: string;
}

/**
 * 申込結果
 */
export interface BookSlotResponse {
  booking_id: string;
  pool_id: string;
  slot_id: string;
  assignee_user_id: string;
  status: PoolBookingStatus;
}
