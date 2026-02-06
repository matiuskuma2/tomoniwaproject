/**
 * People API Routes
 * 
 * People Hub のSSOT統合API
 * 
 * Endpoints:
 * - GET /api/people - 統合People一覧（READ ONLY）
 * - GET /api/people/:id - Person詳細取得
 * - GET /api/people/audit - 監査サマリー
 * 
 * 設計原則:
 * - READ ONLY: 登録はチャット経由、UIは監査・検索・修正に限定
 * - SSOT: contacts + relationships + list_members を統合
 * - N+1禁止: バッチクエリで最適化
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import { PeopleRepository, type ConnectionStatus } from '../repositories/peopleRepository';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/people
 * 統合People一覧
 * 
 * Query Parameters:
 * - q: 検索クエリ（名前/メール）
 * - connection_status: workmate | family | external | pending | blocked
 * - list_id: リストID（リスト所属でフィルタ）
 * - has_email: true | false（メール有無でフィルタ）
 * - limit: 取得件数（default: 50, max: 100）
 * - offset: オフセット（default: 0）
 * 
 * Response:
 * {
 *   items: Person[],
 *   total: number,
 *   limit: number,
 *   offset: number,
 *   missing_email_count: number,
 *   pending_request_count: number,
 * }
 */
app.get('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'People', handler: 'list' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const query = c.req.query();
    const repo = new PeopleRepository(env.DB);

    // Parse query params
    const q = query.q;
    const connectionStatus = query.connection_status as ConnectionStatus | undefined;
    const listId = query.list_id;
    const hasEmail = query.has_email === 'true' ? true : query.has_email === 'false' ? false : undefined;
    const limit = Math.min(parseInt(query.limit || '50', 10), 100);
    const offset = parseInt(query.offset || '0', 10);

    // Validate connection_status
    const validStatuses: ConnectionStatus[] = ['workmate', 'family', 'external', 'pending', 'blocked'];
    if (connectionStatus && !validStatuses.includes(connectionStatus)) {
      return c.json({
        error: 'Invalid connection_status',
        valid_values: validStatuses,
      }, 400);
    }

    const result = await repo.search({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      q,
      connection_status: connectionStatus,
      list_id: listId,
      has_email: hasEmail,
      limit,
      offset,
    });

    return c.json(result);
  } catch (error) {
    log.error('Error searching people', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to search people',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/people/audit
 * 監査サマリー（メール欠損/pending数など）
 * 
 * Response:
 * {
 *   total_people: number,
 *   missing_email_count: number,
 *   pending_request_count: number,
 *   workmate_count: number,
 *   family_count: number,
 *   external_count: number,
 *   blocked_count: number,
 * }
 */
app.get('/audit', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'People', handler: 'audit' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const repo = new PeopleRepository(env.DB);
    const summary = await repo.getAuditSummary(workspaceId, ownerUserId);

    return c.json(summary);
  } catch (error) {
    log.error('Error getting audit summary', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to get audit summary',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/people/:id
 * Person詳細取得
 * 
 * Response:
 * {
 *   person: Person,
 * }
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'People', handler: 'get' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const personId = c.req.param('id');
    const repo = new PeopleRepository(env.DB);

    const person = await repo.getById(personId, workspaceId, ownerUserId);

    if (!person) {
      return c.json({ error: 'Person not found' }, 404);
    }

    return c.json({ person });
  } catch (error) {
    log.error('Error getting person', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to get person',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
