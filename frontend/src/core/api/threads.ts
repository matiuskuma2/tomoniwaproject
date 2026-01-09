/**
 * Threads API
 * Beta A: Added prepareSend/prepareInvites for pending action flow
 */

import { api } from './client';
import type { Thread, ThreadStatus_API, FinalizeResponse } from '../models';
import type { PrepareSendResponse } from './pendingActions';

// ============================================================
// Types for Beta A
// ============================================================

export interface PrepareSendInput {
  source_type: 'emails' | 'list';
  emails?: string[];
  list_id?: string;
  title?: string;
}

export interface PrepareInvitesInput {
  source_type: 'emails' | 'list';
  emails?: string[];
  list_id?: string;
}

export const threadsApi = {
  /**
   * Get all threads
   */
  async list(): Promise<{ threads: Thread[] }> {
    return api.get('/api/threads');
  },

  /**
   * Get thread details
   */
  async get(threadId: string): Promise<{ thread: Thread }> {
    return api.get(`/api/threads/${threadId}`);
  },

  /**
   * Create new thread
   */
  async create(data: {
    title: string;
    description?: string;
    target_list_id?: string;
    candidates?: Array<{
      name: string;
      email: string;
    }>;
  }): Promise<{
    thread: Thread;
    candidates?: Array<{
      name: string;
      email: string;
      reason: string;
      invite_token: string;
      invite_url: string;
    }>;
    message?: string;
    skipped_count?: number;
  }> {
    return api.post('/api/threads', data);
  },

  /**
   * Get thread status (invites, slots, progress)
   */
  async getStatus(threadId: string): Promise<ThreadStatus_API> {
    return api.get(`/api/threads/${threadId}/status`);
  },

  /**
   * Send reminder to pending invites (Phase Next-6 Day1.5: A案)
   * A案: メール送信しない、送信用セットを返す
   */
  async sendReminder(threadId: string): Promise<{
    success: boolean;
    reminded_count: number;
    reminded_invites: Array<{
      email: string;
      name?: string;
      invite_url: string;
      template_message: string;
    }>;
    message?: string;
  }> {
    return api.post(`/api/threads/${threadId}/remind`, {});
  },

  /**
   * Finalize thread (confirm schedule + generate Meet)
   */
  async finalize(
    threadId: string,
    data: { selected_slot_id: string; reason?: string }
  ): Promise<FinalizeResponse> {
    return api.post(`/api/threads/${threadId}/finalize`, data);
  },

  /**
   * Add bulk invites from list to existing thread
   * Phase P0-4: Chat-driven bulk invite
   */
  async addBulkInvites(
    threadId: string,
    data: { target_list_id: string }
  ): Promise<{
    success: boolean;
    thread_id: string;
    list_name: string;
    inserted: number;
    skipped: number;
    failed: number;
    total_invited: number;
    message: string;
  }> {
    return api.post(`/api/threads/${threadId}/invites/batch`, data);
  },

  // ============================================================
  // Beta A: Pending Action Flow (prepare → confirm → execute)
  // ============================================================

  /**
   * 新規スレッド送信準備
   * POST /api/threads/prepare-send
   * 
   * スレッド未選択時にメール/リストを入力した場合に呼ばれる
   * → pending_action を作成し、confirm_token を返す
   * → サマリを表示して「送る/キャンセル/別スレッドで」の入力待ち
   */
  async prepareSend(data: PrepareSendInput): Promise<PrepareSendResponse> {
    return api.post('/api/threads/prepare-send', data);
  },

  /**
   * 追加招待準備
   * POST /api/threads/:threadId/invites/prepare
   * 
   * スレッド選択中にメール/リストを入力した場合に呼ばれる
   * → pending_action を作成し、confirm_token を返す
   * → サマリを表示して「送る/キャンセル/別スレッドで」の入力待ち
   */
  async prepareInvites(threadId: string, data: PrepareInvitesInput): Promise<PrepareSendResponse> {
    return api.post(`/api/threads/${threadId}/invites/prepare`, data);
  },
};
