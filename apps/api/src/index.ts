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
import businessCardsRoutes from './routes/businessCards';

// Middleware
import { requireAuth, requireAdmin } from './middleware/auth';

// Queue Consumer
import emailConsumer from './queue/emailConsumer';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// Global Middleware
// ============================================================
app.use('*', logger());

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
app.route('/auth', authRoutes);

// OTP Service (Ticket 05 - Public for registration)
app.route('/api/otp', otpRoutes);

// External Invite Routes (Ticket 10 - Public, no auth required)
app.route('/i', inviteRoutes);

// ============================================================
// Protected API Routes (requireAuth middleware)
// ============================================================

// WorkItems API (Ticket 07)
app.use('/api/work-items*', requireAuth);
app.route('/api/work-items', workItemsRoutes);

// Voice Commands API (Ticket 08)
app.use('/api/voice*', requireAuth);
app.route('/api/voice', voiceRoutes);

// Threads API (Ticket 10 + Phase B)
app.use('/api/threads*', requireAuth);  // Remove trailing slash to match /api/threads and /api/threads/*
app.route('/api/threads', threadsRoutes);
app.route('/api/threads', threadsStatusRoutes);   // GET /:id/status
app.route('/api/threads', threadsRemindRoutes);   // POST /:id/remind
app.route('/api/threads', threadsFinalizeRoutes); // POST /:id/finalize

// Inbox API (User notifications)
app.use('/api/inbox*', requireAuth);
app.route('/api/inbox', inboxRoutes);

// Rooms API (Team collaboration)
app.use('/api/rooms*', requireAuth);
app.route('/api/rooms', roomsRoutes);

// Contacts API (台帳管理)
app.use('/api/contacts*', requireAuth);
app.route('/api/contacts', contactsRoutes);

// Lists API (送信セグメント)
app.use('/api/lists*', requireAuth);
app.route('/api/lists', listsRoutes);

// Business Cards API (名刺登録)
app.use('/api/business-cards*', requireAuth);
app.route('/api/business-cards', businessCardsRoutes);

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
// Export (includes HTTP handler + Queue consumer)
// ============================================================
export default {
  fetch: app.fetch,
  queue: emailConsumer.queue, // Email queue consumer (Ticket 06)
};
