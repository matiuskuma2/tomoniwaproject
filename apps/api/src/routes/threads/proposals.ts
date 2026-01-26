/**
 * Thread Proposals/Slots Routes (Phase 2-4)
 * 
 * POST /:id/proposals/prepare - Prepare additional proposals (creates pending_action)
 * POST /:id/slots - Add scheduling slots to thread
 * 
 * Moved from threads.ts (no logic changes)
 */

import { Hono } from 'hono';
import { getUserIdFromContext } from '../../middleware/auth';
import type { Env } from '../../../../../packages/shared/src/types/env';
import { getTenant } from '../../utils/workspaceContext';
import { formatDateTime } from '../../utils/datetime';
import {
  PendingActionsRepository,
  generateConfirmToken,
  generateExpiresAt,
  type PendingActionPayload,
  type PendingActionSummary,
} from '../../repositories/pendingActionsRepository';
import {
  composeAdditionalSlotsEmailModel,
  modelToPreview,
} from '../../utils/emailModel';
import { createLogger } from '../../utils/logger';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /threads/:id/proposals/prepare
 * Phase2: 追加候補の準備（pending_action 作成）
 * 
 * 安全装置:
 *   1. collecting (status = 'sent') のみ実行可
 *   2. 最大2回まで (additional_propose_count < 2)
 *   3. 既存回答は消さない（スロット追加のみ）
 *   4. 重複候補は除外（同一 start_at/end_at）
 * 
 * @route POST /threads/:id/proposals/prepare
 * @body slots: Array<{ start_at: string, end_at: string, label?: string }>
 * @returns { confirm_token, expires_at, summary, message_for_chat }
 */
app.post('/:id/proposals/prepare', async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'Threads/proposals', handler: 'proposals/prepare', requestId });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    // ====== (1) スレッド取得 & 権限チェック ======
    const thread = await env.DB.prepare(`
      SELECT 
        id, 
        organizer_user_id, 
        title, 
        status,
        COALESCE(proposal_version, 1) as proposal_version,
        COALESCE(additional_propose_count, 0) as additional_propose_count
      FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{
      id: string;
      organizer_user_id: string;
      title: string;
      status: string;
      proposal_version: number;
      additional_propose_count: number;
    }>();

    if (!thread) {
      return c.json({ 
        error: 'not_found',
        message: 'スレッドが見つかりません',
        request_id: requestId 
      }, 404);
    }

    // ====== (2) 安全装置: collecting のみ ======
    if (thread.status !== 'sent') {
      const statusMessages: Record<string, string> = {
        draft: '下書き状態では追加候補を出せません。まず招待を送信してください。',
        confirmed: '確定済みのスレッドには追加候補を出せません。',
        cancelled: 'キャンセル済みのスレッドには追加候補を出せません。',
      };
      return c.json({
        error: 'invalid_status',
        message: statusMessages[thread.status] || '追加候補を出せない状態です。',
        current_status: thread.status,
        request_id: requestId,
      }, 400);
    }

    // ====== (3) 安全装置: 最大2回まで ======
    if (thread.additional_propose_count >= 2) {
      return c.json({
        error: 'max_proposals_reached',
        message: '追加候補は最大2回までです。新しいスレッドを作成してください。',
        additional_propose_count: thread.additional_propose_count,
        request_id: requestId,
      }, 400);
    }

    // ====== (4) リクエストボディ検証 ======
    const body = await c.req.json<{
      slots: Array<{ start_at: string; end_at: string; label?: string }>;
    }>();

    if (!body.slots || !Array.isArray(body.slots) || body.slots.length === 0) {
      return c.json({ 
        error: 'missing_slots',
        message: '追加する候補日時を指定してください',
        request_id: requestId 
      }, 400);
    }

    if (body.slots.length > 10) {
      return c.json({
        error: 'too_many_slots',
        message: '一度に追加できる候補は10件までです',
        request_id: requestId,
      }, 400);
    }

    // ====== (5) 既存スロットとの重複チェック ======
    const existingSlots = await env.DB.prepare(`
      SELECT start_at, end_at FROM scheduling_slots WHERE thread_id = ?
    `).bind(threadId).all<{ start_at: string; end_at: string }>();

    const existingSet = new Set(
      (existingSlots.results || []).map((s) => `${s.start_at}|${s.end_at}`)
    );

    const newSlots = body.slots.filter((s) => !existingSet.has(`${s.start_at}|${s.end_at}`));
    const duplicateCount = body.slots.length - newSlots.length;

    if (newSlots.length === 0) {
      return c.json({
        error: 'all_duplicates',
        message: '全ての候補が既存の候補と重複しています。',
        duplicate_count: duplicateCount,
        request_id: requestId,
      }, 400);
    }

    // ====== (6) 次の proposal_version を計算 ======
    const nextVersion = thread.proposal_version + 1;

    // ====== (7) pending_action 作成 ======
    interface AddSlotsPayload extends PendingActionPayload {
      action_type: 'add_slots';
      slots: Array<{ start_at: string; end_at: string; label?: string }>;
      next_proposal_version: number;
    }

    const payload: AddSlotsPayload = {
      source_type: 'emails', // ダミー（スロット追加では使用しない）
      action_type: 'add_slots',
      slots: newSlots,
      next_proposal_version: nextVersion,
    };

    const summary: PendingActionSummary = {
      total_count: body.slots.length,
      valid_count: newSlots.length,
      preview: newSlots.slice(0, 5).map((s) => ({
        email: s.label || formatDateTime(s.start_at),
        is_app_user: false,
      })),
      preview_count: Math.min(newSlots.length, 5),
      skipped: {
        invalid_email: 0,
        duplicate_input: duplicateCount,
        missing_email: 0,
        already_invited: 0,
      },
      app_users_count: 0,
      external_count: 0,
    };

    const pendingRepo = new PendingActionsRepository(env.DB);
    const pendingId = crypto.randomUUID();
    const confirmToken = generateConfirmToken();
    const expiresAt = generateExpiresAt(15);

    // pending_actions テーブルに直接 INSERT（action_type は文字列として保存）
    await env.DB.prepare(`
      INSERT INTO pending_actions (
        id, workspace_id, owner_user_id, thread_id,
        action_type, source_type,
        payload_json, summary_json,
        confirm_token, status, expires_at,
        request_id, created_at
      ) VALUES (?, ?, ?, ?, 'add_slots', 'emails', ?, ?, ?, 'pending', ?, ?, datetime('now'))
    `).bind(
      pendingId,
      workspaceId,
      ownerUserId,
      threadId,
      JSON.stringify(payload),
      JSON.stringify(summary),
      confirmToken,
      expiresAt,
      requestId
    ).run();

    // ====== (8) レスポンス ======
    // ⚠️ toLocaleString の直書き禁止 → datetime.ts の関数を使用
    const slotLabels = newSlots.slice(0, 3).map((s) => 
      s.label || formatDateTime(s.start_at)
    );
    const allSlotLabels = newSlots.map((s) => 
      s.label || formatDateTime(s.start_at)
    );

    // P3-INV1 共通ソース化: メールモデル → プレビュー
    const emailModel = composeAdditionalSlotsEmailModel({
      threadTitle: thread.title,
      slotCount: newSlots.length,
      slotLabels: allSlotLabels,
    });
    const emailPreview = modelToPreview(emailModel);

    return c.json({
      request_id: requestId,
      confirm_token: confirmToken,
      expires_at: expiresAt,
      expires_in_seconds: 15 * 60,
      thread_id: threadId,
      thread_title: thread.title,
      next_proposal_version: nextVersion,
      summary: {
        total_slots: body.slots.length,
        new_slots: newSlots.length,
        duplicate_slots: duplicateCount,
        preview_labels: slotLabels,
      },
      remaining_proposals: 2 - thread.additional_propose_count - 1,
      default_decision: 'add',
      email_preview: emailPreview,  // P3-INV1 B案: 骨格ブロック
      message_for_chat: `「${thread.title}」に${newSlots.length}件の追加候補を出します。\n候補: ${slotLabels.join('、')}${newSlots.length > 3 ? ` 他${newSlots.length - 3}件` : ''}\n\n次に「追加」または「キャンセル」を入力してください。\n（残り追加回数: ${2 - thread.additional_propose_count - 1}回）`,
    });

  } catch (error) {
    log.error('proposals/prepare error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({
      error: 'internal_error',
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId,
    }, 500);
  }
});

/**
 * POST /threads/:id/slots
 * Add new scheduling slots to an existing thread
 * 
 * @route POST /threads/:id/slots
 * @body slots: Array<{ start_at: string, end_at: string, label?: string }>
 * @returns { success: true, slots_added: number, slot_ids: string[] }
 */
app.post('/:id/slots', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Threads/proposals', handler: 'slots' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    // Verify thread exists and user has access
    const thread = await env.DB.prepare(`
      SELECT id, organizer_user_id, status FROM scheduling_threads
      WHERE id = ? AND workspace_id = ? AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first<{ id: string; organizer_user_id: string; status: string }>();

    if (!thread) {
      return c.json({ error: 'Thread not found or access denied' }, 404);
    }

    // Parse request body
    const body = await c.req.json<{ 
      slots: Array<{ start_at: string; end_at: string; label?: string }> 
    }>();

    if (!body.slots || !Array.isArray(body.slots) || body.slots.length === 0) {
      return c.json({ error: 'Missing or invalid field: slots' }, 400);
    }

    if (body.slots.length > 10) {
      return c.json({ error: 'Maximum 10 slots allowed per request' }, 400);
    }

    const slotIds: string[] = [];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

    for (const slot of body.slots) {
      if (!slot.start_at || !slot.end_at) {
        return c.json({ error: 'Each slot must have start_at and end_at' }, 400);
      }

      const slotId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        slotId,
        threadId,
        slot.start_at,
        slot.end_at,
        timezone,
        slot.label || null
      ).run();

      slotIds.push(slotId);
    }

    log.debug('Added slots', { count: slotIds.length, threadId });

    return c.json({
      success: true,
      slots_added: slotIds.length,
      slot_ids: slotIds,
    });
  } catch (error) {
    log.error('Error adding slots', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      { error: 'Failed to add slots', details: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

export default app;
