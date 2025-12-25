/**
 * Admin AI Cost Center Routes
 * Manages AI provider settings, keys, budgets, and usage analytics
 * super_admin for write operations, admin can GET
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { adminAuth, requireRole } from '../middleware/adminAuth';
import { AIProviderSettingsRepository } from '../repositories/aiProviderSettingsRepo';
import { AuditLogRepository } from '../repositories/auditLogRepo';

const app = new Hono<{ Bindings: Env }>();

// All routes require admin authentication
app.use('*', adminAuth);

// ============================================================
// AI Provider Settings
// ============================================================

/**
 * GET /admin/ai/providers
 * Get all AI provider settings
 * Access: admin (read), super_admin (read)
 */
app.get('/providers', async (c) => {
  const repo = new AIProviderSettingsRepository(c.env.DB);
  const items = await repo.getAll();

  return c.json({ items });
});

/**
 * GET /admin/ai/providers/:provider
 * Get specific provider settings
 * Access: admin (read), super_admin (read)
 */
app.get('/providers/:provider', async (c) => {
  const provider = c.req.param('provider') as 'gemini' | 'openai';
  
  if (provider !== 'gemini' && provider !== 'openai') {
    return c.json({ error: 'Invalid provider: must be gemini or openai' }, 400);
  }

  const repo = new AIProviderSettingsRepository(c.env.DB);
  const settings = await repo.getByProvider(provider);

  if (!settings) {
    return c.json({ error: 'Provider settings not found' }, 404);
  }

  return c.json(settings);
});

/**
 * PUT /admin/ai/providers
 * Update AI provider settings (batch upsert)
 * Access: super_admin only
 */
app.put('/providers', requireRole('super_admin'), async (c) => {
  const admin = c.get('admin');
  const body = await c.req.json();
  
  // Validate request body
  if (!body.items || !Array.isArray(body.items)) {
    return c.json({ error: 'Invalid request body: items array required' }, 400);
  }

  // Validate each item
  for (const item of body.items) {
    if (!item.provider || (item.provider !== 'gemini' && item.provider !== 'openai')) {
      return c.json({ error: 'Invalid provider: must be gemini or openai' }, 400);
    }
    if (typeof item.is_enabled !== 'boolean') {
      return c.json({ error: 'Invalid is_enabled: must be boolean' }, 400);
    }
    if (!item.default_model || typeof item.default_model !== 'string') {
      return c.json({ error: 'Invalid default_model: must be non-empty string' }, 400);
    }
    if (item.fallback_provider && item.fallback_provider !== 'gemini' && item.fallback_provider !== 'openai') {
      return c.json({ error: 'Invalid fallback_provider: must be gemini or openai' }, 400);
    }
    if (item.feature_routing_json && typeof item.feature_routing_json !== 'object') {
      return c.json({ error: 'Invalid feature_routing_json: must be object' }, 400);
    }
  }

  // Upsert settings
  const repo = new AIProviderSettingsRepository(c.env.DB);
  const items = await repo.upsertMany(body.items);

  // Create audit log
  const auditRepo = new AuditLogRepository(c.env.DB);
  await auditRepo.create({
    actor_admin_id: admin.id,
    action_type: 'update_ai_provider_settings',
    entity_type: 'ai_provider_settings',
    payload: {
      updated_providers: body.items.map((item: any) => item.provider),
      count: body.items.length,
    },
    ip_address: c.req.header('cf-connecting-ip') || undefined,
    user_agent: c.req.header('user-agent') || undefined,
  });

  return c.json({ items });
});

/**
 * POST /admin/ai/providers/:provider/enable
 * Enable or disable a provider
 * Access: super_admin only
 */
app.post('/providers/:provider/enable', requireRole('super_admin'), async (c) => {
  const admin = c.get('admin');
  const provider = c.req.param('provider') as 'gemini' | 'openai';
  const body = await c.req.json();
  
  if (provider !== 'gemini' && provider !== 'openai') {
    return c.json({ error: 'Invalid provider: must be gemini or openai' }, 400);
  }

  if (typeof body.is_enabled !== 'boolean') {
    return c.json({ error: 'Invalid is_enabled: must be boolean' }, 400);
  }

  const repo = new AIProviderSettingsRepository(c.env.DB);
  const existing = await repo.getByProvider(provider);

  if (!existing) {
    return c.json({ error: 'Provider settings not found' }, 404);
  }

  // Update is_enabled only
  await repo.upsertMany([{
    provider,
    is_enabled: body.is_enabled,
    default_model: existing.default_model,
    fallback_provider: existing.fallback_provider,
    fallback_model: existing.fallback_model,
    feature_routing_json: existing.feature_routing_json,
  }]);

  // Create audit log
  const auditRepo = new AuditLogRepository(c.env.DB);
  await auditRepo.create({
    actor_admin_id: admin.id,
    action_type: body.is_enabled ? 'enable_ai_provider' : 'disable_ai_provider',
    entity_type: 'ai_provider_settings',
    entity_id: provider,
    payload: { provider, is_enabled: body.is_enabled },
    ip_address: c.req.header('cf-connecting-ip') || undefined,
    user_agent: c.req.header('user-agent') || undefined,
  });

  return c.json({ success: true, provider, is_enabled: body.is_enabled });
});

// ============================================================
// Placeholder routes (to be implemented in future tickets)
// ============================================================

// AI Provider Keys
app.get('/keys', async (c) => {
  return c.json({ message: 'To be implemented: AI Provider Keys' }, 501);
});

app.post('/keys', requireRole('super_admin'), async (c) => {
  return c.json({ message: 'To be implemented: Create AI Provider Key' }, 501);
});

// AI Budgets
app.get('/budgets', async (c) => {
  return c.json({ message: 'To be implemented: AI Budgets' }, 501);
});

app.post('/budgets', requireRole('super_admin'), async (c) => {
  return c.json({ message: 'To be implemented: Create AI Budget' }, 501);
});

// AI Usage Summary
app.get('/usage/summary', async (c) => {
  return c.json({ message: 'To be implemented: AI Usage Summary' }, 501);
});

// AI Usage Logs
app.get('/usage/logs', async (c) => {
  return c.json({ message: 'To be implemented: AI Usage Logs' }, 501);
});

export default app;
