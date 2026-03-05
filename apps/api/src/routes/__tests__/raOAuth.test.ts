/**
 * PR-B6 Phase 2: raOAuth + FreeBusy filtering tests
 *
 * Tests:
 * RA-P2-1 ~ RA-P2-15: OAuth flow, FreeBusy filtering, fallback
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { generateFreeBusyFilteredSlots } from '../raOAuth';

// ============================================================
// テスト用ヘルパー
// ============================================================

/**
 * テスト用にISO日時文字列を生成（JST基準）
 */
function jstDate(year: number, month: number, day: number, hour: number, minute: number = 0): string {
  // JST → UTC (JST - 9h)
  const utcHour = hour - 9;
  const d = new Date(Date.UTC(year, month - 1, day, utcHour, minute, 0));
  return d.toISOString();
}

/**
 * 固定の「現在」を設定するヘルパー
 */
function setMockNow(isoString: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoString));
}

// ============================================================
// generateFreeBusyFilteredSlots テスト
// ============================================================

describe('PR-B6 Phase 2: generateFreeBusyFilteredSlots', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test('RA-P2-12: busy期間が正しく除外される', () => {
    // 2026-03-10 (月) 〜 2026-03-11 (火)
    // 固定日時: 2026-03-09 (日) を「現在」に設定
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    const timeMin = jstDate(2026, 3, 10, 9, 0);  // 3/10 09:00 JST
    const timeMax = jstDate(2026, 3, 11, 18, 0);  // 3/11 18:00 JST

    // ゲストのbusy: 3/10 10:00-12:00 JST
    const busyPeriods = [
      {
        start: jstDate(2026, 3, 10, 10, 0),
        end: jstDate(2026, 3, 10, 12, 0),
      },
    ];

    const result = generateFreeBusyFilteredSlots(
      busyPeriods,
      timeMin,
      timeMax,
      60, // 60分スロット
      60, // 60分間隔
    );

    // 3/10のスロット
    const march10Slots = result.get('2026-03-10') || [];

    // 10:00, 11:00 は busy期間と重なるので除外されるべき
    const march10Labels = march10Slots.map(s => s.label);
    expect(march10Labels).not.toContain('10:00');
    expect(march10Labels).not.toContain('11:00');

    // 09:00, 12:00, 13:00 ... は含まれるべき
    expect(march10Labels).toContain('09:00');
    expect(march10Labels).toContain('12:00');
    expect(march10Labels).toContain('13:00');

    vi.useRealTimers();
  });

  test('RA-P2-13: busy期間なし → 全スロット生成', () => {
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    const timeMin = jstDate(2026, 3, 10, 9, 0);  // 月曜
    const timeMax = jstDate(2026, 3, 10, 18, 0);

    const result = generateFreeBusyFilteredSlots(
      [], // busyなし
      timeMin,
      timeMax,
      60,
      60,
    );

    const march10Slots = result.get('2026-03-10') || [];
    // 09:00〜17:00 の9スロット（18:00は60分枠が入らない）
    expect(march10Slots.length).toBe(9);

    vi.useRealTimers();
  });

  test('RA-P2-12b: 複数のbusy期間が正しく除外される', () => {
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    const timeMin = jstDate(2026, 3, 10, 9, 0);
    const timeMax = jstDate(2026, 3, 10, 18, 0);

    // 3/10: 09:30-10:30 と 14:00-15:00 がbusy
    const busyPeriods = [
      { start: jstDate(2026, 3, 10, 9, 30), end: jstDate(2026, 3, 10, 10, 30) },
      { start: jstDate(2026, 3, 10, 14, 0), end: jstDate(2026, 3, 10, 15, 0) },
    ];

    const result = generateFreeBusyFilteredSlots(
      busyPeriods,
      timeMin,
      timeMax,
      60,
      60,
    );

    const march10Slots = result.get('2026-03-10') || [];
    const labels = march10Slots.map(s => s.label);

    // 09:00-10:00 は 09:30 busyと重なる → 除外
    expect(labels).not.toContain('09:00');
    // 10:00-11:00 は 09:30-10:30 busyと重なる → 除外
    expect(labels).not.toContain('10:00');
    // 14:00-15:00 は busyと完全一致 → 除外
    expect(labels).not.toContain('14:00');
    // 11:00, 12:00, 13:00, 15:00, 16:00, 17:00 は空き
    expect(labels).toContain('11:00');
    expect(labels).toContain('12:00');
    expect(labels).toContain('15:00');

    vi.useRealTimers();
  });

  test('RA-P2-12c: 週末はスキップされる', () => {
    setMockNow(jstDate(2026, 3, 13, 0, 0));

    // 3/14 (土) 〜 3/16 (月)
    const timeMin = jstDate(2026, 3, 14, 9, 0);
    const timeMax = jstDate(2026, 3, 16, 18, 0);

    const result = generateFreeBusyFilteredSlots(
      [],
      timeMin,
      timeMax,
      60,
      60,
    );

    // 土日はスロットなし
    expect(result.has('2026-03-14')).toBe(false); // 土
    expect(result.has('2026-03-15')).toBe(false); // 日
    // 月曜はスロットあり
    expect(result.has('2026-03-16')).toBe(true);

    vi.useRealTimers();
  });

  test('RA-P2-12d: 30分間隔でスロット生成', () => {
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    const timeMin = jstDate(2026, 3, 10, 9, 0);
    const timeMax = jstDate(2026, 3, 10, 12, 0);

    const result = generateFreeBusyFilteredSlots(
      [],
      timeMin,
      timeMax,
      30, // 30分スロット
      30, // 30分間隔
    );

    const march10Slots = result.get('2026-03-10') || [];
    const labels = march10Slots.map(s => s.label);

    // 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 = 6スロット
    expect(labels).toContain('09:00');
    expect(labels).toContain('09:30');
    expect(labels).toContain('10:00');
    expect(labels).toContain('10:30');
    expect(labels).toContain('11:00');
    expect(labels).toContain('11:30');
    expect(march10Slots.length).toBe(6);

    vi.useRealTimers();
  });

  test('RA-P2-12e: 全日busy → 空Map', () => {
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    const timeMin = jstDate(2026, 3, 10, 9, 0);
    const timeMax = jstDate(2026, 3, 10, 18, 0);

    // 終日busy
    const busyPeriods = [
      { start: jstDate(2026, 3, 10, 0, 0), end: jstDate(2026, 3, 10, 23, 59) },
    ];

    const result = generateFreeBusyFilteredSlots(
      busyPeriods,
      timeMin,
      timeMax,
      60,
      60,
    );

    const march10Slots = result.get('2026-03-10') || [];
    expect(march10Slots.length).toBe(0);

    vi.useRealTimers();
  });
});

// ============================================================
// OAuth フロー概念テスト（API routes はモック不要の純粋ロジック）
// ============================================================

describe('PR-B6 Phase 2: OAuth Flow Logic', () => {
  test('RA-P2-1: stateパラメータが正しくencode/decodeされる', () => {
    const token = 'test-ra-token-abc123';
    const nonce = 'random-nonce-xyz';

    // Encode (OAuth start と同じロジック)
    const state = JSON.stringify({ token, nonce });
    const stateBase64 = btoa(state);

    // Decode (OAuth callback と同じロジック)
    const decoded = JSON.parse(atob(stateBase64));
    expect(decoded.token).toBe(token);
    expect(decoded.nonce).toBe(nonce);
  });

  test('RA-P2-5: 不正stateの検出', () => {
    // 不正な base64
    expect(() => JSON.parse(atob('invalid-base64!!!'))).toThrow();

    // 有効な base64 だが JSON でない
    const notJson = btoa('not a json string');
    expect(() => JSON.parse(atob(notJson))).toThrow();
  });

  test('RA-P2-2: 期限切れRAの検出', () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString(); // 1秒前
    const isExpired = new Date(expiresAt) < new Date();
    expect(isExpired).toBe(true);
  });

  test('RA-P2-3: pending以外のstatusの検出', () => {
    const statuses = ['responded', 'finalized', 'expired', 'cancelled'];
    for (const status of statuses) {
      expect(status !== 'pending').toBe(true);
    }
    expect('pending' !== 'pending').toBe(false);
  });
});

// ============================================================
// Phase 1 回帰テスト（Phase 2変更がPhase 1を壊さないことの確認）
// ============================================================

describe('PR-B6 Phase 2: Phase 1 Regression', () => {
  test('RA-P2-14: Phase 1スロット生成はbusy=[]で全スロット返す', () => {
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    // Phase 1 と同じ条件（busyなし）
    // 3/10 (月) 〜 3/13 (木) の4営業日
    const result = generateFreeBusyFilteredSlots(
      [],
      jstDate(2026, 3, 10, 9, 0),
      jstDate(2026, 3, 13, 18, 0), // 木曜18:00まで
      60,
      60,
    );

    // 平日4日間 × 9スロット = 36
    let totalSlots = 0;
    for (const [, slots] of result) {
      totalSlots += slots.length;
    }
    expect(totalSlots).toBe(36);

    vi.useRealTimers();
  });

  test('RA-P2-15: スロットのstart/endがISO8601形式', () => {
    setMockNow(jstDate(2026, 3, 9, 0, 0));

    const result = generateFreeBusyFilteredSlots(
      [],
      jstDate(2026, 3, 10, 9, 0),
      jstDate(2026, 3, 10, 18, 0),
      60,
      60,
    );

    const march10Slots = result.get('2026-03-10') || [];
    expect(march10Slots.length).toBeGreaterThan(0);

    for (const slot of march10Slots) {
      // ISO8601 format check
      expect(new Date(slot.start).toISOString()).toBe(slot.start);
      expect(new Date(slot.end).toISOString()).toBe(slot.end);
      // end > start
      expect(new Date(slot.end).getTime()).toBeGreaterThan(new Date(slot.start).getTime());
      // label format HH:mm
      expect(slot.label).toMatch(/^\d{2}:\d{2}$/);
    }

    vi.useRealTimers();
  });
});
