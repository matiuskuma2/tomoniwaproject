/**
 * Inbox API
 * Phase Next-1: GET only → Phase Next-2: 既読/未読操作追加
 * 
 * NOTIFICATION_SYSTEM_PLAN.md: 既読ロジック修正
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
   * Get unread count only (lightweight endpoint)
   */
  async getUnreadCount(): Promise<{ unread_count: number }> {
    return api.get('/api/inbox/unread-count');
  },

  /**
   * Mark a notification as read
   * PATCH /api/inbox/:id/read
   */
  async markAsRead(notificationId: string): Promise<{ message: string; id: string }> {
    return api.patch(`/api/inbox/${notificationId}/read`, {});
  },

  /**
   * Mark a notification as unread
   * PATCH /api/inbox/:id/unread
   */
  async markAsUnread(notificationId: string): Promise<{ message: string; id: string }> {
    return api.patch(`/api/inbox/${notificationId}/unread`, {});
  },

  /**
   * Mark all notifications as read
   * POST /api/inbox/mark-all-read
   */
  async markAllAsRead(): Promise<{ message: string; changed_count: number }> {
    return api.post('/api/inbox/mark-all-read', {});
  },

  /**
   * Delete a notification
   * DELETE /api/inbox/:id
   */
  async delete(notificationId: string): Promise<{ message: string; id: string }> {
    return api.delete(`/api/inbox/${notificationId}`);
  },

  /**
   * Delete all read notifications
   * DELETE /api/inbox/clear-read
   */
  async clearRead(): Promise<{ message: string; deleted_count: number }> {
    return api.delete('/api/inbox/clear-read');
  },
};
