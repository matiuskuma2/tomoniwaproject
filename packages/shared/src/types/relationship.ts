/**
 * Relationship Types - Phase D-1
 * 
 * Defines types for user relationships (workmate/family)
 */

// ============================================================
// Relation Type (relationships table)
// ============================================================

/**
 * Relation type between two users
 * - stranger: No relationship (R0) - default for unconnected users
 * - workmate: Work colleague (R1) - can see freebusy, receive notifications
 * - family: Family member (R2) - can see detailed schedule, future: auto-insert
 * - partner: Partner (legacy) - may be deprecated
 */
export const RELATION_TYPE = {
  STRANGER: 'stranger',
  WORKMATE: 'workmate',
  FAMILY: 'family',
  PARTNER: 'partner', // Legacy
} as const;

export type RelationType = typeof RELATION_TYPE[keyof typeof RELATION_TYPE];

/**
 * Validate if a string is a valid RelationType
 */
export function isValidRelationType(type: string): type is RelationType {
  return Object.values(RELATION_TYPE).includes(type as RelationType);
}

// ============================================================
// Permission Preset
// ============================================================

/**
 * Permission preset for relationships
 * - workmate_default: Basic access - see freebusy, receive scheduling notifications
 * - family_view_freebusy: Family level - see detailed freebusy, availability
 * - family_can_write: Family write - can create events on behalf (future)
 */
export const PERMISSION_PRESET = {
  WORKMATE_DEFAULT: 'workmate_default',
  FAMILY_VIEW_FREEBUSY: 'family_view_freebusy',
  FAMILY_CAN_WRITE: 'family_can_write',
} as const;

export type PermissionPreset = typeof PERMISSION_PRESET[keyof typeof PERMISSION_PRESET];

/**
 * Validate if a string is a valid PermissionPreset
 */
export function isValidPermissionPreset(preset: string): preset is PermissionPreset {
  return Object.values(PERMISSION_PRESET).includes(preset as PermissionPreset);
}

/**
 * Permission preset descriptions (for UI)
 */
export const PERMISSION_PRESET_LABELS: Record<PermissionPreset, string> = {
  [PERMISSION_PRESET.WORKMATE_DEFAULT]: '仕事仲間（空き時間を共有）',
  [PERMISSION_PRESET.FAMILY_VIEW_FREEBUSY]: '家族（スケジュール詳細を共有）',
  [PERMISSION_PRESET.FAMILY_CAN_WRITE]: '家族（予定の代理作成も可能）',
};

/**
 * Get default permission preset for a relation type
 */
export function getDefaultPermissionPreset(relationType: RelationType): PermissionPreset | null {
  switch (relationType) {
    case RELATION_TYPE.WORKMATE:
      return PERMISSION_PRESET.WORKMATE_DEFAULT;
    case RELATION_TYPE.FAMILY:
      return PERMISSION_PRESET.FAMILY_VIEW_FREEBUSY;
    default:
      return null;
  }
}

// ============================================================
// Relationship Status
// ============================================================

/**
 * Relationship status
 * - pending: Request sent, waiting for acceptance
 * - active: Relationship established
 * - blocked: Relationship blocked
 */
export const RELATIONSHIP_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  BLOCKED: 'blocked',
} as const;

export type RelationshipStatus = typeof RELATIONSHIP_STATUS[keyof typeof RELATIONSHIP_STATUS];

// ============================================================
// Request Status
// ============================================================

/**
 * Relationship request status
 * - pending: Request sent, waiting for response
 * - accepted: Request accepted, relationship created
 * - declined: Request declined
 * - expired: Request expired
 */
export const REQUEST_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
} as const;

export type RequestStatus = typeof REQUEST_STATUS[keyof typeof REQUEST_STATUS];

// ============================================================
// Interfaces
// ============================================================

/**
 * Relationship record from database
 */
export interface Relationship {
  id: string;
  user_a_id: string;
  user_b_id: string;
  relation_type: RelationType;
  status: RelationshipStatus;
  permissions_json: string;
  permission_preset: PermissionPreset | null;
  created_at: number;
  updated_at: number;
}

/**
 * Relationship request record from database
 */
export interface RelationshipRequest {
  id: string;
  inviter_user_id: string;
  invitee_user_id: string | null;
  invitee_email: string | null;
  requested_type: RelationType;
  status: RequestStatus;
  token: string;
  message: string | null;
  permission_preset: PermissionPreset | null;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
}

/**
 * Create relationship request input
 */
export interface CreateRelationshipRequestInput {
  inviter_user_id: string;
  invitee_user_id?: string;
  invitee_email?: string;
  requested_type: RelationType;
  permission_preset?: PermissionPreset;
  message?: string;
  expires_in_days?: number; // Default: 7
}

/**
 * Relationship with user info (for API responses)
 */
export interface RelationshipWithUser {
  id: string;
  relation_type: RelationType;
  status: RelationshipStatus;
  permission_preset: PermissionPreset | null;
  other_user: {
    id: string;
    display_name: string;
    email: string;
  };
  created_at: number;
}
