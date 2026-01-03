/**
 * Cursor pagination utility (offset禁止)
 * Format: "timestamp|id" -> URL-safe直接エンコード
 * 
 * P0-5: 簡素化（base64不要、Workers/D1安全）
 * - 固定長: ISO8601 datetime + UUID
 * - 直接 encodeURIComponent で URL-safe化
 * - 例: "2026-01-03T01:00:00.000Z|abc-123" -> "2026-01-03T01%3A00%3A00.000Z%7Cabc-123"
 */

export type Cursor = {
  timestamp: string; // ISO8601 or datetime string
  id: string;        // UUID
};

export function encodeCursor(c: Cursor): string {
  const raw = `${c.timestamp}|${c.id}`;
  return encodeURIComponent(raw);
}

export function decodeCursor(cursor: string): Cursor | null {
  try {
    const raw = decodeURIComponent(cursor);
    const [timestamp, id] = raw.split('|');
    if (!timestamp || !id) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

export function clampLimit(raw: string | undefined, max: number = 50): number {
  const n = Number(raw ?? 20);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(max, Math.floor(n));
}
