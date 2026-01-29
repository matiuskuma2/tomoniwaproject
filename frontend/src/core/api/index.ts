/**
 * API Exports
 * Centralized export for all API services
 */

export { api, API_BASE_URL } from './client';
export { threadsApi } from './threads';
export { contactsApi } from './contacts';
export { listsApi } from './lists';
export { inboxApi } from './inbox';
export { calendarApi } from './calendar';
export { voiceApi } from './voice';

// Beta A: Pending Actions API
export { pendingActionsApi } from './pendingActions';
export type { 
  PendingDecision, 
  PendingActionSummary, 
  PrepareSendResponse, 
  ConfirmResponse, 
  ExecuteResponse 
} from './pendingActions';

// P3-TZ1: Users Me API
export { usersMeApi } from './usersMe';
export type { UserProfile, GetMeResponse, UpdateMeResponse } from './usersMe';

// P2-E1: Workspace Notifications API
export { workspaceNotificationsApi } from './workspaceNotifications';
export type { 
  WorkspaceNotificationSettings, 
  UpdateSlackSettingsRequest,
  UpdateSlackSettingsResponse,
  TestSlackResponse
} from './workspaceNotifications';

// Phase D-1: Relationships API
export { 
  relationshipsApi,
  getRelationTypeLabel,
  getRelationTypeBadgeClass,
  getPermissionPresetLabel,
} from './relationships';
export type { 
  RelationType,
  PermissionPreset,
  Relationship,
  RelationshipRequest,
  RelationshipsListResponse,
  PendingRequestsResponse,
  UserSearchResult,
  UserSearchResponse,
} from './relationships';

// Phase R1: Scheduling Internal API
export { schedulingInternalApi } from './schedulingInternal';
export type {
  SchedulingConstraints,
  InternalPrepareRequest,
  InternalPrepareResponse,
  SchedulingSlot,
  ThreadParticipant,
  ThreadSelection,
  InternalThreadResponse,
  InternalRespondRequest,
  InternalRespondResponse,
} from './schedulingInternal';
