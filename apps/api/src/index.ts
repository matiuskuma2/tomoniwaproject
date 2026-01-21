/**
 * Main API Entry Point
 * Cloudflare Workers + Hono
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from '../../../packages/shared/src/types/env';

// Routes
import adminSystemRoutes from './routes/adminSystem';
import adminAiRoutes from './routes/adminAi';
import adminDashboardRoutes from './routes/adminDashboard';
import testRateLimitRoutes from './routes/testRateLimit';
import authRoutes from './routes/auth';
import otpRoutes from './routes/otp';
import workItemsRoutes from './routes/workItems';
import voiceRoutes from './routes/voice';
import threadsRoutes from './routes/threads';
import threadsStatusRoutes from './routes/threadsStatus';
import threadsRemindRoutes from './routes/threadsRemind';
import threadsFinalizeRoutes from './routes/threadsFinalize';
import inviteRoutes from './routes/invite';
import inboxRoutes from './routes/inbox';
import roomsRoutes from './routes/rooms';
import schedulingApiRoutes from './routes/schedulingApi';
import contactsRoutes from './routes/contacts';
import listsRoutes from './routes/lists';
import listItemsRoutes from './routes/listItems';
import listMembersRoutes from './routes/listMembers';
import businessCardsRoutes from './routes/businessCards';
import calendarRoutes from './routes/calendar';
import billingRoutes from './routes/billing';
import pendingActionsRoutes from './routes/pendingActions';
import usersMeRoutes from './routes/usersMe';
import workspaceNotificationsRoutes from './routes/workspaceNotifications';

// Middleware
import { requireAuth, requireAdmin, type Variables } from './middleware/auth';

// Scheduled Tasks
import { pruneAuditLogs } from './scheduled/pruneAuditLogs';

// Queue Consumer
import emailConsumer from './queue/emailConsumer';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Global Middleware
// ============================================================
app.use('*', logger());

// Normalize trailing slashes for API endpoints
// Redirects /api/threads/ to /api/threads (308 Permanent Redirect)
app.use('/api/*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.endsWith('/') && url.pathname !== '/api/') {
    url.pathname = url.pathname.replace(/\/+$/, '');
    return c.redirect(url.toString(), 308);
  }
  await next();
});

// CORS - adjust origins in production via wrangler.jsonc
app.use('/api/*', cors({
  origin: (origin) => {
    // TODO: Read from system_settings or env vars
    return origin;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ============================================================
// Health Check
// ============================================================
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Math.floor(Date.now() / 1000),
    environment: c.env.ENVIRONMENT || 'unknown',
    version: 'e0ac0b0-auth-debug',
    deployed_at: new Date().toISOString(),
  });
});

// API Health Check (for Routes)
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Math.floor(Date.now() / 1000),
    environment: c.env.ENVIRONMENT || 'unknown',
  });
});

// ============================================================
// API Routes
// ============================================================

// Admin System Settings (super_admin only)
app.use('/admin/system/*', requireAuth, requireAdmin);
app.route('/admin/system', adminSystemRoutes);

// Admin AI Cost Center (super_admin for write, admin for read)
app.use('/admin/ai/*', requireAuth, requireAdmin);
app.route('/admin/ai', adminAiRoutes);

// Admin Dashboard (admin only - monitoring and management)
app.use('/admin/dashboard/*', requireAuth, requireAdmin);
app.route('/admin/dashboard', adminDashboardRoutes);

// Test Routes (only in development environment)
app.use('/test/*', async (c, next) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Test routes only available in development' }, 403);
  }
  await next();
});

app.route('/test/rate-limit', testRateLimitRoutes);

// Authentication Routes (Public - no auth required)
// Note: /auth/* routes are accessed via Routes (app.tomoniwao.jp/auth/*)
// Workers receives the full path including /auth
app.route('/auth', authRoutes);

// OTP Service (Ticket 05 - Public for registration)
app.route('/api/otp', otpRoutes);

// External Invite Routes (Ticket 10 - Public, no auth required)
app.route('/i', inviteRoutes);

// ============================================================
// Protected API Routes (requireAuth middleware)
// ============================================================

// WorkItems API (Ticket 07)
app.use('/api/work-items', requireAuth);
app.use('/api/work-items/*', requireAuth);
app.route('/api/work-items', workItemsRoutes);

// Voice Commands API (Ticket 08)
app.use('/api/voice', requireAuth);
app.use('/api/voice/*', requireAuth);
app.route('/api/voice', voiceRoutes);

// Threads API (Ticket 10 + Phase B)
app.use('/api/threads', requireAuth);     // Match /api/threads
app.use('/api/threads/*', requireAuth);   // Match /api/threads/* (including /api/threads/:id/status)
app.route('/api/threads', threadsRoutes);
app.route('/api/threads', threadsStatusRoutes);   // GET /:id/status
app.route('/api/threads', threadsRemindRoutes);   // POST /:id/remind
app.route('/api/threads', threadsFinalizeRoutes); // POST /:id/finalize

// Beta A: Pending Actions API (送信確認フロー)
app.use('/api/pending-actions', requireAuth);
app.use('/api/pending-actions/*', requireAuth);
app.route('/api/pending-actions', pendingActionsRoutes); // POST /:token/confirm, /:token/execute

// Inbox API (User notifications)
app.use('/api/inbox', requireAuth);
app.use('/api/inbox/*', requireAuth);
app.route('/api/inbox', inboxRoutes);

// Rooms API (Team collaboration)
app.use('/api/rooms', requireAuth);
app.use('/api/rooms/*', requireAuth);
app.route('/api/rooms', roomsRoutes);

// Contacts API (台帳管理)
app.use('/api/contacts', requireAuth);
app.use('/api/contacts/*', requireAuth);
app.route('/api/contacts', contactsRoutes);

// Lists API (送信セグメント)
app.use('/api/lists', requireAuth);
app.use('/api/lists/*', requireAuth);
app.route('/api/lists', listsRoutes);

// List Members API (Phase Next-8 Day2: 参加者解決の正)
app.use('/api/lists/:listId/members', requireAuth);
app.use('/api/lists/:listId/members/*', requireAuth);
app.route('/api', listMembersRoutes);

// List Items API (Phase Next-8 Day2: タスク/TODO管理)
app.use('/api/list-items', requireAuth);
app.use('/api/list-items/*', requireAuth);
app.route('/api', listItemsRoutes);

// Business Cards API (名刺登録)
app.use('/api/business-cards', requireAuth);
app.use('/api/business-cards/*', requireAuth);
app.route('/api/business-cards', businessCardsRoutes);

// Users Me API (P3-TZ1: ユーザー設定 - タイムゾーン等)
app.use('/api/users/me', requireAuth);
app.use('/api/users/me/*', requireAuth);
app.route('/api/users/me', usersMeRoutes);

// Workspace Notification Settings API (P2-E1: Slack/Chatwork送達)
app.use('/api/workspace/notifications', requireAuth);
app.use('/api/workspace/notifications/*', requireAuth);
app.route('/api/workspace/notifications', workspaceNotificationsRoutes);

// Calendar API (Phase Next-3 - Read-only calendar access)
app.use('/api/calendar', requireAuth);
app.use('/api/calendar/*', requireAuth);
app.route('/api/calendar', calendarRoutes);

// Billing API (MyASP課金連携 - Phase Next-11)
// 認証境界を「コードで固定」する（運用事故防止 - Day3-0）
//
// ルール:
// - /api/billing/myasp/* → token認証のみ（requireAuthを絶対にかけない）
// - /api/billing/*       → requireAuth必須（将来も漏れない）
//
// この条件分岐ミドルウェアにより、構造的に認証漏れを防ぐ
app.use('/api/billing/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // ✅ 明示的除外: /api/billing/myasp/* はrequireAuthをスキップ
  if (path.startsWith('/api/billing/myasp/')) {
    return await next();
  }

  // ✅ それ以外は必ず認証
  return await requireAuth(c, next);
});

// ルート登録
app.route('/api/billing', billingRoutes);

// TODO: Add more routes
// app.route('/admin/abuse', adminAbuseRoutes);
// app.route('/admin/users', adminUsersRoutes);
// app.route('/admin/workspaces', adminWorkspacesRoutes);
// app.route('/me', meRoutes);
// app.route('/scheduling', schedulingRoutes);
// app.route('/e', externalEventRoutes);
// app.route('/rooms', roomsRoutes);
// app.route('/lists', listsRoutes);
// app.route('/hosted-events', hostedEventsRoutes);

// ============================================================
// Frontend SPA Routes (Will be served by Cloudflare Pages)
// Note: index.html and static assets are automatically served from public/
// ============================================================

// ============================================================
// 404 Handler
// ============================================================
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// ============================================================
// Error Handler
// ============================================================
app.onError((err, c) => {
  console.error('Error:', err);
  
  return c.json(
    {
      error: 'Internal Server Error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
    },
    500
  );
});

// ============================================================
// Scheduled Tasks (Cron)
// ============================================================

async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const cron = event.cron;
  
  console.log('[Scheduled] Cron triggered:', cron);
  
  // Daily cleanup (0 2 * * *)
  if (cron === '0 2 * * *') {
    console.log('[Scheduled] Running daily cleanup...');
    
    // P0-2: Use ctx.waitUntil to prevent premature termination
    ctx.waitUntil(
      (async () => {
        try {
          const result = await pruneAuditLogs(env.DB);
          console.log('[Scheduled] Audit log pruning completed:', result);
        } catch (error) {
          console.error('[Scheduled] Audit log pruning failed:', error);
        }
      })()
    );
  }
  
  // Hourly budget check (0 * * * *)
  if (cron === '0 * * * *') {
    console.log('[Scheduled] Running hourly budget check...');
    // TODO: Implement budget check logic
  }
}

// ============================================================
// Export (includes HTTP handler + Queue consumer + Scheduled)
// ============================================================
export default {
  fetch: app.fetch,
  queue: emailConsumer.queue, // Email queue consumer (Ticket 06)
  scheduled, // Cron tasks (P0-2: Audit log pruning)
};
