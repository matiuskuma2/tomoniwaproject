/**
 * FE-6: oneToMany Executor Unit Tests
 *
 * テスト対象:
 *   OTM-E1: 正常フロー（2名のメール → prepare + send → 成功）
 *   OTM-E2: 0名解決 → エラー
 *   OTM-E3: 1名のみ解決 → 1対1フォールバック案内
 *   OTM-E4: prepare失敗 → エラー
 *   OTM-E5: send失敗 → orphan thread保護
 *   OTM-E6: prepare成功だがthread.idなし → エラー
 *   OTM-E7: 認証エラー → 再ログインメッセージ
 *   OTM-E8: スロット生成失敗（範囲が狭すぎ）→ エラー
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================
const mockOneToManyPrepare = vi.fn();
const mockOneToManySend = vi.fn();

vi.mock('../../../api/oneToMany', () => ({
  oneToManyApi: {
    prepare: (...args: any[]) => mockOneToManyPrepare(...args),
    send: (...args: any[]) => mockOneToManySend(...args),
  },
}));

vi.mock('../../../platform', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../auth', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
}));

// Mock fetch for name resolution
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
import { executeOneToManySchedule } from '../oneToMany';
import type { IntentResult } from '../../intentClassifier';

// ============================================================
// Helpers
// ============================================================

function makeIntent(overrides: Partial<IntentResult['params']> = {}): IntentResult {
  return {
    intent: 'schedule.1toN.prepare' as any,
    confidence: 0.9,
    params: {
      persons: [],
      emails: ['a@test.com', 'b@test.com'],
      mode: 'candidates',
      title: '打ち合わせ',
      duration_minutes: 60,
      ...overrides,
    },
  };
}

// ============================================================
// Tests
// ============================================================

describe('FE-6: executeOneToManySchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ contacts: [] }),
    });
  });

  // OTM-E1: 正常フロー
  it('OTM-E1: 2 emails → prepare + send → success', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-001' },
      invitees: [
        { email: 'a@test.com', name: 'A' },
        { email: 'b@test.com', name: 'B' },
      ],
      slots: [],
    });
    mockOneToManySend.mockResolvedValue({
      success: true,
      thread_id: 'thread-001',
      sent_count: 2,
      total: 2,
      channel: 'email',
      status: 'sent',
    });

    const result = await executeOneToManySchedule(makeIntent());

    expect(result.success).toBe(true);
    expect(result.message).toContain('日程調整スレッドを作成しました');
    expect(result.message).toContain('2名参加');
    expect(result.data?.kind).toBe('1toN.sent');
    expect((result.data?.payload as any)?.threadId).toBe('thread-001');
    expect(mockOneToManyPrepare).toHaveBeenCalledTimes(1);
    expect(mockOneToManySend).toHaveBeenCalledTimes(1);
  });

  // OTM-E2: 0名解決
  it('OTM-E2: no emails, no resolvable names → error', async () => {
    const result = await executeOneToManySchedule(makeIntent({
      emails: [],
      persons: [{ name: '不明太郎' }],
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('メールアドレスが見つかりません');
    expect(mockOneToManyPrepare).not.toHaveBeenCalled();
  });

  // OTM-E3: 1名のみ解決
  it('OTM-E3: only 1 email → fallback to 1on1 guidance', async () => {
    const result = await executeOneToManySchedule(makeIntent({
      emails: ['solo@test.com'],
      persons: [],
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain('1対1の日程調整');
    expect(mockOneToManyPrepare).not.toHaveBeenCalled();
  });

  // OTM-E4: prepare失敗
  it('OTM-E4: prepare throws → error message', async () => {
    mockOneToManyPrepare.mockRejectedValue(new Error('API down'));

    const result = await executeOneToManySchedule(makeIntent());

    expect(result.success).toBe(false);
    expect(result.message).toContain('日程調整に失敗しました');
  });

  // OTM-E5: send失敗（orphan thread保護）
  it('OTM-E5: send fails after prepare → orphan thread protection', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-orphan' },
      invitees: [{ email: 'a@test.com', name: 'A' }],
      slots: [],
    });
    mockOneToManySend.mockRejectedValue(new Error('Send failed'));

    const result = await executeOneToManySchedule(makeIntent());

    expect(result.success).toBe(false);
    expect(result.message).toContain('thread-orphan');
    expect(result.message).toContain('招待メールの送信に失敗');
    // data should still have the thread info
    expect(result.data?.kind).toBe('1toN.prepared');
  });

  // OTM-E6: prepare成功だがthread.idなし
  it('OTM-E6: prepare returns no thread_id → error', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: {},
      invitees: [],
    });

    const result = await executeOneToManySchedule(makeIntent());

    expect(result.success).toBe(false);
    expect(result.message).toContain('スレッドの作成に失敗');
    expect(mockOneToManySend).not.toHaveBeenCalled();
  });

  // OTM-E7: 認証エラー
  it('OTM-E7: auth error → re-login message', async () => {
    mockOneToManyPrepare.mockRejectedValue(new Error('401 Unauthorized'));

    const result = await executeOneToManySchedule(makeIntent());

    expect(result.success).toBe(false);
    expect(result.message).toContain('ログインが必要');
  });

  // OTM-E8: 名前→メール解決成功
  it('OTM-E8: name resolution via contacts API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        contacts: [{ email: 'tanaka@company.com' }],
      }),
    });

    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-resolved' },
      invitees: [
        { email: 'tanaka@company.com', name: '田中' },
        { email: 'b@test.com', name: 'B' },
      ],
      slots: [],
    });
    mockOneToManySend.mockResolvedValue({
      success: true,
      thread_id: 'thread-resolved',
      sent_count: 2,
      total: 2,
      channel: 'email',
      status: 'sent',
    });

    const result = await executeOneToManySchedule(makeIntent({
      emails: ['b@test.com'],
      persons: [{ name: '田中' }],
    }));

    expect(result.success).toBe(true);
    expect(mockOneToManyPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: expect.arrayContaining(['tanaka@company.com', 'b@test.com']),
      })
    );
  });

  // OTM-E9: mode と title が正しく渡される
  it('OTM-E9: mode and title forwarded to API', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-custom' },
      invitees: [],
      slots: [],
    });
    mockOneToManySend.mockResolvedValue({
      success: true,
      thread_id: 'thread-custom',
      sent_count: 2,
      total: 2,
      channel: 'email',
      status: 'sent',
    });

    await executeOneToManySchedule(makeIntent({
      mode: 'open_slots',
      title: '会議',
    }));

    expect(mockOneToManyPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'open_slots',
        title: '会議',
      })
    );
  });

  // OTM-E10: duplicate emails are deduplicated
  it('OTM-E10: duplicate emails → deduplicated', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-dedup' },
      invitees: [],
      slots: [],
    });
    mockOneToManySend.mockResolvedValue({
      success: true,
      thread_id: 'thread-dedup',
      sent_count: 2,
      total: 2,
      channel: 'email',
      status: 'sent',
    });

    await executeOneToManySchedule(makeIntent({
      emails: ['a@test.com', 'a@test.com', 'b@test.com'],
    }));

    // Should deduplicate: only 2 unique emails
    expect(mockOneToManyPrepare).toHaveBeenCalledWith(
      expect.objectContaining({
        emails: expect.arrayContaining(['a@test.com', 'b@test.com']),
      })
    );
    const callEmails = mockOneToManyPrepare.mock.calls[0][0].emails;
    expect(callEmails.length).toBe(2);
  });
});
