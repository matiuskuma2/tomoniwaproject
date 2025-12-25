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
app.route('/admin/system', adminSystemRoutes);

// Admin AI Cost Center (super_admin for write, admin for read)
app.route('/admin/ai', adminAiRoutes);

// TODO: Add more routes
// app.route('/admin/abuse', adminAbuseRoutes);
// app.route('/admin/users', adminUsersRoutes);
// app.route('/admin/workspaces', adminWorkspacesRoutes);
// app.route('/auth', authRoutes);
// app.route('/me', meRoutes);
// app.route('/voice', voiceRoutes);
// app.route('/work-items', workItemsRoutes);
// app.route('/scheduling', schedulingRoutes);
// app.route('/i', externalInviteRoutes);
// app.route('/e', externalEventRoutes);
// app.route('/inbox', inboxRoutes);
// app.route('/rooms', roomsRoutes);
// app.route('/lists', listsRoutes);
// app.route('/hosted-events', hostedEventsRoutes);

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
// Export
// ============================================================
export default app;
