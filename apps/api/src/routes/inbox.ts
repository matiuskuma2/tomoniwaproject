/**
 * Inbox Routes
 * User notification management
 */

import { Hono } from 'hono';
import { InboxRepository } from '../repositories/inboxRepository';

type Bindings = {
  DB: D1Database;
};

type Variables = {
  userId?: string;
  userRole?: string;
};

const inbox = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ============================================================
// GET /api/inbox
// Get user's inbox items with filters and pagination
// ============================================================
inbox.get('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Query parameters
  const isReadParam = c.req.query('is_read');
  const type = c.req.query('type');
  const priority = c.req.query('priority');
  const limitParam = c.req.query('limit') || '50';
  const offsetParam = c.req.query('offset') || '0';

  const limit = Math.min(parseInt(limitParam, 10), 100); // Max 100 items
  const offset = parseInt(offsetParam, 10);

  // Parse is_read filter
  let isRead: boolean | undefined;
  if (isReadParam === 'true') isRead = true;
  if (isReadParam === 'false') isRead = false;

  const inboxRepo = new InboxRepository(env.DB);

  // Get items
  const items = await inboxRepo.getInboxItems({
    user_id: userId,
    is_read: isRead,
    type,
    priority,
    limit,
    offset,
  });

  // Get total count and unread count
  const [totalCount, unreadCount] = await Promise.all([
    inboxRepo.getInboxCount({ user_id: userId, is_read: isRead, type, priority }),
    inboxRepo.getUnreadCount(userId),
  ]);

  return c.json({
    items,
    pagination: {
      total: totalCount,
      limit,
      offset,
      has_more: offset + items.length < totalCount,
    },
    unread_count: unreadCount,
  });
});

// ============================================================
// GET /api/inbox/unread-count
// Get unread count only (lightweight endpoint)
// ============================================================
inbox.get('/unread-count', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const inboxRepo = new InboxRepository(env.DB);
  const unreadCount = await inboxRepo.getUnreadCount(userId);

  return c.json({ unread_count: unreadCount });
});

// ============================================================
// GET /api/inbox/:id
// Get a single inbox item
// ============================================================
inbox.get('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');

  const inboxRepo = new InboxRepository(env.DB);
  const item = await inboxRepo.getById(id, userId);

  if (!item) {
    return c.json({ error: 'Inbox item not found' }, 404);
  }

  return c.json({ item });
});

// ============================================================
// PATCH /api/inbox/:id/read
// Mark an inbox item as read
// ============================================================
inbox.patch('/:id/read', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');

  const inboxRepo = new InboxRepository(env.DB);

  // Check if item exists
  const item = await inboxRepo.getById(id, userId);
  if (!item) {
    return c.json({ error: 'Inbox item not found' }, 404);
  }

  // Mark as read
  await inboxRepo.markAsRead(id, userId);

  return c.json({ message: 'Inbox item marked as read', id });
});

// ============================================================
// PATCH /api/inbox/:id/unread
// Mark an inbox item as unread
// ============================================================
inbox.patch('/:id/unread', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');

  const inboxRepo = new InboxRepository(env.DB);

  // Check if item exists
  const item = await inboxRepo.getById(id, userId);
  if (!item) {
    return c.json({ error: 'Inbox item not found' }, 404);
  }

  // Mark as unread
  await inboxRepo.markAsUnread(id, userId);

  return c.json({ message: 'Inbox item marked as unread', id });
});

// ============================================================
// POST /api/inbox/mark-all-read
// Mark all inbox items as read
// ============================================================
inbox.post('/mark-all-read', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const inboxRepo = new InboxRepository(env.DB);
  const changedCount = await inboxRepo.markAllAsRead(userId);

  return c.json({
    message: 'All inbox items marked as read',
    changed_count: changedCount,
  });
});

// ============================================================
// DELETE /api/inbox/:id
// Delete an inbox item
// ============================================================
inbox.delete('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');

  const inboxRepo = new InboxRepository(env.DB);

  // Check if item exists
  const item = await inboxRepo.getById(id, userId);
  if (!item) {
    return c.json({ error: 'Inbox item not found' }, 404);
  }

  // Delete item
  await inboxRepo.delete(id, userId);

  return c.json({ message: 'Inbox item deleted', id });
});

// ============================================================
// DELETE /api/inbox/clear-read
// Delete all read inbox items
// ============================================================
inbox.delete('/clear-read', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const inboxRepo = new InboxRepository(env.DB);
  const deletedCount = await inboxRepo.deleteAllRead(userId);

  return c.json({
    message: 'All read inbox items deleted',
    deleted_count: deletedCount,
  });
});

export default inbox;
