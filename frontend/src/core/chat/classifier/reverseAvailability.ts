/**
 * classifier/reverseAvailability.ts
 * PR-B6: 逆アベイラビリティ（ご都合伺い）Intent 分類
 *
 * ユーザー発話例:
 * - 「佐藤部長にご都合を伺って日程調整したい」
 * - 「田中さんの都合に合わせたい」
 * - 「先方の予定を聞いて日程決めたい」
 * - 「山田社長にご都合伺いモードで調整して」
 * - 「相手に合わせて日程調整」
 * - 「目上の人との打ち合わせ、相手の空きに合わせたい」
 *
 * 分類条件:
 * 1. REVERSE_KEYWORDS のいずれかにマッチ
 * 2. 相手の名前 or メールアドレスが1名分存在
 *
 * Classifier Chain 配置: oneToMany と oneOnOne の間（8番目）
 * - 7. oneToMany (2名以上) → 8. reverseAvailability (ご都合伺いキーワード + 1名)
 * - → 9. oneOnOne (1名の通常1対1)
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Patterns
// ============================================================

/**
 * 逆アベイラビリティのトリガーキーワード
 * 「ご都合」「お伺い」「都合を聞く」「相手に合わせ」等
 */
const REVERSE_KEYWORDS = [
  'ご都合',
  'お伺い',
  '都合を聞',
  '都合に合わせ',
  '空いてる日に合わせ',
  '先方の予定',
  '相手の空き',
  '相手に合わせ',
  '目上',
  'reverse',
  'ご都合伺い',
  '伺いモード',
  '都合のいい',
  '都合のよい',
  'ご都合の良い',
  '都合を教え',
];

// 名前パターン（oneOnOne.ts と同期）
const PERSON_PATTERNS = [
  /(.+?)さんに/,
  /(.+?)さんと/,
  /(.+?)くんに/,
  /(.+?)くんと/,
  /(.+?)氏に/,
  /(.+?)氏と/,
  /(.+?)様に/,
  /(.+?)様と/,
  /(.+?)部長/,
  /(.+?)社長/,
  /(.+?)課長/,
  /(.+?)先生/,
];

// メールアドレスパターン
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

// 所要時間パターン
const DURATION_PATTERNS = [
  { pattern: /(\d+)時間/, multiplier: 60 },
  { pattern: /(\d+)分/, multiplier: 1 },
];

// ============================================================
// Helper Functions
// ============================================================

/**
 * 逆アベイラビリティのトリガーキーワードにマッチするか
 */
function hasReverseKeyword(input: string): boolean {
  return REVERSE_KEYWORDS.some(kw => input.includes(kw));
}

/**
 * 名前を1名抽出
 */
function extractPerson(input: string): { name: string } | null {
  for (const pattern of PERSON_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      const name = match[1].trim().replace(/^[、と\s]+/, '').replace(/[、と\s]+$/, '');
      if (name.length > 0 && !/^\d+$/.test(name)) {
        return { name };
      }
    }
  }
  return null;
}

/**
 * メールアドレスを1件抽出
 */
function extractEmail(input: string): string | null {
  const match = input.match(EMAIL_PATTERN);
  return match ? match[1] : null;
}

/**
 * 所要時間を抽出（分単位）
 */
function extractDuration(input: string): number {
  for (const { pattern, multiplier } of DURATION_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      return parseInt(match[1], 10) * multiplier;
    }
  }
  return 60; // デフォルト60分
}

/**
 * タイトル推測
 */
function extractTitle(input: string): string {
  if (input.includes('ミーティング')) return 'ミーティング';
  if (input.includes('会議')) return '会議';
  if (input.includes('面談')) return '面談';
  if (input.includes('相談')) return '相談';
  return '打ち合わせ';
}

// ============================================================
// Main Classifier
// ============================================================

/**
 * 逆アベイラビリティ Intent 分類
 *
 * 判定条件:
 * 1. REVERSE_KEYWORDS にマッチ
 * 2. 相手が1名特定できる（名前 or メール）
 *
 * classifierChain での位置:
 *   oneToMany (2名以上) → reverseAvailability (ご都合伺い + 1名) → oneOnOne (通常1名)
 */
export const classifyReverseAvailability: ClassifierFn = (
  input: string,
  _normalizedInput: string,
  _context?: IntentContext,
  activePending?: PendingState | null,
): IntentResult | null => {
  // pending がある場合はスキップ
  if (activePending) {
    return null;
  }

  // ★ FE-7: preferredMode が reverse_availability ならキーワード不要
  const forcedRA = _context?.preferredMode === 'reverse_availability';

  // トリガーキーワードチェック（FE-7: forcedRA なら skip）
  if (!forcedRA && !hasReverseKeyword(input)) {
    return null;
  }

  // 相手の名前 or メール抽出
  const person = extractPerson(input);
  const email = extractEmail(input);

  // 少なくとも名前かメールが必要
  if (!person && !email) {
    // キーワードだけあるが相手不明 → clarification
    return {
      intent: 'schedule.1on1.reverse_availability',
      confidence: 0.7,
      params: {
        title: extractTitle(input),
        duration_minutes: extractDuration(input),
        rawInput: input,
      },
      needsClarification: {
        field: 'target',
        message: 'ご都合伺いモードですね。相手のお名前とメールアドレスを教えてください。',
      },
    };
  }

  return {
    intent: 'schedule.1on1.reverse_availability',
    confidence: 0.9,
    params: {
      target: {
        name: person?.name || email?.split('@')[0] || undefined,
        email: email || undefined,
      },
      title: extractTitle(input),
      duration_minutes: extractDuration(input),
      rawInput: input,
    },
  };
};
