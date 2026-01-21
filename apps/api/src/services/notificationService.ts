/**
 * Notification Service
 * P2-E1: Slack/Chatwork送達の一元管理
 * 
 * 機能:
 * - Email/Slack/Chatwork への通知を一元化
 * - workspace設定に基づいて自動的にチャネルを選択
 * - 失敗しても本処理は落とさない（isolation）
 */

import { WorkspaceNotificationSettingsRepository } from '../repositories/workspaceNotificationSettingsRepository';
import { sendSlackWebhook } from './slackClient';
import { renderSlackPayload, renderSlackText } from './slackRenderer';
import { 
  composeInviteEmailModel, 
  composeAdditionalSlotsEmailModel, 
  composeReminderEmailModel,
  type EmailModel 
} from '../utils/emailModel';

export type NotificationEventType = 'invite' | 'additional_slots' | 'reminder';

export interface NotificationResult {
  slack?: {
    success: boolean;
    error?: string;
  };
  chatwork?: {
    success: boolean;
    error?: string;
  };
}

/**
 * 招待通知を送信（Email送信完了後に呼び出し）
 */
export async function sendInviteNotification(
  db: D1Database,
  workspaceId: string,
  params: {
    inviterName: string;
    threadTitle: string;
    inviteUrl: string;
    recipientCount: number;
  }
): Promise<NotificationResult> {
  const result: NotificationResult = {};

  try {
    const repo = new WorkspaceNotificationSettingsRepository(db);
    const settings = await repo.get(workspaceId);

    // Slack通知
    if (settings?.slack_enabled && settings.slack_webhook_url) {
      const model = composeInviteEmailModel({
        inviterName: params.inviterName,
        threadTitle: params.threadTitle,
        token: '', // Slack通知ではトークンは不要（リンクは表示しない or 別途設定）
      });
      
      // CTAのURLを上書き（Slack用）
      model.cta_url = params.inviteUrl;

      const payload = renderSlackPayload(model);
      
      // 補足情報を追加
      payload.text = `📅 ${params.inviterName}さんが「${params.threadTitle}」の日程調整を開始しました（${params.recipientCount}名に招待送信）`;

      const slackResult = await sendSlackWebhook(settings.slack_webhook_url, payload);
      result.slack = { success: slackResult.success, error: slackResult.error };
      
      console.log(`[NotificationService] Slack invite notification: ${slackResult.success ? 'success' : 'failed'}`);
    }

    // TODO: Chatwork通知

  } catch (error) {
    console.error('[NotificationService] Error sending invite notification:', error);
    result.slack = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }

  return result;
}

/**
 * 追加候補通知を送信
 */
export async function sendAdditionalSlotsNotification(
  db: D1Database,
  workspaceId: string,
  params: {
    threadTitle: string;
    slotCount: number;
    slotLabels: string[];
    notifyCount: number;
  }
): Promise<NotificationResult> {
  const result: NotificationResult = {};

  try {
    const repo = new WorkspaceNotificationSettingsRepository(db);
    const settings = await repo.get(workspaceId);

    // Slack通知
    if (settings?.slack_enabled && settings.slack_webhook_url) {
      const model = composeAdditionalSlotsEmailModel({
        threadTitle: params.threadTitle,
        slotCount: params.slotCount,
        slotLabels: params.slotLabels,
      });

      const payload = renderSlackPayload(model);
      
      // 補足情報を追加
      payload.text = `📅 「${params.threadTitle}」に${params.slotCount}件の追加候補が追加されました（${params.notifyCount}名に通知）`;

      const slackResult = await sendSlackWebhook(settings.slack_webhook_url, payload);
      result.slack = { success: slackResult.success, error: slackResult.error };
      
      console.log(`[NotificationService] Slack additional_slots notification: ${slackResult.success ? 'success' : 'failed'}`);
    }

  } catch (error) {
    console.error('[NotificationService] Error sending additional_slots notification:', error);
    result.slack = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }

  return result;
}

/**
 * リマインド通知を送信
 */
export async function sendReminderNotification(
  db: D1Database,
  workspaceId: string,
  params: {
    inviterName: string;
    threadTitle: string;
    remindedCount: number;
    reminderType: 'pending' | 'need_response' | 'responded';
  }
): Promise<NotificationResult> {
  const result: NotificationResult = {};

  try {
    const repo = new WorkspaceNotificationSettingsRepository(db);
    const settings = await repo.get(workspaceId);

    // Slack通知
    if (settings?.slack_enabled && settings.slack_webhook_url) {
      const model = composeReminderEmailModel({
        inviterName: params.inviterName,
        threadTitle: params.threadTitle,
      });

      const payload = renderSlackPayload(model);
      
      // 補足情報を追加（リマインド種別ごとに文言を変更）
      let reminderLabel = 'リマインド';
      switch (params.reminderType) {
        case 'pending':
          reminderLabel = '未返信リマインド';
          break;
        case 'need_response':
          reminderLabel = '再回答リマインド';
          break;
        case 'responded':
          reminderLabel = '回答済みリマインド';
          break;
      }
      
      payload.text = `⏰ 「${params.threadTitle}」の${reminderLabel}を${params.remindedCount}名に送信しました`;

      const slackResult = await sendSlackWebhook(settings.slack_webhook_url, payload);
      result.slack = { success: slackResult.success, error: slackResult.error };
      
      console.log(`[NotificationService] Slack reminder notification: ${slackResult.success ? 'success' : 'failed'}`);
    }

  } catch (error) {
    console.error('[NotificationService] Error sending reminder notification:', error);
    result.slack = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }

  return result;
}

/**
 * 汎用通知送信（EmailModelを直接渡す場合）
 */
export async function sendNotificationFromModel(
  db: D1Database,
  workspaceId: string,
  model: EmailModel,
  options?: {
    textOverride?: string;
  }
): Promise<NotificationResult> {
  const result: NotificationResult = {};

  try {
    const repo = new WorkspaceNotificationSettingsRepository(db);
    const settings = await repo.get(workspaceId);

    // Slack通知
    if (settings?.slack_enabled && settings.slack_webhook_url) {
      const payload = renderSlackPayload(model);
      
      if (options?.textOverride) {
        payload.text = options.textOverride;
      }

      const slackResult = await sendSlackWebhook(settings.slack_webhook_url, payload);
      result.slack = { success: slackResult.success, error: slackResult.error };
      
      console.log(`[NotificationService] Slack notification: ${slackResult.success ? 'success' : 'failed'}`);
    }

  } catch (error) {
    console.error('[NotificationService] Error sending notification:', error);
    result.slack = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }

  return result;
}
