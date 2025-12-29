/**
 * Inbox API
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

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<{ success: boolean }> {
    return api.patch(`/api/inbox/${notificationId}`, { read: true });
  },
};
