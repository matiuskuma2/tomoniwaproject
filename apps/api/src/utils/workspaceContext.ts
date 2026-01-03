/**
 * Phase Next-8: Workspace Context Provider
 * Purpose: Enforce tenant isolation (workspace_id + owner_user_id) on ALL queries
 * Risk: Without this, cross-tenant data leakage occurs (P0 incident)
 */

import type { Context } from 'hono'
import type { Env, Variables } from '../../../packages/shared/src/types/env'

export interface WorkspaceContext {
  workspaceId: string
  ownerUserId: string
}

/**
 * Get workspace context from authenticated user
 * CRITICAL: This MUST be called after requireAuth middleware
 * 
 * @param c - Hono context with Variables.userId set
 * @returns WorkspaceContext with workspace_id and owner_user_id
 * @throws Error if userId is not set (auth failure)
 */
export function getWorkspaceContext(c: Context<{ Bindings: Env; Variables: Variables }>): WorkspaceContext {
  const userId = c.get('userId')
  
  if (!userId) {
    throw new Error('getWorkspaceContext called without authenticated userId')
  }

  // Phase 1: Single-workspace mode (all users in 'ws-default')
  // Phase 2: Multi-workspace support will fetch from workspace_members table
  return {
    workspaceId: 'ws-default',
    ownerUserId: userId
  }
}

/**
 * Validate that a resource belongs to the current workspace
 * Use this for list_id, contact_id, etc. before operations
 * 
 * @param db - D1 database instance
 * @param ctx - Workspace context
 * @param resourceType - Type of resource (e.g., 'lists', 'contacts')
 * @param resourceId - ID of the resource
 * @returns true if resource belongs to workspace, false otherwise
 */
export async function validateResourceOwnership(
  db: D1Database,
  ctx: WorkspaceContext,
  resourceType: 'lists' | 'contacts',
  resourceId: string
): Promise<boolean> {
  const query = `
    SELECT 1 FROM ${resourceType}
    WHERE id = ?
      AND workspace_id = ?
      AND owner_user_id = ?
    LIMIT 1
  `
  
  const result = await db.prepare(query)
    .bind(resourceId, ctx.workspaceId, ctx.ownerUserId)
    .first()
  
  return result !== null
}
