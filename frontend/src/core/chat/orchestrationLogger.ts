/**
 * orchestrationLogger.ts
 * PR-UX-14: 会話オーケストレーション軽量ロギング
 * 
 * 監視対象 6 ポイント:
 * 1. classify result (intent, confidence, params 概要)
 * 2. execution result kind
 * 3. created threadId (thread creation 系)
 * 4. current route threadId (navigate 前後)
 * 5. status-fetch threadId (useThreadStatus の fetch 対象)
 * 6. pending set/clear (種別と threadId)
 * 
 * @see docs/CONVERSATION_FLOW.md
 * @see docs/STATE_RESPONSIBILITY.md
 */

import { log } from '../platform';
import type { LogContext } from '../platform/log';

const MODULE = 'Orchestration';

// ============================================================
// 1. Classify Result
// ============================================================

export function logClassifyResult(input: string, intent: string, confidence: number, params?: Record<string, unknown>) {
  log.info('classify.result', {
    module: MODULE,
    intent,
    confidence: confidence as unknown as number,
    inputLen: input.length,
    // params の概要のみ（大きなオブジェクトはログに含めない）
    hasParams: !!params,
    personName: (params?.person as { name?: string })?.name,
    hasPending: !!params?.pendingForThread,
  } as LogContext);
}

// ============================================================
// 2. Execution Result
// ============================================================

export function logExecutionResult(kind: string, success: boolean, threadId?: string) {
  log.info('execution.result', {
    module: MODULE,
    intent: kind,
    threadId: threadId || undefined,
    success: success as unknown as string,
  } as LogContext);
}

// ============================================================
// 3. Thread Created
// ============================================================

export function logThreadCreated(newThreadId: string, sourceKind: string) {
  log.info('thread.created', {
    module: MODULE,
    threadId: newThreadId,
    intent: sourceKind,
  } as LogContext);
}

// ============================================================
// 4. Navigate (route threadId change)
// ============================================================

export function logNavigate(fromThreadId: string | null, toThreadId: string) {
  log.info('navigate', {
    module: MODULE,
    threadId: toThreadId,
    from: fromThreadId || 'none',
  } as LogContext);
}

// ============================================================
// 5. Status Fetch
// ============================================================

export function logStatusFetch(threadId: string, source: 'cache' | 'network' | 'prefetch') {
  log.debug('status.fetch', {
    module: MODULE,
    threadId,
    source: source as unknown as string,
  } as LogContext);
}

// ============================================================
// 6. Pending Set/Clear
// ============================================================

export function logPendingSet(threadId: string, kind: string, missingField?: string) {
  log.info('pending.set', {
    module: MODULE,
    threadId,
    intent: kind,
    missingField: missingField || undefined,
  } as LogContext);
}

export function logPendingClear(threadId: string, reason: string) {
  log.info('pending.clear', {
    module: MODULE,
    threadId,
    reason: reason as unknown as string,
  } as LogContext);
}

// ============================================================
// Convenience: Full orchestration trace for a single message
// ============================================================

export function logOrchestrationTrace(trace: {
  input: string;
  classifyIntent: string;
  classifyConfidence: number;
  executionKind?: string;
  executionSuccess?: boolean;
  threadId?: string;
  newThreadId?: string;
  pendingKind?: string | null;
  pendingAction?: 'set' | 'clear' | 'none';
}) {
  log.info('orchestration.trace', {
    module: MODULE,
    intent: trace.classifyIntent,
    confidence: trace.classifyConfidence as unknown as number,
    threadId: trace.threadId,
    newThreadId: trace.newThreadId,
    executionKind: trace.executionKind,
    executionSuccess: trace.executionSuccess as unknown as string,
    pendingKind: trace.pendingKind,
    pendingAction: trace.pendingAction,
  } as LogContext);
}
