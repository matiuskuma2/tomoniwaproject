/**
 * FE-5 T5: postImportBridge Unit Tests
 *
 * テスト対象:
 *   BR-1: send_invite (1名)   → executeInvitePrepareEmails 呼出
 *   BR-2: send_invite (複数名) → executeInvitePrepareEmails 呼出
 *   BR-3: schedule + 1名      → executeOneOnOneFreebusy 呼出
 *   BR-4: schedule + 2名+     → oneToManyApi.prepare + send 呼出
 *   BR-5: schedule + 2名+ send失敗 → orphan thread 保護
 *   BR-6: schedule + 2名+ prepare失敗 → エラーメッセージ
 *   BR-7: 不明アクション → フォールバック
 *   BR-8: generateDefaultSlots — デフォルトスロット生成
 *   BR-9: generateDefaultSlots — constraints付き（morning）
 *   BR-10: generateDefaultSlots — constraints付き（time_min/time_max）
 *   BR-11: schedule + 1名 失敗 → フォールバック
 *   BR-12: send_invite 失敗 → フォールバック
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================
const mockInvitePrepareEmails = vi.fn();
const mockOneOnOneFreebusy = vi.fn();
const mockOneToManyPrepare = vi.fn();
const mockOneToManySend = vi.fn();

vi.mock('../invite', () => ({
  executeInvitePrepareEmails: (...args: any[]) => mockInvitePrepareEmails(...args),
}));

vi.mock('../oneOnOne', () => ({
  executeOneOnOneFreebusy: (...args: any[]) => mockOneOnOneFreebusy(...args),
}));

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

// Import after mocks
import { executePostImportAutoConnect, generateDefaultSlots } from '../postImportBridge';

// ============================================================
// Tests
// ============================================================

describe('FE-5: executePostImportAutoConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // BR-1: send_invite (1名)
  it('BR-1: send_invite + 1 email → executeInvitePrepareEmails', async () => {
    mockInvitePrepareEmails.mockResolvedValue({
      success: true,
      message: '📧 招待の準備ができました',
    });

    const result = await executePostImportAutoConnect({
      action: 'send_invite',
      emails: ['alice@test.com'],
      names: ['Alice'],
    });

    expect(result.success).toBe(true);
    expect(mockInvitePrepareEmails).toHaveBeenCalledTimes(1);
    expect(mockInvitePrepareEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'invite.prepare.emails',
        confidence: 1.0,
        params: expect.objectContaining({
          emails: ['alice@test.com'],
          mode: 'new_thread',
        }),
      })
    );
    // oneOnOne, oneToMany は呼ばれない
    expect(mockOneOnOneFreebusy).not.toHaveBeenCalled();
    expect(mockOneToManyPrepare).not.toHaveBeenCalled();
  });

  // BR-2: send_invite (複数名)
  it('BR-2: send_invite + 3 emails → executeInvitePrepareEmails', async () => {
    mockInvitePrepareEmails.mockResolvedValue({
      success: true,
      message: '📧 3名に招待の準備ができました',
    });

    const result = await executePostImportAutoConnect({
      action: 'send_invite',
      emails: ['a@t.com', 'b@t.com', 'c@t.com'],
      names: ['A', 'B', 'C'],
    });

    expect(result.success).toBe(true);
    expect(mockInvitePrepareEmails).toHaveBeenCalledTimes(1);
    // 人数に関係なく invite
    expect(mockOneToManyPrepare).not.toHaveBeenCalled();
  });

  // BR-3: schedule + 1名
  it('BR-3: schedule + 1 email → executeOneOnOneFreebusy', async () => {
    mockOneOnOneFreebusy.mockResolvedValue({
      success: true,
      message: '📅 日程調整の候補を送りました',
    });

    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['alice@test.com'],
      names: ['Alice'],
    });

    expect(result.success).toBe(true);
    expect(mockOneOnOneFreebusy).toHaveBeenCalledTimes(1);
    expect(mockOneOnOneFreebusy).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'schedule.1on1.freebusy',
        confidence: 1.0,
        params: expect.objectContaining({
          person: { name: 'Alice', email: 'alice@test.com' },
          constraints: { duration: 60 },
          duration_minutes: 60,
          title: '打ち合わせ',
        }),
      })
    );
    expect(mockInvitePrepareEmails).not.toHaveBeenCalled();
    expect(mockOneToManyPrepare).not.toHaveBeenCalled();
  });

  // BR-4: schedule + 2名+
  it('BR-4: schedule + 2 emails → oneToMany prepare + send', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-001' },
      invitees: [
        { email: 'a@t.com', name: 'A' },
        { email: 'b@t.com', name: 'B' },
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

    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['a@t.com', 'b@t.com'],
      names: ['A', 'B'],
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('日程調整スレッドを作成しました');
    expect(result.data?.kind).toBe('thread.create');
    expect((result.data?.payload as any)?.threadId).toBe('thread-001');
    expect(mockOneToManyPrepare).toHaveBeenCalledTimes(1);
    expect(mockOneToManySend).toHaveBeenCalledTimes(1);
    expect(mockOneToManySend).toHaveBeenCalledWith('thread-001', expect.anything());
  });

  // BR-5: schedule + 2名+ send失敗
  it('BR-5: schedule + 2 emails, send fails → orphan thread protection', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: { id: 'thread-orphan' },
      invitees: [{ email: 'a@t.com', name: 'A' }],
      slots: [],
    });
    mockOneToManySend.mockRejectedValue(new Error('Send failed'));

    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['a@t.com', 'b@t.com'],
      names: ['A', 'B'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('thread-orphan');
    expect(result.message).toContain('招待メールの送信に失敗');
  });

  // BR-6: schedule + 2名+ prepare失敗
  it('BR-6: schedule + 2 emails, prepare fails → error message', async () => {
    mockOneToManyPrepare.mockRejectedValue(new Error('Prepare failed'));

    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['a@t.com', 'b@t.com'],
      names: ['A', 'B'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('日程調整の準備に失敗');
  });

  // BR-7: 不明アクション
  it('BR-7: unknown action → fallback error', async () => {
    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: [],
      names: [],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('不明なアクション');
  });

  // BR-11: schedule + 1名 失敗
  it('BR-11: schedule + 1 email, freebusy fails → fallback', async () => {
    mockOneOnOneFreebusy.mockRejectedValue(new Error('Calendar unavailable'));

    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['alice@test.com'],
      names: ['Alice'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('日程調整の準備に失敗');
    expect(result.message).toContain('Alice');
  });

  // BR-12: send_invite 失敗
  it('BR-12: send_invite fails → fallback', async () => {
    mockInvitePrepareEmails.mockRejectedValue(new Error('Network error'));

    const result = await executePostImportAutoConnect({
      action: 'send_invite',
      emails: ['alice@test.com'],
      names: ['Alice'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('招待の準備に失敗');
  });

  // BR-4b: prepare returns no thread ID
  it('BR-4b: oneToMany prepare returns no thread_id → error', async () => {
    mockOneToManyPrepare.mockResolvedValue({
      success: true,
      thread: {},
      invitees: [],
      slots: [],
    });

    const result = await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['a@t.com', 'b@t.com'],
      names: ['A', 'B'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('日程調整スレッドの作成に失敗');
    expect(mockOneToManySend).not.toHaveBeenCalled();
  });

  // BR-3b: schedule + 1名, name がない場合 → email前半を使う
  it('BR-3b: schedule + 1 email, no name → uses email prefix', async () => {
    mockOneOnOneFreebusy.mockResolvedValue({
      success: true,
      message: 'OK',
    });

    await executePostImportAutoConnect({
      action: 'schedule',
      emails: ['tanaka@company.com'],
      names: [],
    });

    expect(mockOneOnOneFreebusy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          person: { name: 'tanaka', email: 'tanaka@company.com' },
        }),
      })
    );
  });
});

// ============================================================
// Tests: generateDefaultSlots
// ============================================================

describe('FE-5: generateDefaultSlots', () => {
  // BR-8: デフォルトスロット生成
  it('BR-8: generates 3 default business-hour slots', () => {
    const slots = generateDefaultSlots(3, 60, null);

    expect(slots).toHaveLength(3);
    slots.forEach(slot => {
      expect(slot.start_at).toBeDefined();
      expect(slot.end_at).toBeDefined();
      expect(slot.label).toBeDefined();
      // ISO8601 format check
      expect(new Date(slot.start_at).getTime()).not.toBeNaN();
      expect(new Date(slot.end_at).getTime()).not.toBeNaN();
      // Duration check (60 min)
      const diffMs = new Date(slot.end_at).getTime() - new Date(slot.start_at).getTime();
      expect(diffMs).toBe(60 * 60 * 1000);
    });
  });

  // BR-8b: 営業日のみ（土日除外）
  it('BR-8b: slots only on weekdays (Mon-Fri)', () => {
    const slots = generateDefaultSlots(15, 60, null);

    slots.forEach(slot => {
      const dayOfWeek = new Date(slot.start_at).getDay();
      expect(dayOfWeek).toBeGreaterThanOrEqual(1); // Monday
      expect(dayOfWeek).toBeLessThanOrEqual(5);     // Friday
    });
  });

  // BR-8c: 翌日以降（今日は含まない）
  it('BR-8c: slots start from tomorrow', () => {
    const slots = generateDefaultSlots(3, 60, null);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    slots.forEach(slot => {
      const slotDate = new Date(slot.start_at);
      slotDate.setHours(0, 0, 0, 0);
      expect(slotDate.getTime()).toBeGreaterThan(today.getTime());
    });
  });

  // BR-9: morning constraints
  it('BR-9: morning prefer → 9, 10, 11 時台', () => {
    const slots = generateDefaultSlots(3, 60, { prefer: 'morning' });

    slots.forEach(slot => {
      const hour = new Date(slot.start_at).getHours();
      expect([9, 10, 11]).toContain(hour);
    });
  });

  // BR-9b: evening constraints
  it('BR-9b: evening prefer → 17, 18, 19 時台', () => {
    const slots = generateDefaultSlots(3, 60, { prefer: 'evening' });

    slots.forEach(slot => {
      const hour = new Date(slot.start_at).getHours();
      expect([17, 18, 19]).toContain(hour);
    });
  });

  // BR-10: time_min / time_max
  it('BR-10: time_min/time_max constraints', () => {
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() + 7); // 1週間後
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + 5); // 5日間の範囲

    const slots = generateDefaultSlots(3, 60, {
      time_min: timeMin.toISOString(),
      time_max: timeMax.toISOString(),
    });

    slots.forEach(slot => {
      const slotDate = new Date(slot.start_at);
      expect(slotDate.getTime()).toBeGreaterThanOrEqual(timeMin.getTime());
    });
  });

  // BR-10b: count=0 → 空配列
  it('BR-10b: count=0 → empty array', () => {
    const slots = generateDefaultSlots(0, 60, null);
    expect(slots).toHaveLength(0);
  });

  // BR-10c: 30分枠
  it('BR-10c: 30 min duration', () => {
    const slots = generateDefaultSlots(3, 30, null);

    slots.forEach(slot => {
      const diffMs = new Date(slot.end_at).getTime() - new Date(slot.start_at).getTime();
      expect(diffMs).toBe(30 * 60 * 1000);
    });
  });

  // BR-8d: label format check
  it('BR-8d: label contains date and time info', () => {
    const slots = generateDefaultSlots(3, 60, null);

    slots.forEach(slot => {
      // label should contain Japanese weekday
      expect(slot.label).toMatch(/[月火水木金]/);
      // label should contain time separator
      expect(slot.label).toMatch(/〜/);
    });
  });
});
