/**
 * Admin Authentication Middleware
 * Verifies admin user and checks role permissions
 */

import { Context, Next } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { AdminUser, AdminRole } from '../../../../packages/shared/src/types/admin';

// Extend Hono context with admin
declare module 'hono' {
  interface ContextVariableMap {
    admin: AdminUser;
  }
}

/**
 * Admin Auth Middleware
 * Validates admin user from Authorization header
 * For MVP: Simple Bearer token with admin_id (replace with JWT in production)
 */
export async function adminAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  
  // TODO: Replace with JWT verification in production
  // For MVP: token is admin_id directly
  const adminId = token;
  
  // Fetch admin from database
  const admin = await c.env.DB
    .prepare(
      `SELECT id, email, display_name, role, is_active, created_at, updated_at
       FROM admin_users
       WHERE id = ? AND is_active = 1`
    )
    .bind(adminId)
    .first<AdminUser>();

  if (!admin) {
    return c.json({ error: 'Unauthorized: Invalid admin token or admin is inactive' }, 401);
  }

  // Store admin in context
  c.set('admin', {
    ...admin,
    is_active: Boolean(admin.is_active),
  });

  await next();
}

/**
 * Role Guard Middleware Factory
 * Requires specific admin role(s)
 * 
 * Usage:
 *   app.get('/admin/system/settings', adminAuth, requireRole('super_admin'), handler)
 */
export function requireRole(...allowedRoles: AdminRole[]) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const admin = c.get('admin');
    
    if (!admin) {
      return c.json({ error: 'Forbidden: Admin context not found' }, 403);
    }

    if (!allowedRoles.includes(admin.role)) {
      return c.json(
        { 
          error: `Forbidden: Requires role ${allowedRoles.join(' or ')}`,
          current_role: admin.role 
        },
        403
      );
    }

    await next();
  };
}

/**
 * Workspace Access Guard Middleware
 * Ensures admin has access to specified workspace
 * super_admin bypasses this check
 * 
 * Usage:
 *   app.get('/admin/workspaces/:id/*', adminAuth, workspaceGuard, handler)
 */
export async function workspaceGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const admin = c.get('admin');
  
  if (!admin) {
    return c.json({ error: 'Forbidden: Admin context not found' }, 403);
  }

  // super_admin bypasses workspace restriction
  if (admin.role === 'super_admin') {
    await next();
    return;
  }

  // Get workspace_id from params or query
  const workspaceId = c.req.param('workspaceId') || c.req.query('workspace_id');
  
  if (!workspaceId) {
    // If no workspace specified, let handler decide
    await next();
    return;
  }

  // Check admin_workspace_access
  const access = await c.env.DB
    .prepare(
      `SELECT 1 FROM admin_workspace_access
       WHERE admin_id = ? AND workspace_id = ?`
    )
    .bind(admin.id, workspaceId)
    .first();

  if (!access) {
    return c.json(
      { 
        error: 'Forbidden: Admin does not have access to this workspace',
        workspace_id: workspaceId 
      },
      403
    );
  }

  await next();
}
