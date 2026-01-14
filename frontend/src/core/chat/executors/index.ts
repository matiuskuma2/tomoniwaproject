/**
 * Executors Index
 * 
 * P1-1: apiExecutor.ts から分割した executor 関数を集約
 * 
 * 分割構成:
 * - types.ts: ExecutionResult, ExecutionContext 型定義
 * - calendar.ts: schedule.today, schedule.week, schedule.freebusy
 * - list.ts: list.create, list.list, list.members, list.add_member
 * 
 * 今後の分割予定:
 * - thread.ts: thread.create, thread.status, thread.finalize
 * - remind.ts: remind.pending, remind.need_response
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
