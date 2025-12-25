/**
 * Voice Command API Routes (Ticket 08)
 * 
 * /voice/execute: Execute voice commands
 * Actions: create, modify, undo work items
 */

import { Hono } from 'hono';
import { IntentParserService } from '../services/intentParser';
import { WorkItemsRepository } from '../repositories/workItemsRepository';
import { rateLimitPresets } from '../middleware/rateLimit';
import type { Env } from '../../../../packages/shared/src/types/env';

const app = new Hono<{ Bindings: Env }>();

/**
 * Execute voice command
 * 
 * @route POST /voice/execute
 * @body { text: string }
 * @ratelimit 20 per minute by user
 */
app.post(
  '/execute',
  rateLimitPresets.voiceExecuteByUser(),
  async (c) => {
    const { env } = c;

    // TODO: Get user_id from auth context
    const userId = c.req.header('x-user-id') || 'test-user-id';

    try {
      const body = await c.req.json();
      const { text } = body;

      if (!text || typeof text !== 'string') {
        return c.json({ error: 'Missing or invalid field: text' }, 400);
      }

      // Parse intent with LLM (Gemini優先 → OpenAI → Pattern)
      const roomId = c.req.header('x-room-id'); // Optional for room context
      const parser = new IntentParserService(
        env.OPENAI_API_KEY || '',
        env.GEMINI_API_KEY || '',
        env.DB
      );
      const intent = await parser.parse(text, userId, roomId);

      console.log('[Voice] Parsed intent:', JSON.stringify(intent, null, 2));

      // Execute action based on intent
      const repo = new WorkItemsRepository(env.DB);
      let result;

      switch (intent.intent) {
        case 'create':
          result = await handleCreate(repo, userId, intent);
          break;

        case 'modify':
          result = await handleModify(repo, userId, intent);
          break;

        case 'undo':
          result = await handleUndo(repo, userId);
          break;

        case 'query':
          result = await handleQuery(repo, userId, intent);
          break;

        default:
          return c.json({
            intent: intent.intent,
            message: 'Sorry, I could not understand your command.',
            confidence: intent.confidence,
            raw_text: intent.raw_text,
          });
      }

      return c.json({
        intent: intent.intent,
        share_intent: intent.share_intent, // Add share_intent to response
        result,
        confidence: intent.confidence,
        raw_text: intent.raw_text,
      });
    } catch (error) {
      console.error('[Voice] Error executing command:', error);
      return c.json(
        {
          error: 'Failed to execute voice command',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      );
    }
  }
);

/**
 * Handle create intent
 */
async function handleCreate(
  repo: WorkItemsRepository,
  userId: string,
  intent: any
): Promise<any> {
  const { type, title, start_at, end_at, location } = intent.entities;

  if (!title) {
    throw new Error('Could not extract title from command');
  }

  const workItem = await repo.create({
    user_id: userId,
    type: type || 'task',
    title,
    start_at,
    end_at,
    location,
    visibility_scope: 'private', // Default to private for voice commands
    source: 'auto_generated',
  });

  return {
    action: 'created',
    work_item: workItem,
    message: `Created ${type || 'task'}: ${title}`,
  };
}

/**
 * Handle modify intent
 */
async function handleModify(
  repo: WorkItemsRepository,
  userId: string,
  intent: any
): Promise<any> {
  const { status, target_id } = intent.entities;

  // If no target_id, modify the most recent item
  let workItemId = target_id;
  
  if (!workItemId) {
    const recentItems = await repo.listByUser(userId, { limit: 1 });
    if (recentItems.length === 0) {
      throw new Error('No recent work items to modify');
    }
    workItemId = recentItems[0].id;
  }

  // Check permission
  const canModify = await repo.canModify(workItemId, userId);
  if (!canModify) {
    throw new Error('Permission denied: cannot modify this work item');
  }

  const updated = await repo.update(workItemId, { status });

  return {
    action: 'modified',
    work_item: updated,
    message: `Updated status to ${status}`,
  };
}

/**
 * Handle undo intent
 */
async function handleUndo(
  repo: WorkItemsRepository,
  userId: string
): Promise<any> {
  // Get most recent item
  const recentItems = await repo.listByUser(userId, { limit: 1 });
  
  if (recentItems.length === 0) {
    throw new Error('No recent work items to undo');
  }

  const workItemId = recentItems[0].id;

  // Check permission
  const canModify = await repo.canModify(workItemId, userId);
  if (!canModify) {
    throw new Error('Permission denied: cannot undo this work item');
  }

  await repo.delete(workItemId);

  return {
    action: 'deleted',
    work_item_id: workItemId,
    message: 'Undid last action',
  };
}

/**
 * Handle query intent
 */
async function handleQuery(
  repo: WorkItemsRepository,
  userId: string,
  intent: any
): Promise<any> {
  const items = await repo.listByUser(userId, { 
    status: 'pending',
    limit: 10,
  });

  return {
    action: 'query',
    items,
    count: items.length,
    message: `Found ${items.length} pending items`,
  };
}

export default app;
