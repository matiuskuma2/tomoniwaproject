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
};
