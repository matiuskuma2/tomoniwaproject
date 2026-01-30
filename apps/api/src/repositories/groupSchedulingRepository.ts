/**
 * Group Scheduling Repository
 * G1-PLAN: 1対N（Broadcast Scheduling）サポート
 * 
 * 責務:
 * - scheduling_threads の1対N拡張（topology, group_policy_json）
 * - thread_responses の CRUD
 */

import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Types
// ============================================================

export type Topology = 'one_on_one' | 'one_to_many';
export type GroupMode = 'fixed' | 'candidates' | 'open_slots' | 'range_auto';
export type FinalizePolicy = 'organizer_decides' | 'quorum' | 'required_people' | 'all_required';
export type ResponseType = 'ok' | 'no' | 'maybe';

export interface GroupPolicy {
  mode: GroupMode;
  deadline_at: string;                    // ISO8601
  finalize_policy: FinalizePolicy;
  quorum_count?: number;                  // quorum policy 用
  required_invitee_keys?: string[];       // required_people policy 用
  auto_finalize: boolean;
  max_reproposals: number;
  reproposal_count: number;
  participant_limit: number;
}

export interface SchedulingThreadWithGroup {
  id: string;
  organizer_user_id: string;
  workspace_id?: string;
  title: string | null;
  description: string | null;
  status: 'draft' | 'sent' | 'confirmed' | 'cancelled';
  mode: 'one_on_one' | 'group' | 'public';
  kind: 'external' | 'internal';
  topology: Topology;
  group_policy_json: string | null;
  group_policy?: GroupPolicy | null;      // パース済み
  created_at: string;
  updated_at: string;
}

export interface ThreadResponse {
  id: string;
  thread_id: string;
  invitee_key: string;
  response: ResponseType;
  selected_slot_id: string | null;
  comment: string | null;
  responded_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateGroupThreadInput {
  organizer_user_id: string;
  workspace_id?: string;
  title: string;
  description?: string;
  kind?: 'external' | 'internal';
  group_policy: GroupPolicy;
}

export interface CreateResponseInput {
  thread_id: string;
  invitee_key: string;
  response: ResponseType;
  selected_slot_id?: string;
  comment?: string;
}

export interface ResponseSummary {
  total: number;
  ok: number;
  no: number;
  maybe: number;
  not_responded: number;
}

// ============================================================
// Repository
// ============================================================

export class GroupSchedulingRepository {
  constructor(private db: D1Database) {}

  // ============================================================
  // Thread Operations
  // ============================================================

  /**
   * 1対Nスレッドを作成
   */
  async createGroupThread(input: CreateGroupThreadInput): Promise<SchedulingThreadWithGroup> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const groupPolicyJson = JSON.stringify({
      ...input.group_policy,
      reproposal_count: 0,  // 初期値
    });

    await this.db.prepare(`
      INSERT INTO scheduling_threads (
        id, organizer_user_id, workspace_id, title, description,
        status, mode, kind, topology, group_policy_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'group', ?, 'one_to_many', ?, ?, ?)
    `).bind(
      id,
      input.organizer_user_id,
      input.workspace_id || null,
      input.title,
      input.description || null,
      input.kind || 'external',
      groupPolicyJson,
      now,
      now
    ).run();

    const thread = await this.getGroupThreadById(id);
    if (!thread) {
      throw new Error('Failed to create group thread');
    }

    return thread;
  }

  /**
   * IDで1対Nスレッドを取得
   */
  async getGroupThreadById(id: string): Promise<SchedulingThreadWithGroup | null> {
    const result = await this.db.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ?
    `).bind(id).first<SchedulingThreadWithGroup>();

    if (!result) return null;

    // group_policy_json をパース
    if (result.group_policy_json) {
      try {
        result.group_policy = JSON.parse(result.group_policy_json);
      } catch {
        result.group_policy = null;
      }
    }

    return result;
  }

  /**
   * スレッドのステータスを更新
   */
  async updateThreadStatus(
    threadId: string,
    status: 'draft' | 'sent' | 'confirmed' | 'cancelled'
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE scheduling_threads SET status = ?, updated_at = ? WHERE id = ?
    `).bind(status, now, threadId).run();
  }

  /**
   * group_policy を更新（再提案カウントなど）
   */
  async updateGroupPolicy(threadId: string, policy: GroupPolicy): Promise<void> {
    const now = new Date().toISOString();
    const policyJson = JSON.stringify(policy);

    await this.db.prepare(`
      UPDATE scheduling_threads SET group_policy_json = ?, updated_at = ? WHERE id = ?
    `).bind(policyJson, now, threadId).run();
  }

  /**
   * ユーザーの1対Nスレッド一覧を取得
   */
  async listGroupThreadsByOrganizer(
    organizerUserId: string,
    options?: {
      status?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ threads: SchedulingThreadWithGroup[]; total: number }> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    let whereClause = 'WHERE organizer_user_id = ? AND topology = ?';
    const params: (string | number)[] = [organizerUserId, 'one_to_many'];

    if (options?.status) {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }

    // Total count
    const countResult = await this.db.prepare(`
      SELECT COUNT(*) as count FROM scheduling_threads ${whereClause}
    `).bind(...params).first<{ count: number }>();

    // Threads
    const result = await this.db.prepare(`
      SELECT * FROM scheduling_threads ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all<SchedulingThreadWithGroup>();

    const threads = (result.results || []).map(t => {
      if (t.group_policy_json) {
        try {
          t.group_policy = JSON.parse(t.group_policy_json);
        } catch {
          t.group_policy = null;
        }
      }
      return t;
    });

    return {
      threads,
      total: countResult?.count || 0,
    };
  }

  // ============================================================
  // Response Operations
  // ============================================================

  /**
   * 回答を記録（upsert）
   */
  async upsertResponse(input: CreateResponseInput): Promise<ThreadResponse> {
    const now = new Date().toISOString();

    // 既存の回答を確認
    const existing = await this.getResponseByInviteeKey(input.thread_id, input.invitee_key);

    if (existing) {
      // 更新
      await this.db.prepare(`
        UPDATE thread_responses SET
          response = ?,
          selected_slot_id = ?,
          comment = ?,
          responded_at = ?,
          updated_at = ?
        WHERE thread_id = ? AND invitee_key = ?
      `).bind(
        input.response,
        input.selected_slot_id || null,
        input.comment || null,
        now,
        now,
        input.thread_id,
        input.invitee_key
      ).run();

      const updated = await this.getResponseByInviteeKey(input.thread_id, input.invitee_key);
      if (!updated) {
        throw new Error('Failed to update response');
      }
      return updated;
    }

    // 新規作成
    const id = uuidv4();
    await this.db.prepare(`
      INSERT INTO thread_responses (
        id, thread_id, invitee_key, response, selected_slot_id, comment,
        responded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      input.thread_id,
      input.invitee_key,
      input.response,
      input.selected_slot_id || null,
      input.comment || null,
      now,
      now,
      now
    ).run();

    const response = await this.getResponseById(id);
    if (!response) {
      throw new Error('Failed to create response');
    }
    return response;
  }

  /**
   * IDで回答を取得
   */
  async getResponseById(id: string): Promise<ThreadResponse | null> {
    return this.db.prepare(`
      SELECT * FROM thread_responses WHERE id = ?
    `).bind(id).first<ThreadResponse>();
  }

  /**
   * スレッドと招待者キーで回答を取得
   */
  async getResponseByInviteeKey(
    threadId: string,
    inviteeKey: string
  ): Promise<ThreadResponse | null> {
    return this.db.prepare(`
      SELECT * FROM thread_responses WHERE thread_id = ? AND invitee_key = ?
    `).bind(threadId, inviteeKey).first<ThreadResponse>();
  }

  /**
   * スレッドの全回答を取得
   */
  async listResponsesByThread(threadId: string): Promise<ThreadResponse[]> {
    const result = await this.db.prepare(`
      SELECT * FROM thread_responses WHERE thread_id = ? ORDER BY responded_at DESC
    `).bind(threadId).all<ThreadResponse>();

    return result.results || [];
  }

  /**
   * 回答サマリーを取得
   * @param threadId スレッドID
   * @param totalInvites 招待総数（thread_invites から取得）
   */
  async getResponseSummary(threadId: string, totalInvites: number): Promise<ResponseSummary> {
    const responses = await this.listResponsesByThread(threadId);

    const summary: ResponseSummary = {
      total: totalInvites,
      ok: 0,
      no: 0,
      maybe: 0,
      not_responded: 0,
    };

    for (const r of responses) {
      switch (r.response) {
        case 'ok': summary.ok++; break;
        case 'no': summary.no++; break;
        case 'maybe': summary.maybe++; break;
      }
    }

    summary.not_responded = totalInvites - responses.length;
    return summary;
  }

  /**
   * 特定のスロットへの投票数を取得
   */
  async getSlotVoteCounts(threadId: string): Promise<Map<string, number>> {
    const result = await this.db.prepare(`
      SELECT selected_slot_id, COUNT(*) as count
      FROM thread_responses
      WHERE thread_id = ? AND selected_slot_id IS NOT NULL AND response = 'ok'
      GROUP BY selected_slot_id
    `).bind(threadId).all<{ selected_slot_id: string; count: number }>();

    const counts = new Map<string, number>();
    for (const row of result.results || []) {
      counts.set(row.selected_slot_id, row.count);
    }
    return counts;
  }

  // ============================================================
  // Finalization Check
  // ============================================================

  /**
   * 成立条件を満たしているか確認
   */
  async checkFinalizationCondition(
    threadId: string,
    policy: GroupPolicy,
    totalInvites: number
  ): Promise<{
    canFinalize: boolean;
    reason: string;
    bestSlotId?: string;
  }> {
    const summary = await this.getResponseSummary(threadId, totalInvites);

    switch (policy.finalize_policy) {
      case 'organizer_decides':
        // 主催者が決定するので、常に canFinalize = true（ボタンを出す）
        return {
          canFinalize: true,
          reason: '主催者が最終確定できます',
        };

      case 'quorum':
        if (summary.ok >= (policy.quorum_count || 1)) {
          const slotCounts = await this.getSlotVoteCounts(threadId);
          const bestSlotId = this.findBestSlot(slotCounts);
          return {
            canFinalize: true,
            reason: `${summary.ok}/${policy.quorum_count}人がOKしました`,
            bestSlotId,
          };
        }
        return {
          canFinalize: false,
          reason: `あと${(policy.quorum_count || 1) - summary.ok}人のOKが必要です`,
        };

      case 'required_people': {
        const responses = await this.listResponsesByThread(threadId);
        const requiredKeys = new Set(policy.required_invitee_keys || []);
        const okKeys = new Set(
          responses.filter(r => r.response === 'ok').map(r => r.invitee_key)
        );

        const allRequiredOk = [...requiredKeys].every(key => okKeys.has(key));
        if (allRequiredOk) {
          const slotCounts = await this.getSlotVoteCounts(threadId);
          const bestSlotId = this.findBestSlot(slotCounts);
          return {
            canFinalize: true,
            reason: '必須メンバー全員がOKしました',
            bestSlotId,
          };
        }

        const missingCount = [...requiredKeys].filter(key => !okKeys.has(key)).length;
        return {
          canFinalize: false,
          reason: `必須メンバーのうち${missingCount}人が未回答/NGです`,
        };
      }

      case 'all_required':
        if (summary.ok === totalInvites && summary.not_responded === 0) {
          const slotCounts = await this.getSlotVoteCounts(threadId);
          const bestSlotId = this.findBestSlot(slotCounts);
          return {
            canFinalize: true,
            reason: '全員がOKしました',
            bestSlotId,
          };
        }
        return {
          canFinalize: false,
          reason: `${summary.not_responded}人が未回答、${summary.no}人がNGです`,
        };
    }
  }

  /**
   * 最も投票数が多いスロットを取得
   */
  private findBestSlot(slotCounts: Map<string, number>): string | undefined {
    let bestSlotId: string | undefined;
    let maxCount = 0;

    for (const [slotId, count] of slotCounts) {
      if (count > maxCount) {
        maxCount = count;
        bestSlotId = slotId;
      }
    }

    return bestSlotId;
  }
}
