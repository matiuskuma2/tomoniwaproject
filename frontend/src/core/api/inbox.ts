/**
 * Inbox API
 * Phase Next-1: GET only
 */

import { api } from './client';
import type { InboxNotification } from '../models';

export const inboxApi = {
  /**
   * Get all inbox notifications
   */
  async list(): Promise<{ items: InboxNotification[] }> {
    return api.get('/api/inbox');
  },

  // Phase Next-2+: Mark as read (PATCH)
  // async markAsRead(notificationId: string): Promise<{ success: boolean }> {
  //   return api.patch(`/api/inbox/${notificationId}`, { read: true });
  // },
};
