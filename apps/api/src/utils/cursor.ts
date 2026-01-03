/**
 * Cursor Pagination Utility
 * 
 * Purpose: offset禁止、cursor方式の固定
 * Format: "created_at|id" -> base64url
 * 
 * Why cursor instead of offset:
 * - offset は 1億件で確実に遅くなる
 * - cursor は index scan で高速
 * - 運用インシデントを構造で防ぐ
 */

export type Cursor = { 
  createdAt: string; 
  id: string; 
};

/**
 * Encode cursor to base64url string
 * Using Web APIs (TextEncoder/btoa) for Cloudflare Workers compatibility
 */
export function encodeCursor(c: Cursor): string {
  const raw = `${c.createdAt}|${c.id}`;
  const bytes = new TextEncoder().encode(raw);
  const base64 = btoa(String.fromCharCode(...bytes));
  // Convert base64 to base64url (replace +/= with -_)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Decode cursor from base64url string
 * Returns null if invalid
 */
export function decodeCursor(cursor: string): Cursor | null {
  try {
    // Convert base64url to base64
    let base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = atob(base64);
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    const raw = new TextDecoder().decode(bytes);
    const [createdAt, id] = raw.split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Build WHERE clause for cursor pagination (DESC order)
 * 
 * For ORDER BY created_at DESC, id DESC:
 * WHERE (created_at < cursor.createdAt) 
 *    OR (created_at = cursor.createdAt AND id < cursor.id)
 */
export function buildCursorCondition(
  cursor: Cursor | null,
  createdAtColumn: string = 'created_at',
  idColumn: string = 'id'
): { sql: string; binds: any[] } {
  if (!cursor) {
    return { sql: '', binds: [] };
  }
  
  const sql = ` AND (${createdAtColumn} < ? OR (${createdAtColumn} = ? AND ${idColumn} < ?)) `;
  const binds = [cursor.createdAt, cursor.createdAt, cursor.id];
  
  return { sql, binds };
}

/**
 * Clamp limit to reasonable range (1..50)
 */
export function clampLimit(raw: string | undefined | null, defaultLimit: number = 20): number {
  const n = Number(raw ?? defaultLimit);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(50, Math.floor(n));
}
