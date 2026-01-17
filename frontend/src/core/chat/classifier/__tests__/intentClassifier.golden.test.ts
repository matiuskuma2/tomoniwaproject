/**
 * intentClassifier.golden.test.ts
 * TD-003: ゴールデンファイル回帰テスト
 * 
 * fixtures/intents.json のスナップショットを使って
 * 「入力→intentのマッピング」が壊れていないか一括検証
 * 
 * 優先順位崩壊を一発で検知できる
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../intentClassifier';
import type { IntentContext } from '../../classifier/types';
import intentsFixture from './fixtures/intents.json';

interface TestCase {
  id: string;
  input: string;
  context: {
    hasThreadId: boolean;
    pendingKind?: string;
  };
  expected: {
    intent: string;
    params?: Record<string, unknown>;
    needsClarification?: boolean;
  };
}

function buildContext(testContext: TestCase['context']): IntentContext {
  return {
    selectedThreadId: testContext.hasThreadId ? 'thread-001' : undefined,
  };
}

describe('TD-003 Golden File: intent classification', () => {
  const cases = intentsFixture.cases as TestCase[];

  it.each(cases)('$id: "$input" -> $expected.intent', (testCase) => {
    const context = buildContext(testCase.context);
    const result = classifyIntent(testCase.input, context);

    // intent の検証
    expect(result.intent).toBe(testCase.expected.intent);

    // params の検証（指定されている場合）
    if (testCase.expected.params) {
      for (const [key, value] of Object.entries(testCase.expected.params)) {
        expect(result.params[key]).toBe(value);
      }
    }

    // needsClarification の検証（指定されている場合）
    if (testCase.expected.needsClarification !== undefined) {
      if (testCase.expected.needsClarification) {
        expect(result.needsClarification).toBeTruthy();
      } else {
        expect(result.needsClarification).toBeFalsy();
      }
    }
  });
});

// サマリーテスト: 全ケースが通ることを確認
describe('TD-003 Golden File: Summary', () => {
  it(`全 ${intentsFixture.cases.length} ケースが定義されている`, () => {
    expect(intentsFixture.cases.length).toBeGreaterThanOrEqual(50);
  });

  it('ケースIDが重複していない', () => {
    const ids = (intentsFixture.cases as TestCase[]).map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
