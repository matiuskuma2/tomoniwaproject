/**
 * NL Router API Client
 * CONV-1.0: calendar限定のAIルーティング
 * 
 * 使い方:
 * ```typescript
 * import { nlRouterApi } from './nlRouter';
 * 
 * const result = await nlRouterApi.route({
 *   text: '来週の午後で空いてるところ教えて',
 *   context: {
 *     selected_thread_id: threadId,
 *     viewer_timezone: 'Asia/Tokyo'
 *   }
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

export const nlRouterApi = {
  /**
   * 自然言語をintentに変換
   * 
   * @param req - リクエスト
   * @returns NlRouteResponse
   * @throws Error - API エラー時
   */
  async route(req: NlRouteRequest): Promise<NlRouteResponse> {
    return api.post<NlRouteResponse>('/api/nl/route', req);
  },
};
