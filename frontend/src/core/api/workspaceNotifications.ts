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
  // P2-E2: SMS settings
  sms_enabled: boolean;
  sms_configured: boolean;
  sms_from?: string;
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

// Chatwork Settings
export interface UpdateChatworkSettingsRequest {
  enabled: boolean;
  api_token?: string | null;
  room_id?: string | null;
}

export interface UpdateChatworkSettingsResponse {
  success: boolean;
  chatwork_enabled: boolean;
  chatwork_configured: boolean;
  error?: string;
}

export interface TestChatworkResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// P2-E2: SMS Settings
export interface UpdateSmsSettingsRequest {
  enabled: boolean;
  from_number?: string | null;
}

export interface UpdateSmsSettingsResponse {
  success: boolean;
  sms_enabled: boolean;
  sms_configured: boolean;
  sms_from?: string;
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

/**
 * Chatwork設定を更新
 * @param data - enabled, api_token, room_id
 */
export async function updateChatworkSettings(
  data: UpdateChatworkSettingsRequest
): Promise<UpdateChatworkSettingsResponse> {
  return api.put<UpdateChatworkSettingsResponse>(
    '/api/workspace/notifications/chatwork',
    data
  );
}

/**
 * Chatwork接続テスト
 */
export async function testChatworkConnection(): Promise<TestChatworkResponse> {
  return api.post<TestChatworkResponse>('/api/workspace/notifications/chatwork/test');
}

/**
 * SMS設定を更新
 * 注意: Twilio SID/Token はサーバー側の環境変数で管理
 * @param data - enabled と from_number（送信元番号）
 */
export async function updateSmsSettings(
  data: UpdateSmsSettingsRequest
): Promise<UpdateSmsSettingsResponse> {
  return api.put<UpdateSmsSettingsResponse>(
    '/api/workspace/notifications/sms',
    data
  );
}

// ============================================================
// Export as namespace
// ============================================================

export const workspaceNotificationsApi = {
  get: getWorkspaceNotifications,
  updateSlack: updateSlackSettings,
  testSlack: testSlackConnection,
  updateChatwork: updateChatworkSettings,
  testChatwork: testChatworkConnection,
  updateSms: updateSmsSettings,
};
