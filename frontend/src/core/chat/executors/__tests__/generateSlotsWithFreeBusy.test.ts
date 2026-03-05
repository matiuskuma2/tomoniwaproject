/**
 * FE-6b: generateSlotsWithFreeBusy Unit Tests
 *
 * テスト対象:
 *   FB-1: FreeBusy API 成功 → available_slots から上位N件を返す
 *   FB-2: FreeBusy API が warning を返す → generateDefaultSlots フォールバック
 *   FB-3: FreeBusy API が空のスロットを返す → generateDefaultSlots フォールバック
 *   FB-4: FreeBusy API がエラーを投げる → generateDefaultSlots フォールバック
 *   FB-5: constraints なし → range='next_week'
 *   FB-6: constraints.time_max ≤ 1日 → range='today'
 *   FB-7: constraints.time_max ≤ 7日 → range='week'
 *   FB-8: count=1 (fixed mode) → 1件のみ返す
 *   FB-9: count > available_slots.length → available 分だけ返す
 *   FB-10: prefer が constraints から FreeBusy API に渡される
 *   FB-11: durationMinutes が meetingLength として渡される
 *   FB-12: available_slots に label がある場合 → そのまま使う
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================

const mockGetFreeBusy = vi.fn();

vi.mock('../../../api/calendar', () => ({
  calendarApi: {
    getFreeBusy: (...args: any[]) => mockGetFreeBusy(...args),
  },
}));

vi.mock('../../../api/oneToMany', () => ({
  oneToManyApi: {
    prepare: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../invite', () => ({
  executeInvitePrepareEmails: vi.fn(),
}));

vi.mock('../oneOnOne', () => ({
  executeOneOnOneFreebusy: vi.fn(),
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
import { generateSlotsWithFreeBusy, generateDefaultSlots } from '../postImportBridge';

// ============================================================
// Helpers
// ============================================================

function makeAvailableSlots(count: number) {
  const slots = [];
  const base = new Date();
  base.setDate(base.getDate() + 1);
  base.setHours(14, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const start = new Date(base.getTime() + i * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    slots.push({
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      label: `候補${i + 1}: ${start.getHours()}:00〜${end.getHours()}:00`,
    });
  }
  return slots;
}

function makeFreeBusyResponse(overrides: Record<string, any> = {}) {
  return {
    range: 'next_week' as const,
    timezone: 'Asia/Tokyo',
    busy: [],
    available_slots: makeAvailableSlots(5),
    coverage: { time_min: '', time_max: '', total_free_minutes: 300, slot_count: 5 },
    prefer: null,
    warning: null,
    ...overrides,
  };
}

// ============================================================
// Tests: generateSlotsWithFreeBusy
// ============================================================

describe('FE-6b: generateSlotsWithFreeBusy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // FB-1: FreeBusy API 成功 → available_slots から上位N件
  it('FB-1: FreeBusy success → returns top N available slots', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots).toHaveLength(3);
    expect(mockGetFreeBusy).toHaveBeenCalledTimes(1);
    expect(mockGetFreeBusy).toHaveBeenCalledWith({
      range: 'next_week',
      prefer: undefined,
      meetingLength: 60,
    });

    // Each slot has required fields
    slots.forEach(slot => {
      expect(slot.start_at).toBeDefined();
      expect(slot.end_at).toBeDefined();
      expect(slot.label).toBeDefined();
    });
  });

  // FB-2: FreeBusy API warning → フォールバック
  it('FB-2: FreeBusy warning (calendar not linked) → fallback to default slots', async () => {
    mockGetFreeBusy.mockResolvedValue(
      makeFreeBusyResponse({ warning: 'google_calendar_permission_missing' })
    );

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots).toHaveLength(3);
    // Verify fallback: default slots have afternoon hours (14, 15, 16)
    slots.forEach(slot => {
      const hour = new Date(slot.start_at).getHours();
      expect([14, 15, 16]).toContain(hour);
    });
  });

  // FB-3: FreeBusy API が空の available_slots → フォールバック
  it('FB-3: empty available_slots → fallback to default slots', async () => {
    mockGetFreeBusy.mockResolvedValue(
      makeFreeBusyResponse({ available_slots: [] })
    );

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots).toHaveLength(3);
    // Fallback slots are default business hours
    slots.forEach(slot => {
      const hour = new Date(slot.start_at).getHours();
      expect([14, 15, 16]).toContain(hour);
    });
  });

  // FB-3b: available_slots が undefined → フォールバック
  it('FB-3b: undefined available_slots → fallback to default slots', async () => {
    mockGetFreeBusy.mockResolvedValue(
      makeFreeBusyResponse({ available_slots: undefined })
    );

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots).toHaveLength(3);
  });

  // FB-4: FreeBusy API エラー → フォールバック（事故ゼロ）
  it('FB-4: FreeBusy API throws → fallback to default slots (zero-failure)', async () => {
    mockGetFreeBusy.mockRejectedValue(new Error('Network error'));

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots).toHaveLength(3);
    // Still produces valid slots
    slots.forEach(slot => {
      expect(new Date(slot.start_at).getTime()).not.toBeNaN();
      expect(new Date(slot.end_at).getTime()).not.toBeNaN();
    });
  });

  // FB-5: constraints なし → range='next_week'
  it('FB-5: null constraints → range=next_week', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    await generateSlotsWithFreeBusy(3, 60, null);

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'next_week' })
    );
  });

  // FB-6: time_max ≤ 1日 → range='today'
  it('FB-6: time_max within 1 day → range=today', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    const timeMax = new Date();
    timeMax.setHours(timeMax.getHours() + 12); // 12時間後

    await generateSlotsWithFreeBusy(3, 60, {
      time_max: timeMax.toISOString(),
    });

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'today' })
    );
  });

  // FB-7: time_max ≤ 7日 → range='week'
  it('FB-7: time_max within 7 days → range=week', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 5); // 5日後

    await generateSlotsWithFreeBusy(3, 60, {
      time_max: timeMax.toISOString(),
    });

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'week' })
    );
  });

  // FB-8: count=1 (fixed mode) → 1件のみ
  it('FB-8: count=1 → returns single slot', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    const slots = await generateSlotsWithFreeBusy(1, 60, null);

    expect(slots).toHaveLength(1);
  });

  // FB-9: count > available → available 分だけ
  it('FB-9: count exceeds available → returns all available', async () => {
    mockGetFreeBusy.mockResolvedValue(
      makeFreeBusyResponse({ available_slots: makeAvailableSlots(2) })
    );

    const slots = await generateSlotsWithFreeBusy(5, 60, null);

    expect(slots).toHaveLength(2);
  });

  // FB-10: prefer が API に渡される
  it('FB-10: prefer constraint forwarded to FreeBusy API', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    await generateSlotsWithFreeBusy(3, 60, { prefer: 'morning' });

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ prefer: 'morning' })
    );
  });

  // FB-11: durationMinutes が meetingLength として渡される
  it('FB-11: durationMinutes forwarded as meetingLength', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    await generateSlotsWithFreeBusy(3, 30, null);

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ meetingLength: 30 })
    );
  });

  // FB-12: label がスロットから保存される
  it('FB-12: slot labels preserved from API response', async () => {
    const customSlots = [
      { start_at: '2026-03-10T14:00:00Z', end_at: '2026-03-10T15:00:00Z', label: '3/10(火) 14:00〜15:00' },
      { start_at: '2026-03-10T15:00:00Z', end_at: '2026-03-10T16:00:00Z', label: '3/10(火) 15:00〜16:00' },
      { start_at: '2026-03-11T10:00:00Z', end_at: '2026-03-11T11:00:00Z', label: '3/11(水) 10:00〜11:00' },
    ];
    mockGetFreeBusy.mockResolvedValue(
      makeFreeBusyResponse({ available_slots: customSlots })
    );

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots[0].label).toBe('3/10(火) 14:00〜15:00');
    expect(slots[1].label).toBe('3/10(火) 15:00〜16:00');
    expect(slots[2].label).toBe('3/11(水) 10:00〜11:00');
  });

  // FB-13: google_account_not_linked warning → フォールバック
  it('FB-13: google_account_not_linked warning → fallback', async () => {
    mockGetFreeBusy.mockResolvedValue(
      makeFreeBusyResponse({ warning: 'google_account_not_linked' })
    );

    const slots = await generateSlotsWithFreeBusy(3, 60, null);

    expect(slots).toHaveLength(3);
    // Verify these are fallback slots (weekday, business hours)
    slots.forEach(slot => {
      const dayOfWeek = new Date(slot.start_at).getDay();
      expect(dayOfWeek).toBeGreaterThanOrEqual(1);
      expect(dayOfWeek).toBeLessThanOrEqual(5);
    });
  });

  // FB-14: time_min + time_max 両方なし → next_week
  it('FB-14: no time_min/time_max → range=next_week', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    await generateSlotsWithFreeBusy(3, 60, { prefer: 'afternoon' });

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'next_week' })
    );
  });

  // FB-15: time_max > 7日 → next_week (上限)
  it('FB-15: time_max beyond 7 days → range=next_week', async () => {
    mockGetFreeBusy.mockResolvedValue(makeFreeBusyResponse());

    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 14); // 14日後

    await generateSlotsWithFreeBusy(3, 60, {
      time_max: timeMax.toISOString(),
    });

    expect(mockGetFreeBusy).toHaveBeenCalledWith(
      expect.objectContaining({ range: 'next_week' })
    );
  });
});
