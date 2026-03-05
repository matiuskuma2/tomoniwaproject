/**
 * PR-B6: Reverse Availability — Executor Unit Tests
 *
 * テスト対象:
 *   RA-E1: 正常フロー（name + email → prepare成功）
 *   RA-E2: clarification（needsClarification あり → メッセージ返すだけ）
 *   RA-E3: メール未指定 → ガイダンスメッセージ
 *   RA-E4: API 401 → 再ログイン案内
 *   RA-E5: API エラー → 失敗メッセージ
 *   RA-E6: ネットワークエラー → 失敗メッセージ
 *   RA-E7: トークンなし → ログイン案内
 *   RA-E8: finalize 正常フロー
 *   RA-E9: finalize 401エラー
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeReverseAvailability,
  executeReverseAvailabilityFinalize,
} from '../reverseAvailability';

// Mocks
vi.mock('../../../platform', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../auth', () => ({
  getToken: vi.fn(() => 'test-token'),
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function buildIntent(params: Record<string, any>, needsClarification?: any) {
  return {
    intent: 'schedule.1on1.reverse_availability' as any,
    confidence: 0.9,
    params,
    needsClarification,
  };
}

describe('executeReverseAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RA-E1: 正常フロー
  it('RA-E1: 正常フロー（name + email → prepare成功）', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        success: true,
        thread_id: 'thread-1',
        reverse_availability_id: 'ra-1',
        token: 'abc123',
        share_url: 'https://app.tomoniwao.jp/ra/abc123',
        expires_at: '2026-03-10T00:00:00Z',
        message_for_chat: '🙏 ご都合伺いモードで日程調整を開始しました。',
        email_queued: true,
        request_id: 'req-1',
      }),
    });

    const result = await executeReverseAvailability(
      buildIntent({
        target: { name: '佐藤部長', email: 'sato@example.com' },
        title: '打ち合わせ',
        duration_minutes: 60,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('ご都合伺いモード');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/reverse-availability/prepare',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  // RA-E2: clarification
  it('RA-E2: needsClarification → そのままメッセージ返す', async () => {
    const result = await executeReverseAvailability(
      buildIntent(
        { title: '打ち合わせ' },
        {
          field: 'target',
          message: 'ご都合伺いモードですね。相手のお名前とメールアドレスを教えてください。',
        },
      ),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('メールアドレスを教えてください');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // RA-E3: メール未指定
  it('RA-E3: メール未指定 → ガイダンス', async () => {
    const result = await executeReverseAvailability(
      buildIntent({
        target: { name: '佐藤部長' },
        title: '打ち合わせ',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('メールアドレスを教えてください');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // RA-E4: API 401
  it('RA-E4: API 401 → 再ログイン案内', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const result = await executeReverseAvailability(
      buildIntent({
        target: { name: '佐藤', email: 'sato@example.com' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('再ログイン');
  });

  // RA-E5: API エラー（success: false）
  it('RA-E5: API success: false → 失敗メッセージ', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        success: false,
        error: 'internal_error',
      }),
    });

    const result = await executeReverseAvailability(
      buildIntent({
        target: { name: '佐藤', email: 'sato@example.com' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('失敗');
  });

  // RA-E6: ネットワークエラー
  it('RA-E6: ネットワークエラー → 通信エラーメッセージ', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await executeReverseAvailability(
      buildIntent({
        target: { name: '佐藤', email: 'sato@example.com' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('通信エラー');
  });

  // RA-E7: トークンなし
  it('RA-E7: トークンなし → ログイン案内', async () => {
    const { getToken } = await import('../../../auth');
    (getToken as any).mockReturnValueOnce(null);

    const result = await executeReverseAvailability(
      buildIntent({
        target: { name: '佐藤', email: 'sato@example.com' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('ログイン');
  });
});

describe('executeReverseAvailabilityFinalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RA-E8: finalize 正常フロー
  it('RA-E8: finalize 正常フロー', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        success: true,
        thread_id: 'thread-1',
        finalized_slot: {
          start: '2026-03-10T10:00:00+09:00',
          end: '2026-03-10T11:00:00+09:00',
          label: '3/10（月）10:00 〜 11:00',
        },
        meet_url: 'https://meet.google.com/abc-def-ghi',
        calendar_event_id: 'event-1',
        message_for_chat: '✅ 打ち合わせの日程が確定しました！',
        request_id: 'req-1',
      }),
    });

    const result = await executeReverseAvailabilityFinalize('ra-1', 0);

    expect(result.success).toBe(true);
    expect(result.message).toContain('確定');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/reverse-availability/ra-1/finalize',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slot_index: 0 }),
      }),
    );
  });

  // RA-E9: finalize 401
  it('RA-E9: finalize 401 → 再ログイン', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const result = await executeReverseAvailabilityFinalize('ra-1', 0);

    expect(result.success).toBe(false);
    expect(result.message).toContain('再ログイン');
  });
});
