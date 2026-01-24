/**
 * Executors Index
 * 
 * P1-1: apiExecutor.ts から分割した executor 関数を集約
 * 
 * 分割構成:
 * - types.ts: ExecutionResult, ExecutionContext 型定義
 * - calendar.ts: schedule.today, schedule.week, schedule.freebusy
 * - list.ts: list.create, list.list, list.members, list.add_member
 * - thread.ts: schedule.create, schedule.status, schedule.finalize, thread.create, invite.list
 * - remind.ts: remind.status, remind.pending, need_response.list, remind.need_response (P2-R1)
 * - batch.ts: 一括招待バッチ処理最適化 (P2-B1)
 * 
 * 今後の分割予定:
 * - pending.ts: pending.action.decide, invite.prepare
 */

// 型定義
export type { ExecutionResult, ExecutionResultData, ExecutionContext } from './types';

// Calendar executors
export { 
  executeToday,
  executeWeek,
  executeFreeBusy,
  executeFreeBusyBatch,  // P3-INTERSECT1
} from './calendar';

// List executors
export {
  executeListCreate,
  executeListList,
  executeListMembers,
  executeListAddMember,
} from './list';

// Thread executors
export {
  executeCreate,
  executeStatusCheck,
  executeFinalize,
  executeThreadCreate,
  executeInviteList,
} from './thread';

// Remind executors (P2-R1: 内訳表示の統一 + confirm/cancel)
export {
  // Status & List
  executeRemindStatus,
  executeRemindPending,
  executeNeedResponseList,
  executeRemindNeedResponse,
  // P2-D2: 回答済みリマインド
  executeRemindResponded,
  executeRemindRespondedConfirm,
  executeRemindRespondedCancel,
  // Confirm & Cancel (P2-R1 Step2)
  executeRemindPendingConfirm,
  executeRemindPendingCancel,
  executeRemindNeedResponseConfirm,
  executeRemindNeedResponseCancel,
  // Helper functions for testing
  analyzeRemindStatus,
  formatRemindSummary,
  formatRemindConfirmation,
} from './remind';

// Batch executors (P2-B1: 一括招待バッチ処理最適化)
export {
  executeBatchAddMembers,
  // Helper functions
  chunkArray,
  formatBatchProgress,
  formatBatchResult,
  getBatchChunkSize,
  // Types
  type BatchProgress,
  type BatchProgressCallback,
  type BatchResult,
  // Constants
  BATCH_CHUNK_SIZE,
  BATCH_THRESHOLD,
} from './batch';
