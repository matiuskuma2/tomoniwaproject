/**
 * ThreadViewModel - UI表示用のSSOT型定義
 * 
 * 目的:
 * - ThreadStatus_API から UI 表示に必要な情報を抽出
 * - mode/topology に基づいてカード表示を分岐
 * - 投票UI / 予約枠UI / 1対1UI を適切に切り替える
 * 
 * トポロジー:
 * - one_on_one: 1対1（fixed/candidates/freebusy）
 * - one_to_many: 1対N（candidates/open_slots）
 * - many_to_one: N対1（pool_booking）
 * - many_to_many: N対N（MVP対象外）
 * 
 * モード:
 * - fixed: 日時確定（1対1）
 * - candidates: 候補日時から選択（投票型）
 * - open_slots: 申込式（先着順）
 * - range_auto: 範囲指定で自動確定
 * - pool_booking: プール予約（N対1）
 */

import type { ThreadStatus_API, Slot, InviteStatus } from './index';

// ============================================================
// Topology & Mode Types
// ============================================================

/**
 * スレッドのトポロジー（参加者構造）
 */
export type ThreadTopology = 
  | 'one_on_one'     // 1対1
  | 'one_to_many'    // 1対N
  | 'many_to_one'    // N対1 (pool)
  | 'many_to_many';  // N対N (MVP対象外)

/**
 * スレッドのモード（調整方式）
 */
export type ThreadMode = 
  | 'fixed'          // 日時確定（1対1）
  | 'candidates'     // 候補日時から選択（投票型）
  | 'open_slots'     // 申込式（先着順）
  | 'range_auto'     // 範囲指定で自動確定
  | 'pool_booking';  // プール予約（N対1）

/**
 * 確定ポリシー
 */
export type FinalizePolicy = 
  | 'organizer_manual'  // 主催者が手動で確定
  | 'all_responded'     // 全員回答で確定
  | 'first_match'       // 最初にマッチで確定
  | 'deadline';         // 締切で確定

// ============================================================
// ViewModel Types
// ============================================================

/**
 * ThreadViewModel - カード表示用の統一ビューモデル
 */
export interface ThreadViewModel {
  // 基本情報
  threadId: string;
  title: string;
  description?: string;
  status: 'draft' | 'active' | 'confirmed' | 'cancelled' | 'failed';
  
  // トポロジー・モード
  topology: ThreadTopology;
  mode: ThreadMode;
  
  // 確定ポリシー
  finalizePolicy: FinalizePolicy;
  autoFinalize: boolean;
  deadlineAt?: string;
  
  // 招待者情報
  invitees: InviteeViewModel[];
  totalInvitees: number;
  respondedCount: number;
  pendingCount: number;
  
  // スロット情報（モード別に解釈が変わる）
  slots: SlotViewModel[];
  totalSlots: number;
  
  // 確定情報
  isFinalized: boolean;
  finalSlotId?: string;
  finalSlot?: SlotViewModel;
  meetingUrl?: string;
  
  // Phase2: 追加候補情報
  proposalVersion: number;
  remainingProposals: number;
  needsResponseCount: number;
  needsResponseInvitees: string[];
  
  // UI表示用フラグ
  showVotesUI: boolean;        // 投票数を表示するか
  showSlotStatusUI: boolean;   // 枠の状態（空き/埋まり）を表示するか
  showAssigneeUI: boolean;     // 担当者を表示するか
  canFinalize: boolean;        // 確定ボタンを表示するか
}

/**
 * InviteeViewModel - 招待者表示用
 */
export interface InviteeViewModel {
  id: string;
  email: string;
  name?: string;
  status: InviteStatus | 'needs_response';
  inviteUrl?: string;
  respondedAt?: string;
  // Phase2: 再回答必要かどうか
  needsResponse: boolean;
  respondedVersion?: number;
}

/**
 * SlotViewModel - スロット表示用
 */
export interface SlotViewModel {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  label?: string;
  
  // 投票型（candidates）
  votes?: number;
  voters?: string[];
  
  // 申込式（open_slots）/ Pool
  slotStatus?: 'open' | 'reserved' | 'booked' | 'cancelled';
  
  // Pool Booking
  assigneeId?: string;
  assigneeName?: string;
  requesterId?: string;
  requesterName?: string;
  
  // Phase2
  proposalVersion: number;
  isLatest: boolean;
}

// ============================================================
// Factory Function
// ============================================================

/**
 * ThreadStatus_API から ThreadViewModel を生成
 * 
 * @param status - API レスポンス
 * @returns ThreadViewModel
 */
export function createThreadViewModel(status: ThreadStatus_API): ThreadViewModel {
  const thread = status.thread;
  const rule = status.rule;
  
  // トポロジー・モードを推定
  const { topology, mode } = inferTopologyAndMode(status);
  
  // 確定ポリシー
  const finalizePolicy = (rule.finalize_policy as FinalizePolicy) || 'organizer_manual';
  const autoFinalize = finalizePolicy !== 'organizer_manual';
  
  // 招待者情報
  const invitees = status.invites.map(inv => createInviteeViewModel(inv, status));
  const respondedCount = invitees.filter(i => i.status === 'accepted' || i.status === 'declined').length;
  const pendingCount = invitees.filter(i => i.status === null || i.status === 'pending').length;
  
  // スロット情報
  const currentVersion = status.proposal_info?.current_version ?? 1;
  const slots = status.slots.map(slot => createSlotViewModel(slot, currentVersion, status));
  
  // 確定情報
  const isFinalized = status.evaluation.finalized === true;
  const finalSlotId = status.evaluation.final_slot_id;
  const finalSlot = finalSlotId ? slots.find(s => s.id === finalSlotId) : undefined;
  const meetingUrl = status.evaluation.meeting?.url;
  
  // Phase2: 追加候補情報
  const proposalInfo = status.proposal_info;
  const needsResponseInvitees = proposalInfo?.invitees_needing_response?.map(i => i.name || i.email) || [];
  
  // UI表示フラグ
  const showVotesUI = topology === 'one_to_many' && mode === 'candidates';
  const showSlotStatusUI = mode === 'open_slots' || mode === 'pool_booking';
  const showAssigneeUI = topology === 'many_to_one';
  const canFinalize = thread.status === 'active' && !isFinalized && respondedCount > 0;
  
  return {
    threadId: thread.id,
    title: thread.title,
    description: thread.description,
    status: thread.status,
    
    topology,
    mode,
    
    finalizePolicy,
    autoFinalize,
    deadlineAt: rule.details?.deadline_at,
    
    invitees,
    totalInvitees: invitees.length,
    respondedCount,
    pendingCount,
    
    slots,
    totalSlots: slots.length,
    
    isFinalized,
    finalSlotId,
    finalSlot,
    meetingUrl,
    
    proposalVersion: currentVersion,
    remainingProposals: proposalInfo?.remaining_proposals ?? 0,
    needsResponseCount: proposalInfo?.invitees_needing_response_count ?? 0,
    needsResponseInvitees,
    
    showVotesUI,
    showSlotStatusUI,
    showAssigneeUI,
    canFinalize,
  };
}

/**
 * ThreadStatus_API からトポロジーとモードを推定
 */
function inferTopologyAndMode(status: ThreadStatus_API): { topology: ThreadTopology; mode: ThreadMode } {
  const thread = status.thread;
  const rule = status.rule;
  
  // thread.mode が明示されている場合
  if (thread.mode) {
    const modeStr = thread.mode.toLowerCase();
    
    // Pool Booking
    if (modeStr === 'pool_booking' || modeStr.includes('pool')) {
      return { topology: 'many_to_one', mode: 'pool_booking' };
    }
    
    // 1対1
    if (modeStr === 'one_on_one' || modeStr === 'fixed' || modeStr === 'freebusy') {
      return { topology: 'one_on_one', mode: modeStr === 'fixed' ? 'fixed' : 'candidates' };
    }
    
    // 申込式
    if (modeStr === 'open_slots' || modeStr === 'range_auto') {
      return { topology: 'one_to_many', mode: modeStr as ThreadMode };
    }
  }
  
  // rule.type からの推定
  if (rule.type) {
    const ruleType = rule.type.toLowerCase();
    
    if (ruleType === 'one_on_one') {
      return { topology: 'one_on_one', mode: 'candidates' };
    }
    
    if (ruleType === 'pool_booking') {
      return { topology: 'many_to_one', mode: 'pool_booking' };
    }
  }
  
  // 招待者数からの推定
  const inviteCount = status.invites.length;
  
  if (inviteCount === 1) {
    return { topology: 'one_on_one', mode: 'candidates' };
  }
  
  // デフォルト: 1対N candidates
  return { topology: 'one_to_many', mode: 'candidates' };
}

/**
 * InviteeViewModel を生成
 */
function createInviteeViewModel(
  invite: ThreadStatus_API['invites'][0],
  status: ThreadStatus_API
): InviteeViewModel {
  const proposalInfo = status.proposal_info;
  const needsResponse = proposalInfo?.invitees_needing_response?.some(
    i => i.invitee_key === invite.invitee_key || i.email === invite.email
  ) ?? false;
  
  return {
    id: invite.invite_id,
    email: invite.email,
    name: invite.candidate_name,
    // status is InviteStatus | null in API, convert null to 'pending'
    status: needsResponse ? 'needs_response' : (invite.status ?? 'pending'),
    inviteUrl: invite.invite_url,
    respondedAt: invite.responded_at,
    needsResponse,
    respondedVersion: undefined, // TODO: API から取得
  };
}

/**
 * SlotViewModel を生成
 */
function createSlotViewModel(
  slot: Slot,
  currentVersion: number,
  _status: ThreadStatus_API // Prefixed with _ to indicate intentionally unused (may be used later)
): SlotViewModel {
  const version = slot.proposal_version ?? 1;
  
  return {
    id: slot.slot_id,
    startAt: slot.start_at,
    endAt: slot.end_at,
    timezone: slot.timezone,
    label: slot.label,
    
    votes: slot.votes,
    voters: undefined, // TODO: selections から計算
    
    slotStatus: 'open', // TODO: Pool の場合は実際のステータスを取得
    
    proposalVersion: version,
    isLatest: version === currentVersion,
  };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * トポロジーの日本語ラベル
 */
export function getTopologyLabel(topology: ThreadTopology): string {
  const labels: Record<ThreadTopology, string> = {
    one_on_one: '1対1',
    one_to_many: '1対N',
    many_to_one: 'N対1（プール）',
    many_to_many: 'N対N',
  };
  return labels[topology];
}

/**
 * モードの日本語ラベル
 */
export function getModeLabel(mode: ThreadMode): string {
  const labels: Record<ThreadMode, string> = {
    fixed: '日時確定',
    candidates: '候補から選択',
    open_slots: '申込式',
    range_auto: '自動確定',
    pool_booking: 'プール予約',
  };
  return labels[mode];
}

/**
 * 表示用バッジカラー
 */
export function getTopologyBadgeClass(topology: ThreadTopology): string {
  const colors: Record<ThreadTopology, string> = {
    one_on_one: 'bg-blue-100 text-blue-800',
    one_to_many: 'bg-green-100 text-green-800',
    many_to_one: 'bg-purple-100 text-purple-800',
    many_to_many: 'bg-gray-100 text-gray-800',
  };
  return colors[topology];
}
