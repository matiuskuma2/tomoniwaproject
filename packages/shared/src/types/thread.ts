/**
 * Thread Status Types and Constants
 * 
 * Matches scheduling_threads.status CHECK constraint:
 * CHECK (status IN ('draft','sent','confirmed','cancelled'))
 */

export const THREAD_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
} as const;

export type ThreadStatus = typeof THREAD_STATUS[keyof typeof THREAD_STATUS];

/**
 * Validate thread status against allowed values
 */
export function isValidThreadStatus(status: string): status is ThreadStatus {
  return Object.values(THREAD_STATUS).includes(status as ThreadStatus);
}

/**
 * Thread Status descriptions for UI
 */
export const THREAD_STATUS_LABELS: Record<ThreadStatus, string> = {
  [THREAD_STATUS.DRAFT]: 'Draft',
  [THREAD_STATUS.SENT]: 'Sent',
  [THREAD_STATUS.CONFIRMED]: 'Confirmed',
  [THREAD_STATUS.CANCELLED]: 'Cancelled',
};
