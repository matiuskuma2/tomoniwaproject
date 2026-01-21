/**
 * Workspace Notification Settings Repository
 * P2-E1: Slack/Chatwork送達
 * 
 * workspace単位で通知チャネル設定（Slack/Chatwork）を管理
 */

// ====== Types ======

export interface WorkspaceNotificationSettings {
  workspace_id: string;
  slack_enabled: boolean;
  slack_webhook_url: string | null;
  chatwork_enabled: boolean;
  chatwork_api_token: string | null;
  chatwork_room_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceNotificationSettingsRow {
  workspace_id: string;
  slack_enabled: number;  // SQLite boolean
  slack_webhook_url: string | null;
  chatwork_enabled: number;  // SQLite boolean
  chatwork_api_token: string | null;
  chatwork_room_id: string | null;
  created_at: string;
  updated_at: string;
}

// ====== Repository ======

export class WorkspaceNotificationSettingsRepository {
  constructor(private db: D1Database) {}

  /**
   * workspace_id で設定を取得
   * 存在しない場合は null を返す
   */
  async get(workspaceId: string): Promise<WorkspaceNotificationSettings | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM workspace_notification_settings WHERE workspace_id = ?`
      )
      .bind(workspaceId)
      .first<WorkspaceNotificationSettingsRow>();

    if (!row) {
      return null;
    }

    return this.rowToSettings(row);
  }

  /**
   * 設定を作成または更新（upsert）
   */
  async upsert(args: {
    workspaceId: string;
    slackEnabled?: boolean;
    slackWebhookUrl?: string | null;
    chatworkEnabled?: boolean;
    chatworkApiToken?: string | null;
    chatworkRoomId?: string | null;
  }): Promise<WorkspaceNotificationSettings> {
    const now = new Date().toISOString();
    
    // 既存レコードを取得
    const existing = await this.get(args.workspaceId);

    if (existing) {
      // UPDATE
      const updates: string[] = [];
      const binds: (string | number | null)[] = [];

      if (args.slackEnabled !== undefined) {
        updates.push('slack_enabled = ?');
        binds.push(args.slackEnabled ? 1 : 0);
      }
      if (args.slackWebhookUrl !== undefined) {
        updates.push('slack_webhook_url = ?');
        binds.push(args.slackWebhookUrl);
      }
      if (args.chatworkEnabled !== undefined) {
        updates.push('chatwork_enabled = ?');
        binds.push(args.chatworkEnabled ? 1 : 0);
      }
      if (args.chatworkApiToken !== undefined) {
        updates.push('chatwork_api_token = ?');
        binds.push(args.chatworkApiToken);
      }
      if (args.chatworkRoomId !== undefined) {
        updates.push('chatwork_room_id = ?');
        binds.push(args.chatworkRoomId);
      }

      updates.push('updated_at = ?');
      binds.push(now);
      binds.push(args.workspaceId);

      await this.db
        .prepare(
          `UPDATE workspace_notification_settings 
           SET ${updates.join(', ')}
           WHERE workspace_id = ?`
        )
        .bind(...binds)
        .run();
    } else {
      // INSERT
      await this.db
        .prepare(
          `INSERT INTO workspace_notification_settings 
           (workspace_id, slack_enabled, slack_webhook_url, chatwork_enabled, chatwork_api_token, chatwork_room_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          args.workspaceId,
          args.slackEnabled ? 1 : 0,
          args.slackWebhookUrl ?? null,
          args.chatworkEnabled ? 1 : 0,
          args.chatworkApiToken ?? null,
          args.chatworkRoomId ?? null,
          now,
          now
        )
        .run();
    }

    // 更新後のレコードを返す
    const updated = await this.get(args.workspaceId);
    if (!updated) {
      throw new Error('Failed to upsert workspace notification settings');
    }
    return updated;
  }

  /**
   * Slack設定のみを更新
   */
  async updateSlackSettings(args: {
    workspaceId: string;
    enabled: boolean;
    webhookUrl: string | null;
  }): Promise<WorkspaceNotificationSettings> {
    return this.upsert({
      workspaceId: args.workspaceId,
      slackEnabled: args.enabled,
      slackWebhookUrl: args.webhookUrl,
    });
  }

  /**
   * Chatwork設定のみを更新
   */
  async updateChatworkSettings(args: {
    workspaceId: string;
    enabled: boolean;
    apiToken: string | null;
    roomId: string | null;
  }): Promise<WorkspaceNotificationSettings> {
    return this.upsert({
      workspaceId: args.workspaceId,
      chatworkEnabled: args.enabled,
      chatworkApiToken: args.apiToken,
      chatworkRoomId: args.roomId,
    });
  }

  /**
   * Slackが有効かつwebhook URLが設定されているか
   */
  async isSlackConfigured(workspaceId: string): Promise<boolean> {
    const settings = await this.get(workspaceId);
    return settings !== null && settings.slack_enabled && settings.slack_webhook_url !== null;
  }

  /**
   * Chatworkが有効かつAPIトークン/Room IDが設定されているか
   */
  async isChatworkConfigured(workspaceId: string): Promise<boolean> {
    const settings = await this.get(workspaceId);
    return settings !== null && 
           settings.chatwork_enabled && 
           settings.chatwork_api_token !== null && 
           settings.chatwork_room_id !== null;
  }

  // ====== Private ======

  private rowToSettings(row: WorkspaceNotificationSettingsRow): WorkspaceNotificationSettings {
    return {
      workspace_id: row.workspace_id,
      slack_enabled: row.slack_enabled === 1,
      slack_webhook_url: row.slack_webhook_url,
      chatwork_enabled: row.chatwork_enabled === 1,
      chatwork_api_token: row.chatwork_api_token,
      chatwork_room_id: row.chatwork_room_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
