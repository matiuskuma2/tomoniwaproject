/**
 * Core Models - Type Definitions
 * These types match the backend API responses
 */

// ============================================================
// User & Auth
// ============================================================
export interface User {
  id: string;
  email: string;
  display_name?: string;
  created_at: string;
}

export interface AuthToken {
  access_token: string;
  user: User;
}

// ============================================================
// Thread (Scheduling)
// ============================================================
export interface Thread {
  id: string;
  organizer_user_id: string;
  title: string;
  description?: string;
  status: ThreadStatus;
  created_at: string;
  updated_at: string;
}

export type ThreadStatus = 'draft' | 'active' | 'confirmed' | 'cancelled';

export interface Slot {
  slot_id: string;
  thread_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  label?: string;
  created_at: string;
}

export interface ThreadInvite {
  id: string;
  thread_id: string;
  invitee_key: string;
  email: string;
  name?: string;
  status: InviteStatus;
  token: string;
  created_at: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface ThreadStatus_API {
  thread_id: string;
  title: string;
  status: ThreadStatus;
  pending_count: number;
  accepted_count: number;
  declined_count: number;
  total_invites: number;
  pending_invites: ThreadInvite[];
  accepted_invites: ThreadInvite[];
  declined_invites: ThreadInvite[];
  slots: Slot[];
}

export interface Meeting {
  provider: 'google_meet';
  url: string;
  calendar_event_id?: string;
}

export interface FinalizeResponse {
  finalized: boolean;
  thread_id: string;
  selected_slot_id: string;
  selected_slot: Slot;
  meeting: Meeting | null;
  final_participants: string[];
  participants_count: number;
  finalized_at: string;
  finalized_by_user_id: string;
  warnings?: any[];
}

// ============================================================
// Contact
// ============================================================
export interface Contact {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  kind: ContactKind;
  user_id?: string;
  email?: string;
  display_name: string;
  relationship_type?: RelationshipType;
  tags?: string[];
  tags_json?: string;
  notes?: string;
  summary?: string;
  invitee_key?: string;
  created_at: string;
  updated_at: string;
}

export type ContactKind = 'external_person' | 'internal_user' | 'organization' | 'group';
export type RelationshipType = 'family' | 'friend' | 'coworker' | 'client' | 'external';

// ============================================================
// List
// ============================================================
export interface List {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ListMember {
  id: string;
  workspace_id: string;
  list_id: string;
  contact_id: string;
  // JOIN fields from contacts table
  contact_kind: ContactKind;
  contact_user_id?: string;
  contact_email?: string;
  contact_display_name: string;
  contact_relationship_type?: RelationshipType;
  contact_tags_json?: string;
  contact_tags?: string[];
  contact_notes?: string;
  contact_summary?: string;
  contact_invitee_key?: string;
  created_at: string;
}

// ============================================================
// Business Card
// ============================================================
export interface BusinessCard {
  id: string;
  workspace_id: string;
  uploader_user_id: string;
  contact_id?: string;
  image_url?: string;
  raw_text?: string;
  parsed_json?: string;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// API Response Wrappers
// ============================================================
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: any;
}
