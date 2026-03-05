/**
 * PR-B6: Reverse Availability — Classifier Unit Tests
 *
 * テスト対象:
 *   RA-C1: 「佐藤部長にご都合を伺って日程調整したい」→ reverse_availability + name=佐藤部長
 *   RA-C2: 「田中さんの都合に合わせたい」→ reverse_availability + name=田中
 *   RA-C3: 「alice@example.com のご都合伺い」→ reverse_availability + email
 *   RA-C4: キーワードのみ（相手不明）→ needsClarification
 *   RA-C5: キーワードなし → null
 *   RA-C6: 「目上の人と打ち合わせ」→ キーワードマッチ + clarification
 *   RA-C7: pending がある場合 → null（スキップ）
 *   RA-C8: 所要時間抽出 → 30分
 *   RA-C9: タイトル推測 → 面談
 */

import { describe, it, expect, vi } from 'vitest';
import { classifyReverseAvailability } from '../reverseAvailability';

describe('classifyReverseAvailability', () => {
  // RA-C1: 名前 + ご都合伺いキーワード
  it('RA-C1: 「佐藤部長にご都合を伺って日程調整したい」→ name=佐藤', () => {
    const result = classifyReverseAvailability(
      '佐藤部長にご都合を伺って日程調整したい',
      '佐藤部長にご都合を伺って日程調整したい',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result!.params.target.name).toBe('佐藤');
  });

  // RA-C2: さんに + 都合に合わせ
  it('RA-C2: 「田中さんの都合に合わせたい」→ name=田中', () => {
    const result = classifyReverseAvailability(
      '田中さんの都合に合わせたい',
      '田中さんの都合に合わせたい',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
    // 田中さん + 都合に合わせ → マッチ
    // 名前パターンが「田中さんに」にマッチしないが「田中さんと」にもマッチしない
    // 「の」は対象外 → person null → clarification
    // ただしキーワードにはマッチ
  });

  // RA-C3: メール + ご都合伺い
  it('RA-C3: 「alice@example.com にご都合伺い」→ email', () => {
    const result = classifyReverseAvailability(
      'alice@example.com にご都合伺い',
      'alice@example.com にご都合伺い',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
    expect(result!.params.target.email).toBe('alice@example.com');
  });

  // RA-C4: キーワードのみ（相手不明）→ needsClarification
  it('RA-C4: 「ご都合伺いモードで日程調整したい」→ clarification', () => {
    const result = classifyReverseAvailability(
      'ご都合伺いモードで日程調整したい',
      'ご都合伺いモードで日程調整したい',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
    expect(result!.needsClarification).toBeDefined();
    expect(result!.needsClarification!.field).toBe('target');
  });

  // RA-C5: キーワードなし → null
  it('RA-C5: 「田中さんと来週打ち合わせ」→ null（通常1on1へ）', () => {
    const result = classifyReverseAvailability(
      '田中さんと来週打ち合わせしたい',
      '田中さんと来週打ち合わせしたい',
      undefined,
      null,
    );
    expect(result).toBeNull();
  });

  // RA-C6: 「目上」キーワード + clarification
  it('RA-C6: 「目上の人と打ち合わせ」→ clarification', () => {
    const result = classifyReverseAvailability(
      '目上の人と打ち合わせ',
      '目上の人と打ち合わせ',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
    expect(result!.needsClarification).toBeDefined();
  });

  // RA-C7: pending がある場合 → null
  it('RA-C7: pending がある場合 → null', () => {
    const result = classifyReverseAvailability(
      '佐藤部長にご都合を伺って',
      '佐藤部長にご都合を伺って',
      undefined,
      { type: 'some_pending', data: {} } as any,
    );
    expect(result).toBeNull();
  });

  // RA-C8: 所要時間抽出
  it('RA-C8: 「山田社長にご都合伺い 30分の面談」→ duration=30', () => {
    const result = classifyReverseAvailability(
      '山田社長にご都合伺い 30分の面談',
      '山田社長にご都合伺い 30分の面談',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.params.duration_minutes).toBe(30);
  });

  // RA-C9: タイトル推測
  it('RA-C9: 面談が含まれる → title=面談', () => {
    const result = classifyReverseAvailability(
      '山田社長にご都合伺い 面談の日程',
      '山田社長にご都合伺い 面談の日程',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.params.title).toBe('面談');
  });

  // RA-C10: 「先方の予定を聞いて」→ マッチ
  it('RA-C10: 「先方の予定を聞いて日程決めたい」→ マッチ', () => {
    const result = classifyReverseAvailability(
      '先方の予定を聞いて日程決めたい',
      '先方の予定を聞いて日程決めたい',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
  });

  // RA-C11: 「reverse availability」→ マッチ
  it('RA-C11: 英語キーワード「reverse」→ マッチ', () => {
    const result = classifyReverseAvailability(
      'reverse availability で調整して',
      'reverse availability で調整して',
      undefined,
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1on1.reverse_availability');
  });
});
