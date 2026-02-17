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
 * - invite.ts: invite.prepare.emails, invite.prepare.list (Phase 1-1)
 * - pending.ts: pending.action.decide (Phase 1-2)
 * 
 * 今後の分割予定:
 * - autoPropose.ts: schedule.auto_propose 系 (Phase 1-3)
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

// Invite executors (Phase 1-1: apiExecutor.ts から分離)
// Phase 1-3b: buildPrepareMessage は shared/prepareMessage.ts に移動（内部共有のみ、exportしない）
export {
  executeInvitePrepareEmails,
  executeInvitePrepareList,
  // Helper functions
  parseInviteLines,
  savePhonesToContacts,
  // Types
  type ParsedInvitee,
} from './invite';

// Pending executors (Phase 1-2: apiExecutor.ts から分離)
export {
  executePendingDecision,
} from './pending';

// AutoPropose executors (Phase 1-3a: apiExecutor.ts から分離)
export {
  // Core auto-propose
  executeAutoPropose,
  executeAutoProposeConfirm,
  executeAutoProposeCancel,
  // Additional propose
  executeAdditionalPropose,
  executeAdditionalProposeByThreadId,
  // Split propose
  executeProposeForSplitConfirm,
  executeProposeForSplitCancel,
  // Helpers
  analyzeStatusForPropose,
  generateProposalsWithoutBusy,
  formatProposalLabel,
} from './autoPropose';

// OneOnOne executors (v1.0: 1対1予定調整, v1.1: Phase B-1 候補3つ, v1.2: Phase B-2 freebusy, v1.3: Phase B-4 open_slots)
export {
  executeOneOnOneFixed,
  executeOneOnOneCandidates,
  executeOneOnOneFreebusy,
  executeOneOnOneOpenSlots,
  formatDateTimeJP,
} from './oneOnOne';

// Relation executors (D0: 仕事仲間申請/承諾/拒否)
export {
  executeRelationRequestWorkmate,
  executeRelationApprove,
  executeRelationDecline,
} from './relation/requestWorkmate';

// Pool Booking executors (G2-A: 受付プール予約)
export {
  executePoolBook,
  executePoolBookingCancel,
  executePoolBookingList,
} from './pool/book';

// Pool Management executors (G2-A: プール管理)
export {
  executePoolCreate,
  executePoolAddSlots,
  executePoolCreateFinalize,
  executePoolCreateCancel,
  executePoolMemberSelected,
  type PoolCreateDraft,
} from './pool/create';

// Contact Import executors (PR-D-1.1: 連絡先取り込み)
// PR-D-3: 名刺OCRスキャン追加
// PR-D-FE-4: 取り込み後の次手選択
export {
  executeContactImportPreview,
  executeContactImportConfirm,
  executeContactImportCancel,
  executeContactImportPersonSelect,
  executeBusinessCardScan,
  executePostImportNextStepDecide,
  // Helpers
  buildPendingContactImportConfirm,
  buildPendingPersonSelect,
} from './contactImport';

// Post-Import Auto-Connect Bridge (FE-5: post-import → schedule/invite 自動接続)
export {
  executePostImportAutoConnect,
  generateDefaultSlots,
  type PostImportAutoConnectParams,
} from './postImportBridge';

// Shared utilities
export { getStatusWithCache } from './shared/cache';
export { refreshAfterWrite } from './shared/refresh';
