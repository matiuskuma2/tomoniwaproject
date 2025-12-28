/**
 * Lists API
 */

import { api } from './client';
import type { List, ListMember, PaginatedResponse } from '../models';

export const listsApi = {
  /**
   * Get all lists
   */
  async list(): Promise<PaginatedResponse<List>> {
    return api.get('/api/lists');
  },

  /**
   * Get list by ID
   */
  async get(listId: string): Promise<List> {
    return api.get(`/api/lists/${listId}`);
  },

  /**
   * Create new list
   */
  async create(data: {
    name: string;
    description?: string;
  }): Promise<List> {
    return api.post('/api/lists', data);
  },

  /**
   * Update list
   */
  async update(
    listId: string,
    data: Partial<{
      name: string;
      description: string;
    }>
  ): Promise<List> {
    return api.put(`/api/lists/${listId}`, data);
  },

  /**
   * Delete list
   */
  async delete(listId: string): Promise<{ success: boolean }> {
    return api.delete(`/api/lists/${listId}`);
  },

  /**
   * Get list members (with JOIN data from contacts)
   */
  async getMembers(listId: string): Promise<PaginatedResponse<ListMember>> {
    return api.get(`/api/lists/${listId}/members`);
  },

  /**
   * Add member to list
   */
  async addMember(
    listId: string,
    data: { contact_id: string }
  ): Promise<ListMember> {
    return api.post(`/api/lists/${listId}/members`, data);
  },

  /**
   * Remove member from list
   */
  async removeMember(
    listId: string,
    memberId: string
  ): Promise<{ success: boolean }> {
    return api.delete(`/api/lists/${listId}/members/${memberId}`);
  },
};
