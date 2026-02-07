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

  // =============================================================================
  // PR-D-1.1: 連絡先取り込みAPI
  // =============================================================================

  /**
   * PR-D-1.1: テキストから連絡先を解析（プレビュー生成）
   * 
   * @param data - text: 取り込みテキスト, source: 取り込み元（text/email/csv）
   * @returns プレビュー結果とconfirmation_token
   */
  async importPreview(data: {
    text: string;
    source?: 'text' | 'email' | 'csv';
  }): Promise<ContactImportPreviewResponse> {
    return api.post('/api/contacts/import', data);
  },

  /**
   * PR-D-1.1: 取り込みを確定実行
   * 
   * @param data - confirmation_token 必須、その他オプション
   * @returns 登録結果
   */
  async importConfirm(data: {
    confirmation_token: string;
    skip_ambiguous?: boolean;
    selected_indices?: number[];
    ambiguous_actions?: Array<{
      candidate_index: number;
      action: 'create_new' | 'skip' | 'update_existing';
      existing_id?: string;
    }>;
  }): Promise<ContactImportConfirmResponse> {
    return api.post('/api/contacts/import/confirm', data);
  },
};

// =============================================================================
// PR-D-API-1: Contact Import API (新エンドポイント)
// /api/contacts/import/preview | person-select | confirm | cancel
// =============================================================================

export const contactsImportApi = {
  /**
   * PR-D-API-1: プレビュー（テキスト/CSV → パース → 曖昧一致検出 → pending作成）
   */
  async preview(data: {
    source: 'text' | 'csv';
    raw_text: string;
  }): Promise<ContactImportNewPreviewResponse> {
    return api.post('/api/contacts/import/preview', data);
  },

  /**
   * PR-D-API-1: 曖昧一致の解決（番号選択）
   */
  async personSelect(data: {
    pending_action_id: string;
    entry_index: number;
    action: 'select' | 'new' | 'skip';
    selected_number?: number;
  }): Promise<ContactImportPersonSelectNewResponse> {
    return api.post('/api/contacts/import/person-select', data);
  },

  /**
   * PR-D-API-1: 確定（contacts書き込み）
   * Gate-4: confirm のみ書き込み
   */
  async confirm(data: {
    pending_action_id: string;
  }): Promise<ContactImportConfirmNewResponse> {
    return api.post('/api/contacts/import/confirm', data);
  },

  /**
   * PR-D-API-1: キャンセル（書き込みゼロ保証）
   */
  async cancel(data: {
    pending_action_id: string;
  }): Promise<{ success: boolean; message: string }> {
    return api.post('/api/contacts/import/cancel', data);
  },
};

// =============================================================================
// PR-D-API-1: 新レスポンス型定義
// =============================================================================

export interface ContactImportNewPreviewResponse {
  pending_action_id: string;
  expires_at: string;
  summary: {
    total_count: number;
    exact_match_count: number;
    ambiguous_count: number;
    new_count: number;
    skipped_count: number;
    missing_email_count: number;
    source: 'text' | 'csv';
    preview_entries: Array<{
      name: string;
      email?: string;
      match_status: 'exact' | 'ambiguous' | 'new' | 'skipped';
      candidate_count?: number;
    }>;
  };
  parsed_entries: Array<{
    index: number;
    name: string;
    email?: string;
    missing_email: boolean;
    match_status: 'exact' | 'ambiguous' | 'new' | 'skipped';
    ambiguous_candidates?: Array<{
      number: number;
      contact_id: string;
      display_name: string;
      email?: string;
      score: number;
    }>;
    resolved_action?: {
      type: 'create_new' | 'select_existing' | 'skip';
      contact_id?: string;
    };
  }>;
  csv_warnings: string[];
  next_pending_kind: string;
  message: string;
}

export interface ContactImportPersonSelectNewResponse {
  updated_entry: {
    index: number;
    name: string;
    email?: string;
    match_status: string;
    resolved_action?: {
      type: 'create_new' | 'select_existing' | 'skip';
      contact_id?: string;
    };
  };
  all_resolved: boolean;
  remaining_unresolved: number;
  next_pending_kind: string;
  message: string;
}

export interface ContactImportConfirmNewResponse {
  success: boolean;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  created_contacts: Array<{
    id: string;
    display_name: string;
    email?: string;
  }>;
}

// =============================================================================
// PR-D-1.1: 型定義（旧API — 後方互換）
// =============================================================================

/**
 * 取り込み候補
 */
export interface ImportCandidate {
  raw_line: string;
  display_name: string | null;
  email: string | null;
  status: 'ok' | 'missing_email' | 'invalid_email' | 'parse_error';
  error_message?: string;
}

/**
 * 曖昧一致情報
 */
export interface AmbiguousMatch {
  candidate_index: number;
  candidate_name: string | null;
  candidate_email: string | null;
  existing_contacts: Array<{
    id: string;
    display_name: string | null;
    email: string | null;
  }>;
  reason: 'same_name' | 'similar_name' | 'email_exists';
}

/**
 * プレビューレスポンス
 */
export interface ContactImportPreviewResponse {
  preview: {
    candidates: ImportCandidate[];
    ambiguous_matches: AmbiguousMatch[];
    total_lines: number;
    valid_count: number;
    missing_email_count: number;
    invalid_email_count: number;
  };
  requires_confirmation: boolean;
  confirmation_token: string;
  message: string;
}

/**
 * 確定レスポンス
 */
export interface ContactImportConfirmResponse {
  created: Array<{ id: string; display_name: string | null; email: string | null }>;
  skipped: Array<{ raw_line: string; reason: string }>;
  updated: Array<{ id: string; display_name: string | null; email: string | null }>;
  errors: Array<{ raw_line: string; error: string }>;
  summary: {
    total_processed: number;
    created_count: number;
    skipped_count: number;
    updated_count: number;
    error_count: number;
  };
}
