/**
 * Admin Debug Routes
 * Debugging endpoints for production troubleshooting
 * admin/super_admin only
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { SessionRepository } from '../repositories/sessionRepository';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /admin/debug/session
 * Debug current session authentication
 * Returns detailed information about the session lookup process
 */
app.get('/session', async (c) => {
  const env = c.env;
  const debugInfo: any = {
    timestamp: new Date().toISOString(),
    environment: env.ENVIRONMENT || 'unknown',
    db_binding_exists: !!env.DB,
  };

  try {
    // Extract token from Authorization header
    const authHeader = c.req.header('Authorization');
    debugInfo.has_auth_header = !!authHeader;
    debugInfo.auth_header_format = authHeader?.startsWith('Bearer ') ? 'Bearer' : 'other';

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      debugInfo.error = 'No valid Authorization header';
      return c.json(debugInfo, 401);
    }

    const sessionToken = authHeader.substring(7).trim();
    debugInfo.token_length = sessionToken.length;
    debugInfo.token_preview = sessionToken.substring(0, 20) + '...';

    // Hash token
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    debugInfo.token_hash = tokenHash;
    debugInfo.token_hash_preview = tokenHash.substring(0, 20) + '...';

    // Query session directly
    debugInfo.query_method = 'SessionRepository.findByTokenHash';
    
    const sessionRepo = new SessionRepository(env.DB);
    const session = await sessionRepo.findByTokenHash(tokenHash);
    
    debugInfo.session_found = !!session;

    if (session) {
      debugInfo.session = {
        id: session.id,
        user_id: session.user_id,
        expires_at: session.expires_at,
        created_at: session.created_at,
        last_seen_at: session.last_seen_at,
      };

      // Check expiry manually
      const expiresAt = new Date(session.expires_at);
      const now = new Date();
      debugInfo.expiry_check = {
        expires_at: session.expires_at,
        now: now.toISOString(),
        is_expired: expiresAt <= now,
        time_until_expiry_seconds: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      };
    } else {
      // Try raw SQL query to see if session exists at all
      debugInfo.raw_sql_check = 'SELECT * FROM sessions WHERE token_hash = ?';
      
      const rawResult = await env.DB.prepare(
        'SELECT id, user_id, token_hash, expires_at FROM sessions WHERE token_hash = ?'
      ).bind(tokenHash).first();
      
      debugInfo.raw_sql_found = !!rawResult;
      
      if (rawResult) {
        debugInfo.raw_sql_result = rawResult;
        
        // Also check with datetime comparison
        const withDatetimeResult = await env.DB.prepare(
          'SELECT id, user_id, token_hash, expires_at, datetime(expires_at) > datetime(\'now\') as is_valid FROM sessions WHERE token_hash = ?'
        ).bind(tokenHash).first();
        
        debugInfo.with_datetime_check = withDatetimeResult;
      } else {
        debugInfo.note = 'Token not found in sessions table';
      }
    }

    return c.json(debugInfo);
  } catch (error) {
    debugInfo.error = error instanceof Error ? error.message : String(error);
    debugInfo.error_stack = error instanceof Error ? error.stack : undefined;
    return c.json(debugInfo, 500);
  }
});

/**
 * GET /admin/debug/db
 * Check database connectivity and basic queries
 */
app.get('/db', async (c) => {
  const env = c.env;
  const debugInfo: any = {
    timestamp: new Date().toISOString(),
    db_binding_exists: !!env.DB,
  };

  try {
    // Test basic query
    const result = await env.DB.prepare('SELECT 1 as test').first();
    debugInfo.basic_query_works = result?.test === 1;

    // Count sessions
    const sessionCount = await env.DB.prepare('SELECT COUNT(*) as count FROM sessions').first();
    debugInfo.sessions_count = sessionCount?.count || 0;

    // Check for sessions table
    const tableCheck = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).first();
    debugInfo.sessions_table_exists = !!tableCheck;

    return c.json(debugInfo);
  } catch (error) {
    debugInfo.error = error instanceof Error ? error.message : String(error);
    debugInfo.error_stack = error instanceof Error ? error.stack : undefined;
    return c.json(debugInfo, 500);
  }
});

/**
 * GET /admin/debug/auth-bypass
 * Emergency debug endpoint WITHOUT authentication
 * ONLY for production troubleshooting
 * Query params: token=<session_token>
 */
app.get('/auth-bypass', async (c) => {
  const env = c.env;
  const debugInfo: any = {
    timestamp: new Date().toISOString(),
    environment: env.ENVIRONMENT || 'unknown',
    db_binding_exists: !!env.DB,
    warning: 'This endpoint bypasses authentication for debugging only',
  };

  try {
    // Get token from query param
    const sessionToken = c.req.query('token');
    
    if (!sessionToken) {
      debugInfo.error = 'Missing token query parameter. Usage: /admin/debug/auth-bypass?token=<your_token>';
      return c.json(debugInfo, 400);
    }

    debugInfo.token_length = sessionToken.length;
    debugInfo.token_preview = sessionToken.substring(0, 20) + '...';

    // Hash token
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionToken);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    debugInfo.token_hash = tokenHash;
    debugInfo.token_hash_preview = tokenHash.substring(0, 20) + '...';

    // Try SessionRepository first
    const sessionRepo = new SessionRepository(env.DB);
    const session = await sessionRepo.findByTokenHash(tokenHash);
    
    debugInfo.session_found_via_repo = !!session;

    if (session) {
      debugInfo.session = {
        id: session.id,
        user_id: session.user_id,
        expires_at: session.expires_at,
        created_at: session.created_at,
        last_seen_at: session.last_seen_at,
      };
    }

    // Try raw SQL query
    debugInfo.raw_sql_query = 'SELECT * FROM sessions WHERE token_hash = ?';
    
    const rawResult = await env.DB.prepare(
      'SELECT id, user_id, token_hash, expires_at, created_at, last_seen_at FROM sessions WHERE token_hash = ?'
    ).bind(tokenHash).first();
    
    debugInfo.raw_sql_found = !!rawResult;
    
    if (rawResult) {
      debugInfo.raw_sql_result = rawResult;
    }

    // Check with datetime comparison
    const withDatetimeResult = await env.DB.prepare(
      'SELECT id, user_id, expires_at, datetime(expires_at) as expires_datetime, datetime(\'now\') as now_datetime, datetime(expires_at) > datetime(\'now\') as is_valid FROM sessions WHERE token_hash = ?'
    ).bind(tokenHash).first();
    
    debugInfo.with_datetime_check = withDatetimeResult;

    // Count all sessions
    const sessionCount = await env.DB.prepare('SELECT COUNT(*) as count FROM sessions').first();
    debugInfo.total_sessions_count = sessionCount?.count || 0;

    return c.json(debugInfo);
  } catch (error) {
    debugInfo.error = error instanceof Error ? error.message : String(error);
    debugInfo.error_stack = error instanceof Error ? error.stack : undefined;
    return c.json(debugInfo, 500);
  }
});

export default app;
