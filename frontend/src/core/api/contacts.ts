/**
 * Contacts API
 */

import { api } from './client';
import type { Contact, PaginatedResponse } from '../models';

export const contactsApi = {
  /**
   * List contacts with optional search
   */
  async list(params?: {
    q?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Contact>> {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.get(`/api/contacts${query ? `?${query}` : ''}`);
  },

  /**
   * Get contact by ID
   */
  async get(contactId: string): Promise<Contact> {
    return api.get(`/api/contacts/${contactId}`);
  },

  /**
   * Create new contact
   */
  async create(data: {
    kind: string;
    email?: string;
    display_name: string;
    relationship_type?: string;
    tags?: string[];
    notes?: string;
  }): Promise<Contact> {
    return api.post('/api/contacts', data);
  },

  /**
   * Update contact
   */
  async update(
    contactId: string,
    data: Partial<{
      display_name: string;
      email: string;
      relationship_type: string;
      tags: string[];
      notes: string;
    }>
  ): Promise<Contact> {
    return api.put(`/api/contacts/${contactId}`, data);
  },

  /**
   * Delete contact
   */
  async delete(contactId: string): Promise<{ success: boolean }> {
    return api.delete(`/api/contacts/${contactId}`);
  },

  /**
   * P2-E2: Upsert contact by email (for SMS phone number)
   * - Creates new contact if not exists
   * - Updates phone if contact exists
   * @param data - email and phone (E.164 format)
   */
  async upsertByEmail(data: {
    email: string;
    phone: string;
    display_name?: string;
  }): Promise<{ success: boolean; contact: { id: string; email: string; phone: string } }> {
    return api.post('/api/contacts/upsert', data);
  },
};
