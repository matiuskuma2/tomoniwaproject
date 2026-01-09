/**
 * Email Normalizer
 * Beta A: メール正規化・検証・抽出
 */

/**
 * メールアドレス正規化
 * - trim
 * - lowercase
 * - null/undefined は null を返す
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return s;
}

/**
 * メールアドレス検証（簡易）
 * RFC準拠ではないが実用的なパターン
 */
export function isValidEmail(email: string): boolean {
  // 最低限の形式チェック: xxx@xxx.xxx
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * メールリストを正規化・重複除去・検証
 * @returns { valid: 有効なメール[], invalid: 無効なメール[], duplicates: 重複したメール[] }
 */
export function normalizeAndValidateEmails(rawEmails: unknown): {
  valid: string[];
  invalid: string[];
  duplicates: string[];
} {
  const list: unknown[] = Array.isArray(rawEmails) ? rawEmails : [];
  
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const raw of list) {
    const normalized = normalizeEmail(raw);
    if (!normalized) continue;

    // 重複チェック
    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }

    // 形式チェック
    if (!isValidEmail(normalized)) {
      invalid.push(normalized);
      continue;
    }

    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid, duplicates };
}

/**
 * テキストからメールアドレスを抽出
 * チャット入力: "tanaka@example.com suzuki@example.com" → ["tanaka@example.com", "suzuki@example.com"]
 */
export function extractEmailsFromText(text: string): string[] {
  // 空白・カンマ・セミコロン・改行で区切られたメールを抽出
  const emailRegex = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/g;
  const matches = text.match(emailRegex) || [];
  return matches.map((m) => normalizeEmail(m)).filter((e): e is string => !!e);
}

/**
 * 文字列がメールアドレスを含むかチェック
 */
export function containsEmail(text: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
}
