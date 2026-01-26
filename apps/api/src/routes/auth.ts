/**
 * Authentication Routes
 * Handles Google OAuth and session management
 */

import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { SessionRepository } from '../repositories/sessionRepository';
import { createLogger } from '../utils/logger';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_ALLOWED_DOMAINS?: string;
  ENVIRONMENT?: string;
  LOG_LEVEL?: string;
};

const auth = new Hono<{ Bindings: Bindings }>();

// ============================================================
// Helper: Generate session token
// ============================================================
async function generateSessionToken(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// Helper: Hash session token (SHA-256)
// ============================================================
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// GET /auth/google/start
// Redirect to Google OAuth consent screen
// ============================================================
auth.get('/google/start', async (c) => {
  const { env } = c;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
    return c.json({ error: 'Google OAuth not configured' }, 500);
  }

  const state = await generateSessionToken();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  
  // Phase 0B: Add Calendar Events scope for Google Meet generation
  const scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.events', // Required for Meet
  ];
  
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline'); // Required for refresh token
  authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

  // Store state in cookie for CSRF protection
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  return c.redirect(authUrl.toString());
});

// ============================================================
// GET /auth/google/callback
// Handle Google OAuth callback
// ============================================================
auth.get('/google/callback', async (c) => {
  const { env } = c;
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Check for OAuth errors
  if (error) {
    return c.json({ error: `OAuth error: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: 'Missing code or state parameter' }, 400);
  }

  // CSRF protection: Verify state (TODO: implement cookie verification)
  // const storedState = getCookie(c, 'oauth_state');
  // if (state !== storedState) {
  //   return c.json({ error: 'Invalid state parameter (CSRF)' }, 400);
  // }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return c.json({ error: 'Failed to exchange code for token', details: errorData }, 400);
    }

    const tokens = await tokenResponse.json<{
      access_token: string;
      refresh_token?: string;
      id_token: string;
      expires_in: number;
      scope: string;
    }>();

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      return c.json({ error: 'Failed to fetch user info' }, 400);
    }

    const userInfo = await userInfoResponse.json<{
      id: string;
      email: string;
      verified_email: boolean;
      name: string;
      picture?: string;
    }>();

    // Validate email domain (if GOOGLE_ALLOWED_DOMAINS is set)
    if (env.GOOGLE_ALLOWED_DOMAINS) {
      const allowedDomains = env.GOOGLE_ALLOWED_DOMAINS.split(',').map(d => d.trim());
      const emailDomain = userInfo.email.split('@')[1];
      if (!allowedDomains.includes(emailDomain)) {
        return c.json({ error: 'Email domain not allowed' }, 403);
      }
    }

    // Ensure email is verified
    if (!userInfo.verified_email) {
      return c.json({ error: 'Email not verified' }, 403);
    }

    // Create or update user
    const existingUser = await env.DB
      .prepare(`SELECT id FROM users WHERE email = ?`)
      .bind(userInfo.email)
      .first<{ id: string }>();

    let userId: string;

    if (existingUser) {
      // Update existing user
      userId = existingUser.id;
      await env.DB
        .prepare(
          `UPDATE users 
           SET display_name = ?, avatar_url = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(userInfo.name, userInfo.picture || null, userId)
        .run();
    } else {
      // Create new user
      // P3-TZ1: 新規ユーザーはデフォルト Asia/Tokyo（将来はブラウザTZを受け取る）
      userId = `user-${Date.now()}`;
      await env.DB
        .prepare(
          `INSERT INTO users (id, email, display_name, avatar_url, timezone)
           VALUES (?, ?, ?, ?, 'Asia/Tokyo')`
        )
        .bind(userId, userInfo.email, userInfo.name, userInfo.picture || null)
        .run();
    }

    // Phase 0B: Save Google Account tokens (for Calendar API)
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();
    
    // Check if Google account already exists
    const existingGoogleAccount = await env.DB
      .prepare(`SELECT id FROM google_accounts WHERE google_sub = ?`)
      .bind(userInfo.id)
      .first<{ id: string }>();
    
    if (existingGoogleAccount) {
      // Update existing Google account
      // Only update refresh_token if we got a new one (it's not always returned)
      if (tokens.refresh_token) {
        await env.DB
          .prepare(
            `UPDATE google_accounts
             SET access_token_enc = ?,
                 refresh_token_enc = ?,
                 token_expires_at = ?,
                 scope = ?,
                 updated_at = datetime('now')
             WHERE google_sub = ?`
          )
          .bind(
            tokens.access_token,
            tokens.refresh_token,
            tokenExpiresAt,
            tokens.scope,
            userInfo.id
          )
          .run();
      } else {
        // Update without changing refresh_token
        await env.DB
          .prepare(
            `UPDATE google_accounts
             SET access_token_enc = ?,
                 token_expires_at = ?,
                 scope = ?,
                 updated_at = datetime('now')
             WHERE google_sub = ?`
          )
          .bind(
            tokens.access_token,
            tokenExpiresAt,
            tokens.scope,
            userInfo.id
          )
          .run();
      }
    } else {
      // Create new Google account
      const googleAccountId = `goog-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      await env.DB
        .prepare(
          `INSERT INTO google_accounts (
            id, user_id, google_sub, email,
            access_token_enc, refresh_token_enc,
            token_expires_at, scope, is_primary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .bind(
          googleAccountId,
          userId,
          userInfo.id,
          userInfo.email,
          tokens.access_token,
          tokens.refresh_token || null,
          tokenExpiresAt,
          tokens.scope
        )
        .run();
    }

    // Create session
    const sessionRepo = new SessionRepository(env.DB);
    const sessionToken = await generateSessionToken();
    const tokenHash = await hashToken(sessionToken);

    await sessionRepo.create({
      user_id: userId,
      token_hash: tokenHash,
      expires_in_seconds: 30 * 24 * 60 * 60, // 30 days
      user_agent: c.req.header('User-Agent'),
    });

    // Set session cookie
    setCookie(c, 'session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    // Redirect to app (or return JSON for API clients)
    return c.redirect('/');
    // return c.json({ success: true, user_id: userId, session_token: sessionToken });
  } catch (error) {
    const log = createLogger(env, { module: 'Auth', handler: 'callback' });
    log.error('OAuth callback error', error);
    return c.json({ error: 'Internal server error during OAuth' }, 500);
  }
});

// ============================================================
// POST /auth/logout
// Revoke current session (uses Cookie or Bearer token)
// ============================================================
auth.post('/logout', async (c) => {
  const { env } = c;
  
  // Extract session token from Authorization header OR Cookie
  let sessionToken: string | null = null;
  
  // 1) Try Authorization: Bearer
  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    sessionToken = authorization.substring(7).trim();
  }
  
  // 2) Try Cookie: session
  if (!sessionToken) {
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      const parts = cookieHeader.split(';').map(s => s.trim());
      for (const part of parts) {
        if (part.startsWith('session=')) {
          sessionToken = decodeURIComponent(part.slice(8));
          break;
        }
      }
    }
  }
  
  if (!sessionToken) {
    return c.json({ error: 'Missing session token (provide Bearer token or session cookie)' }, 401);
  }

  const tokenHash = await hashToken(sessionToken);

  const sessionRepo = new SessionRepository(env.DB);
  const session = await sessionRepo.findByTokenHash(tokenHash);

  if (session) {
    await sessionRepo.revoke(session.id);
  }

  return c.json({ message: 'Logged out successfully' });
});

// ============================================================
// POST /auth/token
// Get Bearer token from current session (for mobile/PWA)
// Requires valid session cookie
// ============================================================
auth.post('/token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Auth', handler: 'token' });
  
  // Extract session token from Cookie only (not Bearer)
  let sessionToken: string | null = null;
  const cookieHeader = c.req.header('Cookie');
  
  log.debug('Cookie header check', { present: !!cookieHeader, length: cookieHeader?.length });
  
  if (cookieHeader) {
    const parts = cookieHeader.split(';').map(s => s.trim());
    for (const part of parts) {
      if (part.startsWith('session=')) {
        sessionToken = decodeURIComponent(part.slice(8));
        log.debug('Session token found', { tokenPrefix: sessionToken?.slice(0, 10) });
        break;
      }
    }
  }
  
  if (!sessionToken) {
    log.debug('No session token in cookie');
    return c.json({ error: 'No active session. Please login first.' }, 401);
  }

  const tokenHash = await hashToken(sessionToken);
  const sessionRepo = new SessionRepository(env.DB);
  const session = await sessionRepo.findByTokenHash(tokenHash);

  log.debug('Session lookup result', { found: !!session, userId: session?.user_id });

  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  // Return the session token as Bearer token
  return c.json({
    access_token: sessionToken,
    token_type: 'Bearer',
    expires_at: session.expires_at,
  });
});

// ============================================================
// GET /auth/me
// Get current user info (uses Cookie or Bearer token)
// ============================================================
auth.get('/me', async (c) => {
  const { env } = c;
  
  // Extract session token from Authorization header OR Cookie
  let sessionToken: string | null = null;
  
  // 1) Try Authorization: Bearer
  const authorization = c.req.header('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    sessionToken = authorization.substring(7).trim();
  }
  
  // 2) Try Cookie: session
  if (!sessionToken) {
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      const parts = cookieHeader.split(';').map(s => s.trim());
      for (const part of parts) {
        if (part.startsWith('session=')) {
          sessionToken = decodeURIComponent(part.slice(8));
          break;
        }
      }
    }
  }
  
  if (!sessionToken) {
    return c.json({ error: 'Missing session token (provide Bearer token or session cookie)' }, 401);
  }

  const tokenHash = await hashToken(sessionToken);

  const sessionRepo = new SessionRepository(env.DB);
  const session = await sessionRepo.findByTokenHash(tokenHash);

  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401);
  }

  // Update last_seen_at
  await sessionRepo.updateLastSeen(session.id);

  // Get user info
  const user = await env.DB
    .prepare(
      `SELECT id, email, display_name, avatar_url, created_at 
       FROM users WHERE id = ?`
    )
    .bind(session.user_id)
    .first();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ user });
});

// ============================================================
// POST /auth/logout
// Logout user and clear session
// ============================================================
auth.post('/logout', async (c) => {
  const { env } = c;

  try {
    // Get session token from cookie
    const sessionToken = c.req.header('cookie')?.match(/session=([^;]+)/)?.[1];

    if (sessionToken) {
      // Hash the session token
      const tokenHash = await hashToken(sessionToken);

      // Delete session from database
      const sessionRepo = new SessionRepository(env.DB);
      await sessionRepo.deleteByTokenHash(tokenHash);
    }

    // Clear session cookie
    setCookie(c, 'session', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 0, // Expire immediately
      path: '/',
    });

    return c.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    const log = createLogger(env, { module: 'Auth', handler: 'logoutSession' });
    log.error('Logout error', error);
    return c.json({ error: 'Logout failed' }, 500);
  }
});

export default auth;
