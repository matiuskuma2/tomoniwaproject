/**
 * Inbox Notification Types and Constants
 * 
 * NOTE: inbox table currently has no CHECK constraint on type,
 * but we define these constants for consistency and future migration.
 */

export const INBOX_TYPE = {
  // System notifications
  SYSTEM_MESSAGE: 'system_message',
  
  // Scheduling/Thread related
  SCHEDULING_INVITE: 'scheduling_invite',
  THREAD_MESSAGE: 'thread_message',
  
  // Work items
  WORK_ITEM_SHARE: 'work_item_share',
  
  // Relationships
  RELATIONSHIP_REQUEST: 'relationship_request',
  
  // Admin/Broadcast
  BROADCAST: 'broadcast',
} as const;

export type InboxType = typeof INBOX_TYPE[keyof typeof INBOX_TYPE];

/**
 * Validate inbox notification type
 */
export function isValidInboxType(type: string): type is InboxType {
  return Object.values(INBOX_TYPE).includes(type as InboxType);
}

/**
 * Inbox Type descriptions for UI
 */
export const INBOX_TYPE_LABELS: Record<InboxType, string> = {
  [INBOX_TYPE.SYSTEM_MESSAGE]: 'System Message',
  [INBOX_TYPE.SCHEDULING_INVITE]: 'Scheduling Invite',
  [INBOX_TYPE.THREAD_MESSAGE]: 'Thread Message',
  [INBOX_TYPE.WORK_ITEM_SHARE]: 'Work Item Share',
  [INBOX_TYPE.RELATIONSHIP_REQUEST]: 'Relationship Request',
  [INBOX_TYPE.BROADCAST]: 'Broadcast',
};

/**
 * Priority levels for inbox notifications
 */
export const INBOX_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type InboxPriority = typeof INBOX_PRIORITY[keyof typeof INBOX_PRIORITY];
