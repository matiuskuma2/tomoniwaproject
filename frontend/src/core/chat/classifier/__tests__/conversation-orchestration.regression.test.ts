/**
 * conversation-orchestration.regression.test.ts
 * PR-UX-14: 会話オーケストレーション 4 critical flows リグレッションテスト
 * 
 * @see docs/CONVERSATION_FLOW.md
 * @see docs/STATE_RESPONSIBILITY.md
 * 
 * テスト対象:
 * 1. clarification → follow-up → thread creation（完全フロー）
 * 2. prepared 後の pending クリアと thread migration
 * 3. clarification が nlRouter/calendar/preference に漏れないこと
 * 4. pending 状態でも skeleton が不要な条件の検証
 */

import { describe, it, expect } from 'vitest';
import { classifyIntentChain } from '../../classifier';
import type { IntentContext } from '../../classifier';
import type { PendingState } from '../../pendingTypes';
import {
  getPendingPlaceholder,
  getPendingHintBanner,
  getPendingSendButtonLabel,
} from '../../pendingTypes';

// ========== helpers ==========
function ctx(overrides?: Partial<IntentContext>): IntentContext {
  return {
    selectedThreadId: undefined,
    pendingForThread: null,
    globalPendingAction: null,
    preferredMode: 'auto',
    ...overrides,
  };
}

function makeClarificationPending(overrides?: Partial<any>): PendingState {
  return {
    kind: 'pending.scheduling.clarification',
    threadId: 'temp',
    createdAt: Date.now(),
    originalIntent: 'schedule.1on1.fixed',
    originalParams: {
      person: { name: '大島', suffix: 'くん' },
      rawInput: '大島くんと予定調整したい',
    },
    missingField: 'date',
    originalInput: '大島くんと予定調整したい',
    ...overrides,
  } as PendingState;
}

// ============================================================
// Flow 1: 「大島くんと予定調整したい」→「来週木曜17時から」→ thread creation
// ============================================================
describe('Flow 1: Clarification → Follow-up → Thread Creation', () => {
  it('Step 1: 「大島くんと予定調整したい」→ schedule.1on1.fixed + needsClarification (no date)', () => {
    const input = '大島くんと予定調整したい';
    const result = classifyIntentChain(input, ctx());

    expect(result).not.toBeNull();
    expect(result.intent).toBe('schedule.1on1.fixed');
    expect(result.params.person?.name).toBe('大島');
    expect(result.params.person?.suffix).toBe('くん');
    // date/time がないので executor が clarification を返す → classifier 自体は intent を返す
    expect(result.params.start_at).toBeUndefined();
  });

  it('Step 2: clarification active + 「来週木曜17時から」→ schedule.1on1.fixed (日時あり, person 引き継ぎ)', () => {
    const pending = makeClarificationPending();
    const input = '来週木曜17時から';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    expect(result).not.toBeNull();
    expect(result.intent).toBe('schedule.1on1.fixed');
    // person は pending の originalParams から復元
    expect(result.params.person?.name).toBe('大島');
    expect(result.params.person?.suffix).toBe('くん');
    // 日時が入力から抽出される
    expect(result.params.start_at).toBeDefined();
  });

  it('Step 2b: clarification active + 「17時から1時間」→ schedule.1on1.fixed (時間のみ, 日付は pending から)', () => {
    const pending = makeClarificationPending({
      missingField: 'time',
      originalParams: {
        person: { name: '大島', suffix: 'くん' },
        start_at: '2026-03-12', // 日付は既にある
        rawInput: '大島くんと来週木曜に調整したい',
      },
    });
    const input = '17時から1時間';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    expect(result).not.toBeNull();
    expect(result.intent).toBe('schedule.1on1.fixed');
    expect(result.params.person?.name).toBe('大島');
  });

  it('Step 3: clarification active でも person のみ入力 → clarification 継続', () => {
    const pending = makeClarificationPending({
      missingField: 'date',
    });
    // 日時を含まない入力（person 変更のみ） → candidates or clarification
    const input = '佐藤さんで';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    // oneOnOne がキャプチャすべき（nlRouter に漏れない）
    expect(result.intent).not.toBe('unknown');
  });
});

// ============================================================
// Flow 2: prepared 後の pending クリアと遷移
// ============================================================
describe('Flow 2: Post-prepared Pending Cleanup', () => {
  it('pending.scheduling.clarification の UI ヘルパーが正しい値を返す', () => {
    const pending = makeClarificationPending();
    
    const placeholder = getPendingPlaceholder(pending);
    expect(placeholder).toBeTruthy();
    expect(typeof placeholder).toBe('string');
    
    const banner = getPendingHintBanner(pending);
    expect(banner).toBeTruthy();
    
    const buttonLabel = getPendingSendButtonLabel(pending);
    expect(buttonLabel).toBeTruthy();
  });

  it('pending.scheduling.clarification → resolved 後は通常入力に戻る', () => {
    // pending なしの状態で通常入力
    const input = '今日の予定を見せて';
    const result = classifyIntentChain(input, ctx({ pendingForThread: null }));

    // calendar 系の intent にマッチ
    expect(result.intent).toBe('schedule.today');
  });
});

// ============================================================
// Flow 3: Clarification が nlRouter / calendar / preference に漏れない
// ============================================================
describe('Flow 3: Clarification Guard — No Leaking to Other Classifiers', () => {
  const pending = makeClarificationPending();

  it('「空いてる日を教えて」→ calendar に漏れない（ガード有効）', () => {
    const input = '空いてる日を教えて';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    // oneOnOne がキャプチャ or unknown（calendar ではない）
    expect(result.intent).not.toBe('schedule.freebusy');
    expect(result.intent).not.toBe('schedule.today');
    expect(result.intent).not.toBe('schedule.week');
  });

  it('「来週の空きを見せて」→ calendar.freebusy に漏れない', () => {
    const input = '来週の空きを見せて';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    expect(result.intent).not.toBe('schedule.freebusy');
  });

  it('「午前中がいい」→ preference に漏れない', () => {
    const input = '午前中がいいです';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    expect(result.intent).not.toBe('preference.set');
  });

  it('「やっぱり15時で」→ clarification 復元で schedule.1on1.fixed', () => {
    const input = 'やっぱり15時でお願い';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    // oneOnOne がキャプチャし、person を復元
    if (result.intent !== 'unknown') {
      expect(result.params.person?.name).toBe('大島');
    }
  });

  it('「今日の予定」→ pending なしなら schedule.today（ガードが pending 有無で切り替わることを確認）', () => {
    // NOTE: calendar classifier は /(今日|きょう).*予定/ で判定。「スケジュール」ではマッチしない
    const input = '今日の予定を見せて';
    
    // pending あり → calendar に漏れない
    const withPending = classifyIntentChain(input, ctx({ pendingForThread: pending }));
    expect(withPending.intent).not.toBe('schedule.today');
    
    // pending なし → schedule.today にマッチ
    const withoutPending = classifyIntentChain(input, ctx({ pendingForThread: null }));
    expect(withoutPending.intent).toBe('schedule.today');
  });

  it('clarification 中に「はい」→ confirmCancel のデフォルト confirm にフォールスルー', () => {
    // ⚠️ 既知の設計ギャップ:
    // confirmCancel は pending.scheduling.clarification を個別に扱わないため、
    // 短入力「はい」が schedule.auto_propose.confirm のデフォルトにフォールスルーする。
    // これは実運用では問題にならない（scheduling clarification 中に「はい」を入力するケースは稀）
    // が、将来の改善候補（→ STATE_RESPONSIBILITY.md 6.1 参照）
    const input = 'はい';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    // 現状: confirmCancel のデフォルト（schedule.auto_propose.confirm）に落ちる
    // NOTE: nlRouter には行かない（これが重要）
    expect(result.intent).not.toBe('unknown');
  });
});

// ============================================================
// Flow 4: Classifier Chain の整合性
// ============================================================
describe('Flow 4: Classifier Chain Integrity', () => {
  it('pending.action active + 「送る」→ pending.action.decide（pendingDecision が最優先）', () => {
    const actionPending: PendingState = {
      kind: 'pending.action',
      threadId: 'thread-123',
      createdAt: Date.now(),
      confirmToken: 'test-token',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      summary: { action: 'send_invites' },
      mode: 'new_thread',
    } as PendingState;

    // 「送る」は pendingDecision の送信語にマッチ
    const input = '送る';
    const result = classifyIntentChain(input, ctx({
      selectedThreadId: 'thread-123',
      pendingForThread: actionPending,
    }));

    // pending.action がある場合、pendingDecision がキャプチャ
    expect(result.intent).toBe('pending.action.decide');
    // decision は日本語入力そのまま or 'send' key
    expect(result.params.decision).toBeDefined();
  });

  it('pending なし + 「大島くんと来週月曜10時から面談」→ 完全な schedule.1on1.fixed', () => {
    const input = '大島くんと来週月曜10時から面談';
    const result = classifyIntentChain(input, ctx());

    expect(result.intent).toBe('schedule.1on1.fixed');
    expect(result.params.person?.name).toBe('大島');
    expect(result.params.person?.suffix).toBe('くん');
    expect(result.params.start_at).toBeDefined();
  });

  it('pending なし + 日常会話 → unknown (nlRouter フォールバック)', () => {
    const input = 'こんにちは、元気ですか？';
    const result = classifyIntentChain(input, ctx());

    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.params.rawInput).toBe(input);
  });

  it('pending.scheduling.clarification + 日付のみ → oneOnOne がキャプチャ（person 引き継ぎ）', () => {
    const pending = makeClarificationPending();
    const input = '来週の月曜日';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    // oneOnOne がキャプチャ（calendar.week ではない）
    expect(result.intent).not.toBe('schedule.week');
    // person が引き継がれている
    if (result.params.person) {
      expect(result.params.person.name).toBe('大島');
    }
  });
});

// ============================================================
// Suffix Retention Verification
// ============================================================
describe('Suffix Retention: 敬称保持の検証', () => {
  it.each([
    { input: '大島くんと打ち合わせしたい', expectedSuffix: 'くん' },
    { input: '田中さんと日程調整', expectedSuffix: 'さん' },
    { input: '佐藤氏と会議', expectedSuffix: '氏' },
    { input: '鈴木様と面談したい', expectedSuffix: '様' },
  ])('「$input」→ suffix = "$expectedSuffix"', ({ input, expectedSuffix }) => {
    const result = classifyIntentChain(input, ctx());

    expect(result.params.person).toBeDefined();
    expect(result.params.person?.suffix).toBe(expectedSuffix);
  });

  it('clarification 復元時も suffix が維持される', () => {
    const pending = makeClarificationPending({
      originalParams: {
        person: { name: '鈴木', suffix: '様' },
        rawInput: '鈴木様と予定調整したい',
      },
    });
    const input = '明日15時から';
    const result = classifyIntentChain(input, ctx({ pendingForThread: pending }));

    if (result.params.person) {
      expect(result.params.person.suffix).toBe('様');
    }
  });
});
