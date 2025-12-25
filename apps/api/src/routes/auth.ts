/**
 * Authentication Routes
 * Handles Google OAuth and session management
 */

import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { SessionRepository } from '../repositories/sessionRepository';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_ALLOWED_DOMAINS?: string;
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
  
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);

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

    const tokens = await tokenResponse.json<{ access_token: string; id_token: string }>();

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
      userId = `user-${Date.now()}`;
      await env.DB
        .prepare(
          `INSERT INTO users (id, email, display_name, avatar_url)
           VALUES (?, ?, ?, ?)`
        )
        .bind(userId, userInfo.email, userInfo.name, userInfo.picture || null)
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
    console.error('OAuth callback error:', error);
    return c.json({ error: 'Internal server error during OAuth' }, 500);
  }
});

// ============================================================
// POST /auth/logout
// Revoke current session
// ============================================================
auth.post('/logout', async (c) => {
  const { env } = c;
  const authorization = c.req.header('Authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const sessionToken = authorization.substring(7);
  const tokenHash = await hashToken(sessionToken);

  const sessionRepo = new SessionRepository(env.DB);
  const session = await sessionRepo.findByTokenHash(tokenHash);

  if (session) {
    await sessionRepo.revoke(session.id);
  }

  return c.json({ message: 'Logged out successfully' });
});

// ============================================================
// GET /auth/me
// Get current user info
// ============================================================
auth.get('/me', async (c) => {
  const { env } = c;
  const authorization = c.req.header('Authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const sessionToken = authorization.substring(7);
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

export default auth;
