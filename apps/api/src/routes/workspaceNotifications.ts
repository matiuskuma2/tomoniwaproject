/**
 * Workspace Notification Settings Routes
 * P2-E1: Slack/Chatwork送達
 * 
 * workspace単位で通知チャネル設定を管理するAPI
 */

import { Hono } from 'hono';
import { WorkspaceNotificationSettingsRepository } from '../repositories/workspaceNotificationSettingsRepository';

type Bindings = {
  DB: D1Database;
};

type Variables = {
  userId?: string;
  userRole?: string;
  workspaceId?: string;
};

const workspaceNotifications = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ============================================================
// GET /api/workspace/notifications
// 現在の通知設定を取得
// ============================================================
workspaceNotifications.get('/', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const workspaceId = c.get('workspaceId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!workspaceId) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  const repo = new WorkspaceNotificationSettingsRepository(env.DB);
  const settings = await repo.get(workspaceId);

  // 設定が存在しない場合はデフォルト値を返す
  if (!settings) {
    return c.json({
      slack_enabled: false,
      slack_webhook_configured: false,
      chatwork_enabled: false,
      chatwork_configured: false,
      // P2-E2: SMS
      sms_enabled: false,
      sms_configured: false,
    });
  }

  // webhook URL / API Token 自体は返さない（漏洩防止）
  return c.json({
    slack_enabled: settings.slack_enabled,
    slack_webhook_configured: settings.slack_webhook_url !== null,
    chatwork_enabled: settings.chatwork_enabled,
    chatwork_configured: settings.chatwork_api_token !== null && settings.chatwork_room_id !== null,
    // P2-E2: SMS
    sms_enabled: settings.sms_enabled,
    sms_configured: settings.sms_from_number !== null,
  });
});

// ============================================================
// PUT /api/workspace/notifications/slack
// Slack設定を更新
// ============================================================
workspaceNotifications.put('/slack', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const workspaceId = c.get('workspaceId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!workspaceId) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  let body: { enabled?: boolean; webhook_url?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // バリデーション
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  // webhook_url のバリデーション
  if (body.webhook_url !== undefined && body.webhook_url !== null) {
    if (typeof body.webhook_url !== 'string') {
      return c.json({ error: 'webhook_url must be a string or null' }, 400);
    }
    // Slack Incoming Webhook URLの形式チェック
    if (!body.webhook_url.startsWith('https://hooks.slack.com/services/')) {
      return c.json({ 
        error: 'webhook_url must start with https://hooks.slack.com/services/' 
      }, 400);
    }
  }

  // enabled=true だが webhook_url がない場合はエラー
  if (body.enabled && !body.webhook_url) {
    // 既存の設定を確認
    const repo = new WorkspaceNotificationSettingsRepository(env.DB);
    const existing = await repo.get(workspaceId);
    if (!existing?.slack_webhook_url) {
      return c.json({ 
        error: 'webhook_url is required when enabling Slack notifications' 
      }, 400);
    }
  }

  const repo = new WorkspaceNotificationSettingsRepository(env.DB);
  
  try {
    await repo.updateSlackSettings({
      workspaceId,
      enabled: body.enabled,
      webhookUrl: body.webhook_url !== undefined ? body.webhook_url : undefined as any,
    });

    console.log(`[WorkspaceNotifications] Slack settings updated for workspace ${workspaceId}: enabled=${body.enabled}`);

    return c.json({ 
      success: true,
      slack_enabled: body.enabled,
      slack_webhook_configured: body.webhook_url !== null && body.webhook_url !== undefined,
    });
  } catch (error) {
    console.error('[WorkspaceNotifications] Error updating Slack settings:', error);
    return c.json({ error: 'Failed to update Slack settings' }, 500);
  }
});

// ============================================================
// PUT /api/workspace/notifications/chatwork
// Chatwork設定を更新
// ============================================================
workspaceNotifications.put('/chatwork', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const workspaceId = c.get('workspaceId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!workspaceId) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  let body: { enabled?: boolean; api_token?: string | null; room_id?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // バリデーション
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  // enabled=true だが api_token/room_id がない場合はエラー
  if (body.enabled) {
    const repo = new WorkspaceNotificationSettingsRepository(env.DB);
    const existing = await repo.get(workspaceId);
    
    const hasApiToken = body.api_token || existing?.chatwork_api_token;
    const hasRoomId = body.room_id || existing?.chatwork_room_id;
    
    if (!hasApiToken || !hasRoomId) {
      return c.json({ 
        error: 'api_token and room_id are required when enabling Chatwork notifications' 
      }, 400);
    }
  }

  const repo = new WorkspaceNotificationSettingsRepository(env.DB);
  
  try {
    await repo.updateChatworkSettings({
      workspaceId,
      enabled: body.enabled,
      apiToken: body.api_token !== undefined ? body.api_token : undefined as any,
      roomId: body.room_id !== undefined ? body.room_id : undefined as any,
    });

    console.log(`[WorkspaceNotifications] Chatwork settings updated for workspace ${workspaceId}: enabled=${body.enabled}`);

    return c.json({ 
      success: true,
      chatwork_enabled: body.enabled,
      chatwork_configured: true,
    });
  } catch (error) {
    console.error('[WorkspaceNotifications] Error updating Chatwork settings:', error);
    return c.json({ error: 'Failed to update Chatwork settings' }, 500);
  }
});

// ============================================================
// POST /api/workspace/notifications/slack/test
// Slack接続テスト（webhook URLが有効かどうか確認）
// ============================================================
workspaceNotifications.post('/slack/test', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const workspaceId = c.get('workspaceId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!workspaceId) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  const repo = new WorkspaceNotificationSettingsRepository(env.DB);
  const settings = await repo.get(workspaceId);

  if (!settings?.slack_webhook_url) {
    return c.json({ error: 'Slack webhook URL not configured' }, 400);
  }

  try {
    // テストメッセージを送信
    const response = await fetch(settings.slack_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '🔔 Tomoniwao Slack連携テスト\nこのメッセージが表示されていれば、Slack通知が正常に設定されています。',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WorkspaceNotifications] Slack test failed:', errorText);
      return c.json({ 
        success: false, 
        error: `Slack API error: ${response.status}` 
      }, 400);
    }

    console.log(`[WorkspaceNotifications] Slack test successful for workspace ${workspaceId}`);

    return c.json({ success: true, message: 'Test message sent successfully' });
  } catch (error) {
    console.error('[WorkspaceNotifications] Slack test error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to send test message' 
    }, 500);
  }
});

// ============================================================
// PUT /api/workspace/notifications/sms
// SMS設定を更新
// P2-E2
// ============================================================
workspaceNotifications.put('/sms', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  const workspaceId = c.get('workspaceId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!workspaceId) {
    return c.json({ error: 'Workspace not found' }, 404);
  }

  let body: { enabled?: boolean; from_number?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // バリデーション
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  // from_number のバリデーション（E.164形式）
  if (body.from_number !== undefined && body.from_number !== null) {
    if (typeof body.from_number !== 'string') {
      return c.json({ error: 'from_number must be a string or null' }, 400);
    }
    // E.164形式チェック（+始まり、10-15桁）
    if (!/^\+[1-9]\d{9,14}$/.test(body.from_number)) {
      return c.json({ 
        error: 'from_number must be in E.164 format (e.g., +81901234567)' 
      }, 400);
    }
  }

  // enabled=true だが from_number がない場合はエラー
  if (body.enabled && !body.from_number) {
    const repo = new WorkspaceNotificationSettingsRepository(env.DB);
    const existing = await repo.get(workspaceId);
    if (!existing?.sms_from_number) {
      return c.json({ 
        error: 'from_number is required when enabling SMS notifications' 
      }, 400);
    }
  }

  const repo = new WorkspaceNotificationSettingsRepository(env.DB);
  
  try {
    await repo.updateSmsSettings({
      workspaceId,
      enabled: body.enabled,
      fromNumber: body.from_number !== undefined ? body.from_number : null,
    });

    console.log(`[WorkspaceNotifications] SMS settings updated for workspace ${workspaceId}: enabled=${body.enabled}`);

    return c.json({ 
      success: true,
      sms_enabled: body.enabled,
      sms_configured: body.from_number !== null && body.from_number !== undefined,
    });
  } catch (error) {
    console.error('[WorkspaceNotifications] Error updating SMS settings:', error);
    return c.json({ error: 'Failed to update SMS settings' }, 500);
  }
});

export default workspaceNotifications;
