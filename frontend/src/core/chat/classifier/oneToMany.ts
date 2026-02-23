/**
 * classifier/oneToMany.ts
 * FE-6: 1対N (Broadcast) スケジューリングの Intent 分類
 * 
 * ユーザー発話例:
 * - 「田中さん、佐藤さん、鈴木さんと来週打ち合わせしたい」
 * - 「チームの5人と日程調整して」
 * - 「alice@test.com, bob@test.com に候補出して日程調整」
 * - 「3名で会議セット」
 * - 「全員に候補を送って」
 * 
 * 分類条件:
 * 1. トリガーワード（予定調整/日程調整/打ち合わせ/会議 等）が存在
 * 2. かつ、以下のいずれかで「複数参加者」を検出:
 *    a. 2名以上の名前（「田中さん、佐藤さん」）
 *    b. 2つ以上のメールアドレス
 *    c. 数量表現（「5人」「3名」「全員」等）
 *    d. 「みんな」「チーム」等のグループ表現
 * 
 * 1対1との共存ルール:
 * - 名前/メール1名のみ → classifyOneOnOne（既存）が処理
 * - 名前/メール2名以上 → classifyOneToMany が処理
 * - 数量表現のみ → classifyOneToMany（clarification: 参加者指定を要求）
 * 
 * 抽出するパラメータ:
 * - persons: Array<{ name?, email? }> — 参加者リスト
 * - title: string — 予定タイトル
 * - duration_minutes: number — 所要時間（デフォルト60分）
 * - constraints: object — 時間制約（FE-6b で活用）
 * - mode: OneToManyMode — candidates / fixed / open_slots（デフォルト candidates）
 * - rawInput: string — 原文
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Patterns
// ============================================================

// トリガーワード（scheduling intent を示す）
const TRIGGER_WORDS = [
  '予定調整',
  '日程調整',
  'スケジュール調整',
  '打ち合わせ',
  'ミーティング',
  '会議',
  '面談',
  '相談',
  '日程',
  '候補',
];

// 複数人を示すキーワード
const MULTI_PERSON_KEYWORDS = [
  'みんな',
  '皆',
  '全員',
  'チーム',
  'メンバー',
  'グループ',
];

// 数量表現パターン（2名以上で oneToMany）
const QUANTITY_PATTERNS = [
  /(\d+)\s*名/,
  /(\d+)\s*人/,
  /(\d+)\s*者/,
];

// 名前パターン（oneOnOne.ts と同期）
const PERSON_PATTERNS = [
  /(.+?)さん/g,
  /(.+?)くん/g,
  /(.+?)氏/g,
  /(.+?)様/g,
];

// メールアドレスパターン（グローバル）
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// 所要時間パターン
const DURATION_PATTERNS = [
  { pattern: /(\d+)時間/, multiplier: 60 },
  { pattern: /(\d+)分/, multiplier: 1 },
];

// 時間帯の prefer 検出
const PREFER_PATTERNS: Array<{ pattern: RegExp; prefer: 'morning' | 'afternoon' | 'evening' | 'business' }> = [
  { pattern: /午前|朝|AM/, prefer: 'morning' },
  { pattern: /午後|昼|PM/, prefer: 'afternoon' },
  { pattern: /夕方|夜/, prefer: 'evening' },
  { pattern: /営業時間|ビジネス/, prefer: 'business' },
];

// 期間の検出パターン
const RANGE_PATTERNS: Array<{ pattern: RegExp; resolver: () => { time_min: Date; time_max: Date } }> = [
  {
    pattern: /来週/,
    resolver: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      const timeMin = new Date(now);
      timeMin.setDate(now.getDate() + daysUntilMonday);
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(timeMin);
      timeMax.setDate(timeMin.getDate() + 6);
      timeMax.setHours(23, 59, 59, 999);
      return { time_min: timeMin, time_max: timeMax };
    },
  },
  {
    pattern: /今週/,
    resolver: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const timeMin = new Date(now);
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(now);
      timeMax.setDate(now.getDate() + (7 - dayOfWeek));
      timeMax.setHours(23, 59, 59, 999);
      return { time_min: timeMin, time_max: timeMax };
    },
  },
  {
    pattern: /2週間|二週間/,
    resolver: () => {
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setHours(0, 0, 0, 0);
      const timeMax = new Date(now);
      timeMax.setDate(now.getDate() + 14);
      timeMax.setHours(23, 59, 59, 999);
      return { time_min: timeMin, time_max: timeMax };
    },
  },
];

// モード検出キーワード
const MODE_KEYWORDS = {
  fixed: ['固定', '決め打ち'],
  open_slots: ['選んでもらう', '選んでもらって', '公開して', 'オープンスロット', 'open slots'],
  candidates: ['候補', 'いくつか', '提案'],
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * トリガーワードが含まれているか
 */
function hasTriggerWord(input: string): boolean {
  return TRIGGER_WORDS.some(word => input.includes(word));
}

/**
 * 複数名の名前を抽出
 * 「田中さん、佐藤さん、鈴木さん」→ ['田中', '佐藤', '鈴木']
 */
function extractMultiplePersons(input: string): Array<{ name: string }> {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const pattern of PERSON_PATTERNS) {
    // Reset regex lastIndex each time
    const regex = new RegExp(pattern.source, 'g');
    let match;
    while ((match = regex.exec(input)) !== null) {
      const name = match[1].trim();
      // 除外: 1文字以下、数字のみ、既出
      if (name.length > 0 && !/^\d+$/.test(name) && !seen.has(name)) {
        // 接続詞 "と" や "、" を除去
        const cleaned = name.replace(/^[、と\s]+/, '').replace(/[、と\s]+$/, '');
        if (cleaned.length > 0 && !seen.has(cleaned)) {
          seen.add(cleaned);
          names.push(cleaned);
        }
      }
    }
  }

  return names.map(name => ({ name }));
}

/**
 * 複数のメールアドレスを抽出
 */
function extractMultipleEmails(input: string): string[] {
  const matches = input.match(EMAIL_PATTERN);
  if (!matches) return [];
  // deduplicate
  return [...new Set(matches)];
}

/**
 * 数量表現を検出（「5名」「3人」等）
 */
function extractQuantity(input: string): number | null {
  for (const pattern of QUANTITY_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= 2) return num;
    }
  }
  return null;
}

/**
 * 複数人キーワードが含まれるか
 */
function hasMultiPersonKeyword(input: string): boolean {
  return MULTI_PERSON_KEYWORDS.some(word => input.includes(word));
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
 * 時間帯の prefer を抽出
 */
function extractPrefer(input: string): 'morning' | 'afternoon' | 'evening' | 'business' | null {
  for (const { pattern, prefer } of PREFER_PATTERNS) {
    if (pattern.test(input)) {
      return prefer;
    }
  }
  return null;
}

/**
 * time_min / time_max を抽出
 */
function extractTimeRange(input: string): { time_min: Date; time_max: Date } | null {
  for (const { pattern, resolver } of RANGE_PATTERNS) {
    if (pattern.test(input)) {
      return resolver();
    }
  }
  return null;
}

/**
 * モード検出
 */
function detectMode(input: string): 'candidates' | 'fixed' | 'open_slots' {
  const lower = input.toLowerCase();
  for (const keyword of MODE_KEYWORDS.open_slots) {
    if (lower.includes(keyword.toLowerCase())) return 'open_slots';
  }
  for (const keyword of MODE_KEYWORDS.fixed) {
    if (lower.includes(keyword.toLowerCase())) return 'fixed';
  }
  // デフォルト: candidates
  return 'candidates';
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
 * 1対N Intent 分類
 * 
 * 判定条件:
 * 1. トリガーワードあり
 * 2. 以下のいずれかで「複数参加者」を検出:
 *    a. 2名以上の名前
 *    b. 2つ以上のメールアドレス
 *    c. 数量表現（2名以上）
 *    d. グループキーワード（全員、チーム等）
 * 
 * 注意: classifierChain では classifyOneOnOne より前に配置すること
 * (2名以上は oneToMany、1名は oneOnOne に流す)
 */
export const classifyOneToMany: ClassifierFn = (
  input: string,
  _normalizedInput: string,
  _context?: IntentContext,
  activePending?: PendingState | null
): IntentResult | null => {
  // pending がある場合はスキップ（既存フローを優先）
  if (activePending) {
    return null;
  }

  // トリガーワードがなければスキップ
  if (!hasTriggerWord(input)) {
    return null;
  }

  // 名前を抽出
  const persons = extractMultiplePersons(input);
  // メールアドレスを抽出
  const emails = extractMultipleEmails(input);
  // 数量表現を検出
  const quantity = extractQuantity(input);
  // グループキーワード
  const hasGroupKeyword = hasMultiPersonKeyword(input);

  // ============================================================
  // 複数参加者の判定
  // ============================================================

  // Case A: 2名以上の名前
  if (persons.length >= 2) {
    return buildOneToManyResult(input, {
      persons,
      emails,
    });
  }

  // Case B: 2つ以上のメールアドレス
  if (emails.length >= 2) {
    return buildOneToManyResult(input, {
      persons: emails.map(e => ({ name: e.split('@')[0] })),
      emails,
    });
  }

  // Case C: 数量表現（2名以上）
  if (quantity !== null && quantity >= 2) {
    // 具体的な名前/メールなし → clarification
    if (persons.length === 0 && emails.length === 0) {
      return {
        intent: 'schedule.1toN.prepare' as any,
        confidence: 0.7,
        params: {
          expectedCount: quantity,
          title: extractTitle(input),
          rawInput: input,
        },
        needsClarification: {
          field: 'participants',
          message: `${quantity}名との日程調整ですね。参加者のメールアドレスか名前を教えてください。`,
        },
      };
    }
    // 名前/メールはあるが1名のみ → それでも数量表現で oneToMany
    return buildOneToManyResult(input, { persons, emails });
  }

  // Case D: グループキーワード（全員、チーム等）
  if (hasGroupKeyword) {
    // 具体的な名前/メールなし → clarification
    if (persons.length === 0 && emails.length === 0) {
      return {
        intent: 'schedule.1toN.prepare' as any,
        confidence: 0.7,
        params: {
          title: extractTitle(input),
          rawInput: input,
          groupKeyword: true,
        },
        needsClarification: {
          field: 'participants',
          message: '参加者のメールアドレスか名前を教えてください。\nまたはリスト名を指定してください（例: 「営業チームリスト」）。',
        },
      };
    }
    return buildOneToManyResult(input, { persons, emails });
  }

  // 複数参加者が検出できなかった → null（次の分類器へ）
  return null;
};

// ============================================================
// Result Builder
// ============================================================

function buildOneToManyResult(
  input: string,
  extracted: {
    persons: Array<{ name: string }>;
    emails: string[];
  }
): IntentResult {
  const mode = detectMode(input);
  const durationMinutes = extractDuration(input);
  const title = extractTitle(input);
  const prefer = extractPrefer(input);
  const timeRange = extractTimeRange(input);

  // constraints を組み立て
  const constraints: Record<string, any> = {};
  if (timeRange) {
    constraints.time_min = timeRange.time_min.toISOString();
    constraints.time_max = timeRange.time_max.toISOString();
  }
  if (prefer) {
    constraints.prefer = prefer;
  }
  if (durationMinutes !== 60) {
    constraints.duration = durationMinutes;
  }

  return {
    intent: 'schedule.1toN.prepare' as any,
    confidence: 0.9,
    params: {
      persons: extracted.persons,
      emails: extracted.emails,
      mode,
      title,
      duration_minutes: durationMinutes,
      constraints: Object.keys(constraints).length > 0 ? constraints : undefined,
      rawInput: input,
    },
  };
}
