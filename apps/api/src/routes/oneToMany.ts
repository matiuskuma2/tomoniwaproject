/**
 * One-to-Many Scheduling API Routes
 * 
 * G1-PLAN に基づく 1対N（Broadcast Scheduling）エンドポイント
 * 
 * POST /api/one-to-many/prepare   - 1対N スレッド作成準備
 * GET  /api/one-to-many/:id       - スレッド詳細取得
 * GET  /api/one-to-many           - スレッド一覧取得
 * POST /api/one-to-many/:id/send  - 招待送信
 * POST /api/one-to-many/:id/respond - 回答登録
 * GET  /api/one-to-many/:id/summary - 回答集計
 * POST /api/one-to-many/:id/finalize - 手動確定
 * POST /api/one-to-many/:id/repropose - 再提案
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { Hono } from 'hono';
import { OneToManyRepository, type CreateOneToManyParams, type GroupPolicy } from '../repositories/oneToManyRepository';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import { ContactsRepository } from '../repositories/contactsRepository';
import { getUserIdFromContext, type Variables } from '../middleware/auth';
import type { Env } from '../../../../packages/shared/src/types/env';
import { getTenant } from '../utils/workspaceContext';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// デフォルト値
// ============================================================

const DEFAULT_DEADLINE_HOURS = 72; // 3日
const DEFAULT_MAX_REPROPOSALS = 2;
const DEFAULT_FINALIZE_POLICY = 'organizer_decides';

// ============================================================
// POST /api/one-to-many/prepare - 1対N スレッド作成準備
// ============================================================

interface PrepareRequest {
  title: string;
  description?: string;
  mode: 'fixed' | 'candidates' | 'open_slots' | 'range_auto';
  kind?: 'external' | 'internal';
  
  // 成立条件
  deadline_hours?: number;       // デフォルト: 72
  finalize_policy?: 'organizer_decides' | 'quorum' | 'required_people' | 'all_required';
  quorum_count?: number;
  required_contact_ids?: string[];
  auto_finalize?: boolean;
  participant_limit?: number;
  
  // 招待者
  contact_ids?: string[];        // 連絡先 ID リスト
  list_id?: string;              // リスト ID
  emails?: string[];             // 直接メールアドレス
  
  // スロット情報（mode により必要）
  slots?: {
    start_at: string;
    end_at: string;
    label?: string;
  }[];
}

app.post('/prepare', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'prepare' });
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<PrepareRequest>();

    // バリデーション
    if (!body.title?.trim()) {
      return c.json({ error: 'title is required' }, 400);
    }
    if (!body.mode || !['fixed', 'candidates', 'open_slots', 'range_auto'].includes(body.mode)) {
      return c.json({ error: 'mode must be one of: fixed, candidates, open_slots, range_auto' }, 400);
    }

    // 招待者の検証
    const hasInvitees = (body.contact_ids && body.contact_ids.length > 0) ||
                        body.list_id ||
                        (body.emails && body.emails.length > 0);
    if (!hasInvitees) {
      return c.json({ error: 'At least one invitee source is required (contact_ids, list_id, or emails)' }, 400);
    }

    // スロットの検証（fixed, candidates モードでは必須）
    if (['fixed', 'candidates'].includes(body.mode) && (!body.slots || body.slots.length === 0)) {
      return c.json({ error: 'slots are required for fixed/candidates mode' }, 400);
    }

    // 締切計算
    const deadlineHours = body.deadline_hours || DEFAULT_DEADLINE_HOURS;
    const deadlineAt = new Date(Date.now() + deadlineHours * 60 * 60 * 1000).toISOString();

    // テナント情報取得
    const { workspaceId, ownerUserId } = getTenant(c as any);

    // 必須参加者の invitee_key 変換
    let requiredInviteeKeys: string[] = [];
    if (body.required_contact_ids && body.required_contact_ids.length > 0) {
      const contactsRepo = new ContactsRepository(env.DB);
      for (const contactId of body.required_contact_ids) {
        const contact = await contactsRepo.getById(contactId, workspaceId, ownerUserId);
        if (contact) {
          const key = await ContactsRepository.generateInviteeKey(contact);
          if (key) requiredInviteeKeys.push(key);
        }
      }
    }

    // グループポリシー
    const groupPolicy: Omit<GroupPolicy, 'reproposal_count'> = {
      mode: body.mode,
      deadline_at: deadlineAt,
      finalize_policy: body.finalize_policy || DEFAULT_FINALIZE_POLICY,
      auto_finalize: body.auto_finalize ?? false,
      max_reproposals: DEFAULT_MAX_REPROPOSALS,
      ...(body.quorum_count && { quorum_count: body.quorum_count }),
      ...(requiredInviteeKeys.length > 0 && { required_invitee_keys: requiredInviteeKeys }),
      ...(body.participant_limit && { participant_limit: body.participant_limit }),
    };

    // スレッド作成
    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.create({
      organizer_user_id: userId,
      title: body.title.trim(),
      description: body.description?.trim(),
      kind: body.kind || 'external',
      mode: 'group',
      group_policy: groupPolicy,
    });

    // スロット作成
    if (body.slots && body.slots.length > 0) {
      for (const slot of body.slots) {
        const slotId = uuidv4();
        await env.DB.prepare(`
          INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label, created_at)
          VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, datetime('now'))
        `).bind(slotId, thread.id, slot.start_at, slot.end_at, slot.label || null).run();
      }
    }

    // 招待者リスト収集
    const invitees: { email: string; name: string; contact_id?: string }[] = [];
    const contactsRepo = new ContactsRepository(env.DB);

    // contact_ids から
    if (body.contact_ids) {
      for (const contactId of body.contact_ids) {
        const contact = await contactsRepo.getById(contactId, workspaceId, ownerUserId);
        if (contact?.email) {
          invitees.push({
            email: contact.email,
            name: contact.display_name || contact.email.split('@')[0],
            contact_id: contact.id,
          });
        }
      }
    }

    // list_id から
    if (body.list_id) {
      const { results: members } = await env.DB.prepare(`
        SELECT lm.*, c.email, c.display_name 
        FROM list_members lm
        JOIN contacts c ON c.id = lm.contact_id
        WHERE lm.list_id = ? AND c.email IS NOT NULL
      `).bind(body.list_id).all<any>();

      for (const member of members || []) {
        if (member.email && !invitees.some(i => i.email === member.email)) {
          invitees.push({
            email: member.email,
            name: member.display_name,
            contact_id: member.contact_id,
          });
        }
      }
    }

    // emails から
    if (body.emails) {
      for (const email of body.emails) {
        const normalizedEmail = email.trim().toLowerCase();
        if (normalizedEmail && !invitees.some(i => i.email === normalizedEmail)) {
          invitees.push({
            email: normalizedEmail,
            name: normalizedEmail.split('@')[0],
          });
        }
      }
    }

    // 参加者上限チェック
    if (groupPolicy.participant_limit && invitees.length > groupPolicy.participant_limit) {
      return c.json({
        error: `Participant limit exceeded: ${invitees.length} > ${groupPolicy.participant_limit}`,
        max_allowed: groupPolicy.participant_limit,
        actual: invitees.length,
      }, 400);
    }

    log.info('One-to-many thread prepared', {
      threadId: thread.id,
      mode: body.mode,
      inviteesCount: invitees.length,
    });

    return c.json({
      success: true,
      thread: {
        id: thread.id,
        title: thread.title,
        status: thread.status,
        mode: body.mode,
        topology: thread.topology,
      },
      group_policy: groupPolicy,
      invitees: invitees.map(i => ({
        email: i.email,
        name: i.name,
        contact_id: i.contact_id,
      })),
      invitees_count: invitees.length,
      slots: body.slots || [],
      next_action: 'Call POST /api/one-to-many/:id/send to send invitations',
    });
  } catch (error) {
    log.error('Error in /prepare', error);
    return c.json({
      error: 'Failed to prepare one-to-many thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// GET /api/one-to-many/:id - スレッド詳細取得
// ============================================================

app.get('/:id', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'getById' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(threadId);

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // スロット取得
    const { results: slots } = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE thread_id = ? ORDER BY start_at ASC
    `).bind(threadId).all();

    // 招待者取得
    const { results: invites } = await env.DB.prepare(`
      SELECT * FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all();

    // 回答集計
    const summary = await oneToManyRepo.getResponseSummary(threadId);

    // 成立条件チェック
    const finalizationCheck = await oneToManyRepo.checkFinalizationCondition(threadId);

    const groupPolicy = thread.group_policy_json ? JSON.parse(thread.group_policy_json) : null;

    return c.json({
      thread: {
        id: thread.id,
        title: thread.title,
        description: thread.description,
        status: thread.status,
        mode: groupPolicy?.mode,
        kind: thread.kind,
        topology: thread.topology,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
      },
      group_policy: groupPolicy,
      slots: slots || [],
      invites: invites || [],
      summary,
      finalization: finalizationCheck,
    });
  } catch (error) {
    log.error('Error in /:id', { threadId, error });
    return c.json({
      error: 'Failed to get thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// GET /api/one-to-many - スレッド一覧取得
// ============================================================

app.get('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'list' });
  const userId = await getUserIdFromContext(c as any);

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const oneToManyRepo = new OneToManyRepository(env.DB);
    const { threads, total } = await oneToManyRepo.listByOrganizer(userId, {
      status,
      limit,
      offset,
    });

    return c.json({
      threads: threads.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        mode: t.group_policy_json ? JSON.parse(t.group_policy_json).mode : null,
        kind: t.kind,
        topology: t.topology,
        created_at: t.created_at,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    log.error('Error in list', error);
    return c.json({
      error: 'Failed to list threads',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /api/one-to-many/:id/send - 招待送信
// ============================================================

interface SendRequest {
  invitees?: { email: string; name: string; contact_id?: string }[];
  channel_type?: 'email' | 'slack' | 'chatwork';
}

app.post('/:id/send', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'send' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<SendRequest>().catch(() => ({} as SendRequest));

    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(threadId);

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (thread.status !== 'draft') {
      return c.json({ error: 'Thread is not in draft status' }, 400);
    }

    // 招待者が指定されていない場合、prepare 時の情報を使う（TODO: 保存しておく必要あり）
    // 現状は body.invitees が必須
    if (!body.invitees || body.invitees.length === 0) {
      return c.json({ error: 'invitees array is required' }, 400);
    }

    const threadsRepo = new ThreadsRepository(env.DB);
    const channelType = body.channel_type || 'email';

    let sentCount = 0;
    const sentInvites: any[] = [];

    for (const invitee of body.invitees) {
      try {
        // 招待作成
        const invite = await threadsRepo.createInvite({
          thread_id: threadId,
          email: invitee.email,
          candidate_name: invitee.name,
          expires_in_hours: 72 * 3, // 9日（締切 + バッファ）
        });

        // チャネル情報を記録
        await env.DB.prepare(`
          UPDATE thread_invites SET channel_type = ?, channel_value = ? WHERE id = ?
        `).bind(channelType, invitee.email, invite?.id).run();

        // メール送信キュー
        if (channelType === 'email' && env.EMAIL_QUEUE) {
          await env.EMAIL_QUEUE.send({
            job_id: `1n-invite-${invite?.id}-${Date.now()}`,
            type: 'group_invite',
            to: invitee.email,
            subject: `招待: ${thread.title}`,
            created_at: Date.now(),
            data: {
              token: invite?.token,
              inviter_name: 'Tomoniwao',
              thread_title: thread.title,
            },
          });
        }

        sentCount++;
        sentInvites.push(invite);
      } catch (err) {
        log.error('Failed to send invite', { email: invitee.email, error: err });
      }
    }

    // ステータスを sent に更新
    await oneToManyRepo.updateStatus(threadId, 'sent');

    log.info('Invitations sent', { threadId, sentCount, total: body.invitees.length });

    return c.json({
      success: true,
      thread_id: threadId,
      sent_count: sentCount,
      total: body.invitees.length,
      channel: channelType,
      status: 'sent',
    });
  } catch (error) {
    log.error('Error in /send', { threadId, error });
    return c.json({
      error: 'Failed to send invitations',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /api/one-to-many/:id/respond - 回答登録
// ============================================================

interface RespondRequest {
  invitee_key?: string;  // 内部ユーザーの場合は不要
  response: 'ok' | 'no' | 'maybe';
  selected_slot_id?: string;
  comment?: string;
}

app.post('/:id/respond', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'respond' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  try {
    const body = await c.req.json<RespondRequest>();

    if (!body.response || !['ok', 'no', 'maybe'].includes(body.response)) {
      return c.json({ error: 'response must be one of: ok, no, maybe' }, 400);
    }

    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(threadId);

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    // invitee_key の決定
    let inviteeKey = body.invitee_key;
    if (!inviteeKey && userId) {
      // ログインユーザーの場合
      inviteeKey = `u:${userId}`;
    }
    if (!inviteeKey) {
      return c.json({ error: 'invitee_key is required for anonymous users' }, 400);
    }

    // 回答登録
    const response = await oneToManyRepo.addResponse({
      thread_id: threadId,
      invitee_key: inviteeKey,
      response: body.response,
      selected_slot_id: body.selected_slot_id,
      comment: body.comment,
    });

    // 成立条件チェック
    const finalizationCheck = await oneToManyRepo.checkFinalizationCondition(threadId);

    // 自動確定チェック
    const groupPolicy: GroupPolicy | null = thread.group_policy_json 
      ? JSON.parse(thread.group_policy_json) 
      : null;

    if (groupPolicy?.auto_finalize && finalizationCheck.met && finalizationCheck.recommended_slot_id) {
      // 自動確定処理（TODO: 実装）
      log.info('Auto-finalize triggered', { threadId, slotId: finalizationCheck.recommended_slot_id });
    }

    // 主催者に通知
    const inboxRepo = new InboxRepository(env.DB);
    await inboxRepo.create({
      user_id: thread.organizer_user_id,
      type: 'group_response',
      title: `回答: ${thread.title}`,
      message: `${inviteeKey} が ${body.response === 'ok' ? '参加可能' : body.response === 'no' ? '参加不可' : '未定'} と回答しました`,
      action_type: 'view_thread',
      action_target_id: threadId,
      action_url: `/threads/${threadId}`,
      priority: 'normal',
    });

    log.info('Response recorded', { threadId, inviteeKey, response: body.response });

    return c.json({
      success: true,
      response,
      finalization: finalizationCheck,
    });
  } catch (error) {
    log.error('Error in /respond', { threadId, error });
    return c.json({
      error: 'Failed to record response',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// GET /api/one-to-many/:id/summary - 回答集計
// ============================================================

app.get('/:id/summary', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'summary' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(threadId);

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    const summary = await oneToManyRepo.getResponseSummary(threadId);
    const finalizationCheck = await oneToManyRepo.checkFinalizationCondition(threadId);

    return c.json({
      thread_id: threadId,
      summary,
      finalization: finalizationCheck,
    });
  } catch (error) {
    log.error('Error in /summary', { threadId, error });
    return c.json({
      error: 'Failed to get summary',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /api/one-to-many/:id/finalize - 手動確定
// ============================================================

interface FinalizeRequest {
  selected_slot_id: string;
  reason?: string;
}

app.post('/:id/finalize', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'finalize' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<FinalizeRequest>();

    if (!body.selected_slot_id) {
      return c.json({ error: 'selected_slot_id is required' }, 400);
    }

    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(threadId);

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (thread.status === 'confirmed') {
      return c.json({ error: 'Thread is already finalized' }, 400);
    }

    // スロット存在確認
    const slot = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE slot_id = ? AND thread_id = ?
    `).bind(body.selected_slot_id, threadId).first<any>();

    if (!slot) {
      return c.json({ error: 'Invalid slot_id' }, 400);
    }

    // 確定記録
    await env.DB.prepare(`
      INSERT OR REPLACE INTO thread_finalize (thread_id, final_slot_id, finalize_policy, finalized_by_user_id, finalized_at, created_at, updated_at)
      VALUES (?, ?, 'ORGANIZER_DECIDES', ?, datetime('now'), datetime('now'), datetime('now'))
    `).bind(threadId, body.selected_slot_id, userId).run();

    // ステータス更新
    await oneToManyRepo.updateStatus(threadId, 'confirmed');

    // 参加者に通知
    const { results: invites } = await env.DB.prepare(`
      SELECT * FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all();

    const inboxRepo = new InboxRepository(env.DB);

    for (const invite of invites as any[]) {
      // メール送信
      if (env.EMAIL_QUEUE) {
        await env.EMAIL_QUEUE.send({
          job_id: `1n-finalized-${invite.id}-${Date.now()}`,
          type: 'group_finalized',
          to: invite.email,
          subject: `確定: ${thread.title}`,
          created_at: Date.now(),
          data: {
            thread_title: thread.title,
            slot_start: slot.start_time,
            slot_end: slot.end_time,
          },
        });
      }

      // 内部ユーザーには inbox 通知
      if (invite.invitee_key?.startsWith('u:')) {
        const targetUserId = invite.invitee_key.replace('u:', '');
        await inboxRepo.create({
          user_id: targetUserId,
          type: 'group_finalized',
          title: `確定: ${thread.title}`,
          message: `${thread.title} が確定しました`,
          action_type: 'view_thread',
          action_target_id: threadId,
          action_url: `/threads/${threadId}`,
          priority: 'high',
        });
      }
    }

    log.info('Thread finalized', { threadId, slotId: body.selected_slot_id });

    return c.json({
      success: true,
      thread_id: threadId,
      status: 'confirmed',
      selected_slot: {
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
      },
    });
  } catch (error) {
    log.error('Error in /finalize', { threadId, error });
    return c.json({
      error: 'Failed to finalize thread',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /api/one-to-many/:id/repropose - 再提案
// ============================================================

interface ReproposeRequest {
  new_slots: {
    start_at: string;
    end_at: string;
    label?: string;
  }[];
  new_deadline_hours?: number;
  message?: string;
}

app.post('/:id/repropose', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OneToMany', handler: 'repropose' });
  const userId = await getUserIdFromContext(c as any);
  const threadId = c.req.param('id');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<ReproposeRequest>();

    if (!body.new_slots || body.new_slots.length === 0) {
      return c.json({ error: 'new_slots array is required' }, 400);
    }

    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(threadId);

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    if (thread.organizer_user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (thread.status === 'confirmed') {
      return c.json({ error: 'Cannot repropose confirmed thread' }, 400);
    }

    // 再提案カウント増加
    const reproposalResult = await oneToManyRepo.incrementReproposalCount(threadId);
    if (!reproposalResult.success) {
      return c.json({
        error: `Maximum reproposals reached: ${reproposalResult.current}/${reproposalResult.max}`,
        max_reproposals: reproposalResult.max,
        current_count: reproposalResult.current,
      }, 400);
    }

    // 古いスロットを削除
    await env.DB.prepare(`DELETE FROM scheduling_slots WHERE thread_id = ?`).bind(threadId).run();

    // 新しいスロットを追加
    for (const slot of body.new_slots) {
      const slotId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label, created_at)
        VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, datetime('now'))
      `).bind(slotId, threadId, slot.start_at, slot.end_at, slot.label || null).run();
    }

    // 新しい締切
    if (body.new_deadline_hours) {
      const newDeadline = new Date(Date.now() + body.new_deadline_hours * 60 * 60 * 1000).toISOString();
      await oneToManyRepo.updateGroupPolicy(threadId, { deadline_at: newDeadline });
    }

    // 既存の回答をリセット
    await env.DB.prepare(`DELETE FROM thread_responses WHERE thread_id = ?`).bind(threadId).run();

    // 参加者に再提案通知
    const { results: invites } = await env.DB.prepare(`
      SELECT * FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).all();

    for (const invite of invites as any[]) {
      if (env.EMAIL_QUEUE) {
        await env.EMAIL_QUEUE.send({
          job_id: `1n-repropose-${invite.id}-${Date.now()}`,
          type: 'group_repropose',
          to: (invite as any).email,
          subject: `再提案: ${thread.title}`,
          created_at: Date.now(),
          data: {
            thread_title: thread.title,
            token: (invite as any).token,
            message: body.message,
          },
        });
      }
    }

    log.info('Thread reproposed', {
      threadId,
      reproposalCount: reproposalResult.current,
      newSlotsCount: body.new_slots.length,
    });

    return c.json({
      success: true,
      thread_id: threadId,
      reproposal_count: reproposalResult.current,
      max_reproposals: reproposalResult.max,
      new_slots_count: body.new_slots.length,
    });
  } catch (error) {
    log.error('Error in /repropose', { threadId, error });
    return c.json({
      error: 'Failed to repropose',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
