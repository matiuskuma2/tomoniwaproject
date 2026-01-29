/**
 * Scheduling Internal API Client
 * 
 * R1: Internal scheduling API for workmate 1:1 scheduling
 * - prepare: Start internal scheduling (create thread, generate slots, send notification)
 * - getThread: Get thread details (participants, slots, selections)
 * - respond: Invitee responds with selected slot (confirms the thread)
 */

import { api } from './client';

// ============================================================
// Request/Response Types
// ============================================================

/**
 * Constraints for scheduling
 */
export interface SchedulingConstraints {
  /** Start of time range (ISO 8601) */
  time_min?: string;
  /** End of time range (ISO 8601) */
  time_max?: string;
  /** Preferred time of day */
  prefer?: 'morning' | 'afternoon' | 'evening' | 'any';
  /** Preferred days of week */
  days?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[];
  /** Meeting duration in minutes */
  duration?: number;
  /** Number of candidates to generate */
  candidate_count?: number;
}

/**
 * Prepare request
 */
export interface InternalPrepareRequest {
  /** Invitee user ID (must be workmate) */
  invitee_user_id: string;
  /** Meeting title */
  title: string;
  /** Optional description */
  description?: string;
  /** Scheduling constraints */
  constraints?: SchedulingConstraints;
}

/**
 * Slot information
 */
export interface SchedulingSlot {
  slot_id: string;
  start_at: string;
  end_at: string;
  label?: string;
}

/**
 * Prepare response
 */
export interface InternalPrepareResponse {
  success: boolean;
  thread_id: string;
  slots: SchedulingSlot[];
  inbox_item_id?: string;
  message_for_chat?: string;
}

/**
 * Participant information
 */
export interface ThreadParticipant {
  id: string;
  user_id: string;
  email?: string;
  display_name?: string;
  role: 'owner' | 'member';
}

/**
 * Selection information
 */
export interface ThreadSelection {
  id: string;
  slot_id: string;
  user_id: string;
  status: 'selected' | 'rejected';
  created_at: string;
}

/**
 * Thread detail response
 */
export interface InternalThreadResponse {
  thread: {
    id: string;
    organizer_user_id: string;
    title: string;
    description?: string;
    status: 'draft' | 'sent' | 'confirmed' | 'cancelled';
    kind: 'external' | 'internal';
    created_at: string;
    updated_at: string;
  };
  participants: ThreadParticipant[];
  slots: SchedulingSlot[];
  selections: ThreadSelection[];
  confirmed_slot?: SchedulingSlot;
}

/**
 * Respond request
 */
export interface InternalRespondRequest {
  selected_slot_id: string;
}

/**
 * Calendar registration status for a participant (R1.1)
 */
export interface CalendarRegistrationStatus {
  registered: boolean;
  event_id?: string;
  meeting_url?: string;
  error?: string;
}

/**
 * Calendar status for all participants (R1.1)
 */
export interface CalendarStatus {
  organizer: CalendarRegistrationStatus;
  invitee: CalendarRegistrationStatus;
}

/**
 * Respond response
 */
export interface InternalRespondResponse {
  success: boolean;
  thread_status: string;
  confirmed_slot: SchedulingSlot;
  calendar_status?: CalendarStatus;
  meeting_url?: string | null;
  message?: string;
}

// ============================================================
// API Client
// ============================================================

export const schedulingInternalApi = {
  /**
   * Start internal scheduling
   * POST /api/scheduling/internal/prepare
   * 
   * Creates a new internal scheduling thread:
   * 1. Validates view_freebusy permission with invitee
   * 2. Fetches freebusy for both users
   * 3. Calculates intersection (common available slots)
   * 4. Creates scheduling_thread with kind='internal'
   * 5. Creates scheduling_slots for candidates
   * 6. Creates thread_participants
   * 7. Sends inbox notification to invitee
   */
  async prepare(request: InternalPrepareRequest): Promise<InternalPrepareResponse> {
    return api.post<InternalPrepareResponse>(
      '/api/scheduling/internal/prepare',
      request
    );
  },

  /**
   * Get thread details
   * GET /api/scheduling/internal/:threadId
   * 
   * Returns thread with participants, slots, and selections.
   * Only accessible by participants.
   */
  async getThread(threadId: string): Promise<InternalThreadResponse> {
    return api.get<InternalThreadResponse>(
      `/api/scheduling/internal/${threadId}`
    );
  },

  /**
   * Respond to scheduling request (select a slot)
   * POST /api/scheduling/internal/:threadId/respond
   * 
   * Invitee selects a slot:
   * 1. Validates user is participant
   * 2. Creates thread_selection
   * 3. Updates thread.status to 'confirmed'
   * 4. Sends inbox notifications to both users
   */
  async respond(threadId: string, request: InternalRespondRequest): Promise<InternalRespondResponse> {
    return api.post<InternalRespondResponse>(
      `/api/scheduling/internal/${threadId}/respond`,
      request
    );
  },
};
