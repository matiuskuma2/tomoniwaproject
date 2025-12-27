/**
 * Contacts API Routes
 * 
 * 予定調整ツールの台帳管理API
 * - POST /api/contacts: 台帳に登録
 * - GET /api/contacts: 検索（名前/メール/タグ）
 * - GET /api/contacts/:id: 詳細取得
 * - PATCH /api/contacts/:id: 更新
 * - DELETE /api/contacts/:id: 削除
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import {
  ContactsRepository,
  type ContactKind,
  type RelationshipType,
  type CreateContactInput,
  type UpdateContactInput,
} from '../repositories/contactsRepository';

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Default workspace_id (暫定：workspaces実装後に正規化)
const DEFAULT_WORKSPACE = 'ws-default';

/**
 * POST /api/contacts
 * Create a new contact
 */
app.post('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{
      kind: ContactKind;
      user_id?: string;
      email?: string;
      display_name?: string;
      relationship_type?: RelationshipType;
      tags?: string[];
      notes?: string;
      summary?: string;
    }>();

    // Validation
    if (!body.kind) {
      return c.json({ error: 'kind is required' }, 400);
    }

    if (body.kind === 'internal_user' && !body.user_id) {
      return c.json({ error: 'user_id is required for internal_user' }, 400);
    }

    if ((body.kind === 'external_person' || body.kind === 'list_member') && !body.email) {
      return c.json({ error: 'email is required for external contacts' }, 400);
    }

    const repo = new ContactsRepository(env.DB);

    // Check duplicate
    if (body.kind === 'internal_user' && body.user_id) {
      const existing = await repo.getByUserId(body.user_id, DEFAULT_WORKSPACE, userId);
      if (existing) {
        return c.json({ error: 'Contact already exists for this user' }, 409);
      }
    }

    if ((body.kind === 'external_person' || body.kind === 'list_member') && body.email) {
      const existing = await repo.getByEmail(body.email, DEFAULT_WORKSPACE, userId);
      if (existing) {
        return c.json({ error: 'Contact already exists for this email' }, 409);
      }
    }

    const input: CreateContactInput = {
      workspace_id: DEFAULT_WORKSPACE,
      owner_user_id: userId,
      kind: body.kind,
      user_id: body.user_id,
      email: body.email,
      display_name: body.display_name,
      relationship_type: body.relationship_type,
      tags: body.tags,
      notes: body.notes,
      summary: body.summary,
    };

    const contact = await repo.create(input);

    // Generate invitee_key for response
    const invitee_key = await ContactsRepository.generateInviteeKey(contact);

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key,
      },
    }, 201);
  } catch (error) {
    console.error('[Contacts] Error creating contact:', error);
    return c.json(
      {
        error: 'Failed to create contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/contacts
 * Search contacts
 */
app.get('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const query = c.req.query();
    const repo = new ContactsRepository(env.DB);

    const result = await repo.search({
      workspace_id: DEFAULT_WORKSPACE,
      owner_user_id: userId,
      q: query.q,
      kind: query.kind as ContactKind | undefined,
      relationship_type: query.relationship_type as RelationshipType | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    // Parse tags_json and add invitee_key
    const contacts = await Promise.all(
      result.contacts.map(async (contact) => ({
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      }))
    );

    return c.json({
      contacts,
      total: result.total,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    console.error('[Contacts] Error searching contacts:', error);
    return c.json(
      {
        error: 'Failed to search contacts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/contacts/:id
 * Get contact by ID
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const contactId = c.req.param('id');
    const repo = new ContactsRepository(env.DB);

    const contact = await repo.getById(contactId, DEFAULT_WORKSPACE, userId);

    if (!contact) {
      return c.json({ error: 'Contact not found' }, 404);
    }

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      },
    });
  } catch (error) {
    console.error('[Contacts] Error getting contact:', error);
    return c.json(
      {
        error: 'Failed to get contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PATCH /api/contacts/:id
 * Update contact
 */
app.patch('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const contactId = c.req.param('id');
    const body = await c.req.json<UpdateContactInput>();

    const repo = new ContactsRepository(env.DB);

    const contact = await repo.update(contactId, DEFAULT_WORKSPACE, userId, body);

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      },
    });
  } catch (error) {
    console.error('[Contacts] Error updating contact:', error);
    return c.json(
      {
        error: 'Failed to update contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/contacts/:id
 * Delete contact
 */
app.delete('/:id', async (c) => {
  const { env } = c;
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const contactId = c.req.param('id');
    const repo = new ContactsRepository(env.DB);

    await repo.delete(contactId, DEFAULT_WORKSPACE, userId);

    return c.json({ success: true });
  } catch (error) {
    console.error('[Contacts] Error deleting contact:', error);
    return c.json(
      {
        error: 'Failed to delete contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
