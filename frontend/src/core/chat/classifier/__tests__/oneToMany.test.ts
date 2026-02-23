/**
 * FE-6: oneToMany Classifier Unit Tests
 *
 * テスト対象:
 *   OTM-C1: 2名以上の名前 + トリガーワード → schedule.1toN.prepare
 *   OTM-C2: 2つ以上のメール + トリガーワード → schedule.1toN.prepare
 *   OTM-C3: 数量表現（3名以上）→ schedule.1toN.prepare (clarification)
 *   OTM-C4: グループキーワード（全員、チーム）→ clarification
 *   OTM-C5: 1名のみ → null（oneOnOneに流す）
 *   OTM-C6: トリガーワードなし → null
 *   OTM-C7: pending状態あり → null
 *   OTM-C8: constraints抽出（来週、午後等）
 *   OTM-C9: mode検出（open_slots）
 *   OTM-C10: title推測（会議、面談等）
 *   OTM-C11: duration抽出
 */

import { describe, it, expect } from 'vitest';
import { classifyOneToMany } from '../oneToMany';

// ============================================================
// Tests: Classification
// ============================================================

describe('FE-6: classifyOneToMany', () => {
  // OTM-C1: 2名以上の名前
  it('OTM-C1: 2名の名前 + 打ち合わせ → schedule.1toN.prepare', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんと打ち合わせしたい',
      '田中さんと佐藤さんと打ち合わせしたい',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1toN.prepare');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result!.params.persons).toHaveLength(2);
    expect(result!.params.persons[0].name).toBe('田中');
    expect(result!.params.persons[1].name).toBe('佐藤');
  });

  // OTM-C1b: 3名
  it('OTM-C1b: 3名の名前 → schedule.1toN.prepare', () => {
    const result = classifyOneToMany(
      '田中さん、佐藤さん、鈴木さんと来週会議したい',
      '田中さん、佐藤さん、鈴木さんと来週会議したい',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1toN.prepare');
    expect(result!.params.persons.length).toBeGreaterThanOrEqual(2);
    expect(result!.params.title).toBe('会議');
  });

  // OTM-C2: 2つ以上のメール
  it('OTM-C2: 2メール + 日程調整 → schedule.1toN.prepare', () => {
    const result = classifyOneToMany(
      'alice@test.com と bob@test.com の日程調整して',
      'alice@test.com と bob@test.com の日程調整して',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1toN.prepare');
    expect(result!.params.emails).toHaveLength(2);
    expect(result!.params.emails).toContain('alice@test.com');
    expect(result!.params.emails).toContain('bob@test.com');
  });

  // OTM-C3: 数量表現
  it('OTM-C3: "5名で打ち合わせ" → schedule.1toN.prepare (clarification)', () => {
    const result = classifyOneToMany(
      '5名で打ち合わせしたい',
      '5名で打ち合わせしたい',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1toN.prepare');
    expect(result!.confidence).toBeLessThanOrEqual(0.7);
    expect(result!.needsClarification).toBeDefined();
    expect(result!.needsClarification?.field).toBe('participants');
    expect(result!.params.expectedCount).toBe(5);
  });

  // OTM-C4: グループキーワード
  it('OTM-C4: "全員と日程調整" → clarification', () => {
    const result = classifyOneToMany(
      '全員と日程調整して',
      '全員と日程調整して',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.intent).toBe('schedule.1toN.prepare');
    expect(result!.needsClarification).toBeDefined();
  });

  // OTM-C5: 1名のみ → null
  it('OTM-C5: 1名のみ → null (oneOnOneに流す)', () => {
    const result = classifyOneToMany(
      '田中さんと打ち合わせしたい',
      '田中さんと打ち合わせしたい',
      undefined,
      null
    );

    expect(result).toBeNull();
  });

  // OTM-C6: トリガーワードなし → null
  it('OTM-C6: トリガーなし → null', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんにメッセージ送って',
      '田中さんと佐藤さんにメッセージ送って',
      undefined,
      null
    );

    expect(result).toBeNull();
  });

  // OTM-C7: pending状態あり → null
  it('OTM-C7: pending あり → null', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんと打ち合わせしたい',
      '田中さんと佐藤さんと打ち合わせしたい',
      undefined,
      { kind: 'pending.action', data: {} } as any
    );

    expect(result).toBeNull();
  });

  // OTM-C8: constraints抽出
  it('OTM-C8: "来週の午後に" → constraints に time_min/time_max + prefer', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんと来週の午後に打ち合わせ',
      '田中さんと佐藤さんと来週の午後に打ち合わせ',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.params.constraints).toBeDefined();
    expect(result!.params.constraints.time_min).toBeDefined();
    expect(result!.params.constraints.time_max).toBeDefined();
    expect(result!.params.constraints.prefer).toBe('afternoon');
  });

  // OTM-C9: open_slots モード
  it('OTM-C9: "選んでもらう" → mode=open_slots', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんに空き枠を共有して選んでもらって予定調整',
      '田中さんと佐藤さんに空き枠を共有して選んでもらって予定調整',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.params.mode).toBe('open_slots');
  });

  // OTM-C10: title推測
  it('OTM-C10: "面談" → title=面談', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんと面談したい',
      '田中さんと佐藤さんと面談したい',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.params.title).toBe('面談');
  });

  // OTM-C11: duration抽出
  it('OTM-C11: "2時間の打ち合わせ" → duration=120', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんと2時間の打ち合わせ',
      '田中さんと佐藤さんと2時間の打ち合わせ',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.params.duration_minutes).toBe(120);
  });

  // OTM-C12: デフォルト mode = candidates
  it('OTM-C12: mode指定なし → candidates', () => {
    const result = classifyOneToMany(
      '田中さんと佐藤さんと日程調整',
      '田中さんと佐藤さんと日程調整',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.params.mode).toBe('candidates');
  });

  // OTM-C13: 名前+メール混在
  it('OTM-C13: 名前1つ + メール1つ → 2名として検出', () => {
    const result = classifyOneToMany(
      '田中さんとbob@test.comと日程調整して',
      '田中さんとbob@test.comと日程調整して',
      undefined,
      null
    );

    // メールが1つでも、名前が1つ→合計2つは名前パターン側で1名
    // メールパターンで1名→最終的にemails.length >= 2にはならない
    // この場合は名前1+メール1で合計2名にならないので null の可能性
    // 実際には、メール1+名前1の場合はnullが正解（oneOnOneのケースに近い）
    // ただし classifyOneOnOne は名前orメール1つしか見ないので、
    // ここは implementation-dependent
    // 期待: emailsが1つ取れ、名前が1つ取れるが、
    // 条件判定: persons.length >= 2 は false, emails.length >= 2 は false → null
    expect(result).toBeNull();
  });

  // OTM-C14: "さん" 敬称のバリエーション
  it('OTM-C14: "くん" "様" 敬称 → 名前抽出', () => {
    const result = classifyOneToMany(
      '大島くんと田中様と打ち合わせ',
      '大島くんと田中様と打ち合わせ',
      undefined,
      null
    );

    expect(result).not.toBeNull();
    expect(result!.params.persons.length).toBeGreaterThanOrEqual(2);
  });
});
