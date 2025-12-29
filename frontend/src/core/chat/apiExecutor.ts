/**
 * API Executor for Phase Next-2 (P0 only)
 * Execute API calls based on classified intent
 */

import { threadsApi } from '../api/threads';
import type { IntentResult } from './intentClassifier';
import type { ThreadStatus_API } from '../models';

export interface ExecutionResult {
  success: boolean;
  message: string;
  data?: any;
  needsClarification?: {
    field: string;
    message: string;
  };
}

/**
 * Execute API call based on intent
 * Phase Next-2: P0 intents only
 */
export async function executeIntent(
  intentResult: IntentResult,
  additionalParams?: Record<string, any>
): Promise<ExecutionResult> {
  // If intent needs clarification, return immediately
  if (intentResult.needsClarification) {
    return {
      success: false,
      message: intentResult.needsClarification.message,
      needsClarification: intentResult.needsClarification,
    };
  }

  switch (intentResult.intent) {
    case 'schedule.external.create':
      return executeCreate(intentResult, additionalParams);
    
    case 'schedule.status.check':
      return executeStatusCheck(intentResult);
    
    case 'schedule.finalize':
      return executeFinalize(intentResult, additionalParams);
    
    case 'unknown':
      return {
        success: false,
        message: '理解できませんでした',
      };
    
    default:
      return {
        success: false,
        message: 'この機能はまだ実装されていません。',
      };
  }
}

/**
 * P0-1: schedule.external.create
 * Phase Next-2: Fixed title/description, email-based candidates
 */
async function executeCreate(
  intentResult: IntentResult,
  _additionalParams?: Record<string, any>
): Promise<ExecutionResult> {
  // Extract emails from intent params
  const emails = intentResult.params.emails as string[] | undefined;
  
  if (!emails || emails.length === 0) {
    return {
      success: false,
      message: '送信先のメールアドレスを貼ってください。\n\n例: tanaka@example.com',
      needsClarification: {
        field: 'emails',
        message: '送信先のメールアドレスを貼ってください。',
      },
    };
  }

  try {
    // Build candidates from emails
    const candidates = emails.map((email) => ({
      email,
      name: email.split('@')[0], // Use email prefix as name
    }));

    // Create thread with FIXED title/description
    const response = await threadsApi.create({
      title: '日程調整（自動生成）',
      description: '', // Empty description
      candidates,
    });

    // Build success message with invite URLs
    const inviteCount = response.candidates?.length || 0;
    let message = `✅ 調整を作成しました（${inviteCount}名）\n\n`;
    
    if (inviteCount > 0) {
      message += '招待リンク:\n';
      
      // Show ALL invite URLs
      response.candidates?.forEach((c) => {
        message += `- ${c.email}: ${c.invite_url}\n`;
      });
    }

    return {
      success: true,
      message,
      data: response,
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P0-2: schedule.status.check
 */
async function executeStatusCheck(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { threadId, scope } = intentResult.params;

  try {
    // All threads
    if (scope === 'all' || !threadId) {
      const response = await threadsApi.list();
      const activeThreads = response.threads.filter((t) => t.status === 'active');
      
      if (activeThreads.length === 0) {
        return {
          success: true,
          message: '現在、募集中の調整はありません。',
        };
      }

      let message = `📋 現在募集中の調整（${activeThreads.length}件）\n\n`;
      activeThreads.forEach((thread, index) => {
        message += `${index + 1}. ${thread.title}\n`;
        message += `   作成日: ${new Date(thread.created_at).toLocaleDateString('ja-JP')}\n\n`;
      });

      return {
        success: true,
        message,
        data: { threads: activeThreads },
      };
    }

    // Single thread status
    const status = await threadsApi.getStatus(threadId);
    
    // Build status message
    let message = `📊 ${status.thread.title}\n\n`;
    message += `状態: ${getStatusLabel(status.thread.status)}\n`;
    message += `招待: ${status.invites.length}名\n`;
    
    const acceptedCount = status.invites.filter((i) => i.status === 'accepted').length;
    const pendingCount = status.invites.filter((i) => i.status === 'pending').length;
    
    message += `承諾: ${acceptedCount}名\n`;
    message += `未返信: ${pendingCount}名\n\n`;

    // Show slots with votes
    if (status.slots && status.slots.length > 0) {
      message += '📅 候補日時:\n';
      status.slots.forEach((slot, index) => {
        const votes = getSlotVotes(slot.slot_id, status);
        message += `${index + 1}. ${formatDateTime(slot.start_at)} (${votes}票)\n`;
      });
    }

    return {
      success: true,
      message,
      data: status,
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P0-3: schedule.finalize
 */
async function executeFinalize(
  intentResult: IntentResult,
  additionalParams?: Record<string, any>
): Promise<ExecutionResult> {
  const { threadId, slotNumber } = intentResult.params;

  if (!threadId) {
    return {
      success: false,
      message: 'スレッドが選択されていません。',
      needsClarification: {
        field: 'threadId',
        message: 'どのスレッドの日程を確定しますか？',
      },
    };
  }

  try {
    // Get thread status to find slot_id
    const status = await threadsApi.getStatus(threadId);
    
    if (status.slots.length === 0) {
      return {
        success: false,
        message: '候補日時が設定されていません。',
      };
    }

    // Determine selected_slot_id
    let selectedSlotId: string | undefined = additionalParams?.selected_slot_id;

    if (!selectedSlotId && slotNumber) {
      // Use slot number (1-indexed)
      const slotIndex = slotNumber - 1;
      if (slotIndex >= 0 && slotIndex < status.slots.length) {
        selectedSlotId = status.slots[slotIndex].slot_id;
      }
    }

    if (!selectedSlotId) {
      // Show slot options
      let message = 'どの候補日時で確定しますか？\n\n';
      status.slots.forEach((slot, index) => {
        const votes = getSlotVotes(slot.slot_id, status);
        message += `${index + 1}. ${formatDateTime(slot.start_at)} (${votes}票)\n`;
      });
      message += '\n番号を入力してください（例: 1番で確定）';

      return {
        success: false,
        message,
        needsClarification: {
          field: 'slotId',
          message,
        },
      };
    }

    // Execute finalize
    const response = await threadsApi.finalize(threadId, {
      selected_slot_id: selectedSlotId,
      reason: additionalParams?.reason,
    });

    // Build success message
    let message = `✅ 日程を確定しました\n\n`;
    message += `📅 日時: ${formatDateTime(response.selected_slot.start_at)} - ${formatDateTime(response.selected_slot.end_at)}\n`;
    message += `👥 参加者: ${response.participants_count}名\n`;

    if (response.meeting) {
      message += `\n🎥 Google Meet:\n${response.meeting.url}\n`;
    }

    return {
      success: true,
      message,
      data: response,
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// Helper functions

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: '下書き',
    active: '募集中',
    confirmed: '確定',
    cancelled: 'キャンセル',
  };
  return labels[status] || status;
}

function getSlotVotes(slotId: string, status: ThreadStatus_API): number {
  if (!status.selections) return 0;
  
  // Count selections for this slot
  return Object.values(status.selections).filter((selection: any) => 
    selection.slot_id === slotId
  ).length;
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
