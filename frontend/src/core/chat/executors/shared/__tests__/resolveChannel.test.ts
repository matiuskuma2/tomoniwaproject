/**
 * Channel Resolver Tests
 * Phase 3: チャネル選択の決定ユーティリティのテスト
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveChannel,
  resolveChannelFromChannels,
  formatResolveChannelMessage,
  getChannelTypeLabel,
  type ContactChannel,
  type ResolveChannelResult,
} from '../resolveChannel';

// Mock log
vi.mock('../../../../platform', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('resolveChannel', () => {
  describe('Phase 3: email-based resolution (minimal implementation)', () => {
    it('should resolve to email when contact has email', () => {
      const result = resolveChannel({
        id: 'contact-1',
        email: 'test@example.com',
        display_name: '田中太郎',
      });

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('email');
        expect(result.channel.value).toBe('test@example.com');
        expect(result.channel.display_label).toBe('email: test@example.com');
      }
    });

    it('should return not_available when contact has no email', () => {
      const result = resolveChannel({
        id: 'contact-1',
        email: undefined,
        display_name: '田中太郎',
      });

      expect(result.type).toBe('not_available');
      if (result.type === 'not_available') {
        expect(result.reason).toBe('no_email');
      }
    });

    it('should return not_available when email is empty string', () => {
      const result = resolveChannel({
        id: 'contact-1',
        email: '',
        display_name: '田中太郎',
      });

      expect(result.type).toBe('not_available');
      if (result.type === 'not_available') {
        expect(result.reason).toBe('no_email');
      }
    });
  });
});

describe('resolveChannelFromChannels (future extension)', () => {
  describe('empty channels', () => {
    it('should return not_available when channels array is empty', () => {
      const result = resolveChannelFromChannels([]);

      expect(result.type).toBe('not_available');
      if (result.type === 'not_available') {
        expect(result.reason).toBe('no_channels');
      }
    });
  });

  describe('single channel', () => {
    it('should resolve to single email channel', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'email', channel_value: 'test@example.com', is_primary: false, verified: false },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('email');
        expect(result.channel.value).toBe('test@example.com');
      }
    });

    it('should resolve to single slack channel when verified', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: false, verified: true },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('slack');
        expect(result.channel.value).toBe('@tanaka');
      }
    });

    it('should not resolve to unverified slack channel', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: false, verified: false },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('not_available');
    });
  });

  describe('primary channel priority', () => {
    it('should resolve to primary channel over non-primary', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'email', channel_value: 'test@example.com', is_primary: false, verified: false },
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: true, verified: true },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('slack');
        expect(result.channel.value).toBe('@tanaka');
      }
    });

    it('should return needs_selection when multiple primary channels exist', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'email', channel_value: 'test@example.com', is_primary: true, verified: false },
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: true, verified: true },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('needs_selection');
      if (result.type === 'needs_selection') {
        expect(result.candidates.length).toBe(2);
        expect(result.reason).toBe('複数のプライマリチャネルが設定されています');
      }
    });
  });

  describe('channel type priority (email > slack > chatwork)', () => {
    it('should prefer email over slack when no primary is set', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: false, verified: true },
        { channel_type: 'email', channel_value: 'test@example.com', is_primary: false, verified: false },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('email');
      }
    });

    it('should prefer slack over chatwork when no email', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'chatwork', channel_value: '12345', is_primary: false, verified: true },
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: false, verified: true },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('slack');
      }
    });
  });

  describe('workspace settings filtering', () => {
    it('should exclude slack when workspace has slack_enabled = false', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: true, verified: true },
        { channel_type: 'email', channel_value: 'test@example.com', is_primary: false, verified: false },
      ];

      const result = resolveChannelFromChannels(channels, {
        slack_enabled: false,
        chatwork_enabled: true,
      });

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('email');
      }
    });

    it('should exclude chatwork when workspace has chatwork_enabled = false', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'chatwork', channel_value: '12345', is_primary: true, verified: true },
        { channel_type: 'email', channel_value: 'test@example.com', is_primary: false, verified: false },
      ];

      const result = resolveChannelFromChannels(channels, {
        slack_enabled: true,
        chatwork_enabled: false,
      });

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.channel.type).toBe('email');
      }
    });

    it('should return not_available when all channels are disabled', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'slack', channel_value: '@tanaka', is_primary: false, verified: true },
        { channel_type: 'chatwork', channel_value: '12345', is_primary: false, verified: true },
      ];

      const result = resolveChannelFromChannels(channels, {
        slack_enabled: false,
        chatwork_enabled: false,
      });

      expect(result.type).toBe('not_available');
    });
  });

  describe('multiple channels of same type', () => {
    it('should return needs_selection when multiple emails exist', () => {
      const channels: ContactChannel[] = [
        { channel_type: 'email', channel_value: 'work@example.com', is_primary: false, verified: false },
        { channel_type: 'email', channel_value: 'personal@example.com', is_primary: false, verified: false },
      ];

      const result = resolveChannelFromChannels(channels);

      expect(result.type).toBe('needs_selection');
      if (result.type === 'needs_selection') {
        expect(result.candidates.length).toBe(2);
        expect(result.reason).toBe('複数のemailが登録されています');
      }
    });
  });
});

describe('formatResolveChannelMessage', () => {
  it('should format resolved message', () => {
    const result: ResolveChannelResult = {
      type: 'resolved',
      channel: {
        type: 'email',
        value: 'test@example.com',
        display_label: 'email: test@example.com',
      },
    };

    const message = formatResolveChannelMessage(result);
    expect(message).toBe('送信チャネル: email: test@example.com');
  });

  it('should format needs_selection message with numbered list', () => {
    const result: ResolveChannelResult = {
      type: 'needs_selection',
      candidates: [
        { type: 'email', value: 'work@example.com', display_label: 'email: work@example.com', is_primary: false, verified: false },
        { type: 'email', value: 'personal@example.com', display_label: 'email: personal@example.com', is_primary: false, verified: false },
      ],
      reason: '複数のemailが登録されています',
    };

    const message = formatResolveChannelMessage(result);
    expect(message).toContain('複数のemailが登録されています');
    expect(message).toContain('1. email: work@example.com');
    expect(message).toContain('2. email: personal@example.com');
    expect(message).toContain('番号で選んでください');
  });

  it('should format no_email message', () => {
    const result: ResolveChannelResult = {
      type: 'not_available',
      reason: 'no_email',
    };

    const message = formatResolveChannelMessage(result);
    expect(message).toContain('メールアドレスが登録されていません');
  });

  it('should format no_channels message', () => {
    const result: ResolveChannelResult = {
      type: 'not_available',
      reason: 'no_channels',
    };

    const message = formatResolveChannelMessage(result);
    expect(message).toContain('有効な連絡先チャネルがありません');
  });

  it('should format workspace_not_configured message', () => {
    const result: ResolveChannelResult = {
      type: 'not_available',
      reason: 'workspace_not_configured',
    };

    const message = formatResolveChannelMessage(result);
    expect(message).toContain('Slack/ChatWorkが設定されていません');
  });
});

describe('getChannelTypeLabel', () => {
  it('should return Japanese label for email', () => {
    expect(getChannelTypeLabel('email')).toBe('メール');
  });

  it('should return Japanese label for slack', () => {
    expect(getChannelTypeLabel('slack')).toBe('Slack');
  });

  it('should return Japanese label for chatwork', () => {
    expect(getChannelTypeLabel('chatwork')).toBe('ChatWork');
  });

  it('should return Japanese label for line', () => {
    expect(getChannelTypeLabel('line')).toBe('LINE');
  });

  it('should return Japanese label for phone', () => {
    expect(getChannelTypeLabel('phone')).toBe('電話');
  });
});
