/**
 * Cursor pagination utility (offset禁止)
 * Format: "timestamp|id" -> base64url
 */

export type Cursor = {
  timestamp: string; // ISO8601 or datetime string
  id: string;        // UUID
};

export function encodeCursor(c: Cursor): string {
  const raw = `${c.timestamp}|${c.id}`;
  // Use TextEncoder for Web standard compatibility
  const bytes = new TextEncoder().encode(raw);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function decodeCursor(cursor: string): Cursor | null {
  try {
    // Reverse base64url to base64
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    const binary = atob(paddedBase64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const raw = new TextDecoder().decode(bytes);
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
