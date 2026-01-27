/**
 * oneOnOne.regression.test.ts
 * Phase B-1: 1対1予定調整（fixed / candidates3）の回帰テスト
 * 
 * 守るべきもの:
 * 1. 固定日時（fixed）: 単一日時の場合は schedule.1on1.fixed
 * 2. 候補3つ（candidates3）: 複数日時または「候補」キーワードの場合は schedule.1on1.candidates3
 * 3. 誤検出防止: 日時トークンが1つしかない場合は candidates3 にしない
 */

import { describe, it, expect } from 'vitest';
import { classifyOneOnOne } from '../oneOnOne';
import type { IntentContext } from '../types';

// ========== helpers ==========
function normalizedInput(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

describe('Phase B-1: 1on1 scheduling classification', () => {
  // ============================================================
  // 1) 固定日時（fixed）のケース
  // ============================================================
  describe('Fixed single slot (schedule.1on1.fixed)', () => {
    it('「Aさんと来週木曜17時から1時間、予定調整お願い」-> schedule.1on1.fixed', () => {
      const input = 'Aさんと来週木曜17時から1時間、予定調整お願い';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.fixed');
      expect(result?.params.person).toBeDefined();
      expect(result?.params.start_at).toBeDefined();
      expect(result?.params.end_at).toBeDefined();
    });

    it('「田中さんと打ち合わせしたい、明日14時から」-> schedule.1on1.fixed', () => {
      const input = '田中さんと打ち合わせしたい、明日14時から';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.fixed');
      expect(result?.params.person?.name).toBe('田中');
    });

    it('「test@example.com と会議、来週月曜10時」-> schedule.1on1.fixed (email)', () => {
      const input = 'test@example.com と会議、来週月曜10時';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.fixed');
      expect(result?.params.person?.email).toBe('test@example.com');
    });
  });

  // ============================================================
  // 2) 候補3つ（candidates3）のケース
  // ============================================================
  describe('Multiple candidates (schedule.1on1.candidates3)', () => {
    it('「田中さんと来週月曜10時か火曜14時で打ち合わせ」-> schedule.1on1.candidates3', () => {
      const input = '田中さんと来週月曜10時か火曜14時で打ち合わせ';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.candidates3');
      expect(result?.params.person?.name).toBe('田中');
      expect(result?.params.slots).toBeDefined();
      expect(result?.params.slots.length).toBeGreaterThanOrEqual(2);
    });

    it('「佐藤さんに3つ候補出して日程調整」-> schedule.1on1.candidates3 (needsClarification)', () => {
      const input = '佐藤さんに3つ候補出して日程調整';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.candidates3');
      expect(result?.params.person?.name).toBe('佐藤');
      // 具体的な日時がないので clarification が必要
      expect(result?.needsClarification?.field).toBe('slots');
    });

    it('「Aさんと1/28、1/29、1/30で予定調整」-> schedule.1on1.candidates3', () => {
      const input = 'Aさんと1/28、1/29、1/30 14時で予定調整';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.candidates3');
      expect(result?.params.slots).toBeDefined();
      expect(result?.params.slots.length).toBe(3);
    });

    it('「山田さんと来週木曜10時か14時か16時で相談」-> schedule.1on1.candidates3 (1日複数時刻)', () => {
      const input = '山田さんと来週木曜10時か14時か16時で相談';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.candidates3');
      expect(result?.params.slots.length).toBe(3);
    });

    it('「鈴木さんといくつか候補で打ち合わせ」-> schedule.1on1.candidates3 (needsClarification)', () => {
      const input = '鈴木さんといくつか候補で打ち合わせ';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.candidates3');
      expect(result?.needsClarification?.field).toBe('slots');
    });
  });

  // ============================================================
  // 3) clarification が必要なケース
  // ============================================================
  describe('Clarification required', () => {
    it('「田中さんと予定調整」-> schedule.1on1.fixed + needsClarification(date)', () => {
      const input = '田中さんと予定調整';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.fixed');
      expect(result?.needsClarification?.field).toBe('date');
    });

    it('「田中さんと来週木曜に打ち合わせ」-> schedule.1on1.fixed + needsClarification(time)', () => {
      const input = '田中さんと来週木曜に打ち合わせ';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('schedule.1on1.fixed');
      expect(result?.needsClarification?.field).toBe('time');
    });
  });

  // ============================================================
  // 4) トリガーワードがない場合はスキップ
  // ============================================================
  describe('No trigger word -> null', () => {
    it('「田中さんと話したい」-> null (トリガーなし)', () => {
      const input = '田中さんと話したい';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).toBeNull();
    });

    it('「今日の天気は？」-> null (無関係)', () => {
      const input = '今日の天気は？';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // 5) 相手がいない場合はスキップ
  // ============================================================
  describe('No person -> null', () => {
    it('「来週木曜17時から予定調整」-> null (相手なし)', () => {
      const input = '来週木曜17時から予定調整';
      const result = classifyOneOnOne(input, normalizedInput(input));
      
      expect(result).toBeNull();
    });
  });
});
