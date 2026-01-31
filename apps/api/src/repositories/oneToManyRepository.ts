/**
 * OneToManyRepository - 1対N（Broadcast Scheduling）用リポジトリ
 * 
 * G1-PLAN に基づき、以下を管理:
 * - 1対N スレッドの作成・取得
 * - group_policy_json（成立条件・締切等）
 * - thread_responses（参加者回答）
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { v4 as uuidv4 } from 'uuid';
import type { D1Database } from '@cloudflare/workers-types';

// ============================================================
// Types
// ============================================================

/**
 * 成立条件ポリシー
 */
export type FinalizePolicy = 
  | 'organizer_decides'  // 主催者が手動確定（デフォルト）
  | 'quorum'             // 最小定足数達成で確定
  | 'required_people'    // 必須参加者全員が OK で確定
  | 'all_required';      // 全員 OK で確定

/**
 * 1対N モード
 */
export type OneToManyMode = 
  | 'fixed'           // 日時決め打ち
  | 'candidates'      // 複数候補から選択
  | 'open_slots'      // 申込カレンダー型
  | 'range_auto';     // 範囲→自動候補生成

/**
 * group_policy_json の型
 */
export interface GroupPolicy {
  mode: OneToManyMode;
  deadline_at: string;                    // ISO8601 形式
  finalize_policy: FinalizePolicy;
  quorum_count?: number;                  // quorum の場合必須
  required_invitee_keys?: string[];       // required_people の場合
  auto_finalize: boolean;                 // 条件達成時に自動確定
  max_reproposals: number;                // 最大再提案回数（デフォルト: 2）
  reproposal_count: number;               // 現在の再提案回数
  participant_limit?: number;             // 参加者上限
}

/**
 * 1対N スレッド
 */
export interface OneToManyThread {
  id: string;
  organizer_user_id: string;
  title: string | null;
  description: string | null;
  status: 'draft' | 'sent' | 'confirmed' | 'cancelled';
  mode: 'one_on_one' | 'group' | 'public';
  kind: 'external' | 'internal';
  topology: 'one_on_one' | 'one_to_many';
  group_policy_json: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 回答（thread_responses）
 */
export interface ThreadResponse {
  id: string;
  thread_id: string;
  invitee_key: string;
  response: 'ok' | 'no' | 'maybe';
  selected_slot_id: string | null;
  comment: string | null;
  responded_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * 作成パラメータ
 */
export interface CreateOneToManyParams {
  organizer_user_id: string;
  title: string;
  description?: string;
  kind?: 'external' | 'internal';
  mode?: 'group' | 'public';
  group_policy: Omit<GroupPolicy, 'reproposal_count'>;
}

/**
 * 回答追加パラメータ
 */
export interface AddResponseParams {
  thread_id: string;
  invitee_key: string;
  response: 'ok' | 'no' | 'maybe';
  selected_slot_id?: string;
  comment?: string;
}

/**
 * 回答集計結果
 */
export interface ResponseSummary {
  total_invited: number;
  responded: number;
  response_rate: number;
  ok_count: number;
  no_count: number;
  maybe_count: number;
  pending_count: number;
  by_slot: {
    slot_id: string;
    ok_count: number;
    no_count: number;
    maybe_count: number;
  }[];
}

// ============================================================
// Repository
// ============================================================

export class OneToManyRepository {
  constructor(private db: D1Database) {}

  /**
   * 1対N スレッド作成
   */
  async create(params: CreateOneToManyParams): Promise<OneToManyThread> {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const groupPolicy: GroupPolicy = {
      ...params.group_policy,
      reproposal_count: 0,
    };

    // デフォルト値設定
    if (!groupPolicy.max_reproposals) {
      groupPolicy.max_reproposals = 2;
    }
    if (groupPolicy.auto_finalize === undefined) {
      groupPolicy.auto_finalize = false;
    }

    await this.db.prepare(`
      INSERT INTO scheduling_threads (
        id, organizer_user_id, title, description, status, mode, kind, topology, group_policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, 'one_to_many', ?, ?, ?)
    `).bind(
      id,
      params.organizer_user_id,
      params.title,
      params.description || null,
      params.mode || 'group',
      params.kind || 'external',
      JSON.stringify(groupPolicy),
      now,
      now
    ).run();

    const thread = await this.getById(id);
    if (!thread) {
      throw new Error('Failed to create one-to-many thread');
    }
    return thread;
  }

  /**
   * ID でスレッド取得
   */
  async getById(id: string): Promise<OneToManyThread | null> {
    const result = await this.db.prepare(`
      SELECT * FROM scheduling_threads WHERE id = ? AND topology = 'one_to_many'
    `).bind(id).first<OneToManyThread>();
    return result || null;
  }

  /**
   * 主催者の1対Nスレッド一覧
   */
  async listByOrganizer(
    organizerUserId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<{ threads: OneToManyThread[]; total: number }> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;

    let query = `
      SELECT * FROM scheduling_threads 
      WHERE organizer_user_id = ? AND topology = 'one_to_many'
    `;
    let countQuery = `
      SELECT COUNT(*) as count FROM scheduling_threads 
      WHERE organizer_user_id = ? AND topology = 'one_to_many'
    `;
    const params: any[] = [organizerUserId];

    if (options?.status) {
      query += ` AND status = ?`;
      countQuery += ` AND status = ?`;
      params.push(options.status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    const [{ results }, countResult] = await Promise.all([
      this.db.prepare(query).bind(...params, limit, offset).all<OneToManyThread>(),
      this.db.prepare(countQuery).bind(...params).first<{ count: number }>(),
    ]);

    return {
      threads: results || [],
      total: countResult?.count || 0,
    };
  }

  /**
   * グループポリシー更新
   */
  async updateGroupPolicy(threadId: string, policy: Partial<GroupPolicy>): Promise<void> {
    const thread = await this.getById(threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }

    const currentPolicy: GroupPolicy = thread.group_policy_json 
      ? JSON.parse(thread.group_policy_json)
      : {};

    const updatedPolicy = { ...currentPolicy, ...policy };

    await this.db.prepare(`
      UPDATE scheduling_threads 
      SET group_policy_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(JSON.stringify(updatedPolicy), threadId).run();
  }

  /**
   * ステータス更新
   */
  async updateStatus(threadId: string, status: 'draft' | 'sent' | 'confirmed' | 'cancelled'): Promise<void> {
    await this.db.prepare(`
      UPDATE scheduling_threads 
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(status, threadId).run();
  }

  /**
   * 回答追加/更新（UPSERT）
   */
  async addResponse(params: AddResponseParams): Promise<ThreadResponse> {
    const id = uuidv4();
    const now = new Date().toISOString();

    // UPSERT: 同一 thread_id + invitee_key は上書き
    await this.db.prepare(`
      INSERT INTO thread_responses (
        id, thread_id, invitee_key, response, selected_slot_id, comment, responded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, invitee_key) DO UPDATE SET
        response = excluded.response,
        selected_slot_id = excluded.selected_slot_id,
        comment = excluded.comment,
        responded_at = excluded.responded_at,
        updated_at = excluded.updated_at
    `).bind(
      id,
      params.thread_id,
      params.invitee_key,
      params.response,
      params.selected_slot_id || null,
      params.comment || null,
      now,
      now,
      now
    ).run();

    const response = await this.getResponseByInvitee(params.thread_id, params.invitee_key);
    if (!response) {
      throw new Error('Failed to add response');
    }
    return response;
  }

  /**
   * 招待者の回答取得
   */
  async getResponseByInvitee(threadId: string, inviteeKey: string): Promise<ThreadResponse | null> {
    const result = await this.db.prepare(`
      SELECT * FROM thread_responses WHERE thread_id = ? AND invitee_key = ?
    `).bind(threadId, inviteeKey).first<ThreadResponse>();
    return result || null;
  }

  /**
   * スレッドの全回答一覧
   */
  async listResponses(threadId: string): Promise<ThreadResponse[]> {
    const { results } = await this.db.prepare(`
      SELECT * FROM thread_responses WHERE thread_id = ? ORDER BY responded_at DESC
    `).bind(threadId).all<ThreadResponse>();
    return results || [];
  }

  /**
   * 回答集計
   */
  async getResponseSummary(threadId: string): Promise<ResponseSummary> {
    // 招待者数を取得
    const { count: totalInvited } = await this.db.prepare(`
      SELECT COUNT(*) as count FROM thread_invites WHERE thread_id = ?
    `).bind(threadId).first<{ count: number }>() || { count: 0 };

    // 回答を取得
    const responses = await this.listResponses(threadId);

    // 回答集計
    const okCount = responses.filter(r => r.response === 'ok').length;
    const noCount = responses.filter(r => r.response === 'no').length;
    const maybeCount = responses.filter(r => r.response === 'maybe').length;
    const respondedCount = responses.length;
    const pendingCount = totalInvited - respondedCount;

    // スロット別集計
    const slotMap = new Map<string, { ok: number; no: number; maybe: number }>();
    for (const r of responses) {
      if (r.selected_slot_id) {
        const existing = slotMap.get(r.selected_slot_id) || { ok: 0, no: 0, maybe: 0 };
        if (r.response === 'ok') existing.ok++;
        else if (r.response === 'no') existing.no++;
        else if (r.response === 'maybe') existing.maybe++;
        slotMap.set(r.selected_slot_id, existing);
      }
    }

    const bySlot = Array.from(slotMap.entries()).map(([slot_id, counts]) => ({
      slot_id,
      ok_count: counts.ok,
      no_count: counts.no,
      maybe_count: counts.maybe,
    }));

    return {
      total_invited: totalInvited,
      responded: respondedCount,
      response_rate: totalInvited > 0 ? (respondedCount / totalInvited) * 100 : 0,
      ok_count: okCount,
      no_count: noCount,
      maybe_count: maybeCount,
      pending_count: pendingCount,
      by_slot: bySlot,
    };
  }

  /**
   * 成立条件チェック
   * 
   * @returns { met: boolean; reason: string; recommended_slot_id?: string }
   */
  async checkFinalizationCondition(threadId: string): Promise<{
    met: boolean;
    reason: string;
    recommended_slot_id?: string;
  }> {
    const thread = await this.getById(threadId);
    if (!thread || !thread.group_policy_json) {
      return { met: false, reason: 'Thread not found or no policy' };
    }

    const policy: GroupPolicy = JSON.parse(thread.group_policy_json);
    const summary = await this.getResponseSummary(threadId);

    // 締切チェック
    const now = new Date();
    const deadline = new Date(policy.deadline_at);
    const isDeadlinePassed = now > deadline;

    switch (policy.finalize_policy) {
      case 'organizer_decides':
        // 主催者決定: 条件自体は常に満たさない（手動確定のみ）
        // ただし締切後は通知すべき
        if (isDeadlinePassed) {
          return { met: false, reason: 'deadline_passed_awaiting_organizer' };
        }
        return { met: false, reason: 'awaiting_organizer_decision' };

      case 'quorum':
        // 定足数達成チェック
        if (policy.quorum_count && summary.ok_count >= policy.quorum_count) {
          // 最多得票のスロットを推奨
          const topSlot = summary.by_slot.sort((a, b) => b.ok_count - a.ok_count)[0];
          return { 
            met: true, 
            reason: `quorum_met: ${summary.ok_count}/${policy.quorum_count}`,
            recommended_slot_id: topSlot?.slot_id,
          };
        }
        if (isDeadlinePassed) {
          return { met: false, reason: `deadline_passed_quorum_not_met: ${summary.ok_count}/${policy.quorum_count}` };
        }
        return { met: false, reason: `quorum_not_yet: ${summary.ok_count}/${policy.quorum_count}` };

      case 'required_people':
        // 必須参加者全員チェック
        if (policy.required_invitee_keys && policy.required_invitee_keys.length > 0) {
          const responses = await this.listResponses(threadId);
          const okInviteeKeys = responses.filter(r => r.response === 'ok').map(r => r.invitee_key);
          const allRequired = policy.required_invitee_keys.every(k => okInviteeKeys.includes(k));
          
          if (allRequired) {
            const topSlot = summary.by_slot.sort((a, b) => b.ok_count - a.ok_count)[0];
            return {
              met: true,
              reason: 'all_required_ok',
              recommended_slot_id: topSlot?.slot_id,
            };
          }
        }
        if (isDeadlinePassed) {
          return { met: false, reason: 'deadline_passed_required_not_met' };
        }
        return { met: false, reason: 'required_not_yet' };

      case 'all_required':
        // 全員 OK チェック
        if (summary.pending_count === 0 && summary.no_count === 0) {
          const topSlot = summary.by_slot.sort((a, b) => b.ok_count - a.ok_count)[0];
          return {
            met: true,
            reason: 'all_ok',
            recommended_slot_id: topSlot?.slot_id,
          };
        }
        if (isDeadlinePassed) {
          return { met: false, reason: 'deadline_passed_not_all_ok' };
        }
        if (summary.no_count > 0) {
          return { met: false, reason: `has_declines: ${summary.no_count}` };
        }
        return { met: false, reason: `pending: ${summary.pending_count}` };

      default:
        return { met: false, reason: 'unknown_policy' };
    }
  }

  /**
   * 特定のスロットがロック済み（OK 回答あり）かどうかをチェック
   * open_slots モードでの先着制に使用
   * 
   * @param threadId スレッドID
   * @param slotId チェックするスロットID
   * @returns ロック済みの場合は invitee_key、未ロックなら null
   */
  async isSlotLocked(threadId: string, slotId: string): Promise<string | null> {
    const result = await this.db.prepare(`
      SELECT invitee_key FROM thread_responses 
      WHERE thread_id = ? AND selected_slot_id = ? AND response = 'ok'
      LIMIT 1
    `).bind(threadId, slotId).first<{ invitee_key: string }>();
    return result?.invitee_key || null;
  }

  /**
   * スレッドのロック済みスロット一覧を取得
   * open_slots モードでの UI 表示に使用
   * 
   * @param threadId スレッドID
   * @returns ロック済みスロットIDの配列
   */
  async getLockedSlotIds(threadId: string): Promise<string[]> {
    const { results } = await this.db.prepare(`
      SELECT DISTINCT selected_slot_id FROM thread_responses 
      WHERE thread_id = ? AND response = 'ok' AND selected_slot_id IS NOT NULL
    `).bind(threadId).all<{ selected_slot_id: string }>();
    return results?.map(r => r.selected_slot_id) || [];
  }

  /**
   * open_slots モードで全枠が埋まったかチェック（auto_finalize 用）
   * 
   * @param threadId スレッドID
   * @returns { allSlotsFilled: boolean; totalSlots: number; filledSlots: number }
   */
  async checkAutoFinalizeOpenSlots(threadId: string): Promise<{
    shouldAutoFinalize: boolean;
    allSlotsFilled: boolean;
    totalSlots: number;
    filledSlots: number;
    reason: string;
  }> {
    // スレッドと policy を取得
    const thread = await this.getById(threadId);
    if (!thread || !thread.group_policy_json) {
      return { 
        shouldAutoFinalize: false, 
        allSlotsFilled: false, 
        totalSlots: 0, 
        filledSlots: 0, 
        reason: 'thread_not_found' 
      };
    }

    const policy: GroupPolicy = JSON.parse(thread.group_policy_json);

    // open_slots モードでない、または auto_finalize=false の場合は対象外
    if (policy.mode !== 'open_slots' || !policy.auto_finalize) {
      return { 
        shouldAutoFinalize: false, 
        allSlotsFilled: false, 
        totalSlots: 0, 
        filledSlots: 0, 
        reason: policy.mode !== 'open_slots' 
          ? 'not_open_slots_mode' 
          : 'auto_finalize_disabled' 
      };
    }

    // すでに confirmed の場合は対象外
    if (thread.status === 'confirmed') {
      return { 
        shouldAutoFinalize: false, 
        allSlotsFilled: true, 
        totalSlots: 0, 
        filledSlots: 0, 
        reason: 'already_confirmed' 
      };
    }

    // 全スロットを取得
    const { results: slots } = await this.db.prepare(`
      SELECT slot_id FROM scheduling_slots WHERE thread_id = ?
    `).bind(threadId).all<{ slot_id: string }>();

    const totalSlots = slots?.length || 0;
    if (totalSlots === 0) {
      return { 
        shouldAutoFinalize: false, 
        allSlotsFilled: false, 
        totalSlots: 0, 
        filledSlots: 0, 
        reason: 'no_slots' 
      };
    }

    // ロック済みスロット（OK 回答あり）を取得
    const lockedSlotIds = await this.getLockedSlotIds(threadId);
    const filledSlots = lockedSlotIds.length;

    const allSlotsFilled = filledSlots >= totalSlots;

    return {
      shouldAutoFinalize: allSlotsFilled,
      allSlotsFilled,
      totalSlots,
      filledSlots,
      reason: allSlotsFilled ? 'all_slots_filled' : `slots_remaining: ${totalSlots - filledSlots}`,
    };
  }

  /**
   * スレッドを confirmed に更新（CAS: 競合防止）
   * 
   * 同時に複数リクエストが最後の枠を埋めるレースを防ぐため、
   * status != 'confirmed' の条件付きで更新する
   * 
   * @param threadId スレッドID
   * @returns { success: boolean; alreadyConfirmed: boolean }
   */
  async tryFinalizeIfNotConfirmed(threadId: string): Promise<{
    success: boolean;
    alreadyConfirmed: boolean;
  }> {
    const now = new Date().toISOString();

    // CAS 更新: status が confirmed でない場合のみ更新
    const result = await this.db.prepare(`
      UPDATE scheduling_threads 
      SET status = 'confirmed', updated_at = ?
      WHERE id = ? AND status != 'confirmed'
    `).bind(now, threadId).run();

    // changes が 1 なら更新成功（このリクエストで確定）
    // changes が 0 なら既に別リクエストで確定済み
    const success = (result.meta?.changes || 0) === 1;
    const alreadyConfirmed = !success;

    return { success, alreadyConfirmed };
  }

  /**
   * 再提案カウント増加
   */
  async incrementReproposalCount(threadId: string): Promise<{ success: boolean; current: number; max: number }> {
    const thread = await this.getById(threadId);
    if (!thread || !thread.group_policy_json) {
      throw new Error('Thread not found');
    }

    const policy: GroupPolicy = JSON.parse(thread.group_policy_json);
    const newCount = policy.reproposal_count + 1;

    if (newCount > policy.max_reproposals) {
      return { success: false, current: policy.reproposal_count, max: policy.max_reproposals };
    }

    policy.reproposal_count = newCount;
    await this.db.prepare(`
      UPDATE scheduling_threads 
      SET group_policy_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(JSON.stringify(policy), threadId).run();

    return { success: true, current: newCount, max: policy.max_reproposals };
  }
}
