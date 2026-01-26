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
import type { Variables } from '../middleware/auth';
import { getTenant, ensureOwnedOr404 } from '../utils/workspaceContext';
import {
  ContactsRepository,
  type ContactKind,
  type RelationshipType,
  type CreateContactInput,
  type UpdateContactInput,
} from '../repositories/contactsRepository';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/contacts
 * Create a new contact
 */
app.post('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'create' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

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

    // Check duplicate (with tenant isolation)
    if (body.kind === 'internal_user' && body.user_id) {
      const existing = await repo.getByUserId(body.user_id, workspaceId, ownerUserId);
      if (existing) {
        return c.json({ error: 'Contact already exists for this user' }, 409);
      }
    }

    if ((body.kind === 'external_person' || body.kind === 'list_member') && body.email) {
      const existing = await repo.getByEmail(body.email, workspaceId, ownerUserId);
      if (existing) {
        return c.json({ error: 'Contact already exists for this email' }, 409);
      }
    }

    const input: CreateContactInput = {
      workspace_id: workspaceId,  // P0-1: Use tenant context
      owner_user_id: ownerUserId,  // P0-1: Use tenant context
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
    log.error('Error creating contact', { error: error instanceof Error ? error.message : String(error) });
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
  const log = createLogger(env, { module: 'Contacts', handler: 'search' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const query = c.req.query();
    const repo = new ContactsRepository(env.DB);

    const result = await repo.search({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
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
    log.error('Error searching contacts', { error: error instanceof Error ? error.message : String(error) });
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
  const log = createLogger(env, { module: 'Contacts', handler: 'get' });
  const userId = c.get('userId');

  if (!userId) {

    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const contactId = c.req.param('id');
    const repo = new ContactsRepository(env.DB);

    const contact = await repo.getById(contactId, workspaceId, ownerUserId);

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
    log.error('Error getting contact', { error: error instanceof Error ? error.message : String(error) });
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
  const log = createLogger(env, { module: 'Contacts', handler: 'update' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const contactId = c.req.param('id');
    const body = await c.req.json<UpdateContactInput>();

    const repo = new ContactsRepository(env.DB);

    const contact = await repo.update(contactId, workspaceId, ownerUserId, body);

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      },
    });
  } catch (error) {
    log.error('Error updating contact', { error: error instanceof Error ? error.message : String(error) });
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
 * POST /api/contacts/upsert
 * P2-E2: Upsert contact by email (for SMS phone number)
 * - If exists: update phone
 * - If not: create external_person with phone
 */
app.post('/upsert', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'upsert' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{
      email: string;
      phone: string;
      display_name?: string;
    }>();

    // Validation
    if (!body.email) {
      return c.json({ error: 'email is required' }, 400);
    }
    if (!body.phone) {
      return c.json({ error: 'phone is required' }, 400);
    }

    // E.164 format validation (basic)
    if (!body.phone.match(/^\+[1-9]\d{9,14}$/)) {
      return c.json({ error: 'phone must be in E.164 format (e.g., +819012345678)' }, 400);
    }

    const repo = new ContactsRepository(env.DB);
    const contact = await repo.upsertByEmail(
      workspaceId,
      ownerUserId,
      body.email,
      body.phone,
      body.display_name
    );

    log.debug('Upserted phone', { email: body.email, workspaceId });

    return c.json({
      success: true,
      contact: {
        id: contact.id,
        email: contact.email,
        phone: (contact as any).phone,
        display_name: contact.display_name,
      },
    });
  } catch (error) {
    log.error('Error upserting contact', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to upsert contact',
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
  const log = createLogger(env, { module: 'Contacts', handler: 'delete' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const contactId = c.req.param('id');
    const repo = new ContactsRepository(env.DB);

    await repo.delete(contactId, workspaceId, ownerUserId);

    return c.json({ success: true });
  } catch (error) {
    log.error('Error deleting contact', { error: error instanceof Error ? error.message : String(error) });
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
