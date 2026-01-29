/**
 * Relationship Access Service - Phase D-1 ACCESS
 * 
 * Central guard for relationship-based permissions.
 * Converts permission_preset to actual permission flags.
 * 
 * Usage:
 *   const access = new RelationshipAccessService(env.DB);
 *   const permissions = await access.getPermissionsWith(requesterId, targetId);
 *   if (!permissions.view_freebusy) throw new HTTPException(403, 'No permission');
 * 
 * Or use the guard directly:
 *   await access.requirePermission(requesterId, targetId, 'view_freebusy');
 */

import type { D1Database } from '@cloudflare/workers-types';
import { 
  PERMISSION_PRESET, 
  RELATIONSHIP_STATUS,
  type PermissionPreset,
  type RelationType 
} from '../../../../packages/shared/src/types/relationship';

// ============================================================
// Types
// ============================================================

/**
 * Resolved permission flags from a relationship
 */
export interface ResolvedPermissions {
  /** Can view target's freebusy (busy/available) */
  view_freebusy: boolean;
  /** Can view target's calendar event details */
  view_calendar_details: boolean;
  /** Can create events on target's calendar */
  write_calendar: boolean;
  /** Source relationship info */
  relationship: {
    id: string;
    relation_type: RelationType;
    permission_preset: PermissionPreset | null;
  } | null;
}

/**
 * No relationship - default permissions (all false)
 */
const NO_PERMISSIONS: ResolvedPermissions = {
  view_freebusy: false,
  view_calendar_details: false,
  write_calendar: false,
  relationship: null,
};

/**
 * Permission type for requirePermission()
 */
export type PermissionType = 'view_freebusy' | 'view_calendar_details' | 'write_calendar';

// ============================================================
// Permission Resolution Logic
// ============================================================

/**
 * Resolve permissions from a permission_preset
 * 
 * @param preset - Permission preset value (or null)
 * @returns Permission flags
 */
export function resolvePermissionFromPreset(preset: PermissionPreset | string | null): {
  view_freebusy: boolean;
  view_calendar_details: boolean;
  write_calendar: boolean;
} {
  switch (preset) {
    case PERMISSION_PRESET.WORKMATE_DEFAULT:
      // Workmate: basic freebusy only
      return {
        view_freebusy: true,
        view_calendar_details: false,
        write_calendar: false,
      };
    
    case PERMISSION_PRESET.FAMILY_VIEW_FREEBUSY:
      // Family view: freebusy + calendar details
      return {
        view_freebusy: true,
        view_calendar_details: true,
        write_calendar: false,
      };
    
    case PERMISSION_PRESET.FAMILY_CAN_WRITE:
      // Family write: all permissions
      return {
        view_freebusy: true,
        view_calendar_details: true,
        write_calendar: true,
      };
    
    default:
      // No preset or unknown: no permissions
      return {
        view_freebusy: false,
        view_calendar_details: false,
        write_calendar: false,
      };
  }
}

// ============================================================
// Service Class
// ============================================================

/**
 * Relationship Access Service
 * 
 * Provides permission checking between users based on their relationship.
 */
export class RelationshipAccessService {
  constructor(private db: D1Database) {}

  /**
   * Get relationship between two users
   * 
   * @param requesterUserId - User requesting access
   * @param targetUserId - Target user
   * @returns Relationship record or null
   */
  async getRelationshipBetween(
    requesterUserId: string,
    targetUserId: string
  ): Promise<{
    id: string;
    relation_type: RelationType;
    permission_preset: PermissionPreset | null;
    status: string;
  } | null> {
    // Self-access is always allowed (no relationship needed)
    if (requesterUserId === targetUserId) {
      return null;
    }

    // Normalize user pair (alphabetical order for consistent lookup)
    const [userA, userB] = [requesterUserId, targetUserId].sort();

    const result = await this.db.prepare(`
      SELECT id, relation_type, permission_preset, status
      FROM relationships
      WHERE user_a_id = ? AND user_b_id = ? AND status = ?
    `).bind(userA, userB, RELATIONSHIP_STATUS.ACTIVE).first<{
      id: string;
      relation_type: RelationType;
      permission_preset: PermissionPreset | null;
      status: string;
    }>();

    return result || null;
  }

  /**
   * Get resolved permissions for a user to access another user's data
   * 
   * @param requesterUserId - User requesting access
   * @param targetUserId - Target user whose data is being accessed
   * @returns Resolved permission flags
   */
  async getPermissionsWith(
    requesterUserId: string,
    targetUserId: string
  ): Promise<ResolvedPermissions> {
    // Self-access: full permissions
    if (requesterUserId === targetUserId) {
      return {
        view_freebusy: true,
        view_calendar_details: true,
        write_calendar: true,
        relationship: null, // Self-access, no relationship needed
      };
    }

    const relationship = await this.getRelationshipBetween(requesterUserId, targetUserId);

    if (!relationship) {
      return NO_PERMISSIONS;
    }

    const permissions = resolvePermissionFromPreset(relationship.permission_preset);

    return {
      ...permissions,
      relationship: {
        id: relationship.id,
        relation_type: relationship.relation_type,
        permission_preset: relationship.permission_preset,
      },
    };
  }

  /**
   * Check if user has a specific permission for another user
   * 
   * @param requesterUserId - User requesting access
   * @param targetUserId - Target user
   * @param required - Required permission type
   * @returns true if allowed
   */
  async hasPermission(
    requesterUserId: string,
    targetUserId: string,
    required: PermissionType
  ): Promise<boolean> {
    const permissions = await this.getPermissionsWith(requesterUserId, targetUserId);
    return permissions[required];
  }

  /**
   * Require a specific permission - throws if not allowed
   * 
   * @param requesterUserId - User requesting access
   * @param targetUserId - Target user
   * @param required - Required permission type
   * @throws Error with 403 status if not allowed
   */
  async requirePermission(
    requesterUserId: string,
    targetUserId: string,
    required: PermissionType
  ): Promise<ResolvedPermissions> {
    const permissions = await this.getPermissionsWith(requesterUserId, targetUserId);

    if (!permissions[required]) {
      const errorMessages: Record<PermissionType, string> = {
        view_freebusy: 'この操作には相手との関係性が必要です（仕事仲間または家族）',
        view_calendar_details: 'この操作には家族としての関係性が必要です',
        write_calendar: 'この操作には「代理予約可能」の権限が必要です',
      };

      const error = new Error(errorMessages[required]) as Error & { status: number };
      error.status = 403;
      throw error;
    }

    return permissions;
  }

  /**
   * Get permission summary for UI display
   * 
   * @param requesterUserId - User requesting access
   * @param targetUserId - Target user
   * @returns Human-readable permission summary
   */
  async getPermissionSummary(
    requesterUserId: string,
    targetUserId: string
  ): Promise<{
    has_relationship: boolean;
    relation_type: RelationType | null;
    permission_preset: PermissionPreset | null;
    permissions: {
      view_freebusy: boolean;
      view_calendar_details: boolean;
      write_calendar: boolean;
    };
    labels: {
      relation_type: string;
      permission_preset: string;
    };
  }> {
    const permissions = await this.getPermissionsWith(requesterUserId, targetUserId);

    const relationLabels: Record<string, string> = {
      stranger: '他人',
      workmate: '仕事仲間',
      family: '家族',
      partner: 'パートナー',
    };

    const presetLabels: Record<string, string> = {
      workmate_default: '仕事仲間（空き時間を共有）',
      family_view_freebusy: '家族（スケジュール詳細を共有）',
      family_can_write: '家族（予定の代理作成も可能）',
    };

    const relationType = permissions.relationship?.relation_type || null;
    const preset = permissions.relationship?.permission_preset || null;

    return {
      has_relationship: permissions.relationship !== null,
      relation_type: relationType,
      permission_preset: preset,
      permissions: {
        view_freebusy: permissions.view_freebusy,
        view_calendar_details: permissions.view_calendar_details,
        write_calendar: permissions.write_calendar,
      },
      labels: {
        relation_type: relationType ? relationLabels[relationType] || relationType : '他人',
        permission_preset: preset ? presetLabels[preset] || preset : 'なし',
      },
    };
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a RelationshipAccessService instance
 */
export function createRelationshipAccessService(db: D1Database): RelationshipAccessService {
  return new RelationshipAccessService(db);
}
