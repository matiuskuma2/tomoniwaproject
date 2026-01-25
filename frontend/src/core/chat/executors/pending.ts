/**
 * Pending Executors - Phase 1-2
 * 
 * apiExecutor.ts から pending.action.decide 系ロジックを分離
 * - executePendingDecision: confirm/cancel/new_thread の決定処理
 * 
 * 責務:
 * - 送信確認フローの決定処理のみ
 * - buildPrepareMessage は含まない（Phase 1-3 で shared/ に移動予定）
 */

import { pendingActionsApi, type PendingDecision } from '../../api/pendingActions';
import { isPendingAction } from '../pendingTypes';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult, ExecutionContext } from './types';
import { executePreferenceSetConfirm, executePreferenceSetCancel } from './preference';
import { log } from '../../platform';
// P0-2: refresh 系
import { getRefreshActions, type WriteOp } from '../../refresh/refreshMap';
import { runRefresh } from '../../refresh/runRefresh';

// ============================================================
// Helper Functions
// ============================================================

/**
 * P0-2: Write 操作後に必須の refresh を実行
 * refresh 失敗で Write を失敗扱いにしない（運用インシデント回避）
 * 
 * Note: この関数は apiExecutor.ts にも存在します。
 * 将来的には shared/ に移動することを検討。
 */
async function refreshAfterWrite(op: WriteOp, threadId?: string): Promise<void> {
  try {
    const actions = getRefreshActions(op, threadId ? { threadId } : undefined);
    await runRefresh(actions);
  } catch (e) {
    log.warn('refreshAfterWrite failed', { module: 'pending', writeOp: op, threadId, err: e });
  }
}

// ============================================================
// Executors
// ============================================================

/**
 * Beta A / Phase2: 決定処理
 * - 通常: 3語固定 (送る/キャンセル/別スレッドで)
 * - 追加候補: 2語固定 (追加/キャンセル)
 * P0-1: 正規化された pending を使用
 * PREF-SET-1: prefs_confirm / prefs_cancel 対応
 */
export async function executePendingDecision(
  intentResult: IntentResult,
  context?: ExecutionContext
): Promise<ExecutionResult> {
  const { decision, confirmToken } = intentResult.params;
  
  // PREF-SET-1: 好み設定の確認/キャンセル
  if (decision === 'prefs_confirm') {
    return executePreferenceSetConfirm(context);
  }
  if (decision === 'prefs_cancel') {
    return executePreferenceSetCancel();
  }
  
  // P0-1: 正規化された pending から pending.action を取得
  const activePending = context?.pendingForThread ?? context?.globalPendingAction ?? null;
  const pending = isPendingAction(activePending) ? activePending : null;
  
  if (!pending && !confirmToken) {
    return {
      success: false,
      message: '❌ 確認中の送信がありません。\n先にメールアドレスまたはリストを入力してください。',
    };
  }
  
  const token = confirmToken || pending?.confirmToken;
  if (!token) {
    return {
      success: false,
      message: '❌ 確認トークンが見つかりません。',
    };
  }
  
  try {
    // Map Japanese decision to API decision
    // Phase2: 「追加」を「send」として扱う
    const apiDecision: PendingDecision = 
      decision === '送る' ? 'send' :
      decision === '追加' ? 'send' :    // Phase2: 追加候補用
      decision === '追加する' ? 'send' : // Phase2: 追加候補用
      decision === 'キャンセル' ? 'cancel' :
      decision === 'やめる' ? 'cancel' : // Phase2: 追加候補用
      decision === '別スレッドで' ? 'new_thread' :
      decision;
    
    // Step 1: Confirm
    const confirmResponse = await pendingActionsApi.confirm(token, apiDecision);
    
    // キャンセルの場合は終了
    if (confirmResponse.decision === 'cancel') {
      return {
        success: true,
        message: confirmResponse.message_for_chat || '✅ キャンセルしました。',
        data: {
          kind: 'pending.action.cleared',
          payload: {},
        },
      };
    }
    
    // 送る or 別スレッドで の場合は execute
    if (confirmResponse.can_execute) {
      const executeResponse = await pendingActionsApi.execute(token);
      
      // Phase2: add_slots の場合は別のレスポンス形式
      const isAddSlots = (executeResponse as any).proposal_version !== undefined;
      
      if (isAddSlots) {
        // Phase2: 追加候補の実行結果
        const addSlotsResponse = executeResponse as any;
        
        // P0-2: Write 後の refresh 強制
        await refreshAfterWrite('ADD_SLOTS', addSlotsResponse.thread_id);
        
        return {
          success: true,
          message: addSlotsResponse.message_for_chat || 
            `✅ ${addSlotsResponse.result.slots_added}件の追加候補を追加しました。`,
          data: {
            kind: 'pending.action.executed',
            payload: {
              threadId: addSlotsResponse.thread_id,
              actionType: 'add_slots',
              slotsAdded: addSlotsResponse.result.slots_added,
              proposalVersion: addSlotsResponse.proposal_version,
              remainingProposals: addSlotsResponse.remaining_proposals,
              notifications: addSlotsResponse.result.notifications,
            },
          },
        };
      }
      
      // 通常の招待送信
      const message = executeResponse.message_for_chat || 
        `✅ ${executeResponse.result.inserted}名に招待を送信しました。`;
      
      // P0-2: Write 後の refresh 強制
      await refreshAfterWrite('INVITE_SEND', executeResponse.thread_id);
      
      return {
        success: true,
        message,
        data: {
          kind: 'pending.action.executed',
          payload: {
            threadId: executeResponse.thread_id,
            inserted: executeResponse.result.inserted,
            emailQueued: executeResponse.result.deliveries.email_queued,
          },
        },
      };
    }
    
    // can_execute が false の場合（異常系）
    return {
      success: false,
      message: confirmResponse.message_for_chat || '❌ 実行できませんでした。',
      data: {
        kind: 'pending.action.decided',
        payload: {
          decision: confirmResponse.decision,
          canExecute: confirmResponse.can_execute,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
