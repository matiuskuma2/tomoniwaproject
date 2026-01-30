/**
 * Channel Resolver for 1-on-1 Scheduling
 * Phase 3: チャネル選択の決定ユーティリティ
 * 
 * 目的:
 * - 「大島くんに予定調整送って」→ どのチャネルで送るかを決定
 * - 送信できる（email / slack / chatwork のいずれか）
 * - 送れない場合は理由が明確
 * 
 * 現在の実装（最小版）:
 * - contact.email をデフォルトチャネルとして使用
 * - contact_channels テーブルは将来の拡張ポイント
 * 
 * 将来の拡張（Phase 4+）:
 * - contact_channels から is_primary=1 のチャネルを優先
 * - workspace_notification_settings で slack/chatwork の有効性をチェック
 * - 複数チャネルが同条件で並ぶ場合はユーザー選択
 */

import { log } from '../../../platform';

// ============================================================
// Types
// ============================================================

export type ChannelType = 'email' | 'slack' | 'chatwork' | 'line' | 'phone';

export interface ContactChannel {
  channel_type: ChannelType;
  channel_value: string;
  is_primary: boolean;
  verified: boolean;
}

export interface ResolvedChannel {
  type: ChannelType;
  value: string;
  display_label: string; // "email: test@example.com" など
}

export interface ChannelCandidate {
  type: ChannelType;
  value: string;
  display_label: string;
  is_primary: boolean;
  verified: boolean;
}

// Resolve結果の型
export type ResolveChannelResult =
  | { type: 'resolved'; channel: ResolvedChannel }
  | { type: 'needs_selection'; candidates: ChannelCandidate[]; reason: string }
  | { type: 'not_available'; reason: NotAvailableReason };

export type NotAvailableReason = 
  | 'no_email'           // contact に email がない
  | 'no_channels'        // contact_channels が空（将来用）
  | 'workspace_not_configured'  // workspace に Slack/ChatWork が未設定
  | 'channel_not_verified';     // 指定チャネルが未検証

// ============================================================
// Channel Resolution Logic
// ============================================================

/**
 * 連絡先のチャネルを解決する
 * 
 * Phase 3 実装（最小版）:
 * - contact.email があれば email チャネルとして解決
 * - なければ not_available (no_email)
 * 
 * @param contact - 解決済みの連絡先情報
 * @returns ResolveChannelResult
 */
export function resolveChannel(contact: {
  id: string;
  email?: string;
  display_name: string;
}): ResolveChannelResult {
  log.debug('[resolveChannel] Input', { 
    contactId: contact.id, 
    hasEmail: !!contact.email,
    displayName: contact.display_name 
  });

  // Phase 3: contact.email をデフォルトチャネルとして使用
  if (contact.email) {
    const channel: ResolvedChannel = {
      type: 'email',
      value: contact.email,
      display_label: `email: ${contact.email}`,
    };

    log.debug('[resolveChannel] Resolved to email', { 
      channel: channel.value 
    });

    return { type: 'resolved', channel };
  }

  // email がない場合は not_available
  log.debug('[resolveChannel] No email available', { 
    contactId: contact.id 
  });

  return {
    type: 'not_available',
    reason: 'no_email',
  };
}

/**
 * 将来の拡張: contact_channels からチャネルを解決
 * 
 * TODO: Phase 4+ で contact_channels API を実装したら、この関数を有効化
 * 
 * 優先順位ルール（自動決定）:
 * 1. is_primary = 1 のチャネル（種類問わず）
 * 2. なければ email
 * 3. なければ slack
 * 4. なければ chatwork
 * 
 * 追加ルール:
 * - workspace に Slack/ChatWork が未設定なら、そのチャネルは候補から除外
 * - verified = 0 は候補から除外
 * - 同率が複数あるなら ユーザーに選ばせる pending を出す
 */
export function resolveChannelFromChannels(
  channels: ContactChannel[],
  workspaceSettings?: {
    slack_enabled: boolean;
    chatwork_enabled: boolean;
  }
): ResolveChannelResult {
  log.debug('[resolveChannelFromChannels] Input', { 
    channelCount: channels.length,
    workspaceSettings 
  });

  if (channels.length === 0) {
    return { type: 'not_available', reason: 'no_channels' };
  }

  // フィルタリング: verified = 1 のみ（email は例外的に verified 不要でもOK）
  // workspace 設定で無効なチャネルを除外
  const availableChannels = channels.filter(ch => {
    // email は verified 不要
    if (ch.channel_type === 'email') return true;
    
    // verified でないものは除外
    if (!ch.verified) return false;
    
    // workspace 設定で無効なチャネルを除外
    if (ch.channel_type === 'slack' && workspaceSettings && !workspaceSettings.slack_enabled) {
      return false;
    }
    if (ch.channel_type === 'chatwork' && workspaceSettings && !workspaceSettings.chatwork_enabled) {
      return false;
    }
    
    return true;
  });

  if (availableChannels.length === 0) {
    return { type: 'not_available', reason: 'no_channels' };
  }

  // is_primary = 1 のチャネルを優先
  const primaryChannels = availableChannels.filter(ch => ch.is_primary);
  if (primaryChannels.length === 1) {
    const ch = primaryChannels[0];
    return {
      type: 'resolved',
      channel: {
        type: ch.channel_type,
        value: ch.channel_value,
        display_label: `${ch.channel_type}: ${ch.channel_value}`,
      },
    };
  }

  // 複数の primary がある場合は選択を促す
  if (primaryChannels.length > 1) {
    return {
      type: 'needs_selection',
      candidates: primaryChannels.map(ch => ({
        type: ch.channel_type,
        value: ch.channel_value,
        display_label: `${ch.channel_type}: ${ch.channel_value}`,
        is_primary: ch.is_primary,
        verified: ch.verified,
      })),
      reason: '複数のプライマリチャネルが設定されています',
    };
  }

  // primary がない場合は優先順位に従う: email > slack > chatwork
  const priorityOrder: ChannelType[] = ['email', 'slack', 'chatwork', 'line', 'phone'];
  
  for (const channelType of priorityOrder) {
    const matching = availableChannels.filter(ch => ch.channel_type === channelType);
    if (matching.length === 1) {
      const ch = matching[0];
      return {
        type: 'resolved',
        channel: {
          type: ch.channel_type,
          value: ch.channel_value,
          display_label: `${ch.channel_type}: ${ch.channel_value}`,
        },
      };
    }
    if (matching.length > 1) {
      return {
        type: 'needs_selection',
        candidates: matching.map(ch => ({
          type: ch.channel_type,
          value: ch.channel_value,
          display_label: `${ch.channel_type}: ${ch.channel_value}`,
          is_primary: ch.is_primary,
          verified: ch.verified,
        })),
        reason: `複数の${channelType}が登録されています`,
      };
    }
  }

  // どのチャネルもない場合
  return { type: 'not_available', reason: 'no_channels' };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * チャネル解決結果からユーザー向けメッセージを生成
 */
export function formatResolveChannelMessage(result: ResolveChannelResult): string {
  switch (result.type) {
    case 'resolved':
      return `送信チャネル: ${result.channel.display_label}`;
    
    case 'needs_selection': {
      const candidateList = result.candidates
        .map((c, i) => `${i + 1}. ${c.display_label}`)
        .join('\n');
      return `${result.reason}\n\n${candidateList}\n\n番号で選んでください。`;
    }
    
    case 'not_available':
      return formatNotAvailableReason(result.reason);
  }
}

/**
 * not_available の理由をユーザー向けメッセージに変換
 */
function formatNotAvailableReason(reason: NotAvailableReason): string {
  switch (reason) {
    case 'no_email':
      return 'この連絡先にはメールアドレスが登録されていません。連絡先にメールアドレスを追加してください。';
    case 'no_channels':
      return 'この連絡先には有効な連絡先チャネルがありません。連絡先にメールアドレスまたは他のチャネルを追加してください。';
    case 'workspace_not_configured':
      return 'このワークスペースにはSlack/ChatWorkが設定されていません。設定画面から連携を有効にしてください。';
    case 'channel_not_verified':
      return '指定されたチャネルは検証されていません。検証済みのチャネルを使用してください。';
  }
}

/**
 * チャネルタイプを日本語表示に変換
 */
export function getChannelTypeLabel(type: ChannelType): string {
  switch (type) {
    case 'email': return 'メール';
    case 'slack': return 'Slack';
    case 'chatwork': return 'ChatWork';
    case 'line': return 'LINE';
    case 'phone': return '電話';
  }
}
