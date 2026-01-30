/**
 * One-to-Many (1対N Broadcast Scheduling) API
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

/** 成立条件ポリシー */
export type FinalizePolicy = 
  | 'organizer_decides'  // 主催者が手動確定（デフォルト）
  | 'quorum'             // 最小定足数達成で確定
  | 'required_people'    // 必須参加者全員が OK で確定
  | 'all_required';      // 全員 OK で確定

/** 1対N モード */
export type OneToManyMode = 
  | 'fixed'           // 日時決め打ち
  | 'candidates'      // 複数候補から選択
  | 'open_slots'      // 申込カレンダー型
  | 'range_auto';     // 範囲→自動候補生成

/** グループポリシー */
export interface GroupPolicy {
  mode: OneToManyMode;
  deadline_at: string;
  finalize_policy: FinalizePolicy;
  quorum_count?: number;
  required_invitee_keys?: string[];
  auto_finalize: boolean;
  max_reproposals: number;
  reproposal_count: number;
  participant_limit?: number;
}

/** スロット */
export interface Slot {
  start_at: string;
  end_at: string;
  label?: string;
}

/** 招待者 */
export interface Invitee {
  email: string;
  name: string;
  contact_id?: string;
}

/** スレッド基本情報 */
export interface OneToManyThread {
  id: string;
  title: string;
  description?: string;
  status: 'draft' | 'sent' | 'confirmed' | 'cancelled';
  mode?: OneToManyMode;
  kind: 'external' | 'internal';
  topology: 'one_on_one' | 'one_to_many';
  created_at: string;
  updated_at?: string;
}

/** 回答 */
export interface ThreadResponse {
  id: string;
  thread_id: string;
  invitee_key: string;
  response: 'ok' | 'no' | 'maybe';
  selected_slot_id?: string;
  comment?: string;
  responded_at: string;
}

/** 回答集計 */
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

/** 成立条件チェック結果 */
export interface FinalizationCheck {
  met: boolean;
  reason: string;
  recommended_slot_id?: string;
}

// ============================================================
// Request / Response Types
// ============================================================

export interface PrepareRequest {
  title: string;
  description?: string;
  mode: OneToManyMode;
  kind?: 'external' | 'internal';
  deadline_hours?: number;
  finalize_policy?: FinalizePolicy;
  quorum_count?: number;
  required_contact_ids?: string[];
  auto_finalize?: boolean;
  participant_limit?: number;
  contact_ids?: string[];
  list_id?: string;
  emails?: string[];
  slots?: Slot[];
}

export interface PrepareResponse {
  success: boolean;
  thread: OneToManyThread;
  group_policy: GroupPolicy;
  invitees: Invitee[];
  invitees_count: number;
  slots: Slot[];
  next_action: string;
}

export interface SendRequest {
  invitees: Invitee[];
  channel_type?: 'email' | 'slack' | 'chatwork';
}

export interface SendResponse {
  success: boolean;
  thread_id: string;
  sent_count: number;
  total: number;
  channel: string;
  status: string;
}

export interface ThreadDetailResponse {
  thread: OneToManyThread;
  group_policy: GroupPolicy;
  slots: any[];
  invites: any[];
  summary: ResponseSummary;
  finalization: FinalizationCheck;
}

export interface ThreadListResponse {
  threads: OneToManyThread[];
  total: number;
  limit: number;
  offset: number;
}

export interface SummaryResponse {
  thread_id: string;
  summary: ResponseSummary;
  finalization: FinalizationCheck;
}

export interface RespondRequest {
  invitee_key?: string;
  response: 'ok' | 'no' | 'maybe';
  selected_slot_id?: string;
  comment?: string;
}

export interface RespondResponse {
  success: boolean;
  response: ThreadResponse;
  finalization: FinalizationCheck;
}

export interface FinalizeRequest {
  selected_slot_id: string;
  reason?: string;
}

export interface FinalizeResponse {
  success: boolean;
  thread_id: string;
  status: string;
  selected_slot: {
    id: string;
    start_time: string;
    end_time: string;
  };
}

export interface ReproposeRequest {
  new_slots: Slot[];
  new_deadline_hours?: number;
  message?: string;
}

export interface ReproposeResponse {
  success: boolean;
  thread_id: string;
  reproposal_count: number;
  max_reproposals: number;
  new_slots_count: number;
}

// ============================================================
// API Client
// ============================================================

export const oneToManyApi = {
  /**
   * スレッド作成準備
   */
  async prepare(data: PrepareRequest): Promise<PrepareResponse> {
    return api.post('/api/one-to-many/prepare', data);
  },

  /**
   * スレッド詳細取得
   */
  async get(threadId: string): Promise<ThreadDetailResponse> {
    return api.get(`/api/one-to-many/${threadId}`);
  },

  /**
   * スレッド一覧取得
   */
  async list(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<ThreadListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    const query = searchParams.toString();
    return api.get(`/api/one-to-many${query ? `?${query}` : ''}`);
  },

  /**
   * 招待送信
   */
  async send(threadId: string, data: SendRequest): Promise<SendResponse> {
    return api.post(`/api/one-to-many/${threadId}/send`, data);
  },

  /**
   * 回答集計取得
   */
  async getSummary(threadId: string): Promise<SummaryResponse> {
    return api.get(`/api/one-to-many/${threadId}/summary`);
  },

  /**
   * 回答登録
   */
  async respond(threadId: string, data: RespondRequest): Promise<RespondResponse> {
    return api.post(`/api/one-to-many/${threadId}/respond`, data);
  },

  /**
   * 手動確定
   */
  async finalize(threadId: string, data: FinalizeRequest): Promise<FinalizeResponse> {
    return api.post(`/api/one-to-many/${threadId}/finalize`, data);
  },

  /**
   * 再提案
   */
  async repropose(threadId: string, data: ReproposeRequest): Promise<ReproposeResponse> {
    return api.post(`/api/one-to-many/${threadId}/repropose`, data);
  },
};
