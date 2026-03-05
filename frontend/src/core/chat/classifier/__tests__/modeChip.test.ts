/**
 * modeChip.test.ts
 * FE-7: Mode Chip preferredMode override テスト
 * 
 * PRD テスト計画 § 7.1 に対応:
 * FE7-1  ~ FE7-4:  oneOnOne.ts の各モード強制
 * FE7-5:           reverseAvailability.ts のキーワード不要化
 * FE7-6:           auto → 従来どおり NL 判定
 * FE7-7:           pending active → スキップ
 * FE7-8:           トリガーワードなし → null
 * FE7-9:           人名なし → null
 * FE7-10:          RA キーワードなし + 人名 → match
 * FE7-11:          RA キーワードなし + 人名なし → clarification
 * FE7-12:          回帰: Auto モードで全既存テスト pass
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../intentClassifier';
import type { IntentContext } from '../types';
import type { PendingState } from '../../pendingTypes';

// ========== helpers ==========
function ctxWithMode(
  mode: IntentContext['preferredMode'],
  overrides: Partial<IntentContext> = {},
): IntentContext {
  return {
    selectedThreadId: undefined,
    preferredMode: mode,
    ...overrides,
  };
}

// ============================================================
// FE7-1 ~ FE7-4: oneOnOne の各モード強制
// ============================================================
describe('FE-7: preferredMode override (oneOnOne)', () => {
  // FE7-1: preferredMode='fixed' + 人名 → schedule.1on1.fixed
  it('FE7-1: fixed + 人名 → schedule.1on1.fixed (clarification あり)', () => {
    const r = classifyIntent(
      '田中さんと予定調整して',
      ctxWithMode('fixed'),
    );
    expect(r.intent).toBe('schedule.1on1.fixed');
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    // 日時がないので clarification
    expect(r.needsClarification).toBeTruthy();
    expect(r.params.person?.name).toBe('田中');
  });

  it('FE7-1b: fixed + 人名 + 完全な日時 → schedule.1on1.fixed (clarification なし)', () => {
    const r = classifyIntent(
      '田中さんと来週木曜17時から打ち合わせ',
      ctxWithMode('fixed'),
    );
    expect(r.intent).toBe('schedule.1on1.fixed');
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.needsClarification).toBeFalsy();
    expect(r.params.start_at).toBeDefined();
    expect(r.params.end_at).toBeDefined();
  });

  // FE7-2: preferredMode='candidates' + 人名 → schedule.1on1.candidates3
  it('FE7-2: candidates + 人名 → schedule.1on1.candidates3 (clarification あり)', () => {
    const r = classifyIntent(
      '佐藤さんと日程調整したい',
      ctxWithMode('candidates'),
    );
    expect(r.intent).toBe('schedule.1on1.candidates3');
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    // 候補日時がないので clarification
    expect(r.needsClarification).toBeTruthy();
    expect(r.params.person?.name).toBe('佐藤');
  });

  // FE7-3: preferredMode='freebusy' + 人名 → schedule.1on1.freebusy
  it('FE7-3: freebusy + 人名 → schedule.1on1.freebusy', () => {
    const r = classifyIntent(
      '山田さんとミーティングしたい',
      ctxWithMode('freebusy'),
    );
    expect(r.intent).toBe('schedule.1on1.freebusy');
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
    // freebusy は日時不要（カレンダーから自動生成）
    expect(r.needsClarification).toBeFalsy();
    expect(r.params.person?.name).toBe('山田');
  });

  // FE7-4: preferredMode='open_slots' + 人名 → schedule.1on1.open_slots
  it('FE7-4: open_slots + 人名 → schedule.1on1.open_slots', () => {
    const r = classifyIntent(
      '鈴木さんと会議したい',
      ctxWithMode('open_slots'),
    );
    expect(r.intent).toBe('schedule.1on1.open_slots');
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
    // open_slots は日時不要
    expect(r.needsClarification).toBeFalsy();
    expect(r.params.person?.name).toBe('鈴木');
  });
});

// ============================================================
// FE7-5: reverseAvailability の RA キーワード不要化
// ============================================================
describe('FE-7: preferredMode override (reverseAvailability)', () => {
  // FE7-5: preferredMode='reverse_availability' + 人名
  //        → schedule.1on1.reverse_availability (RA キーワードあり)
  it('FE7-5: reverse_availability + RA キーワード + 人名 → match', () => {
    // 「ご都合伺い」キーワード + 人名あり
    // 注意: preference classifier (位置6) が先に反応しないよう、入力を調整
    const r = classifyIntent(
      '佐藤部長にご都合を伺って調整',
      ctxWithMode('reverse_availability'),
    );
    expect(r.intent).toBe('schedule.1on1.reverse_availability');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.needsClarification).toBeFalsy();
  });

  // FE7-10: RA キーワードなし + 人名 → match
  //         (preferredMode が forced なのでキーワード不要)
  it('FE7-10: reverse_availability + RA キーワードなし + 人名 → match', () => {
    // 「田中さんと日程調整して」にはRAキーワードがない
    const r = classifyIntent(
      '田中さんと日程調整して',
      ctxWithMode('reverse_availability'),
    );
    expect(r.intent).toBe('schedule.1on1.reverse_availability');
    expect(r.needsClarification).toBeFalsy();
    expect(r.params.target?.name).toBeDefined();
  });

  // FE7-11: RA キーワードなし + 人名なし → clarification
  it('FE7-11: reverse_availability + RA キーワードなし + 人名なし → clarification', () => {
    // 「日程調整して」には RA キーワードも人名もない
    const r = classifyIntent(
      '日程調整して',
      ctxWithMode('reverse_availability'),
    );
    // reverseAvailability classifier がキーワードなしでも入るが、人名なし → clarification
    expect(r.intent).toBe('schedule.1on1.reverse_availability');
    expect(r.needsClarification).toBeTruthy();
    expect(r.needsClarification?.field).toBe('target');
  });
});

// ============================================================
// FE7-6: auto モード → 従来どおり NL 判定
// ============================================================
describe('FE-7: auto mode = 従来どおり', () => {
  it('FE7-6a: auto + freebusy キーワード（1対1文脈）→ freebusy 系 (NL 勝ち)', () => {
    // 「空いてるところ」は calendar classifier (位置5) で先にマッチする
    // これは正しい動作（chain 優先順位「挙動を1ミリも変えない」）
    // oneOnOne の freebusy キーワードと calendar の freebusy の境界
    const r = classifyIntent(
      '田中さんと空いてるところから予定調整',
      ctxWithMode('auto'),
    );
    // calendar classifier が「空いて」を拾うので freebusy 系になる
    expect(r.intent).toMatch(/freebusy/);
  });

  it('FE7-6b: auto + 固定日時 → fixed (NL 勝ち)', () => {
    const r = classifyIntent(
      '田中さんと来週木曜17時から打ち合わせ',
      ctxWithMode('auto'),
    );
    expect(r.intent).toBe('schedule.1on1.fixed');
  });

  it('FE7-6c: preferredMode=undefined → 従来どおり', () => {
    const r = classifyIntent(
      '田中さんと来週木曜17時から打ち合わせ',
      { selectedThreadId: undefined },
    );
    expect(r.intent).toBe('schedule.1on1.fixed');
  });

  it('FE7-6d: preferredMode=null → 従来どおり', () => {
    const r = classifyIntent(
      '田中さんと来週木曜17時から打ち合わせ',
      { selectedThreadId: undefined, preferredMode: null },
    );
    expect(r.intent).toBe('schedule.1on1.fixed');
  });
});

// ============================================================
// FE7-7: pending active → スキップ（Mode Chip は disabled）
// ============================================================
describe('FE-7: pending active → override スキップ', () => {
  it('FE7-7: fixed + pending active → null (oneOnOne をスキップ)', () => {
    const pending: PendingState = {
      kind: 'pending.action',
      threadId: 'thread-001',
      createdAt: Date.now(),
      confirmToken: 'token-abc',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      summary: {},
      mode: 'new_thread',
    };

    const r = classifyIntent(
      '田中さんと予定調整して',
      {
        ...ctxWithMode('fixed'),
        pendingForThread: pending,
      },
    );
    // pending.action が最優先 → pending.action.decide の unknown / clarification
    // oneOnOne には到達しない
    expect(r.intent).not.toBe('schedule.1on1.fixed');
  });
});

// ============================================================
// FE7-8: トリガーワードなし → null (oneOnOne 不発)
// ============================================================
describe('FE-7: トリガーワードなし', () => {
  it('FE7-8: fixed + トリガーワードなし → oneOnOne 不発', () => {
    // 「田中さんにメール送って」はスケジューリング trigger word がない
    const r = classifyIntent(
      '田中さんにメール送って',
      ctxWithMode('fixed'),
    );
    // oneOnOne の trigger word チェックで null → 他の classifier が拾う or unknown
    expect(r.intent).not.toBe('schedule.1on1.fixed');
  });
});

// ============================================================
// FE7-9: 人名なし → null (oneOnOne 不発)
// ============================================================
describe('FE-7: 人名なし', () => {
  it('FE7-9: fixed + 人名なし → oneOnOne 不発', () => {
    // 「予定調整して」には人名がない
    const r = classifyIntent(
      '予定調整して',
      ctxWithMode('fixed'),
    );
    // oneOnOne の person チェックで null → 他の classifier が拾う or unknown
    expect(r.intent).not.toBe('schedule.1on1.fixed');
  });
});

// ============================================================
// FE7-12: 回帰テスト — Auto モードで既存動作が壊れていないこと
// ============================================================
describe('FE-7 回帰: preferredMode 未設定で既存動作が維持', () => {
  it('回帰: 「今日の予定」→ schedule.today (calendar)', () => {
    const r = classifyIntent('今日の予定', { selectedThreadId: 'thread-001' });
    expect(r.intent).toBe('schedule.today');
  });

  it('回帰: 「リスト」→ list.list', () => {
    const r = classifyIntent('リスト', { selectedThreadId: 'thread-001' });
    expect(r.intent).toBe('list.list');
  });

  it('回帰: 「田中さんと来週木曜17時から打ち合わせ」→ schedule.1on1.fixed', () => {
    const r = classifyIntent('田中さんと来週木曜17時から打ち合わせ', {
      selectedThreadId: undefined,
    });
    expect(r.intent).toBe('schedule.1on1.fixed');
  });

  it('回帰: 「佐藤さんに候補出して日程調整」→ schedule.1on1.candidates3', () => {
    const r = classifyIntent('佐藤さんに候補出して日程調整', {
      selectedThreadId: undefined,
    });
    expect(r.intent).toBe('schedule.1on1.candidates3');
  });

  it('回帰: 「Aさんと空いてるところから予定調整」→ freebusy 系', () => {
    const r = classifyIntent('Aさんと空いてるところから予定調整', {
      selectedThreadId: undefined,
    });
    // calendar classifier が「空いて」+「と」を拾うので freebusy.batch になる可能性あり
    // これは既存動作（chain 優先順位）として正しい
    expect(r.intent).toMatch(/freebusy/);
  });

  it('回帰: 「Bさんに選んでもらって予定調整」→ schedule.1on1.open_slots', () => {
    const r = classifyIntent('Bさんに選んでもらって予定調整', {
      selectedThreadId: undefined,
    });
    expect(r.intent).toBe('schedule.1on1.open_slots');
  });

  it('回帰: 「佐藤部長にご都合を伺って調整」→ schedule.1on1.reverse_availability', () => {
    const r = classifyIntent('佐藤部長にご都合を伺って調整', {
      selectedThreadId: undefined,
    });
    expect(r.intent).toBe('schedule.1on1.reverse_availability');
  });

  it('回帰: 「平日14時以降がいい」→ preference.set (人物なし)', () => {
    const r = classifyIntent('平日14時以降がいい', {
      selectedThreadId: undefined,
    });
    expect(r.intent).toBe('preference.set');
  });
});

// ============================================================
// 追加: Mode 競合テスト（PRD § 6.1）
// ============================================================
describe('FE-7: Mode vs NL 競合', () => {
  it('fixed モード + freebusy キーワードなし → Fixed 勝ち (Mode 優先)', () => {
    // calendar classifier を回避するため、freebusy キーワードを含まない入力
    const r = classifyIntent(
      '田中さんと来週の打ち合わせ',
      ctxWithMode('fixed'),
    );
    // Mode Chip が fixed → oneOnOne の buildForcedModeResult で fixed が返る
    expect(r.intent).toBe('schedule.1on1.fixed');
  });

  it('fixed モードでも calendar classifier が先にマッチする入力は calendar が勝つ', () => {
    // 「空いてるところ」は calendar classifier (位置5) で先に反応
    // Mode Chip override は oneOnOne (位置9) に到達した時のみ適用
    // → chain の優先順位が正しく動作していることを確認
    const r = classifyIntent(
      '空き',
      ctxWithMode('fixed'),
    );
    expect(r.intent).toMatch(/freebusy/);
  });

  it('freebusy モードなのに 固定日時あり → FreeBusy 勝ち (Mode 優先)', () => {
    const r = classifyIntent(
      '田中さんと来週木曜17時から打ち合わせ',
      ctxWithMode('freebusy'),
    );
    expect(r.intent).toBe('schedule.1on1.freebusy');
  });

  it('candidates モードで日時1つのみ → Candidates3 + clarification (Mode 優先)', () => {
    const r = classifyIntent(
      '田中さんと来週木曜17時から打ち合わせ',
      ctxWithMode('candidates'),
    );
    expect(r.intent).toBe('schedule.1on1.candidates3');
    // 候補が足りない → clarification
    expect(r.needsClarification).toBeTruthy();
  });
});
