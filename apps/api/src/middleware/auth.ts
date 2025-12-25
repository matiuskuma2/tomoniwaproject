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
};

/**
 * Extract user ID from request
 * 
 * Priority:
 * 1. Bearer token (production)
 * 2. x-user-id header (development only)
 */
export async function getUserId(c: Context<{ Bindings: Env; Variables: Variables }>): Promise<string | null> {
  const env = c.env as Env;
  // Check for development mode (ENVIRONMENT not set or explicitly 'development')
  const isDevelopment = !env.ENVIRONMENT || env.ENVIRONMENT === 'development';

  // Try x-user-id header (development only)
  if (isDevelopment) {
    const userId = c.req.header('x-user-id');
    if (userId) {
      return userId;
    }
  }

  // Try Bearer token (session-based authentication)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const sessionToken = authHeader.substring(7);
    
    if (sessionToken && sessionToken.length > 0) {
      try {
        // Import dynamically to avoid circular dependency
        const { SessionRepository } = await import('../repositories/sessionRepository');
        
        // Hash token for lookup
        const encoder = new TextEncoder();
        const data = encoder.encode(sessionToken);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Verify session
        const sessionRepo = new SessionRepository(env.DB);
        const session = await sessionRepo.findByTokenHash(tokenHash);
        
        if (session) {
          // Update last_seen_at
          await sessionRepo.updateLastSeen(session.id);
          return session.user_id;
        }
      } catch (error) {
        console.error('Session verification error:', error);
      }
    }
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
  const userId = await getUserId(c);

  if (!userId) {
    return c.json(
      { 
        error: 'Unauthorized',
        message: 'Authentication required. Provide Bearer token or x-user-id header (dev only).'
      },
      401
    );
  }

  // Store userId in context for downstream handlers
  c.set('userId', userId);
  
  await next();
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
