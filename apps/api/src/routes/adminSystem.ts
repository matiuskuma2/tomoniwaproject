/**
 * Admin System Settings Routes
 * Manages global system settings (email, OGP, legal URLs)
 * super_admin only
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { adminAuth, requireRole } from '../middleware/adminAuth';
import { SystemSettingsRepository } from '../repositories/systemSettingsRepo';
import { AuditLogRepository } from '../repositories/auditLogRepo';

const app = new Hono<{ Bindings: Env }>();

// All routes require super_admin role
app.use('*', adminAuth, requireRole('super_admin'));

/**
 * GET /admin/system/settings
 * Get all system settings
 */
app.get('/settings', async (c) => {
  const repo = new SystemSettingsRepository(c.env.DB);
  const items = await repo.getAll();

  return c.json({ items });
});

/**
 * GET /admin/system/settings/:key
 * Get a specific setting by key
 */
app.get('/settings/:key', async (c) => {
  const key = c.req.param('key');
  const repo = new SystemSettingsRepository(c.env.DB);
  const setting = await repo.getByKey(key);

  if (!setting) {
    return c.json({ error: 'Setting not found' }, 404);
  }

  return c.json(setting);
});

/**
 * PUT /admin/system/settings
 * Update system settings (batch upsert)
 */
app.put('/settings', async (c) => {
  const admin = c.get('admin');
  const body = await c.req.json();
  
  // Validate request body
  if (!body.items || !Array.isArray(body.items)) {
    return c.json({ error: 'Invalid request body: items array required' }, 400);
  }

  // Validate each item
  for (const item of body.items) {
    if (!item.key || typeof item.key !== 'string') {
      return c.json({ error: 'Invalid item: key is required and must be a string' }, 400);
    }
    if (item.value_json === undefined) {
      return c.json({ error: `Invalid item: value_json is required for key ${item.key}` }, 400);
    }
  }

  // Upsert settings
  const repo = new SystemSettingsRepository(c.env.DB);
  const items = await repo.upsertMany(body.items, admin.id);

  // Create audit log
  const auditRepo = new AuditLogRepository(c.env.DB);
  await auditRepo.create({
    actor_admin_id: admin.id,
    action_type: 'update_system_settings',
    entity_type: 'system_settings',
    payload: {
      updated_keys: body.items.map((item: any) => item.key),
      count: body.items.length,
    },
    ip_address: c.req.header('cf-connecting-ip') || undefined,
    user_agent: c.req.header('user-agent') || undefined,
  });

  return c.json({ items });
});

/**
 * DELETE /admin/system/settings/:key
 * Delete a setting by key
 */
app.delete('/settings/:key', async (c) => {
  const admin = c.get('admin');
  const key = c.req.param('key');
  
  const repo = new SystemSettingsRepository(c.env.DB);
  
  // Check if setting exists
  const existing = await repo.getByKey(key);
  if (!existing) {
    return c.json({ error: 'Setting not found' }, 404);
  }

  await repo.delete(key);

  // Create audit log
  const auditRepo = new AuditLogRepository(c.env.DB);
  await auditRepo.create({
    actor_admin_id: admin.id,
    action_type: 'delete_system_setting',
    entity_type: 'system_settings',
    entity_id: key,
    payload: { key },
    ip_address: c.req.header('cf-connecting-ip') || undefined,
    user_agent: c.req.header('user-agent') || undefined,
  });

  return c.json({ success: true });
});

/**
 * GET /admin/system/settings/prefix/:prefix
 * Get settings by key prefix (e.g., "email.*")
 */
app.get('/settings/prefix/:prefix', async (c) => {
  const prefix = c.req.param('prefix');
  const repo = new SystemSettingsRepository(c.env.DB);
  const items = await repo.getByPrefix(prefix);

  return c.json({ items });
});

export default app;
