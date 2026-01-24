/**
 * Chat API Client
 * CONV-CHAT: AI秘書との会話
 * 
 * 使い方:
 * ```typescript
 * import { chatApi } from './chat';
 * 
 * const result = await chatApi.sendMessage({
 *   text: 'こんにちは',
 *   context: { thread_id: threadId }
 * });
 * console.log(result.message); // AI応答
 * ```
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export interface ChatMessageRequest {
  text: string;
  context?: {
    thread_id?: string | null;
  };
}

export interface ChatMessageResponse {
  message: string;
  intent_detected?: string;
  should_execute?: boolean;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  thread_id: string | null;
  created_at: string;
}

export interface ChatHistoryResponse {
  messages: ChatHistoryMessage[];
}

// ============================================================
// API Client
// ============================================================

export const chatApi = {
  /**
   * AI秘書にメッセージを送信
   * 
   * @param req - リクエスト
   * @returns ChatMessageResponse
   * @throws Error - API エラー時
   */
  async sendMessage(req: ChatMessageRequest): Promise<ChatMessageResponse> {
    return api.post<ChatMessageResponse>('/api/chat/message', req);
  },

  /**
   * 会話履歴を取得
   * 
   * @param limit - 取得件数（デフォルト20）
   * @returns ChatHistoryResponse
   * @throws Error - API エラー時
   */
  async getHistory(limit: number = 20): Promise<ChatHistoryResponse> {
    return api.get<ChatHistoryResponse>(`/api/chat/history?limit=${limit}`);
  },
};
