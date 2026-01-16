/**
 * classifier/utils.ts
 * TD-003: 共通ユーティリティ関数
 */

/**
 * Extract email addresses from text
 */
export function extractEmails(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  return matches || [];
}

/**
 * Extract names from Japanese text (simple heuristic)
 * Phase Next-2: Very basic implementation
 */
export function extractNames(text: string): string[] {
  // Simple pattern: "〇〇さん" or "〇〇氏"
  const namePattern = /([一-龯ぁ-んァ-ヶa-zA-Z]+)(さん|氏|様)/g;
  const matches = [];
  let match;

  while ((match = namePattern.exec(text)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}
