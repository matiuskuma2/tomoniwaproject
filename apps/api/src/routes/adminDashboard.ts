/**
 * Admin Dashboard Routes
 * Monitoring and management endpoints for operations
 */

import { Hono } from 'hono';
import { getUserIdFromContext } from '../middleware/auth';
import { encodeCursor, decodeCursor, clampLimit } from '../utils/cursor';

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
// User list with cursor pagination (P0-2: OFFSET禁止)
// ============================================================
adminDashboard.get('/users', async (c) => {
  const { env } = c;
  
  const limit = clampLimit(c.req.query('limit'), 100);
  const cursorParam = c.req.query('cursor');

  // P0-2: Decode cursor
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (cursorParam) {
    const decoded = decodeCursor(cursorParam);
    if (!decoded) {
      return c.json({ error: 'Invalid cursor format' }, 400);
    }
    cursorCreatedAt = decoded.timestamp;
    cursorId = decoded.id;
  }

  let query = `
    SELECT 
      id, email, display_name, role, 
      created_at, updated_at
    FROM users
    WHERE 1=1
  `;

  const params: any[] = [];

  // P0-2: Cursor condition
  if (cursorCreatedAt && cursorId) {
    query += ` AND (created_at < ? OR (created_at = ? AND id < ?))`;
    params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }

  query += `
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;
  params.push(limit + 1);

  const users = await env.DB.prepare(query).bind(...params).all();

  // P0-2: Detect hasMore
  const hasMore = users.results && users.results.length > limit;
  const items = hasMore ? users.results!.slice(0, limit) : users.results || [];

  // P0-2: Generate next cursor
  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1] as any;
    nextCursor = encodeCursor({
      timestamp: last.created_at,
      id: last.id,
    });
  }

  return c.json({
    users: items,
    pagination: {
      limit,
      cursor: nextCursor,
      has_more: hasMore,
    },
  });
});

// ============================================================
// GET /admin/dashboard/rooms
// Room list with member counts (P0-2: cursor pagination)
// ============================================================
adminDashboard.get('/rooms', async (c) => {
  const { env } = c;
  
  const limit = clampLimit(c.req.query('limit'), 100);
  const cursorParam = c.req.query('cursor');

  // P0-2: Decode cursor
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (cursorParam) {
    const decoded = decodeCursor(cursorParam);
    if (!decoded) {
      return c.json({ error: 'Invalid cursor format' }, 400);
    }
    cursorCreatedAt = decoded.timestamp;
    cursorId = decoded.id;
  }

  let query = `
    SELECT 
      r.id, r.name, r.description, r.owner_user_id,
      r.visibility, r.created_at,
      COUNT(rm.user_id) as member_count
    FROM rooms r
    LEFT JOIN room_members rm ON r.id = rm.room_id
  `;

  const params: any[] = [];

  // P0-2: Cursor condition
  if (cursorCreatedAt && cursorId) {
    query += ` WHERE (r.created_at < ? OR (r.created_at = ? AND r.id < ?))`;
    params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }

  query += `
    GROUP BY r.id
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ?
  `;
  params.push(limit + 1);

  const rooms = await env.DB.prepare(query).bind(...params).all();

  // P0-2: Detect hasMore
  const hasMore = rooms.results && rooms.results.length > limit;
  const items = hasMore ? rooms.results!.slice(0, limit) : rooms.results || [];

  // P0-2: Generate next cursor
  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1] as any;
    nextCursor = encodeCursor({
      timestamp: last.created_at,
      id: last.id,
    });
  }

  return c.json({
    rooms: items,
    pagination: {
      limit,
      cursor: nextCursor,
      has_more: hasMore,
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
// Thread list with status (P0-2: cursor pagination)
// ============================================================
adminDashboard.get('/threads', async (c) => {
  const { env } = c;
  
  const limit = clampLimit(c.req.query('limit'), 100);
  const statusParam = c.req.query('status');
  const cursorParam = c.req.query('cursor');

  // P0-2: Decode cursor
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (cursorParam) {
    const decoded = decodeCursor(cursorParam);
    if (!decoded) {
      return c.json({ error: 'Invalid cursor format' }, 400);
    }
    cursorCreatedAt = decoded.timestamp;
    cursorId = decoded.id;
  }

  let query = `
    SELECT 
      t.id, t.title, t.description, t.status,
      t.organizer_user_id as user_id, u.display_name as owner_name,
      t.created_at, t.updated_at,
      COUNT(ti.id) as invite_count
    FROM scheduling_threads t
    LEFT JOIN users u ON t.organizer_user_id = u.id
    LEFT JOIN thread_invites ti ON t.id = ti.thread_id
    WHERE 1=1
  `;

  const bindings: any[] = [];

  if (statusParam) {
    query += ' AND t.status = ?';
    bindings.push(statusParam);
  }

  // P0-2: Cursor condition
  if (cursorCreatedAt && cursorId) {
    query += ` AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))`;
    bindings.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }

  query += ` 
    GROUP BY t.id
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ?
  `;
  bindings.push(limit + 1);

  const threads = await env.DB.prepare(query).bind(...bindings).all();

  // P0-2: Detect hasMore
  const hasMore = threads.results && threads.results.length > limit;
  const items = hasMore ? threads.results!.slice(0, limit) : threads.results || [];

  // P0-2: Generate next cursor
  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1] as any;
    nextCursor = encodeCursor({
      timestamp: last.created_at,
      id: last.id,
    });
  }

  return c.json({
    threads: items,
    pagination: {
      limit,
      cursor: nextCursor,
      has_more: hasMore,
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
