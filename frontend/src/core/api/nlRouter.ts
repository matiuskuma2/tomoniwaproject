/**
 * NL Router API Client
 * CONV-1.0: calendar限定のAIルーティング
 * CONV-1.1: params補完（Assist Mode）
 * 
 * 使い方:
 * ```typescript
 * import { nlRouterApi } from './nlRouter';
 * 
 * // CONV-1.0: intent判定
 * const result = await nlRouterApi.route({
 *   text: '来週の午後で空いてるところ教えて',
 *   context: {
 *     selected_thread_id: threadId,
 *     viewer_timezone: 'Asia/Tokyo'
 *   }
 * });
 * 
 * // CONV-1.1: params補完
 * const assist = await nlRouterApi.assist({
 *   text: '来週の午後で空いてる？',
 *   detected_intent: 'schedule.freebusy',
 *   existing_params: {},
 *   viewer_timezone: 'Asia/Tokyo'
 * });
 * ```
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export interface NlRouteRequest {
  text: string;
  context?: {
    selected_thread_id?: string | null;
    viewer_timezone?: string | null;
  };
}

export interface NlRouteResponse {
  intent: string;
  confidence: number;
  params: Record<string, any>;
  needs_clarification?: {
    field: string;
    message: string;
  };
  rationale?: string;
}

// ============================================================
// Calendar-only intents (CONV-1.0)
// ============================================================

export const NL_ROUTER_CALENDAR_INTENTS = [
  'schedule.today',
  'schedule.week',
  'schedule.freebusy',
  'schedule.freebusy.batch',
] as const;

export type NlRouterCalendarIntent = typeof NL_ROUTER_CALENDAR_INTENTS[number];

/**
 * nlRouter が返す intent が calendar系か判定
 */
export function isCalendarIntent(intent: string): intent is NlRouterCalendarIntent {
  return NL_ROUTER_CALENDAR_INTENTS.includes(intent as NlRouterCalendarIntent);
}

// ============================================================
// API Client
// ============================================================

// ============================================================
// CONV-1.1: Assist Types
// ============================================================

export interface NlAssistRequest {
  text: string;
  detected_intent: NlRouterCalendarIntent;
  existing_params: Record<string, unknown>;
  viewer_timezone?: string;
  now_iso?: string;
  context_hint?: {
    selected_thread_id?: string | null;
    participants_count?: number;
  };
}

export interface NlAssistResponse {
  success: boolean;
  data?: {
    target_intent: string;
    params_patch: Record<string, unknown>;
    confidence: number;
    rationale?: string;
  };
  error?: string;
  message?: string;
}

// ============================================================
// CONV-1.2: Multi-intent Types
// ============================================================

export interface NlMultiRouteRequest {
  text: string;
  context?: {
    selected_thread_id?: string | null;
    viewer_timezone?: string | null;
    has_pending_action?: boolean;
  };
}

export interface NlMultiRouteResponse {
  intent: string;
  confidence: number;
  params: Record<string, any>;
  side_effect: 'none' | 'read' | 'write_local' | 'write_external';
  requires_confirmation: boolean;
  confirmation_prompt?: string;
  needs_clarification?: {
    field: string;
    message: string;
  };
  rationale?: string;
}

/**
 * CONV-1.2: multi-intent対応のintent一覧
 * side_effect: write_localでも、後続でwrite_externalになる可能性がある
 */
export const NL_ROUTER_MULTI_INTENTS = {
  // Calendar (READ-ONLY)
  CALENDAR: ['schedule.today', 'schedule.week', 'schedule.freebusy', 'schedule.freebusy.batch'],
  // Thread (READ-ONLY)
  THREAD_READ: ['schedule.status.check', 'thread.summary'],
  // Invite (WRITE_LOCAL → pending → WRITE_EXTERNAL)
  INVITE: ['invite.prepare.emails', 'invite.prepare.list'],
  // Remind (WRITE_LOCAL → pending → WRITE_EXTERNAL)
  REMIND: ['schedule.remind.pending', 'schedule.remind.need_response', 'schedule.remind.responded'],
  // Notify (WRITE_EXTERNAL)
  NOTIFY: ['schedule.notify.confirmed'],
  // List (WRITE_LOCAL)
  LIST: ['list.create', 'list.list', 'list.members', 'list.add_member', 'list.delete'],
  // Contacts (WRITE_LOCAL)
  CONTACTS: ['contacts.add', 'contacts.list'],
  // Group
  GROUP: ['group.create', 'group.list', 'group.invite'],
  // Preference (WRITE_LOCAL)
  PREFERENCE: ['preference.set', 'preference.show', 'preference.clear'],
  // Failure (WRITE_LOCAL)
  FAILURE: ['schedule.fail.report'],
  // Chat
  CHAT: ['chat.general'],
} as const;

/**
 * multi-intent判定用ヘルパー
 */
export function isMultiIntentCategory(intent: string, category: keyof typeof NL_ROUTER_MULTI_INTENTS): boolean {
  return NL_ROUTER_MULTI_INTENTS[category].includes(intent as any);
}

/**
 * 即実行可能なintent（read系 + write_local系で確認不要）
 */
export function isImmediateExecutionIntent(intent: string): boolean {
  const immediate = [
    ...NL_ROUTER_MULTI_INTENTS.CALENDAR,
    ...NL_ROUTER_MULTI_INTENTS.THREAD_READ,
    'list.list',
    'list.members',
    'contacts.list',
    'group.list',
    'preference.show',
  ];
  return immediate.includes(intent);
}

/**
 * pending.actionへ合流するintent
 */
export function isPendingFlowIntent(intent: string): boolean {
  const pendingFlow = [
    ...NL_ROUTER_MULTI_INTENTS.INVITE,
    ...NL_ROUTER_MULTI_INTENTS.REMIND,
    ...NL_ROUTER_MULTI_INTENTS.NOTIFY,
    'group.invite',
  ];
  return pendingFlow.includes(intent);
}

// ============================================================
// API Client
// ============================================================

export const nlRouterApi = {
  /**
   * CONV-1.0: 自然言語をintentに変換
   * 
   * @param req - リクエスト
   * @returns NlRouteResponse
   * @throws Error - API エラー時
   */
  async route(req: NlRouteRequest): Promise<NlRouteResponse> {
    return api.post<NlRouteResponse>('/api/nl/route', req);
  },

  /**
   * CONV-1.1: params補完（intentは変更しない）
   * 
   * @param req - リクエスト
   * @returns NlAssistResponse
   * @throws Error - API エラー時
   */
  async assist(req: NlAssistRequest): Promise<NlAssistResponse> {
    return api.post<NlAssistResponse>('/api/nl/assist', req);
  },

  /**
   * CONV-1.2: multi-intent対応ルーティング
   * 
   * calendar系以外も対応:
   * - invite/remind/notify → pendingフローへ
   * - list/contacts/group → 即実行
   * - chat.general → 雑談フォールバック
   * 
   * @param req - リクエスト
   * @returns NlMultiRouteResponse
   * @throws Error - API エラー時
   */
  async multi(req: NlMultiRouteRequest): Promise<NlMultiRouteResponse> {
    return api.post<NlMultiRouteResponse>('/api/nl/multi', req);
  },
};
