/**
 * Workspace Context (P0-1: Tenant Isolation Enforcement)
 * 
 * CRITICAL: This enforces tenant isolation at the infrastructure level
 * - workspace_id + owner_user_id MUST be in ALL queries
 * - Context is set by requireAuth middleware (no DB query needed)
 * - Prevents cross-tenant data leakage (P0 security incident)
 * 
 * Phase 1: Single-tenant mode ('ws-default' logical value, NOT in DB)
 * Phase 2: Multi-tenant mode (fetch from workspaces table)
 */

import type { Context } from 'hono'
import type { Env } from '../../../../packages/shared/src/types/env'
import type { Variables } from '../middleware/auth'

export type TenantCtx = {
  workspaceId: string
  ownerUserId: string
}

/**
 * Get tenant context from authenticated request
 * 
 * MUST be called after requireAuth middleware
 * - workspaceId: Set by requireAuth ('ws-default' for Phase 1)
 * - ownerUserId: Set by requireAuth (= userId for Phase 1)
 * 
 * @throws Error if context is not set (indicates middleware misconfiguration)
 */
export function getTenant(c: Context<{ Bindings: Env; Variables: Variables }>): TenantCtx {
  const workspaceId = c.get('workspaceId')
  const ownerUserId = c.get('ownerUserId')
  
  if (!workspaceId || !ownerUserId) {
    throw new Error('tenant_context_missing')
  }

  return { workspaceId, ownerUserId }
}

/**
 * Ensure resource is owned by current tenant (404 if not)
 * 
 * CRITICAL: Call this before any operation on list_id / contact_id / etc.
 * - Prevents cross-tenant access (P0 security incident)
 * - Returns false for missing resources (prevents information leakage)
 * 
 * @param c - Hono context
 * @param args - { table: 'lists' | 'contacts' | 'list_items', id: string }
 * @returns true if resource exists AND belongs to workspace/owner, false otherwise
 */
export async function ensureOwnedOr404(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  args: { table: 'lists' | 'contacts' | 'list_items'; id: string }
): Promise<boolean> {
  const { workspaceId, ownerUserId } = getTenant(c)

  // P0-1: Enforce tenant isolation
  const query = `
    SELECT 1 FROM ${args.table}
    WHERE id = ?
      AND workspace_id = ?
      AND owner_user_id = ?
    LIMIT 1
  `
  
  const result = await c.env.DB.prepare(query)
    .bind(args.id, workspaceId, ownerUserId)
    .first()
  
  return result !== null
}

/**
 * Filter contact IDs that belong to current tenant (batch, O(1) DB roundtrip)
 * 
 * Use this for batch operations (e.g., adding multiple contacts to a list)
 * - Returns Set of valid IDs only
 * - Filters out missing/unauthorized resources
 * - Handles chunk splitting for large batches (500 per query)
 * 
 * @param c - Hono context
 * @param contactIds - Array of contact IDs to validate
 * @returns Set of valid IDs (subset of input)
 */
export async function filterOwnedContactIds(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  contactIds: string[]
): Promise<Set<string>> {
  const { workspaceId, ownerUserId } = getTenant(c)
  
  if (contactIds.length === 0) return new Set()
  
  // P0-1: Chunk splitting to avoid SQLite IN clause limits
  const CHUNK_SIZE = 500
  const validIds = new Set<string>()
  
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    
    const query = `
      SELECT id FROM contacts
      WHERE workspace_id = ?
        AND owner_user_id = ?
        AND id IN (${placeholders})
    `
    
    const result = await c.env.DB.prepare(query)
      .bind(workspaceId, ownerUserId, ...chunk)
      .all<{ id: string }>()
    
    for (const row of result.results ?? []) {
      validIds.add(row.id)
    }
  }
  
  return validIds
}

/**
 * Ensure thread is owned by current user (threads table uses user_id, not owner_user_id)
 * 
 * NOTE: threads table schema uses:
 * - workspace_id: ✅
 * - user_id: organizer (NOT owner_user_id)
 * 
 * @param c - Hono context
 * @param threadId - Thread ID to validate
 * @returns true if thread exists AND belongs to workspace/user, false otherwise
 */
export async function ensureThreadOwnedOr404(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  threadId: string
): Promise<boolean> {
  const { workspaceId } = getTenant(c)
  const userId = c.get('userId')  // threads use user_id as organizer
  
  if (!userId) {
    throw new Error('userId_missing')
  }

  // P0-1: Enforce tenant isolation (threads use user_id, not owner_user_id)
  const query = `
    SELECT 1 FROM threads
    WHERE id = ?
      AND workspace_id = ?
      AND user_id = ?
    LIMIT 1
  `
  
  const result = await c.env.DB.prepare(query)
    .bind(threadId, workspaceId, userId)
    .first()
  
  return result !== null
}
