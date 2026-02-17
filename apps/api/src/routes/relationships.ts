/**
 * Relationships Routes - Phase D-1
 * 
 * Manage user relationships (workmate / family)
 * 
 * Endpoints:
 * - POST /api/relationships/request - Create relationship request
 * - POST /api/relationships/:token/accept - Accept relationship request
 * - POST /api/relationships/:token/decline - Decline relationship request
 * - GET /api/relationships - List user's relationships
 * - GET /api/relationships/pending - List pending requests (sent + received)
 * - DELETE /api/relationships/:id - Remove relationship
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { InboxRepository } from '../repositories/inboxRepository';
import {
  RELATION_TYPE,
  PERMISSION_PRESET,
  RELATIONSHIP_STATUS,
  REQUEST_STATUS,
  isValidRelationType,
  isValidPermissionPreset,
  getDefaultPermissionPreset,
  type RelationType,
  type PermissionPreset,
} from '../../../../packages/shared/src/types/relationship';
import { INBOX_TYPE, INBOX_PRIORITY } from '../../../../packages/shared/src/types/inbox';

type Bindings = {
  DB: D1Database;
  ENVIRONMENT?: string;
};

type Variables = {
  userId?: string;
  userRole?: string;
};

const relationships = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ============================================================
// Helper: Get user info
// ============================================================
async function getUserInfo(db: D1Database, userId: string) {
  const result = await db.prepare(`
    SELECT id, email, display_name
    FROM users
    WHERE id = ?
  `).bind(userId).first<{ id: string; email: string; display_name: string }>();
  return result;
}

// ============================================================
// Helper: Find user by email or ID
// ============================================================
async function findUserByEmailOrId(db: D1Database, identifier: string) {
  // Try as UUID first
  const byId = await db.prepare(`
    SELECT id, email, display_name
    FROM users
    WHERE id = ?
  `).bind(identifier).first<{ id: string; email: string; display_name: string }>();
  
  if (byId) return byId;
  
  // Try as email
  const byEmail = await db.prepare(`
    SELECT id, email, display_name
    FROM users
    WHERE email = ?
  `).bind(identifier.toLowerCase()).first<{ id: string; email: string; display_name: string }>();
  
  return byEmail;
}

// ============================================================
// Helper: Normalize user pair (alphabetical order for unique constraint)
// ============================================================
function normalizeUserPair(userA: string, userB: string): { user_a_id: string; user_b_id: string } {
  return userA < userB
    ? { user_a_id: userA, user_b_id: userB }
    : { user_a_id: userB, user_b_id: userA };
}

// ============================================================
// Helper: Check if relationship exists
// ============================================================
async function getExistingRelationship(db: D1Database, userId1: string, userId2: string) {
  const { user_a_id, user_b_id } = normalizeUserPair(userId1, userId2);
  
  const result = await db.prepare(`
    SELECT id, user_a_id, user_b_id, relation_type, status, permission_preset, permissions_json, created_at, updated_at
    FROM relationships
    WHERE user_a_id = ? AND user_b_id = ?
  `).bind(user_a_id, user_b_id).first();
  
  return result;
}

// ============================================================
// POST /api/relationships/request
// Create a new relationship request
// ============================================================
relationships.post('/request', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const logger = createLogger(env);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const body = await c.req.json<{
    invitee_identifier: string;  // email or user_id
    requested_type: string;      // workmate | family
    permission_preset?: string;  // for family
    message?: string;
  }>();
  
  const { invitee_identifier, requested_type, permission_preset, message } = body;
  
  // Validate requested_type
  if (!requested_type || !isValidRelationType(requested_type)) {
    return c.json({ 
      error: 'Invalid requested_type',
      valid_types: [RELATION_TYPE.WORKMATE, RELATION_TYPE.FAMILY]
    }, 400);
  }
  
  // Validate permission_preset for family
  let finalPreset: PermissionPreset | null = null;
  if (requested_type === RELATION_TYPE.FAMILY) {
    if (permission_preset && !isValidPermissionPreset(permission_preset)) {
      return c.json({ 
        error: 'Invalid permission_preset',
        valid_presets: Object.values(PERMISSION_PRESET)
      }, 400);
    }
    finalPreset = permission_preset 
      ? permission_preset as PermissionPreset 
      : PERMISSION_PRESET.FAMILY_VIEW_FREEBUSY;
  } else if (requested_type === RELATION_TYPE.WORKMATE) {
    finalPreset = PERMISSION_PRESET.WORKMATE_DEFAULT;
  }
  
  // Find invitee
  const invitee = await findUserByEmailOrId(env.DB, invitee_identifier);
  if (!invitee) {
    return c.json({ 
      error: 'User not found',
      message: '指定されたユーザーが見つかりません'
    }, 404);
  }
  
  // Cannot request relationship with self
  if (invitee.id === userId) {
    return c.json({ error: 'Cannot create relationship with yourself' }, 400);
  }
  
  // Check if relationship already exists
  const existingRelation = await getExistingRelationship(env.DB, userId, invitee.id);
  if (existingRelation && existingRelation.status === RELATIONSHIP_STATUS.ACTIVE) {
    return c.json({ 
      error: 'Relationship already exists',
      message: 'すでに関係が成立しています'
    }, 409);
  }
  
  // Check for pending request
  const pendingRequest = await env.DB.prepare(`
    SELECT id, status, requested_type
    FROM relationship_requests
    WHERE (inviter_user_id = ? AND invitee_user_id = ?)
       OR (inviter_user_id = ? AND invitee_user_id = ?)
    AND status = 'pending'
  `).bind(userId, invitee.id, invitee.id, userId).first();
  
  if (pendingRequest) {
    return c.json({ 
      error: 'Pending request exists',
      message: '未処理の申請があります'
    }, 409);
  }
  
  // Get inviter info
  const inviter = await getUserInfo(env.DB, userId);
  if (!inviter) {
    return c.json({ error: 'Inviter not found' }, 500);
  }
  
  // Create request
  const requestId = uuidv4();
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  
  await env.DB.prepare(`
    INSERT INTO relationship_requests (
      id, inviter_user_id, invitee_user_id, invitee_email,
      requested_type, status, token, message, permission_preset,
      expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, datetime('now'))
  `).bind(
    requestId,
    userId,
    invitee.id,
    invitee.email,
    requested_type,
    token,
    message || null,
    finalPreset,
    expiresAt
  ).run();
  
  // Create inbox notification for invitee
  const inboxRepo = new InboxRepository(env.DB);
  const relationLabel = requested_type === RELATION_TYPE.FAMILY ? '家族' : '仕事仲間';
  
  await inboxRepo.create({
    user_id: invitee.id,
    type: INBOX_TYPE.RELATIONSHIP_REQUEST,
    title: `${inviter.display_name || inviter.email} さんから「${relationLabel}」申請`,
    message: message || `${inviter.display_name || inviter.email} さんが「${relationLabel}」として繋がりたいと申請しています。`,
    action_type: 'relationship_request',
    action_target_id: requestId,
    action_url: `/relationships/requests/${token}`,
    priority: INBOX_PRIORITY.NORMAL,
  });
  
  logger.info('Relationship request created', {
    request_id: requestId,
    inviter_user_id: userId,
    invitee_user_id: invitee.id,
    requested_type,
    permission_preset: finalPreset,
  });
  
  return c.json({
    success: true,
    request_id: requestId,
    token,
    invitee: {
      id: invitee.id,
      display_name: invitee.display_name,
      email: invitee.email,
    },
    requested_type,
    permission_preset: finalPreset,
    expires_at: expiresAt,
    message: `${relationLabel}申請を送信しました`,
  });
});

// ============================================================
// POST /api/relationships/:token/accept
// Accept a relationship request
// ============================================================
relationships.post('/:token/accept', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const token = c.req.param('token');
  const logger = createLogger(env);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Find request
  const request = await env.DB.prepare(`
    SELECT id, inviter_user_id, invitee_user_id, requested_type, 
           permission_preset, status, expires_at
    FROM relationship_requests
    WHERE token = ?
  `).bind(token).first<{
    id: string;
    inviter_user_id: string;
    invitee_user_id: string;
    requested_type: RelationType;
    permission_preset: PermissionPreset | null;
    status: string;
    expires_at: string;
  }>();
  
  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }
  
  // Verify user is the invitee
  if (request.invitee_user_id !== userId) {
    return c.json({ error: 'Not authorized to accept this request' }, 403);
  }
  
  // Check status
  if (request.status !== REQUEST_STATUS.PENDING) {
    return c.json({ 
      error: 'Request already processed',
      status: request.status
    }, 400);
  }
  
  // Check expiry
  if (new Date(request.expires_at) < new Date()) {
    await env.DB.prepare(`
      UPDATE relationship_requests SET status = 'expired' WHERE id = ?
    `).bind(request.id).run();
    return c.json({ error: 'Request expired' }, 400);
  }
  
  // Create relationship
  const { user_a_id, user_b_id } = normalizeUserPair(request.inviter_user_id, request.invitee_user_id);
  const relationshipId = uuidv4();
  const preset = request.permission_preset || getDefaultPermissionPreset(request.requested_type);
  
  // Check if relationship already exists (edge case: created via other request)
  const existing = await getExistingRelationship(env.DB, request.inviter_user_id, request.invitee_user_id);
  
  if (existing && existing.status === RELATIONSHIP_STATUS.ACTIVE) {
    // Update request status but don't create duplicate relationship
    await env.DB.prepare(`
      UPDATE relationship_requests 
      SET status = 'accepted', responded_at = datetime('now')
      WHERE id = ?
    `).bind(request.id).run();
    
    return c.json({ 
      success: true,
      message: '関係が承認されました（既存の関係を維持）',
      relationship_id: existing.id as string,
    });
  }
  
  // Insert relationship
  await env.DB.prepare(`
    INSERT INTO relationships (
      id, user_a_id, user_b_id, relation_type, status,
      permission_preset, permissions_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, '{}', unixepoch(), unixepoch())
  `).bind(
    relationshipId,
    user_a_id,
    user_b_id,
    request.requested_type,
    preset
  ).run();
  
  // Update request status
  await env.DB.prepare(`
    UPDATE relationship_requests 
    SET status = 'accepted', responded_at = datetime('now')
    WHERE id = ?
  `).bind(request.id).run();
  
  // Get inviter info for notification
  const inviter = await getUserInfo(env.DB, request.inviter_user_id);
  const invitee = await getUserInfo(env.DB, userId);
  
  // Notify inviter
  if (inviter) {
    const inboxRepo = new InboxRepository(env.DB);
    const relationLabel = request.requested_type === RELATION_TYPE.FAMILY ? '家族' : '仕事仲間';
    
    await inboxRepo.create({
      user_id: request.inviter_user_id,
      type: INBOX_TYPE.RELATIONSHIP_REQUEST,
      title: `「${relationLabel}」申請が承認されました`,
      message: `${invitee?.display_name || invitee?.email} さんが「${relationLabel}」申請を承認しました。`,
      action_type: 'relationship_accepted',
      action_target_id: relationshipId,
      action_url: '/relationships',
      priority: INBOX_PRIORITY.NORMAL,
    });
  }
  
  logger.info('Relationship request accepted', {
    request_id: request.id,
    relationship_id: relationshipId,
    inviter_user_id: request.inviter_user_id,
    invitee_user_id: userId,
    relation_type: request.requested_type,
  });
  
  return c.json({
    success: true,
    message: '関係が成立しました',
    relationship_id: relationshipId,
    relation_type: request.requested_type,
    permission_preset: preset,
  });
});

// ============================================================
// POST /api/relationships/:token/decline
// Decline a relationship request
// ============================================================
relationships.post('/:token/decline', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const token = c.req.param('token');
  const logger = createLogger(env);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Find request
  const request = await env.DB.prepare(`
    SELECT id, inviter_user_id, invitee_user_id, requested_type, status
    FROM relationship_requests
    WHERE token = ?
  `).bind(token).first<{
    id: string;
    inviter_user_id: string;
    invitee_user_id: string;
    requested_type: string;
    status: string;
  }>();
  
  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }
  
  // Verify user is the invitee
  if (request.invitee_user_id !== userId) {
    return c.json({ error: 'Not authorized to decline this request' }, 403);
  }
  
  // Check status
  if (request.status !== REQUEST_STATUS.PENDING) {
    return c.json({ 
      error: 'Request already processed',
      status: request.status
    }, 400);
  }
  
  // Update request status
  await env.DB.prepare(`
    UPDATE relationship_requests 
    SET status = 'declined', responded_at = datetime('now')
    WHERE id = ?
  `).bind(request.id).run();
  
  // Get invitee info for notification
  const invitee = await getUserInfo(env.DB, userId);
  
  // Notify inviter (optional - may not want to reveal rejection)
  const inviter = await getUserInfo(env.DB, request.inviter_user_id);
  if (inviter) {
    const inboxRepo = new InboxRepository(env.DB);
    const relationLabel = request.requested_type === RELATION_TYPE.FAMILY ? '家族' : '仕事仲間';
    
    await inboxRepo.create({
      user_id: request.inviter_user_id,
      type: INBOX_TYPE.RELATIONSHIP_REQUEST,
      title: `「${relationLabel}」申請が辞退されました`,
      message: `${invitee?.display_name || invitee?.email} さんが「${relationLabel}」申請を辞退しました。`,
      action_type: 'relationship_declined',
      action_target_id: request.id,
      action_url: '/relationships',
      priority: INBOX_PRIORITY.LOW,
    });
  }
  
  logger.info('Relationship request declined', {
    request_id: request.id,
    inviter_user_id: request.inviter_user_id,
    invitee_user_id: userId,
  });
  
  return c.json({
    success: true,
    message: '申請を辞退しました',
  });
});

// ============================================================
// GET /api/relationships
// List user's active relationships
// ============================================================
relationships.get('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Query parameters - cursor-based pagination (P0-2 compliant)
  const type = c.req.query('type'); // filter by relation_type
  const limitParam = c.req.query('limit') || '50';
  const cursor = c.req.query('cursor'); // format: "created_at,id" (both as strings)
  
  const limit = Math.min(parseInt(limitParam, 10), 100);
  
  // Parse cursor
  let cursorCreatedAt: number | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const parts = cursor.split(',');
    if (parts.length === 2) {
      cursorCreatedAt = parseInt(parts[0], 10);
      cursorId = parts[1];
    }
  }
  
  // Build query with cursor pagination
  let query = `
    SELECT 
      r.id,
      r.relation_type,
      r.status,
      r.permission_preset,
      r.created_at,
      CASE 
        WHEN r.user_a_id = ? THEN r.user_b_id 
        ELSE r.user_a_id 
      END as other_user_id,
      u.display_name as other_user_name,
      u.email as other_user_email
    FROM relationships r
    JOIN users u ON u.id = CASE 
      WHEN r.user_a_id = ? THEN r.user_b_id 
      ELSE r.user_a_id 
    END
    WHERE (r.user_a_id = ? OR r.user_b_id = ?)
      AND r.status = 'active'
  `;
  const params: (string | number)[] = [userId, userId, userId, userId];
  
  if (type && isValidRelationType(type)) {
    query += ` AND r.relation_type = ?`;
    params.push(type);
  }
  
  // Cursor-based pagination: fetch items older than cursor
  if (cursorCreatedAt !== null && cursorId !== null) {
    query += ` AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))`;
    params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  }
  
  query += ` ORDER BY r.created_at DESC, r.id DESC LIMIT ?`;
  params.push(limit + 1); // Fetch one extra to check has_more
  
  const results = await env.DB.prepare(query)
    .bind(...params)
    .all<{
      id: string;
      relation_type: RelationType;
      status: string;
      permission_preset: PermissionPreset | null;
      created_at: number;
      other_user_id: string;
      other_user_name: string;
      other_user_email: string;
    }>();
  
  const allItems = results.results || [];
  const hasMore = allItems.length > limit;
  const items = hasMore ? allItems.slice(0, limit) : allItems;
  
  // Build next cursor
  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    nextCursor = `${lastItem.created_at},${lastItem.id}`;
  }
  
  const mappedItems = items.map(r => ({
    id: r.id,
    relation_type: r.relation_type,
    status: r.status,
    permission_preset: r.permission_preset,
    created_at: r.created_at,
    other_user: {
      id: r.other_user_id,
      display_name: r.other_user_name,
      email: r.other_user_email,
    },
  }));
  
  return c.json({
    items: mappedItems,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  });
});

// ============================================================
// GET /api/relationships/pending
// List pending requests (sent and received)
// ============================================================
relationships.get('/pending', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Get received requests
  const received = await env.DB.prepare(`
    SELECT 
      rr.id, rr.token, rr.requested_type, rr.permission_preset,
      rr.message, rr.expires_at, rr.created_at,
      u.id as inviter_id, u.display_name as inviter_name, u.email as inviter_email
    FROM relationship_requests rr
    JOIN users u ON u.id = rr.inviter_user_id
    WHERE rr.invitee_user_id = ? AND rr.status = 'pending'
    ORDER BY rr.created_at DESC
  `).bind(userId).all<{
    id: string;
    token: string;
    requested_type: RelationType;
    permission_preset: PermissionPreset | null;
    message: string | null;
    expires_at: string;
    created_at: string;
    inviter_id: string;
    inviter_name: string;
    inviter_email: string;
  }>();
  
  // Get sent requests
  const sent = await env.DB.prepare(`
    SELECT 
      rr.id, rr.token, rr.requested_type, rr.permission_preset,
      rr.message, rr.expires_at, rr.created_at,
      u.id as invitee_id, u.display_name as invitee_name, u.email as invitee_email
    FROM relationship_requests rr
    JOIN users u ON u.id = rr.invitee_user_id
    WHERE rr.inviter_user_id = ? AND rr.status = 'pending'
    ORDER BY rr.created_at DESC
  `).bind(userId).all<{
    id: string;
    token: string;
    requested_type: RelationType;
    permission_preset: PermissionPreset | null;
    message: string | null;
    expires_at: string;
    created_at: string;
    invitee_id: string;
    invitee_name: string;
    invitee_email: string;
  }>();
  
  return c.json({
    received: (received.results || []).map(r => ({
      id: r.id,
      token: r.token,
      requested_type: r.requested_type,
      permission_preset: r.permission_preset,
      message: r.message,
      expires_at: r.expires_at,
      created_at: r.created_at,
      inviter: {
        id: r.inviter_id,
        display_name: r.inviter_name,
        email: r.inviter_email,
      },
    })),
    sent: (sent.results || []).map(r => ({
      id: r.id,
      token: r.token,
      requested_type: r.requested_type,
      permission_preset: r.permission_preset,
      message: r.message,
      expires_at: r.expires_at,
      created_at: r.created_at,
      invitee: {
        id: r.invitee_id,
        display_name: r.invitee_name,
        email: r.invitee_email,
      },
    })),
  });
});

// ============================================================
// DELETE /api/relationships/:id
// Remove a relationship (both users can remove)
// ============================================================
relationships.delete('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const relationshipId = c.req.param('id');
  const logger = createLogger(env);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Find relationship
  const relationship = await env.DB.prepare(`
    SELECT id, user_a_id, user_b_id, relation_type
    FROM relationships
    WHERE id = ?
  `).bind(relationshipId).first<{
    id: string;
    user_a_id: string;
    user_b_id: string;
    relation_type: string;
  }>();
  
  if (!relationship) {
    return c.json({ error: 'Relationship not found' }, 404);
  }
  
  // Verify user is part of the relationship
  if (relationship.user_a_id !== userId && relationship.user_b_id !== userId) {
    return c.json({ error: 'Not authorized to remove this relationship' }, 403);
  }
  
  // Delete relationship
  await env.DB.prepare(`
    DELETE FROM relationships WHERE id = ?
  `).bind(relationshipId).run();
  
  logger.info('Relationship removed', {
    relationship_id: relationshipId,
    removed_by: userId,
    relation_type: relationship.relation_type,
  });
  
  return c.json({
    success: true,
    message: '関係を解除しました',
  });
});

// ============================================================
// GET /api/relationships/with/:userId
// Get relationship with a specific user
// ============================================================
relationships.get('/with/:targetUserId', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const targetUserId = c.req.param('targetUserId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const relationship = await getExistingRelationship(env.DB, userId, targetUserId);
  
  if (!relationship || relationship.status !== RELATIONSHIP_STATUS.ACTIVE) {
    return c.json({
      has_relationship: false,
      relation_type: RELATION_TYPE.STRANGER,
    });
  }
  
  return c.json({
    has_relationship: true,
    relationship: {
      id: relationship.id as string,
      relation_type: relationship.relation_type as RelationType,
      status: relationship.status as string,
      permission_preset: relationship.permission_preset as PermissionPreset | null,
      created_at: relationship.created_at as number,
    },
  });
});

// ============================================================
// GET /api/relationships/search
// Search for users by email or user ID (for relationship request)
// ============================================================
relationships.get('/search', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const query = c.req.query('q');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  if (!query || query.trim().length < 3) {
    return c.json({ 
      error: 'Query too short',
      message: '3文字以上で検索してください'
    }, 400);
  }
  
  const searchTerm = query.trim().toLowerCase();
  
  // Search by exact email or partial display_name
  const results = await env.DB.prepare(`
    SELECT id, email, display_name
    FROM users
    WHERE id != ?
      AND (
        LOWER(email) = ?
        OR LOWER(display_name) LIKE ?
      )
    LIMIT 10
  `).bind(userId, searchTerm, `%${searchTerm}%`).all<{
    id: string;
    email: string;
    display_name: string;
  }>();
  
  // Enrich results with relationship status
  const enrichedResults = await Promise.all(
    (results.results || []).map(async (user) => {
      const relationship = await getExistingRelationship(env.DB, userId, user.id);
      
      // Check for pending request
      const pendingRequest = await env.DB.prepare(`
        SELECT id, status, requested_type
        FROM relationship_requests
        WHERE ((inviter_user_id = ? AND invitee_user_id = ?)
           OR (inviter_user_id = ? AND invitee_user_id = ?))
          AND status = 'pending'
        LIMIT 1
      `).bind(userId, user.id, user.id, userId).first<{
        id: string;
        status: string;
        requested_type: string;
      }>();
      
      return {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        relationship: relationship && relationship.status === RELATIONSHIP_STATUS.ACTIVE
          ? {
              id: relationship.id as string,
              relation_type: relationship.relation_type as RelationType,
              permission_preset: relationship.permission_preset as PermissionPreset | null,
            }
          : null,
        pending_request: pendingRequest
          ? {
              id: pendingRequest.id,
              requested_type: pendingRequest.requested_type,
            }
          : null,
        can_request: !relationship || relationship.status !== RELATIONSHIP_STATUS.ACTIVE,
      };
    })
  );
  
  return c.json({
    query: query.trim(),
    results: enrichedResults,
    count: enrichedResults.length,
  });
});

// ============================================================
// GET /api/relationships/permissions/with/:targetUserId
// Get detailed permissions with a specific user
// ============================================================
relationships.get('/permissions/with/:targetUserId', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const targetUserId = c.req.param('targetUserId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Import and use RelationshipAccessService
  const { createRelationshipAccessService } = await import('../services/relationshipAccess');
  const accessService = createRelationshipAccessService(env.DB);
  
  const summary = await accessService.getPermissionSummary(userId, targetUserId);
  
  // Get target user info
  const targetUser = await env.DB.prepare(`
    SELECT id, email, display_name
    FROM users
    WHERE id = ?
  `).bind(targetUserId).first<{
    id: string;
    email: string;
    display_name: string;
  }>();
  
  return c.json({
    requester_user_id: userId,
    target_user_id: targetUserId,
    target_user: targetUser ? {
      id: targetUser.id,
      email: targetUser.email,
      display_name: targetUser.display_name,
    } : null,
    ...summary,
  });
});

// ============================================================
// POST /api/relationships/block
// Block a user (prevents future relationship requests)
// ============================================================
relationships.post('/block', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const logger = createLogger(env);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const body = await c.req.json<{
    target_user_id: string;
    reason?: string;
  }>();
  
  const { target_user_id, reason } = body;
  
  if (!target_user_id) {
    return c.json({ error: 'target_user_id is required' }, 400);
  }
  
  // Cannot block yourself
  if (target_user_id === userId) {
    return c.json({ error: 'Cannot block yourself' }, 400);
  }
  
  // Check if target user exists
  const targetUser = await env.DB.prepare(`
    SELECT id FROM users WHERE id = ?
  `).bind(target_user_id).first();
  
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  // Check if already blocked
  const existingBlock = await env.DB.prepare(`
    SELECT id FROM blocks WHERE user_id = ? AND blocked_user_id = ?
  `).bind(userId, target_user_id).first();
  
  if (existingBlock) {
    return c.json({ 
      error: 'User already blocked',
      message: 'このユーザーは既にブロック済みです'
    }, 409);
  }
  
  // Get workspace_id from user context (simplified for MVP)
  // Phase 1: Single-tenant mode — use default workspace
  // workspace_members table does not exist yet; will be added in multi-tenant phase
  const workspaceId = 'ws-default';
  
  // Create block record
  const blockId = uuidv4();
  
  await env.DB.prepare(`
    INSERT INTO blocks (id, workspace_id, user_id, blocked_user_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(blockId, workspaceId, userId, target_user_id, reason || null).run();
  
  // Decline any pending requests from the blocked user
  await env.DB.prepare(`
    UPDATE relationship_requests 
    SET status = 'declined', responded_at = datetime('now')
    WHERE inviter_user_id = ? AND invitee_user_id = ? AND status = 'pending'
  `).bind(target_user_id, userId).run();
  
  logger.info('User blocked', {
    user_id: userId,
    blocked_user_id: target_user_id,
    block_id: blockId,
  });
  
  return c.json({
    success: true,
    block_id: blockId,
    message: 'ユーザーをブロックしました',
  });
});

// ============================================================
// DELETE /api/relationships/block/:targetUserId
// Unblock a user
// ============================================================
relationships.delete('/block/:targetUserId', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const targetUserId = c.req.param('targetUserId');
  const logger = createLogger(env);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Delete block record
  const result = await env.DB.prepare(`
    DELETE FROM blocks WHERE user_id = ? AND blocked_user_id = ?
  `).bind(userId, targetUserId).run();
  
  if (result.meta.changes === 0) {
    return c.json({ error: 'Block not found' }, 404);
  }
  
  logger.info('User unblocked', {
    user_id: userId,
    unblocked_user_id: targetUserId,
  });
  
  return c.json({
    success: true,
    message: 'ブロックを解除しました',
  });
});

// ============================================================
// GET /api/relationships/blocked
// List blocked users
// ============================================================
relationships.get('/blocked', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const results = await env.DB.prepare(`
    SELECT 
      b.id as block_id,
      b.blocked_user_id,
      b.reason,
      b.created_at,
      u.display_name as blocked_user_name,
      u.email as blocked_user_email
    FROM blocks b
    JOIN users u ON u.id = b.blocked_user_id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `).bind(userId).all<{
    block_id: string;
    blocked_user_id: string;
    reason: string | null;
    created_at: string;
    blocked_user_name: string;
    blocked_user_email: string;
  }>();
  
  return c.json({
    blocked_users: (results.results || []).map(r => ({
      block_id: r.block_id,
      user: {
        id: r.blocked_user_id,
        display_name: r.blocked_user_name,
        email: r.blocked_user_email,
      },
      reason: r.reason,
      created_at: r.created_at,
    })),
    count: results.results?.length || 0,
  });
});

export default relationships;
