/**
 * Phase B: GET /api/threads/:id/status
 * 
 * Purpose: Get current thread status with AttendanceEngine evaluation
 * Returns: thread, rule, slots, invites, selections, evaluation, pending
 */

import { Hono } from 'hono';
import { AttendanceEngine } from '../services/attendanceEngine';
import type { Env } from '../../../../packages/shared/src/types/env';
import { getTenant } from '../utils/workspaceContext';

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
  ownerUserId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/threads/:id/status
 * 
 * Authorization: Bearer token or session cookie
 * Access: Organizer only
 */
app.get('/:id/status', async (c) => {
  const { env } = c;
  
  try {
    // ====== (0) Authorization ======
    // userId is set by requireAuth middleware
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    // P0-1: Get tenant context
    const { workspaceId, ownerUserId } = getTenant(c);
    
    const threadId = c.req.param('id');
    
    // ====== (1) Load Thread (P0-1: tenant isolation) ======
    // Phase2: proposal_version / additional_propose_count を追加
    const thread = await env.DB.prepare(`
      SELECT 
        id,
        organizer_user_id,
        title,
        description,
        status,
        mode,
        created_at,
        updated_at,
        COALESCE(proposal_version, 1) as proposal_version,
        COALESCE(additional_propose_count, 0) as additional_propose_count
      FROM scheduling_threads
      WHERE id = ?
        AND workspace_id = ?
        AND organizer_user_id = ?
    `).bind(threadId, workspaceId, ownerUserId).first();
    
    if (!thread) {
      // P0-1: 404 で存在を隠す（403ではない）
      return c.json({ error: 'Thread not found' }, 404);
    }
    
    // ====== (2) Load Rule ======
    let ruleRow = await env.DB.prepare(`
      SELECT 
        version,
        rule_json,
        finalize_policy
      FROM thread_attendance_rules
      WHERE thread_id = ?
    `).bind(threadId).first();
    
    // Fallback to default ANY rule
    if (!ruleRow) {
      ruleRow = {
        version: 1,
        rule_json: JSON.stringify({
          version: 1,
          type: 'ANY',
          participants: [],
          constraints: {
            per_invitee_max_choices: 1,
            allow_decline: true
          }
        }),
        finalize_policy: 'EARLIEST_VALID'
      };
    }
    
    const ruleObj = JSON.parse(ruleRow.rule_json as string);
    
    // ====== (3) Load Slots ======
    // Phase2: proposal_version を追加（v1/v2/v3 混在表示用）
    const slotsResult = await env.DB.prepare(`
      SELECT 
        slot_id,
        start_at,
        end_at,
        timezone,
        label,
        COALESCE(proposal_version, 1) as proposal_version
      FROM scheduling_slots
      WHERE thread_id = ?
      ORDER BY start_at ASC
    `).bind(threadId).all();
    
    const slots = slotsResult.results || [];
    
    // ====== (3.5) Load Vote Counts ======
    // Count votes per slot (selected_slot_id)
    const votesResult = await env.DB.prepare(`
      SELECT 
        selected_slot_id as slot_id, 
        COUNT(*) as votes
      FROM thread_selections
      WHERE thread_id = ?
        AND selected_slot_id IS NOT NULL
      GROUP BY selected_slot_id
    `).bind(threadId).all();
    
    const votesBySlotId = new Map(
      (votesResult.results || []).map((r: any) => [r.slot_id, r.votes])
    );
    
    // Merge votes into slots
    const slotsWithVotes = slots.map((s: any) => ({
      ...s,
      votes: votesBySlotId.get(s.slot_id) ?? 0,
    }));
    
    // ====== (4) Load Invites ======
    const invitesResult = await env.DB.prepare(`
      SELECT 
        id,
        token,
        email,
        candidate_name,
        invitee_key,
        status,
        expires_at,
        accepted_at,
        created_at
      FROM thread_invites
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `).bind(threadId).all();
    
    const invites = invitesResult.results || [];
    
    // ====== (5) Load Selections ======
    // Phase2: proposal_version_at_response を追加（再回答必要判定用）
    const selectionsResult = await env.DB.prepare(`
      SELECT 
        selection_id,
        invitee_key,
        status,
        selected_slot_id,
        responded_at,
        proposal_version_at_response
      FROM thread_selections
      WHERE thread_id = ?
      ORDER BY responded_at ASC
    `).bind(threadId).all();
    
    const selections = selectionsResult.results || [];
    
    // ====== (6) Check Finalize ======
    const finalize = await env.DB.prepare(`
      SELECT 
        thread_id,
        final_slot_id,
        finalize_policy,
        finalized_by_user_id as finalized_by,
        finalized_at,
        final_participants_json,
        meeting_url,
        meeting_provider,
        calendar_event_id
      FROM thread_finalize
      WHERE thread_id = ?
      LIMIT 1
    `).bind(threadId).first();
    
    let evaluation;
    
    if (finalize) {
      // Already finalized - return snapshot with meeting info
      evaluation = {
        finalized: true,
        final_slot_id: finalize.final_slot_id,
        finalized_at: finalize.finalized_at,
        finalized_by: finalize.finalized_by,
        reason: finalize.reason,
        auto_finalized: finalize.auto_finalized === 1,
        final_participants: JSON.parse((finalize.final_participants_json as string) || '[]'),
        meeting: finalize.meeting_url ? {
          provider: finalize.meeting_provider || 'google_meet',
          url: finalize.meeting_url,
          calendar_event_id: finalize.calendar_event_id
        } : null
      };
    } else {
      // Not finalized - run evaluation
      const engine = new AttendanceEngine(env.DB);
      evaluation = await engine.evaluateThread(threadId);
    }
    
    // ====== (7) Pending Analysis ======
    const respondedKeys = new Set(
      selections.map((s: any) => s.invitee_key)
    );
    
    const pendingInvites = invites.filter((inv: any) => 
      (inv.status === 'pending' || inv.status === null) &&
      inv.invitee_key &&
      !respondedKeys.has(inv.invitee_key)
    );
    
    // Required missing (for REQUIRED_PLUS_QUORUM)
    let requiredMissing: string[] = [];
    if (ruleObj.type === 'REQUIRED_PLUS_QUORUM' && Array.isArray(ruleObj.required)) {
      requiredMissing = ruleObj.required.filter((k: string) => !respondedKeys.has(k));
    }
    
    // ====== (8) Response ======
    const host = c.req.header('host') || 'webapp.snsrilarc.workers.dev';
    
    // Phase2: 再回答必要な invitee を計算
    const currentProposalVersion = (thread as any).proposal_version || 1;
    const inviteesNeedingResponse = invites.filter((inv: any) => {
      // declined は対象外
      const sel = selections.find((s: any) => s.invitee_key === inv.invitee_key);
      if (sel?.status === 'declined') return false;
      // 未回答 or 古い世代で回答済み
      if (!sel) return true;
      const versionAtResponse = sel.proposal_version_at_response;
      if (versionAtResponse === null || versionAtResponse === undefined) return true;
      return versionAtResponse < currentProposalVersion;
    });

    return c.json({
      thread: {
        id: thread.id,
        organizer_user_id: thread.organizer_user_id,
        title: thread.title,
        description: thread.description,
        status: thread.status,
        mode: thread.mode,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        // Phase2: proposal_version 情報
        proposal_version: (thread as any).proposal_version || 1,
        additional_propose_count: (thread as any).additional_propose_count || 0,
        remaining_proposals: 2 - ((thread as any).additional_propose_count || 0),
      },
      rule: {
        version: ruleRow.version,
        type: ruleObj.type,
        finalize_policy: ruleRow.finalize_policy,
        details: ruleObj
      },
      slots: slotsWithVotes,
      invites: invites.map((inv: any) => ({
        invite_id: inv.id,
        email: inv.email,
        candidate_name: inv.candidate_name,
        invitee_key: inv.invitee_key,
        status: inv.status,
        token: inv.token,
        invite_url: `https://${host}/i/${inv.token}`,
        expires_at: inv.expires_at,
        responded_at: inv.accepted_at
      })),
      selections: selections,
      evaluation: evaluation,
      pending: {
        count: pendingInvites.length,
        invites: pendingInvites.map((inv: any) => ({
          invitee_key: inv.invitee_key,
          email: inv.email,
          name: inv.candidate_name,
          expires_at: inv.expires_at
        })),
        required_missing: requiredMissing
      },
      // Phase2: 追加候補関連情報
      proposal_info: {
        current_version: currentProposalVersion,
        additional_propose_count: (thread as any).additional_propose_count || 0,
        remaining_proposals: 2 - ((thread as any).additional_propose_count || 0),
        invitees_needing_response: inviteesNeedingResponse.map((inv: any) => ({
          invitee_key: inv.invitee_key,
          email: inv.email,
          name: inv.candidate_name,
        })),
        invitees_needing_response_count: inviteesNeedingResponse.length,
      }
    });
    
  } catch (error) {
    console.error('[ThreadsStatus] Error:', error);
    return c.json({
      error: 'Failed to get thread status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// ============================================================
// PROG-1: GET /api/threads/:id/summary
// 会話向けの進捗要約（read-only）
// ============================================================

import { 
  getThreadProgressSummary, 
  formatProgressSummaryForChat,
  type ThreadProgressSummary 
} from '../services/threadProgressSummary';

/**
 * GET /api/threads/:id/summary
 * 
 * PROG-1: 会話向けの進捗要約を返す
 * - AIが「今どうなってる？」に答えるための要約
 * - side_effect: read-only（外部送信なし）
 */
app.get('/:id/summary', async (c) => {
  const { env } = c;
  
  try {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const { workspaceId, ownerUserId } = getTenant(c);
    const threadId = c.req.param('id');
    
    // 進捗要約を取得
    const summary = await getThreadProgressSummary(
      env.DB,
      workspaceId,
      ownerUserId,
      threadId
    );
    
    if (!summary) {
      return c.json({ error: 'Thread not found' }, 404);
    }
    
    // クエリパラメータで形式を指定可能
    const format = c.req.query('format') || 'json';
    
    if (format === 'chat') {
      // 会話向けテキスト形式
      return c.json({
        success: true,
        format: 'chat',
        message: formatProgressSummaryForChat(summary),
        data: summary,
      });
    }
    
    // デフォルト: JSON形式
    return c.json({
      success: true,
      format: 'json',
      data: summary,
    });
    
  } catch (error) {
    console.error('[ThreadsSummary] Error:', error);
    return c.json({
      error: 'Failed to get thread summary',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
