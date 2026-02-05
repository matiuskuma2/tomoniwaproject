/**
 * Thread Create Routes (Phase 2-3)
 * 
 * POST / - Create thread with AI-generated candidates OR bulk invite from list
 * 
 * Moved from threads.ts (no logic changes)
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../../repositories/threadsRepository';
import { ContactsRepository } from '../../repositories/contactsRepository';
import { ListsRepository } from '../../repositories/listsRepository';
import { AIRouterService } from '../../services/aiRouter';
import { CandidateGeneratorService } from '../../services/candidateGenerator';
import { getUserIdFromContext } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import type { Env } from '../../../../../packages/shared/src/types/env';
import type { EmailJob } from '../../services/emailQueue';
import { THREAD_STATUS } from '../../../../../packages/shared/src/types/thread';
import { getTenant } from '../../utils/workspaceContext';
import { createLogger } from '../../utils/logger';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Create new thread
 * 
 * @route POST /threads
 * @body { 
 *   title: string, 
 *   description?: string, 
 *   target_list_id?: string,
 *   seed_mode?: 'empty' | 'legacy_default_slots' | 'ai_from_list'
 * }
 * @ratelimit 10 per minute by user
 * 
 * seed_mode behavior:
 * - 'empty' (default): Create empty thread with no slots or invites
 * - 'legacy_default_slots': Create 3 default slots (tomorrow, day after, 3 days) - for demo/审査用
 * - 'ai_from_list': Use AI to generate candidates from target_list_id
 * 
 * SSOT: Thread creation should start empty. Slots and invites are added via subsequent API calls.
 */
app.post(
  '/',
  rateLimit({
    action: 'thread_create',
    scope: 'user',
    max: 10,
    windowSeconds: 60,
    identifierExtractor: (c) => c.req.header('x-user-id') || 'unknown',
  }),
  async (c) => {
    const { env } = c;
    const log = createLogger(env, { module: 'Threads', handler: 'create' });
    const userId = await getUserIdFromContext(c as any);

    // P0-1: Get tenant context
    const { workspaceId, ownerUserId } = getTenant(c);

    try {
      const body = await c.req.json();
      const { title, description, target_list_id, seed_mode = 'empty' } = body;

      // Validate seed_mode
      const validSeedModes = ['empty', 'legacy_default_slots', 'ai_from_list'];
      if (!validSeedModes.includes(seed_mode)) {
        return c.json({ 
          error: `Invalid seed_mode. Must be one of: ${validSeedModes.join(', ')}`,
          received: seed_mode 
        }, 400);
      }

      if (!title || typeof title !== 'string') {
        return c.json({ error: 'Missing or invalid field: title' }, 400);
      }

      log.debug('Creating thread', { title, seed_mode, hasTargetList: !!target_list_id });

      // Step 1: Create thread in scheduling_threads (P0-1: tenant isolation)
      const threadId = crypto.randomUUID();
      const now = new Date().toISOString();
      
      // P3-TZ3: organizer timezone をスレッドにコピー
      const organizerTzRow = await env.DB.prepare(
        `SELECT timezone FROM users WHERE id = ? LIMIT 1`
      ).bind(ownerUserId).first<{ timezone: string }>();
      const organizerTimeZone = organizerTzRow?.timezone || 'Asia/Tokyo';
      
      await env.DB.prepare(`
        INSERT INTO scheduling_threads (id, workspace_id, organizer_user_id, title, description, status, mode, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'one_on_one', ?, ?, ?)
      `).bind(threadId, workspaceId, ownerUserId, title, description || null, THREAD_STATUS.DRAFT, organizerTimeZone, now, now).run();

      log.debug('Created thread', { threadId });

      // Step 1.5: Create default attendance rule (ALL type)
      const defaultRule = {
        version: '1.0',
        type: 'ALL',
        slot_policy: { multiple_slots_allowed: true },
        invitee_scope: { allow_unregistered: true },
        rule: {},
        finalize_policy: {
          auto_finalize: true,
          policy: 'EARLIEST_VALID',
        },
      };

      await env.DB.prepare(`
        INSERT INTO thread_attendance_rules (thread_id, rule_json)
        VALUES (?, ?)
      `).bind(threadId, JSON.stringify(defaultRule)).run();

      log.debug('Created default attendance rule');

      let candidates: any[] = [];
      let invites: any[] = [];
      let skippedCount = 0;
      let slotsCreated = 0;

      // ============================
      // SSOT: seed_mode controls initial data creation
      // ============================

      // Step 1.6: Create default scheduling slots (only if seed_mode = 'legacy_default_slots')
      if (seed_mode === 'legacy_default_slots') {
        const slotBaseTime = new Date();
        const tomorrow = new Date(slotBaseTime);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(14, 0, 0, 0); // 2 PM

        const dayAfter = new Date(slotBaseTime);
        dayAfter.setDate(dayAfter.getDate() + 2);
        dayAfter.setHours(14, 0, 0, 0);

        const threeDays = new Date(slotBaseTime);
        threeDays.setDate(threeDays.getDate() + 3);
        threeDays.setHours(14, 0, 0, 0);

        const slots = [
          { start: tomorrow, end: new Date(tomorrow.getTime() + 60 * 60 * 1000) }, // 1 hour
          { start: dayAfter, end: new Date(dayAfter.getTime() + 60 * 60 * 1000) },
          { start: threeDays, end: new Date(threeDays.getTime() + 60 * 60 * 1000) },
        ];

        for (const slot of slots) {
          const slotId = crypto.randomUUID();
          await env.DB.prepare(`
            INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            slotId,
            threadId,
            slot.start.toISOString(),
            slot.end.toISOString(),
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
          ).run();
        }
        slotsCreated = slots.length;
        log.debug('Created legacy default scheduling slots', { count: slotsCreated });
      } else {
        log.debug('Skipping default slots (seed_mode is not legacy_default_slots)', { seed_mode });
      }

      // ============================
      // Branch: Bulk invite from list (only if seed_mode = 'ai_from_list' AND target_list_id provided)
      // ============================
      if (seed_mode === 'ai_from_list' && target_list_id) {
        // Step 2A: Bulk invite from list
        log.debug('Bulk invite mode', { targetListId: target_list_id });

        const listsRepo = new ListsRepository(env.DB);
        const contactsRepo = new ContactsRepository(env.DB);

        // Verify list ownership (P0-1: tenant isolation)
        const list = await listsRepo.getById(target_list_id, workspaceId, ownerUserId);
        if (!list) {
          return c.json({ error: 'List not found or access denied' }, 404);
        }

        // Get total count first (最重要ポイント 2: 上限1000件チェック)
        const { members, total } = await listsRepo.getMembers(target_list_id, workspaceId, 1001, 0);

        if (total > 1000) {
          return c.json({ 
            error: 'List size exceeds 1000 contacts. Please split into smaller lists.',
            total,
            limit: 1000
          }, 400);
        }

        if (members.length === 0) {
          return c.json({ error: 'List is empty. Add contacts first.' }, 400);
        }

        log.debug("Bulk inviting contacts", { memberCount: members.length });

        // 最重要ポイント 3: email が無い contact は除外
        const validMembers = members.filter((m) => m.contact_email);
        skippedCount = members.length - validMembers.length;

        if (skippedCount > 0) {
          log.warn("Skipped contacts without email", { skippedCount });
        }

        // Step 3A: Create invites in batch (P0-1: Transaction for performance)
        const threadsRepo = new ThreadsRepository(env.DB);
        const batchResult = await threadsRepo.createInvitesBatch(
          validMembers.map((member) => ({
            thread_id: threadId,
            email: member.contact_email!,
            candidate_name: member.contact_display_name || member.contact_email!,
            candidate_reason: `From list: ${list.name}`,
            expires_in_hours: 72, // 3 days
          }))
        );

        log.debug('Batch invite result', { batchResult });

        // P0-3: Fetch only inserted invites (accurate tracking)
        if (batchResult.insertedIds.length > 0) {
          const placeholders = batchResult.insertedIds.map(() => '?').join(',');
          const inviteList = await env.DB.prepare(
            `SELECT * FROM thread_invites WHERE id IN (${placeholders}) ORDER BY created_at DESC`
          ).bind(...batchResult.insertedIds).all();

          invites = inviteList.results as any[];
        } else {
          invites = [];
        }

        // Convert to candidates format for response
        candidates = validMembers.map((m) => ({
          name: m.contact_display_name || m.contact_email!,
          email: m.contact_email!,
          reason: `From list: ${list.name}`,
        }));
      } else if (seed_mode === 'legacy_default_slots' && !target_list_id) {
        // Step 2B: Generate candidates with AI (legacy flow - only for demo/审査用)
        log.debug('AI candidate generation mode (legacy)', { seed_mode });

        const allowFallback = env.AI_FALLBACK_ENABLED === 'true';
        
        const aiRouter = new AIRouterService(
          env.GEMINI_API_KEY || '',
          env.OPENAI_API_KEY || '',
          env.DB,
          allowFallback
        );

        const candidateGen = new CandidateGeneratorService(aiRouter, userId);
        candidates = await candidateGen.generateCandidates(title, description);

        log.debug('Generated candidates', { count: candidates.length });

        // Step 3B: Create invites for each candidate
        const threadsRepo = new ThreadsRepository(env.DB);
        invites = await Promise.all(
          candidates.map((candidate) =>
            threadsRepo.createInvite({
              thread_id: threadId,
              email: candidate.email,
              candidate_name: candidate.name,
              candidate_reason: candidate.reason,
              expires_in_hours: 72, // 3 days
            })
          )
        );

        log.debug('Created invites', { count: invites.length });
      } else {
        // SSOT: seed_mode = 'empty' (default) - no candidates, no invites
        log.debug('Empty thread mode - no auto-generated candidates or invites', { seed_mode });
      }

      // Step 4: Send invite emails via queue (共通)
      // Beta A: thread_title を追加してメール本文に表示
      for (const invite of invites) {
        const candidate = candidates.find((c) => c.email === invite.email);
        if (!candidate) continue;

        const emailJob: EmailJob = {
          job_id: `invite-${invite.id}`,
          type: 'invite',
          to: candidate.email,
          subject: `【日程調整】「${title}」のご依頼`,
          created_at: Date.now(),
          data: {
            token: invite.token,
            inviter_name: 'Tomoniwao',
            relation_type: 'thread_invite',
            thread_title: title,
          },
        };

        await env.EMAIL_QUEUE.send(emailJob);
        log.debug('Queued email', { email: candidate.email });
      }

      return c.json({
        thread: {
          id: threadId,
          title,
          description,
          organizer_user_id: userId,
          status: 'draft',
          created_at: now
        },
        candidates: candidates.map((candidate, i) => {
          // Get the host from the request
          const host = c.req.header('host') || 'app.tomoniwao.jp';
          return {
            ...candidate,
            invite_token: invites[i].token,
            invite_url: `https://${host}/i/${invites[i].token}`,
          };
        }),
        message: seed_mode === 'empty' 
          ? 'Thread created (empty - add slots and invites via separate API calls)'
          : `Thread created with ${candidates.length} candidate invitations sent`,
        seed_mode,
        slots_created: slotsCreated,
        // 最重要ポイント 3: skipped_count をレスポンスに含める（target_list_id モード時のみ）
        ...(target_list_id ? { skipped_count: skippedCount } : {}),
      });
    } catch (error) {
      log.error('Error creating thread', error);
      return c.json(
        {
          error: 'Failed to create thread',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      );
    }
  }
);

export default app;
