/**
 * Remind Executors
 * P2-R1: リマインダー機能強化 - 内訳表示の統一
 * 
 * 目的:
 * - 未返信/再回答の内訳を統一フォーマットで表示
 * - 次アクションを明確に案内
 * - next_reminder_available_at を一貫表示
 * 
 * 対象:
 * - schedule.remind.pending (未返信リマインド)
 * - schedule.need_response.list (再回答必要者リスト)
 * - schedule.remind.need_response (再回答リマインド)
 * 
 * 統一フォーマット:
 * 1. ヘッダー: スレッドタイトル、候補バージョン
 * 2. サマリー: 総数、未返信数、再回答必要数
 * 3. 内訳: 対象者リスト（理由付き）
 * 4. 次アクション: 明確なヒント
 * 5. レート制限: next_reminder_available_at
 */

import { threadsApi } from '../../api';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import type { ThreadStatus_API } from '../../models';
import { formatDateTimeForViewer, DEFAULT_TIMEZONE } from '../../../utils/datetime';
import { threadStatusCache } from '../../cache';
import { getRefreshActions, type WriteOp } from '../../refresh/refreshMap';
import { runRefresh } from '../../refresh/runRefresh';
import { log } from '../../platform';

// ============================================================
// Types
// ============================================================

interface InviteeStatus {
  email: string;
  name?: string;
  inviteeKey: string;
  reason: 'pending' | 'need_response' | 'declined' | 'responded';
  respondedVersion?: number;
}

interface RemindSummary {
  threadId: string;
  threadTitle: string;
  threadStatus: string;
  currentVersion: number;
  remainingProposals: number;
  totalInvites: number;
  pendingCount: number;        // 未返信（一度も回答していない）
  needResponseCount: number;   // 再回答必要（旧世代回答）
  declinedCount: number;       // 辞退
  respondedCount: number;      // 最新回答済み
  nextReminderAt?: string;     // 次回リマインド可能時刻
  invitees: InviteeStatus[];
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get status with cache update
 */
async function getStatusWithCache(threadId: string): Promise<ThreadStatus_API> {
  const status = await threadsApi.getStatus(threadId);
  threadStatusCache.setStatus(threadId, status);
  return status;
}

/**
 * Write 操作後に refresh を実行
 */
async function refreshAfterWrite(op: WriteOp, threadId: string): Promise<void> {
  try {
    await runRefresh(getRefreshActions(op, { threadId }));
  } catch (e) {
    log.warn('refreshAfterWrite failed', { module: 'remind', writeOp: op, threadId, err: e });
  }
}

/**
 * Format datetime for display
 */
function formatDateTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return formatDateTimeForViewer(date, DEFAULT_TIMEZONE);
  } catch {
    return dateStr;
  }
}

/**
 * P2-R1: スレッドのリマインド状況を分析
 * 統一フォーマット用のサマリーを生成
 */
export function analyzeRemindStatus(status: ThreadStatus_API): RemindSummary {
  // proposal_info を取得（Phase2対応）
  const proposalInfo = (status as any).proposal_info || null;
  const currentVersion = proposalInfo?.current_version || 1;
  const remainingProposals = proposalInfo?.remaining_proposals ?? 2;
  
  // selections マップを構築
  const selectionsMap = new Map<string, any>();
  if (status.selections) {
    status.selections.forEach((sel: any) => {
      selectionsMap.set(sel.invitee_key, sel);
    });
  }
  
  // 各招待者の状態を判定
  const invitees: InviteeStatus[] = status.invites.map((inv: any) => {
    const selection = selectionsMap.get(inv.invitee_key);
    
    // declined チェック
    if (inv.status === 'declined') {
      return {
        email: inv.email,
        name: inv.candidate_name,
        inviteeKey: inv.invitee_key,
        reason: 'declined' as const,
      };
    }
    
    // 未回答チェック
    if (!selection) {
      return {
        email: inv.email,
        name: inv.candidate_name,
        inviteeKey: inv.invitee_key,
        reason: 'pending' as const,
      };
    }
    
    // proposal_version チェック
    const respondedVersion = selection.proposal_version_at_response || 1;
    if (respondedVersion < currentVersion) {
      return {
        email: inv.email,
        name: inv.candidate_name,
        inviteeKey: inv.invitee_key,
        reason: 'need_response' as const,
        respondedVersion,
      };
    }
    
    // 最新回答済み
    return {
      email: inv.email,
      name: inv.candidate_name,
      inviteeKey: inv.invitee_key,
      reason: 'responded' as const,
      respondedVersion,
    };
  });
  
  // カウント集計
  const pendingCount = invitees.filter(i => i.reason === 'pending').length;
  const needResponseCount = invitees.filter(i => i.reason === 'need_response').length;
  const declinedCount = invitees.filter(i => i.reason === 'declined').length;
  const respondedCount = invitees.filter(i => i.reason === 'responded').length;
  
  return {
    threadId: status.thread.id,
    threadTitle: status.thread.title,
    threadStatus: status.thread.status,
    currentVersion,
    remainingProposals,
    totalInvites: status.invites.length,
    pendingCount,
    needResponseCount,
    declinedCount,
    respondedCount,
    invitees,
  };
}

/**
 * P2-R1: 統一フォーマットでサマリーを生成
 */
export function formatRemindSummary(summary: RemindSummary, options: {
  showPending?: boolean;
  showNeedResponse?: boolean;
  showAll?: boolean;
  includeNextActions?: boolean;
} = {}): string {
  const {
    showPending = true,
    showNeedResponse = true,
    showAll = false,
    includeNextActions = true,
  } = options;
  
  let message = '';
  
  // ヘッダー
  message += `📋 **${summary.threadTitle}**\n\n`;
  
  // ステータスバー
  message += `📊 候補: v${summary.currentVersion}`;
  if (summary.currentVersion > 1) {
    message += ` (追加候補あり)`;
  }
  message += ` | 追加可能: あと ${summary.remainingProposals} 回\n`;
  
  // サマリー
  message += `👥 招待: ${summary.totalInvites}名`;
  message += ` (✅${summary.respondedCount} ⏳${summary.pendingCount} 🔄${summary.needResponseCount} ❌${summary.declinedCount})\n\n`;
  
  // 凡例
  message += `*✅最新回答済 ⏳未返信 🔄再回答必要 ❌辞退*\n\n`;
  
  // 内訳表示
  const pendingInvitees = summary.invitees.filter(i => i.reason === 'pending');
  const needResponseInvitees = summary.invitees.filter(i => i.reason === 'need_response');
  const allTargets = [...pendingInvitees, ...needResponseInvitees];
  
  if (showAll || (showPending && pendingInvitees.length > 0)) {
    if (pendingInvitees.length > 0) {
      message += `**⏳ 未返信 (${pendingInvitees.length}名)**\n`;
      pendingInvitees.forEach((inv, idx) => {
        message += `${idx + 1}. ${inv.email}`;
        if (inv.name) message += ` (${inv.name})`;
        message += ` — 未回答\n`;
      });
      message += `\n`;
    }
  }
  
  if (showAll || (showNeedResponse && needResponseInvitees.length > 0)) {
    if (needResponseInvitees.length > 0) {
      message += `**🔄 再回答必要 (${needResponseInvitees.length}名)**\n`;
      needResponseInvitees.forEach((inv, idx) => {
        message += `${idx + 1}. ${inv.email}`;
        if (inv.name) message += ` (${inv.name})`;
        message += ` — v${inv.respondedVersion}時点の回答\n`;
      });
      message += `\n`;
    }
  }
  
  // 次アクション
  if (includeNextActions) {
    if (allTargets.length === 0) {
      message += `✅ 全員が最新候補に回答済みです！\n`;
      message += `💡 「1番で確定」などと入力して日程を確定できます。\n`;
    } else {
      message += `**💡 次のアクション:**\n`;
      if (pendingInvitees.length > 0) {
        message += `- 「リマインド」→ 未返信者 ${pendingInvitees.length}名 にリマインド\n`;
      }
      if (needResponseInvitees.length > 0) {
        message += `- 「再回答リマインド」→ 再回答必要者 ${needResponseInvitees.length}名 にリマインド\n`;
      }
      if (summary.remainingProposals > 0 && allTargets.length > 0) {
        message += `- 「追加候補」→ 新しい候補日を追加（票割れ解消）\n`;
      }
    }
  }
  
  // レート制限
  if (summary.nextReminderAt) {
    message += `\n⏰ 次回リマインド可能: ${formatDateTime(summary.nextReminderAt)}\n`;
  }
  
  return message;
}

/**
 * P2-R1: リマインド確認メッセージを生成
 */
export function formatRemindConfirmation(summary: RemindSummary, targetType: 'pending' | 'need_response' | 'all'): string {
  const targets = summary.invitees.filter(i => {
    if (targetType === 'all') return i.reason === 'pending' || i.reason === 'need_response';
    return i.reason === targetType;
  });
  
  if (targets.length === 0) {
    if (targetType === 'pending') {
      return '✅ 未返信者がいません。リマインドは不要です。';
    } else if (targetType === 'need_response') {
      return '✅ 再回答必要者がいません。リマインドは不要です。';
    } else {
      return '✅ リマインド対象者がいません。';
    }
  }
  
  let message = `📩 **リマインド確認**\n\n`;
  message += `📋 スレッド: ${summary.threadTitle}\n`;
  message += `📊 候補バージョン: v${summary.currentVersion}\n`;
  message += `📬 送信対象: ${targets.length}名\n\n`;
  
  message += `**対象者:**\n`;
  targets.forEach((inv, idx) => {
    const reasonLabel = inv.reason === 'pending' ? '⏳未返信' : `🔄v${inv.respondedVersion}時点`;
    message += `${idx + 1}. ${inv.email}`;
    if (inv.name) message += ` (${inv.name})`;
    message += ` — ${reasonLabel}\n`;
  });
  
  message += `\n⚠️ この ${targets.length}名 にリマインドを送りますか？\n\n`;
  message += `「はい」で送信\n`;
  message += `「いいえ」でキャンセル`;
  
  return message;
}

// ============================================================
// Executors (P2-R1 統一版)
// ============================================================

/**
 * P2-R1: schedule.status.remind
 * スレッドのリマインド状況を統一フォーマットで表示
 * 
 * コマンド: 「状況」「全体状況」「リマインド状況」
 */
export async function executeRemindStatus(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId, scope } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドの状況を確認しますか？\n左のスレッド一覧から選択してください。',
      },
    };
  }
  
  try {
    const status = await getStatusWithCache(threadId);
    
    // ステータスチェック
    if (status.thread.status === 'confirmed') {
      return {
        success: true,
        message: `✅ 「${status.thread.title}」は既に確定済みです。`,
        data: {
          kind: 'remind.status',
          payload: { threadId, status: 'confirmed' },
        },
      };
    }
    
    if (status.thread.status === 'cancelled') {
      return {
        success: true,
        message: `❌ 「${status.thread.title}」はキャンセルされています。`,
        data: {
          kind: 'remind.status',
          payload: { threadId, status: 'cancelled' },
        },
      };
    }
    
    // 分析
    const summary = analyzeRemindStatus(status);
    
    // 統一フォーマットで出力
    const message = formatRemindSummary(summary, {
      showPending: true,
      showNeedResponse: true,
      showAll: scope === 'all',
      includeNextActions: true,
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'remind.status',
        payload: summary,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P2-R1: schedule.remind.pending (統一版)
 * 未返信者にリマインド確認を表示
 */
export async function executeRemindPending(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドにリマインドを送りますか？\n左のスレッド一覧から選択してください。',
      },
    };
  }
  
  try {
    const status = await getStatusWithCache(threadId);
    
    // ステータスチェック
    if (status.thread.status === 'confirmed' || status.thread.status === 'cancelled') {
      return {
        success: false,
        message: `❌ このスレッドは既に ${status.thread.status === 'confirmed' ? '確定' : 'キャンセル'} されています。\nリマインドは送れません。`,
      };
    }
    
    // 分析
    const summary = analyzeRemindStatus(status);
    
    // 未返信者チェック
    const pendingInvitees = summary.invitees.filter(i => i.reason === 'pending');
    
    if (pendingInvitees.length === 0) {
      // 再回答必要者がいるかチェック
      const needResponseInvitees = summary.invitees.filter(i => i.reason === 'need_response');
      if (needResponseInvitees.length > 0) {
        return {
          success: true,
          message: `✅ 未返信者はいませんが、再回答必要者が ${needResponseInvitees.length}名 います。\n\n💡 「再回答リマインド」と入力してください。`,
          data: {
            kind: 'remind.pending.none',
            payload: { threadId, needResponseCount: needResponseInvitees.length },
          },
        };
      }
      
      return {
        success: true,
        message: '✅ 全員が回答済みです。\n\nリマインドは不要です。',
        data: {
          kind: 'remind.pending.none',
          payload: { threadId },
        },
      };
    }
    
    // 確認メッセージ
    const message = formatRemindConfirmation(summary, 'pending');
    
    return {
      success: true,
      message,
      data: {
        kind: 'remind.pending.generated',
        payload: {
          source: 'remind',
          threadId,
          pendingInvitees: pendingInvitees.map(i => ({
            email: i.email,
            name: i.name,
            inviteeKey: i.inviteeKey,
          })),
          count: pendingInvitees.length,
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

/**
 * P2-R1: schedule.need_response.list (統一版)
 * 再回答必要者のリストを統一フォーマットで表示
 */
export async function executeNeedResponseList(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドの再回答必要者を確認しますか？\n左のスレッド一覧から選択してください。',
      },
    };
  }
  
  try {
    const status = await getStatusWithCache(threadId);
    
    // 分析
    const summary = analyzeRemindStatus(status);
    
    // 統一フォーマットで出力（再回答必要者にフォーカス）
    const message = formatRemindSummary(summary, {
      showPending: false,
      showNeedResponse: true,
      showAll: false,
      includeNextActions: true,
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'need_response.list',
        payload: {
          threadId,
          threadTitle: summary.threadTitle,
          currentVersion: summary.currentVersion,
          inviteesNeedingResponse: summary.invitees
            .filter(i => i.reason === 'need_response')
            .map(i => ({
              email: i.email,
              name: i.name,
              respondedVersion: i.respondedVersion,
            })),
          inviteesNeedingResponseCount: summary.needResponseCount,
          remainingProposals: summary.remainingProposals,
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

/**
 * P2-R1: schedule.remind.need_response (統一版)
 * 再回答必要者にリマインド確認を表示
 */
export async function executeRemindNeedResponse(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId } = intentResult.params;
  
  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドの再回答必要者にリマインドを送りますか？\n左のスレッド一覧から選択してください。',
      },
    };
  }
  
  try {
    const status = await getStatusWithCache(threadId);
    
    // ステータスチェック
    if (status.thread.status === 'confirmed' || status.thread.status === 'cancelled') {
      return {
        success: false,
        message: `❌ このスレッドは既に ${status.thread.status === 'confirmed' ? '確定' : 'キャンセル'} されています。\nリマインドは送れません。`,
      };
    }
    
    // 分析
    const summary = analyzeRemindStatus(status);
    
    // 再回答必要者チェック
    const needResponseInvitees = summary.invitees.filter(i => i.reason === 'need_response');
    
    if (needResponseInvitees.length === 0) {
      // 未返信者がいるかチェック
      const pendingInvitees = summary.invitees.filter(i => i.reason === 'pending');
      if (pendingInvitees.length > 0) {
        return {
          success: true,
          message: `✅ 再回答必要者はいませんが、未返信者が ${pendingInvitees.length}名 います。\n\n💡 「リマインド」と入力してください。`,
          data: {
            kind: 'remind.need_response.none',
            payload: { threadId, pendingCount: pendingInvitees.length },
          },
        };
      }
      
      return {
        success: true,
        message: '✅ 全員が最新の候補に回答済みです。\nリマインドを送る必要はありません。',
        data: {
          kind: 'remind.need_response.none',
          payload: { threadId },
        },
      };
    }
    
    // 確認メッセージ
    const message = formatRemindConfirmation(summary, 'need_response');
    
    return {
      success: true,
      message,
      data: {
        kind: 'remind.need_response.generated',
        payload: {
          threadId,
          threadTitle: summary.threadTitle,
          targetInvitees: needResponseInvitees.map(i => ({
            email: i.email,
            name: i.name,
            inviteeKey: i.inviteeKey,
          })),
          count: needResponseInvitees.length,
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
