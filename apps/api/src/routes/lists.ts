/**
 * Lists API Routes
 * 
 * 予定調整の一括送信用セグメント管理
 * - POST /api/lists: リスト作成
 * - GET /api/lists: リスト一覧
 * - PATCH /api/lists/:id: 更新
 * - DELETE /api/lists/:id: 削除
 * - POST /api/lists/:id/members: Contact追加
 * - DELETE /api/lists/:id/members/:contactId: Contact削除
 * - GET /api/lists/:id/members: メンバー一覧
 */

import { Hono } from 'hono';
import { getTenant } from '../utils/workspaceContext';
import type { Env } from '../../../../packages/shared/src/types/env';
import { ListsRepository } from '../repositories/listsRepository';
import { ContactsRepository } from '../repositories/contactsRepository';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Default workspace_id (暫定：workspaces実装後に正規化)
const workspaceId = 'ws-default';

/**
 * POST /api/lists
 * Create a new list
 */
app.post('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
    }>();

    if (!body.name) {
      return c.json({ error: 'name is required' }, 400);
    }

    const repo = new ListsRepository(env.DB);

    const list = await repo.create({
      workspace_id: workspaceId,
      owner_user_id: userId,
      name: body.name,
      description: body.description,
    });

    return c.json({ list }, 201);
  } catch (error) {
    console.error('[Lists] Error creating list:', error);
    return c.json(
      {
        error: 'Failed to create list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/lists
 * Get all lists
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const query = c.req.query();
    const repo = new ListsRepository(env.DB);

    const result = await repo.getAll(
      workspaceId,
      userId,
      query.limit ? parseInt(query.limit, 10) : 50,
      query.offset ? parseInt(query.offset, 10) : 0
    );

    // Get member counts for each list
    const listsWithCounts = await Promise.all(
      result.lists.map(async (list) => ({
        ...list,
        member_count: await repo.getMemberCount(list.id, workspaceId),
      }))
    );

    return c.json({
      lists: listsWithCounts,
      total: result.total,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    console.error('[Lists] Error getting lists:', error);
    return c.json(
      {
        error: 'Failed to get lists',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/lists/:id
 * Get list by ID
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const listId = c.req.param('id');
    const repo = new ListsRepository(env.DB);

    const list = await repo.getById(listId, workspaceId, userId);

    if (!list) {
      return c.json({ error: 'List not found' }, 404);
    }

    const member_count = await repo.getMemberCount(list.id, workspaceId);

    return c.json({
      list: {
        ...list,
        member_count,
      },
    });
  } catch (error) {
    console.error('[Lists] Error getting list:', error);
    return c.json(
      {
        error: 'Failed to get list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PATCH /api/lists/:id
 * Update list
 */
app.patch('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const listId = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string;
    }>();

    const repo = new ListsRepository(env.DB);

    const list = await repo.update(listId, workspaceId, userId, body);

    return c.json({ list });
  } catch (error) {
    console.error('[Lists] Error updating list:', error);
    return c.json(
      {
        error: 'Failed to update list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/lists/:id
 * Delete list
 */
app.delete('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const listId = c.req.param('id');
    const repo = new ListsRepository(env.DB);

    await repo.delete(listId, workspaceId, userId);

    return c.json({ success: true });
  } catch (error) {
    console.error('[Lists] Error deleting list:', error);
    return c.json(
      {
        error: 'Failed to delete list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/lists/:id/members
 * Add contact to list
 */
app.post('/:id/members', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const listId = c.req.param('id');
    const body = await c.req.json<{
      contact_id: string;
    }>();

    if (!body.contact_id) {
      return c.json({ error: 'contact_id is required' }, 400);
    }

    const repo = new ListsRepository(env.DB);

    // Verify list ownership
    const list = await repo.getById(listId, workspaceId, userId);
    if (!list) {
      return c.json({ error: 'List not found' }, 404);
    }

    // Verify contact ownership
    const contactsRepo = new ContactsRepository(env.DB);
    const contact = await contactsRepo.getById(body.contact_id, workspaceId, userId);
    if (!contact) {
      return c.json({ error: 'Contact not found' }, 404);
    }

    const member = await repo.addMember(listId, body.contact_id, workspaceId);

    return c.json({ member }, 201);
  } catch (error) {
    console.error('[Lists] Error adding member:', error);
    if (error instanceof Error && error.message.includes('already a member')) {
      return c.json({ error: error.message }, 409);
    }
    return c.json(
      {
        error: 'Failed to add member',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/lists/:id/members/:contactId
 * Remove contact from list
 */
app.delete('/:id/members/:contactId', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const listId = c.req.param('id');
    const contactId = c.req.param('contactId');

    const repo = new ListsRepository(env.DB);

    // Verify list ownership
    const list = await repo.getById(listId, workspaceId, userId);
    if (!list) {
      return c.json({ error: 'List not found' }, 404);
    }

    await repo.removeMember(listId, contactId, workspaceId);

    return c.json({ success: true });
  } catch (error) {
    console.error('[Lists] Error removing member:', error);
    return c.json(
      {
        error: 'Failed to remove member',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/lists/:id/members
 * Get list members with contact details
 */
app.get('/:id/members', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const listId = c.req.param('id');
    const query = c.req.query();

    const repo = new ListsRepository(env.DB);

    // Verify list ownership
    const list = await repo.getById(listId, workspaceId, userId);
    if (!list) {
      return c.json({ error: 'List not found' }, 404);
    }

    const result = await repo.getMembers(
      listId,
      workspaceId,
      query.limit ? parseInt(query.limit, 10) : 100,
      query.offset ? parseInt(query.offset, 10) : 0
    );

    // Parse tags_json and generate invitee_key
    const membersWithTags = await Promise.all(
      result.members.map(async (member) => ({
        ...member,
        contact_tags: JSON.parse(member.contact_tags_json),
        contact_invitee_key: await ContactsRepository.generateInviteeKey({
          kind: member.contact_kind,
          user_id: member.contact_user_id,
          email: member.contact_email,
        } as any),
      }))
    );

    return c.json({
      members: membersWithTags,
      total: result.total,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    console.error('[Lists] Error getting members:', error);
    return c.json(
      {
        error: 'Failed to get members',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
