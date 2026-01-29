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
 * Thread Kind Types and Constants
 * 
 * Matches scheduling_threads.kind CHECK constraint:
 * CHECK (kind IN ('external', 'internal'))
 * 
 * - external: R0 flow (/i/:token external invite)
 * - internal: R1 flow (workmate app-internal scheduling)
 */
export const THREAD_KIND = {
  EXTERNAL: 'external',
  INTERNAL: 'internal',
} as const;

export type ThreadKind = typeof THREAD_KIND[keyof typeof THREAD_KIND];

/**
 * Validate thread kind against allowed values
 */
export function isValidThreadKind(kind: string): kind is ThreadKind {
  return Object.values(THREAD_KIND).includes(kind as ThreadKind);
}

/**
 * Thread Kind descriptions for UI
 */
export const THREAD_KIND_LABELS: Record<ThreadKind, string> = {
  [THREAD_KIND.EXTERNAL]: '外部招待',
  [THREAD_KIND.INTERNAL]: 'アプリ内調整',
};

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
