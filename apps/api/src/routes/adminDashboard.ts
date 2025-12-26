/**
 * Admin Dashboard Routes
 * Monitoring and management endpoints for operations
 */

import { Hono } from 'hono';
import { getUserIdFromContext } from '../middleware/auth';

type Bindings = {
  DB: D1Database;
  EMAIL_QUEUE: Queue;
  RESEND_API_KEY?: string;
};

const adminDashboard = new Hono<{ Bindings: Bindings; Variables: { userId: string } }>();

// ============================================================
// Helper: Check if user is admin
// ============================================================
async function isAdmin(db: D1Database, userId: string): Promise<boolean> {
  const user = await db
    .prepare('SELECT role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ role: string }>();

  return user?.role === 'admin' || user?.role === 'super_admin';
}

// ============================================================
// Middleware: Require admin role
// ============================================================
adminDashboard.use('*', async (c, next) => {
  const userId = getUserIdFromContext(c);
  const { env } = c;

  const isUserAdmin = await isAdmin(env.DB, userId);
  if (!isUserAdmin) {
    return c.json({ error: 'Forbidden: Admin access required' }, 403);
  }

  await next();
});

// ============================================================
// GET /admin/dashboard/stats
// Overall statistics
// ============================================================
adminDashboard.get('/stats', async (c) => {
  const { env } = c;

  // Get counts
  const [usersCount, roomsCount, threadsCount, workItemsCount, inboxCount] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM rooms').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM scheduling_threads').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM work_items').first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM inbox WHERE is_read = 0').first<{ count: number }>(),
  ]);

  // Get recent activity (last 24 hours)
  const recentUsers = await env.DB
    .prepare(`SELECT COUNT(*) as count FROM users WHERE created_at > datetime('now', '-1 day')`)
    .first<{ count: number }>();

  const recentThreads = await env.DB
    .prepare(`SELECT COUNT(*) as count FROM scheduling_threads WHERE created_at > datetime('now', '-1 day')`)
    .first<{ count: number }>();

  return c.json({
    stats: {
      total_users: usersCount?.count || 0,
      total_rooms: roomsCount?.count || 0,
      total_threads: threadsCount?.count || 0,
      total_work_items: workItemsCount?.count || 0,
      unread_notifications: inboxCount?.count || 0,
    },
    recent_activity: {
      new_users_24h: recentUsers?.count || 0,
      new_threads_24h: recentThreads?.count || 0,
    },
  });
});

// ============================================================
// GET /admin/dashboard/users
// User list with pagination
// ============================================================
adminDashboard.get('/users', async (c) => {
  const { env } = c;
  
  const limitParam = c.req.query('limit') || '50';
  const offsetParam = c.req.query('offset') || '0';
  const limit = Math.min(parseInt(limitParam, 10), 100);
  const offset = parseInt(offsetParam, 10);

  const users = await env.DB
    .prepare(
      `SELECT 
        id, email, display_name, role, 
        created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all();

  const totalCount = await env.DB
    .prepare('SELECT COUNT(*) as count FROM users')
    .first<{ count: number }>();

  return c.json({
    users: users.results || [],
    pagination: {
      total: totalCount?.count || 0,
      limit,
      offset,
      has_more: offset + (users.results?.length || 0) < (totalCount?.count || 0),
    },
  });
});

// ============================================================
// GET /admin/dashboard/rooms
// Room list with member counts
// ============================================================
adminDashboard.get('/rooms', async (c) => {
  const { env } = c;
  
  const limitParam = c.req.query('limit') || '50';
  const offsetParam = c.req.query('offset') || '0';
  const limit = Math.min(parseInt(limitParam, 10), 100);
  const offset = parseInt(offsetParam, 10);

  const rooms = await env.DB
    .prepare(
      `SELECT 
        r.id, r.name, r.description, r.owner_user_id,
        r.visibility, r.created_at,
        COUNT(rm.user_id) as member_count
      FROM rooms r
      LEFT JOIN room_members rm ON r.id = rm.room_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all();

  const totalCount = await env.DB
    .prepare('SELECT COUNT(*) as count FROM rooms')
    .first<{ count: number }>();

  return c.json({
    rooms: rooms.results || [],
    pagination: {
      total: totalCount?.count || 0,
      limit,
      offset,
      has_more: offset + (rooms.results?.length || 0) < (totalCount?.count || 0),
    },
  });
});

// ============================================================
// GET /admin/dashboard/ai-usage
// AI API usage statistics
// ============================================================
adminDashboard.get('/ai-usage', async (c) => {
  const { env } = c;

  const daysParam = c.req.query('days') || '7';
  const days = Math.min(parseInt(daysParam, 10), 30);

  // Get AI usage from ai_usage_logs
  const usageLogs = await env.DB
    .prepare(
      `SELECT 
        provider,
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(estimated_cost_usd) as total_cost_usd,
        DATE(created_at) as date
      FROM ai_usage_logs
      WHERE created_at > datetime('now', '-' || ? || ' day')
      GROUP BY provider, model, DATE(created_at)
      ORDER BY created_at DESC`
    )
    .bind(days)
    .all();

  // Get summary
  const summary = await env.DB
    .prepare(
      `SELECT 
        provider,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(estimated_cost_usd) as total_cost_usd
      FROM ai_usage_logs
      WHERE created_at > datetime('now', '-' || ? || ' day')
      GROUP BY provider
      ORDER BY total_cost_usd DESC`
    )
    .bind(days)
    .all();

  return c.json({
    period_days: days,
    summary: summary.results || [],
    daily_usage: usageLogs.results || [],
  });
});

// ============================================================
// GET /admin/dashboard/threads
// Thread list with status
// ============================================================
adminDashboard.get('/threads', async (c) => {
  const { env } = c;
  
  const limitParam = c.req.query('limit') || '50';
  const offsetParam = c.req.query('offset') || '0';
  const statusParam = c.req.query('status');
  const limit = Math.min(parseInt(limitParam, 10), 100);
  const offset = parseInt(offsetParam, 10);

  let query = `
    SELECT 
      t.id, t.title, t.description, t.status,
      t.organizer_user_id as user_id, u.display_name as owner_name,
      t.created_at, t.updated_at,
      COUNT(ti.id) as invite_count
    FROM scheduling_threads t
    LEFT JOIN users u ON t.organizer_user_id = u.id
    LEFT JOIN thread_invites ti ON t.id = ti.thread_id
  `;

  const bindings: any[] = [];

  if (statusParam) {
    query += ' WHERE t.status = ?';
    bindings.push(statusParam);
  }

  query += ` 
    GROUP BY t.id
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;
  bindings.push(limit, offset);

  const threads = await env.DB.prepare(query).bind(...bindings).all();

  let countQuery = 'SELECT COUNT(*) as count FROM scheduling_threads';
  if (statusParam) {
    countQuery += ' WHERE status = ?';
  }
  const totalCount = await env.DB
    .prepare(countQuery)
    .bind(...(statusParam ? [statusParam] : []))
    .first<{ count: number }>();

  return c.json({
    threads: threads.results || [],
    pagination: {
      total: totalCount?.count || 0,
      limit,
      offset,
      has_more: offset + (threads.results?.length || 0) < (totalCount?.count || 0),
    },
  });
});

// ============================================================
// GET /admin/dashboard/email-stats
// Email sending statistics
// ============================================================
adminDashboard.get('/email-stats', async (c) => {
  const { env } = c;

  const daysParam = c.req.query('days') || '7';
  const days = Math.min(parseInt(daysParam, 10), 30);

  // Note: This is a placeholder. Actual email logs would come from:
  // 1. Resend API (via their dashboard or API)
  // 2. A custom email_logs table if we implement it
  // 3. Analytics from EMAIL_QUEUE

  // For now, return a placeholder response
  return c.json({
    period_days: days,
    note: 'Email statistics available via Resend Dashboard',
    resend_dashboard: 'https://resend.com/emails',
    // Future: Add email_logs table and query here
    stats: {
      total_sent: 0,
      total_delivered: 0,
      total_failed: 0,
      total_opened: 0,
      total_clicked: 0,
    },
  });
});

export default adminDashboard;
