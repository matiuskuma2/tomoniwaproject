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

// Remind executors (P2-R1: 内訳表示の統一)
export {
  executeRemindStatus,
  executeRemindPending,
  executeNeedResponseList,
  executeRemindNeedResponse,
  // Helper functions for testing
  analyzeRemindStatus,
  formatRemindSummary,
  formatRemindConfirmation,
} from './remind';
