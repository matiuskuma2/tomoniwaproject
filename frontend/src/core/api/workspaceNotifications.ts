/**
 * Workspace Notifications API Client
 * P2-E1: Slack/Chatwork送達設定
 */

import { api } from './client';

// ============================================================
// Types
// ============================================================

export interface WorkspaceNotificationSettings {
  slack_enabled: boolean;
  slack_webhook_configured: boolean;
  chatwork_enabled: boolean;
  chatwork_configured: boolean;
}

export interface UpdateSlackSettingsRequest {
  enabled: boolean;
  webhook_url?: string | null;
}

export interface UpdateSlackSettingsResponse {
  success: boolean;
  slack_enabled: boolean;
  slack_webhook_configured: boolean;
  error?: string;
}

export interface TestSlackResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// ============================================================
// API Functions
// ============================================================

/**
 * ワークスペース通知設定を取得
 * 注意: webhook URL自体は返却しない（セキュリティ）
 */
export async function getWorkspaceNotifications(): Promise<WorkspaceNotificationSettings> {
  return api.get<WorkspaceNotificationSettings>('/api/workspace/notifications');
}

/**
 * Slack設定を更新
 * @param data - enabled と webhook_url
 */
export async function updateSlackSettings(
  data: UpdateSlackSettingsRequest
): Promise<UpdateSlackSettingsResponse> {
  return api.put<UpdateSlackSettingsResponse>(
    '/api/workspace/notifications/slack',
    data
  );
}

/**
 * Slack接続テスト
 */
export async function testSlackConnection(): Promise<TestSlackResponse> {
  return api.post<TestSlackResponse>('/api/workspace/notifications/slack/test');
}

// ============================================================
// Export as namespace
// ============================================================

export const workspaceNotificationsApi = {
  get: getWorkspaceNotifications,
  updateSlack: updateSlackSettings,
  testSlack: testSlackConnection,
};
