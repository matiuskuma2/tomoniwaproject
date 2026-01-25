/**
 * Threads Router Index - Phase 2-1
 * 
 * 集約ルータ: threads.ts から分割した各サブルートをマウントする
 * 
 * Phase 2 分割計画:
 * - PR 2-2: list.ts (GET /, GET /:id)
 * - PR 2-3: create.ts (POST /)
 * - PR 2-4: proposals.ts (POST /:id/proposals/prepare, POST /:id/slots)
 * - PR 2-5: invites.ts (POST /:id/invites/batch, POST /:id/invites/prepare)
 * - PR 2-6: actions.ts (POST /:id/remind, POST /prepare-send, GET /:id/reschedule/info)
 * - PR 2-7: threads.ts を集約のみに
 * 
 * Note: このファイルは現時点では "箱だけ"
 * 各PRで順次サブルートをマウントしていく
 */

import { Hono } from 'hono';
import type { Env } from '../../../../../packages/shared/src/types/env';

// Phase 2-2: list.ts (GET /, GET /:id)
import listRoutes from './list';
// Phase 2-3: create.ts (POST /)
import createRoutes from './create';
// Phase 2-4: proposals.ts (POST /:id/proposals/prepare, POST /:id/slots)
import proposalsRoutes from './proposals';
// Phase 2-5: invites.ts (POST /:id/invites/batch, POST /:id/invites/prepare)
import invitesRoutes from './invites';

// 共通の Variables 型定義（threads.ts と同一）
export type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

// 集約ルータ
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Phase 2-2 以降で順次マウント
// ============================================================

// PR 2-2: list.ts (GET /, GET /:id) ✅
app.route('/', listRoutes);

// PR 2-3: create.ts (POST /) ✅
app.route('/', createRoutes);

// PR 2-4: proposals.ts (POST /:id/proposals/prepare, POST /:id/slots) ✅
app.route('/', proposalsRoutes);

// PR 2-5: invites.ts (POST /:id/invites/batch, POST /:id/invites/prepare) ✅
app.route('/', invitesRoutes);

// PR 2-6: actions.ts をマウント予定
// app.route('/', actionsRoutes);

export default app;
