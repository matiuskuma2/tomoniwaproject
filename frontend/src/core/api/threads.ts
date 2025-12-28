/**
 * Threads API
 */

import { api } from './client';
import type { Thread, ThreadStatus_API, FinalizeResponse } from '../models';

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
   * Send reminder to pending invites
   */
  async sendReminder(threadId: string): Promise<{
    success: boolean;
    reminded_count: number;
  }> {
    return api.post(`/api/threads/${threadId}/remind`);
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
};
