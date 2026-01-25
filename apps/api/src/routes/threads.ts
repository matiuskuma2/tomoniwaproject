/**
 * Threads API Routes - Legacy Router (Phase 2 完了)
 * 
 * ============================================================
 * Phase 2 リファクタリング完了
 * ============================================================
 * 
 * このファイルは Phase 2 で分割完了。全ルートは threads/ ディレクトリに移動済み。
 * 
 * 分割先（Phase 2 完了）:
 * - routes/threads/list.ts: GET /, GET /:id (PR 2-2)
 * - routes/threads/create.ts: POST / (PR 2-3)
 * - routes/threads/proposals.ts: POST /:id/proposals/prepare, POST /:id/slots (PR 2-4)
 * - routes/threads/invites.ts: POST /:id/invites/batch, POST /:id/invites/prepare (PR 2-5)
 * - routes/threads/actions.ts: POST /:id/remind, POST /prepare-send, GET /:id/reschedule/info (PR 2-6)
 * 
 * Phase 2.5b: /i/:token 系は routes/invite.ts に一本化、このファイルから削除
 * 
 * このファイルは後方互換のために残しているが、実質的に空。
 * 将来的にはファイル削除を検討。
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Phase 2 完了: 全ルートは threads/ ディレクトリに移動済み
// 
// - GET /, GET /:id → threads/list.ts
// - POST / → threads/create.ts
// - POST /:id/proposals/prepare, POST /:id/slots → threads/proposals.ts
// - POST /:id/invites/batch, POST /:id/invites/prepare → threads/invites.ts
// - POST /:id/remind, POST /prepare-send, GET /:id/reschedule/info → threads/actions.ts
// 
// Phase 2.5b: /i/:token 系は routes/invite.ts に一本化
// 公開招待URLは /i/:token を使用（このファイルの旧ルートは廃止済み）
// ============================================================

export default app;
