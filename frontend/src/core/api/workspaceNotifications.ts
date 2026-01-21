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
  chatwork_webhook_configured: boolean;
}

export interface UpdateWorkspaceNotificationSettingsRequest {
  slack_enabled?: boolean;
  slack_webhook_url?: string | null;
  chatwork_enabled?: boolean;
  chatwork_webhook_url?: string | null;
}

export interface UpdateWorkspaceNotificationSettingsResponse {
  success: boolean;
  settings: WorkspaceNotificationSettings;
  message?: string;
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
 * ワークスペース通知設定を更新
 * @param data - 更新するフィールド
 */
export async function updateWorkspaceNotifications(
  data: UpdateWorkspaceNotificationSettingsRequest
): Promise<UpdateWorkspaceNotificationSettingsResponse> {
  return api.put<UpdateWorkspaceNotificationSettingsResponse>(
    '/api/workspace/notifications',
    data
  );
}

// ============================================================
// Export as namespace
// ============================================================

export const workspaceNotificationsApi = {
  get: getWorkspaceNotifications,
  update: updateWorkspaceNotifications,
};
