/**
 * Workspace Context (P0-1: Tenant Isolation Enforcement)
 * 
 * CRITICAL: This enforces tenant isolation at the infrastructure level
 * - workspace_id + owner_user_id MUST be in ALL queries
 * - Context is set by requireAuth middleware (no DB query needed)
 * - Prevents cross-tenant data leakage (P0 security incident)
 * 
 * Phase 1: Single-tenant mode ('ws-default' for all users)
 * Phase 2: Multi-tenant mode (fetch from workspaces table)
 */

import type { Context } from 'hono'
import type { Env } from '../../../../packages/shared/src/types/env'
import type { Variables } from '../middleware/auth'

export interface WorkspaceContext {
  workspaceId: string
  ownerUserId: string
}

/**
 * Get workspace context from authenticated request
 * 
 * MUST be called after requireAuth middleware
 * - workspaceId: Set by requireAuth
 * - ownerUserId: Set by requireAuth (= userId for Phase 1)
 * 
 * @throws Error if context is not set (indicates middleware misconfiguration)
 */
export function getWorkspaceContext(c: Context<{ Bindings: Env; Variables: Variables }>): WorkspaceContext {
  const workspaceId = c.get('workspaceId')
  const ownerUserId = c.get('ownerUserId')
  
  if (!workspaceId || !ownerUserId) {
    throw new Error('[P0-1] Tenant context not set. Ensure requireAuth middleware is applied.')
  }

  return { workspaceId, ownerUserId }
}

/**
 * Validate that a resource belongs to the current workspace/owner
 * 
 * CRITICAL: Call this before any operation on list_id / contact_id / etc.
 * - Prevents cross-tenant access (P0 security incident)
 * - Returns false for missing resources (prevents information leakage)
 * 
 * @param db - D1 database instance
 * @param ctx - Workspace context (from getWorkspaceContext)
 * @param resourceType - Type of resource ('lists' or 'contacts')
 * @param resourceId - ID of the resource to validate
 * @returns true if resource exists AND belongs to workspace/owner, false otherwise
 */
export async function validateResourceOwnership(
  db: D1Database,
  ctx: WorkspaceContext,
  resourceType: 'lists' | 'contacts',
  resourceId: string
): Promise<boolean> {
  // P0-1: Enforce tenant isolation
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

/**
 * Validate multiple resources in batch (more efficient than N queries)
 * 
 * Use this for batch operations (e.g., adding multiple contacts to a list)
 * - Returns array of valid IDs only
 * - Filters out missing/unauthorized resources
 * 
 * @param db - D1 database instance
 * @param ctx - Workspace context
 * @param resourceType - Type of resource
 * @param resourceIds - Array of IDs to validate
 * @returns Array of valid IDs (subset of input)
 */
export async function validateResourceOwnershipBatch(
  db: D1Database,
  ctx: WorkspaceContext,
  resourceType: 'lists' | 'contacts',
  resourceIds: string[]
): Promise<string[]> {
  if (resourceIds.length === 0) return []
  
  // P0-1: Enforce tenant isolation with IN clause
  const placeholders = resourceIds.map(() => '?').join(',')
  const query = `
    SELECT id FROM ${resourceType}
    WHERE workspace_id = ?
      AND owner_user_id = ?
      AND id IN (${placeholders})
  `
  
  const result = await db.prepare(query)
    .bind(ctx.workspaceId, ctx.ownerUserId, ...resourceIds)
    .all<{ id: string }>()
  
  return (result.results ?? []).map(r => r.id)
}
