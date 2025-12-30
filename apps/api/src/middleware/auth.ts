/**
 * Authentication Middleware
 * 
 * Production: Bearer token required
 * Development: x-user-id header allowed (for testing)
 */

import { Context, Next } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';

export interface AuthContext {
  userId: string;
  isDevMode?: boolean;
}

type Variables = {
  userId?: string;
  userRole?: string;
};

/**
 * Helper: Extract cookie value from Cookie header
 */
function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) {
      return decodeURIComponent(p.slice(name.length + 1));
    }
  }
  return null;
}

/**
 * Extract user ID from request
 * 
 * Priority:
 * 1. Authorization: Bearer <token>
 * 2. Cookie: session=<token>
 * 3. x-user-id header (development only)
 */
export async function getUserId(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<string | null> {
  const env = c.env as Env;
  // Check for development mode (ENVIRONMENT not set or explicitly 'development')
  const isDevelopment = !env.ENVIRONMENT || env.ENVIRONMENT === 'development';

  // Try x-user-id header (development only) - highest priority for dev
  if (isDevelopment) {
    const userId = c.req.header('x-user-id');
    if (userId) {
      return userId;
    }
  }

  // Try to get session token from:
  // 1) Authorization: Bearer <token>
  // 2) Cookie: session=<token>
  let sessionToken: string | null = null;

  // 1) Bearer token
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    sessionToken = authHeader.substring(7).trim();
  }

  // 2) Cookie fallback
  if (!sessionToken) {
    const cookieHeader = c.req.header('Cookie');
    sessionToken = getCookieValue(cookieHeader, 'session');
  }

  // Verify session token if present
  if (sessionToken && sessionToken.length > 0) {
    try {
      console.log('[Auth] Verifying session token, length:', sessionToken.length);
      
      // Import dynamically to avoid circular dependency
      const { SessionRepository } = await import('../repositories/sessionRepository');
      
      // Hash token for lookup
      const encoder = new TextEncoder();
      const data = encoder.encode(sessionToken);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      console.log('[Auth] Token hash:', tokenHash.substring(0, 16) + '...');
      
      // Verify session
      const sessionRepo = new SessionRepository(env.DB);
      const session = await sessionRepo.findByTokenHash(tokenHash);
      
      console.log('[Auth] Session found:', !!session);
      
      if (session) {
        // Update last_seen_at
        await sessionRepo.updateLastSeen(session.id);
        console.log('[Auth] Session valid, userId:', session.user_id);
        return session.user_id;
      } else {
        console.warn('[Auth] Session not found in DB for token hash:', tokenHash.substring(0, 16) + '...');
      }
    } catch (error) {
      console.error('Session verification error:', error);
    }
  } else {
    console.warn('[Auth] No session token provided');
  }

  return null;
}

/**
 * Require authentication middleware
 * 
 * Usage:
 * app.use('/api/protected/*', requireAuth)
 */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  let errorDetails: any = null;
  
  try {
    const userId = await getUserId(c);

    if (!userId) {
      // DEBUG: Add more details to error response
      const authHeader = c.req.header('Authorization');
      const hasBearerToken = authHeader?.startsWith('Bearer ') || false;
      const tokenLength = hasBearerToken && authHeader ? authHeader.substring(7).trim().length : 0;
      
      return c.json(
        { 
          error: 'Unauthorized',
          message: 'Authentication required. Provide Bearer token, session cookie, or x-user-id header (dev only).',
          debug: {
            has_bearer_token: hasBearerToken,
            token_length: tokenLength,
            environment: c.env.ENVIRONMENT || 'unknown',
            error_details: errorDetails
          }
        },
        401
      );
    }

    // Store userId in context for downstream handlers
    c.set('userId', userId);
    
    await next();
  } catch (error) {
    console.error('[Auth] requireAuth middleware error:', error);
    errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
    
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Authentication middleware error',
        debug: {
          error_details: errorDetails,
          environment: c.env.ENVIRONMENT || 'unknown'
        }
      },
      401
    );
  }
}

/**
 * Optional auth middleware (doesn't fail if no auth)
 */
export async function optionalAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const userId = await getUserId(c);
  
  if (userId) {
    c.set('userId', userId);
  }
  
  await next();
}

/**
 * Require admin role middleware
 * Must be used AFTER requireAuth
 * 
 * Usage:
 * app.use('/admin/*', requireAuth, requireAdmin)
 */
export async function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json(
      { 
        error: 'Unauthorized',
        message: 'Authentication required'
      },
      401
    );
  }

  // Get user role from database
  try {
    const result = await env.DB.prepare(`
      SELECT role FROM users WHERE id = ?
    `).bind(userId).first<{ role: string }>();

    if (!result || (result.role !== 'admin' && result.role !== 'super_admin')) {
      return c.json(
        { 
          error: 'Forbidden',
          message: 'Admin access required'
        },
        403
      );
    }

    // Store role in context for downstream handlers
    c.set('userRole', result.role);
    
    await next();
  } catch (error) {
    console.error('Role check error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Get user ID from context (after requireAuth middleware)
 */
export function getUserIdFromContext(c: Context): string {
  const userId = c.get('userId');
  
  if (!userId) {
    throw new Error('User ID not found in context. Did you forget requireAuth middleware?');
  }
  
  return userId;
}

/**
 * Get user ID with fallback to x-user-id (for backward compatibility)
 * 
 * DEPRECATED: Use getUserId() instead
 * This is a temporary helper for migration period
 */
export async function getUserIdLegacy(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<string> {
  const userId = await getUserId(c);
  
  if (userId) {
    return userId;
  }
  
  // Fallback for tests (dev only)
  const env = c.env as Env;
  const isDevelopment = !env.ENVIRONMENT || env.ENVIRONMENT === 'development';
  
  if (isDevelopment) {
    return 'test-user-id';
  }
  
  throw new Error('Authentication required');
}
