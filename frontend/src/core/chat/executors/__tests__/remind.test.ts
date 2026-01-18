/**
 * remind.test.ts
 * P2-R1: リマインダー機能強化 - 内訳表示の統一テスト
 * 
 * テスト内容:
 * - analyzeRemindStatus: スレッドのリマインド状況分析
 * - formatRemindSummary: 統一フォーマット出力
 * - formatRemindConfirmation: リマインド確認メッセージ
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeRemindStatus,
  formatRemindSummary,
  formatRemindConfirmation,
} from '../remind';
import type { ThreadStatus_API } from '../../../models';

// ============================================================
// Test Fixtures
// ============================================================

/**
 * モック: 基本的なスレッドステータス
 */
function createMockStatus(options: {
  invites?: Array<{
    email: string;
    name?: string;
    status: string;
    invitee_key: string;
  }>;
  selections?: Array<{
    invitee_key: string;
    proposal_version_at_response?: number;
  }>;
  currentVersion?: number;
  remainingProposals?: number;
}): ThreadStatus_API {
  const {
    invites = [],
    selections = [],
    currentVersion = 1,
    remainingProposals = 2,
  } = options;

  return {
    thread: {
      id: 'test-thread-id',
      title: 'テスト調整',
      status: 'active',
      organizer_user_id: 'user-1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
    rule: {
      version: 1,
      type: 'normal',
      finalize_policy: 'manual',
      details: {},
    },
    slots: [],
    invites: invites.map((inv) => ({
      invite_id: `invite-${inv.invitee_key}`,
      email: inv.email,
      candidate_name: inv.name || inv.email.split('@')[0],
      status: inv.status,
      token: `token-${inv.invitee_key}`,
      invite_url: `https://example.com/i/token-${inv.invitee_key}`,
      invitee_key: inv.invitee_key,
      expires_at: '2024-12-31T23:59:59Z',
    })),
    selections: selections.map((sel) => ({
      invitee_key: sel.invitee_key,
      proposal_version_at_response: sel.proposal_version_at_response || 1,
    })),
    evaluation: {
      finalized: false,
      warnings: [],
    },
    pending: {
      count: 0,
      invites: [],
      required_missing: false,
    },
    proposal_info: {
      current_version: currentVersion,
      additional_propose_count: currentVersion - 1,
      remaining_proposals: remainingProposals,
      invitees_needing_response: [],
      invitees_needing_response_count: 0,
    },
  } as unknown as ThreadStatus_API;
}

// ============================================================
// Tests: analyzeRemindStatus
// ============================================================

describe('analyzeRemindStatus', () => {
  it('全員回答済みの場合', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
        { email: 'b@example.com', status: 'accepted', invitee_key: 'key-b' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 1 },
        { invitee_key: 'key-b', proposal_version_at_response: 1 },
      ],
    });

    const summary = analyzeRemindStatus(status);

    expect(summary.totalInvites).toBe(2);
    expect(summary.pendingCount).toBe(0);
    expect(summary.needResponseCount).toBe(0);
    expect(summary.respondedCount).toBe(2);
    expect(summary.declinedCount).toBe(0);
  });

  it('未返信者がいる場合', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
        { email: 'b@example.com', status: 'pending', invitee_key: 'key-b' },
        { email: 'c@example.com', status: 'pending', invitee_key: 'key-c' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 1 },
      ],
    });

    const summary = analyzeRemindStatus(status);

    expect(summary.pendingCount).toBe(2);
    expect(summary.respondedCount).toBe(1);
    expect(summary.invitees.filter(i => i.reason === 'pending')).toHaveLength(2);
  });

  it('再回答必要者がいる場合（proposal_version > 回答時version）', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
        { email: 'b@example.com', status: 'accepted', invitee_key: 'key-b' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 2 }, // 最新
        { invitee_key: 'key-b', proposal_version_at_response: 1 }, // 旧世代
      ],
      currentVersion: 2,
    });

    const summary = analyzeRemindStatus(status);

    expect(summary.currentVersion).toBe(2);
    expect(summary.needResponseCount).toBe(1);
    expect(summary.respondedCount).toBe(1);
    
    const needResponseInvitee = summary.invitees.find(i => i.reason === 'need_response');
    expect(needResponseInvitee?.email).toBe('b@example.com');
    expect(needResponseInvitee?.respondedVersion).toBe(1);
  });

  it('辞退者がいる場合', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
        { email: 'b@example.com', status: 'declined', invitee_key: 'key-b' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 1 },
      ],
    });

    const summary = analyzeRemindStatus(status);

    expect(summary.declinedCount).toBe(1);
    expect(summary.respondedCount).toBe(1);
    expect(summary.invitees.find(i => i.reason === 'declined')?.email).toBe('b@example.com');
  });

  it('混合ケース: 未返信 + 再回答必要 + 辞退 + 回答済み', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
        { email: 'b@example.com', status: 'accepted', invitee_key: 'key-b' },
        { email: 'c@example.com', status: 'pending', invitee_key: 'key-c' },
        { email: 'd@example.com', status: 'declined', invitee_key: 'key-d' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 2 }, // 最新
        { invitee_key: 'key-b', proposal_version_at_response: 1 }, // 旧世代
      ],
      currentVersion: 2,
    });

    const summary = analyzeRemindStatus(status);

    expect(summary.totalInvites).toBe(4);
    expect(summary.pendingCount).toBe(1);
    expect(summary.needResponseCount).toBe(1);
    expect(summary.declinedCount).toBe(1);
    expect(summary.respondedCount).toBe(1);
  });
});

// ============================================================
// Tests: formatRemindSummary
// ============================================================

describe('formatRemindSummary', () => {
  it('サマリーに必須情報が含まれる', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'pending', invitee_key: 'key-a' },
      ],
      currentVersion: 2,
      remainingProposals: 1,
    });

    const summary = analyzeRemindStatus(status);
    const message = formatRemindSummary(summary);

    // ヘッダー
    expect(message).toContain('テスト調整');
    // バージョン
    expect(message).toContain('v2');
    expect(message).toContain('追加候補あり');
    // 残り回数
    expect(message).toContain('あと 1 回');
    // 凡例
    expect(message).toContain('✅最新回答済');
    expect(message).toContain('⏳未返信');
    expect(message).toContain('🔄再回答必要');
    expect(message).toContain('❌辞退');
  });

  it('未返信者がいる場合の次アクション', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'pending', invitee_key: 'key-a' },
      ],
    });

    const summary = analyzeRemindStatus(status);
    const message = formatRemindSummary(summary, { includeNextActions: true });

    expect(message).toContain('次のアクション');
    expect(message).toContain('リマインド');
    expect(message).toContain('未返信者 1名');
  });

  it('全員回答済みの場合の次アクション', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 1 },
      ],
    });

    const summary = analyzeRemindStatus(status);
    const message = formatRemindSummary(summary, { includeNextActions: true });

    expect(message).toContain('全員が最新候補に回答済み');
    expect(message).toContain('確定');
  });
});

// ============================================================
// Tests: formatRemindConfirmation
// ============================================================

describe('formatRemindConfirmation', () => {
  it('未返信者へのリマインド確認', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', name: '田中', status: 'pending', invitee_key: 'key-a' },
        { email: 'b@example.com', status: 'pending', invitee_key: 'key-b' },
      ],
    });

    const summary = analyzeRemindStatus(status);
    const message = formatRemindConfirmation(summary, 'pending');

    expect(message).toContain('リマインド確認');
    expect(message).toContain('a@example.com');
    expect(message).toContain('田中');
    expect(message).toContain('⏳未返信');
    expect(message).toContain('2名');
    expect(message).toContain('はい');
    expect(message).toContain('いいえ');
  });

  it('再回答必要者へのリマインド確認', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 1 },
      ],
      currentVersion: 2,
    });

    const summary = analyzeRemindStatus(status);
    const message = formatRemindConfirmation(summary, 'need_response');

    expect(message).toContain('a@example.com');
    expect(message).toContain('v1時点');
  });

  it('対象者がいない場合', () => {
    const status = createMockStatus({
      invites: [
        { email: 'a@example.com', status: 'accepted', invitee_key: 'key-a' },
      ],
      selections: [
        { invitee_key: 'key-a', proposal_version_at_response: 1 },
      ],
    });

    const summary = analyzeRemindStatus(status);
    const message = formatRemindConfirmation(summary, 'pending');

    expect(message).toContain('未返信者がいません');
    expect(message).toContain('不要');
  });
});
