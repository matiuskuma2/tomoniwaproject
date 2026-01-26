/**
 * CORS Origin Validation Utilities
 * 
 * Purpose: Restrict CORS to allowed origins only (security for 1000+ connections)
 * 
 * Usage in wrangler.jsonc:
 *   "CORS_ORIGINS": "https://app.tomoniwao.jp,.pages.dev"
 * 
 * Format:
 *   - Exact match: "https://app.tomoniwao.jp"
 *   - Suffix match: ".pages.dev" (allows any *.pages.dev)
 *   - Multiple: comma-separated "https://a.com,https://b.com,.pages.dev"
 */

/**
 * Parse CORS_ORIGINS env var into an array of allowed patterns
 */
export function parseCorsOrigins(raw?: string): string[] {
  if (!raw) return [];
  
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Check if an origin is allowed based on the allow list
 * 
 * @param origin - The Origin header value from the request
 * @param allowList - Array of allowed patterns (exact or suffix with leading dot)
 * @returns true if the origin is allowed
 * 
 * Examples:
 *   isAllowedOrigin("https://app.tomoniwao.jp", ["https://app.tomoniwao.jp"]) → true
 *   isAllowedOrigin("https://abc.pages.dev", [".pages.dev"]) → true
 *   isAllowedOrigin("https://evil.com", ["https://app.tomoniwao.jp"]) → false
 */
export function isAllowedOrigin(origin: string | null | undefined, allowList: string[]): boolean {
  // No origin header (e.g., curl, server-to-server) → not a browser CORS request
  if (!origin) return false;
  
  // Empty allow list → deny all (fail-safe)
  if (allowList.length === 0) return false;
  
  for (const pattern of allowList) {
    // Exact match
    if (pattern === origin) {
      return true;
    }
    
    // Suffix match (pattern starts with ".")
    // e.g., ".pages.dev" allows "https://abc.pages.dev"
    if (pattern.startsWith('.')) {
      // Extract hostname from origin
      try {
        const url = new URL(origin);
        if (url.hostname.endsWith(pattern)) {
          return true;
        }
      } catch {
        // Invalid URL → not allowed
        continue;
      }
    }
  }
  
  return false;
}

/**
 * Get CORS origin response value
 * 
 * @param origin - The Origin header value
 * @param allowList - Array of allowed patterns
 * @returns The origin if allowed, null if not allowed
 */
export function getCorsOrigin(origin: string | null | undefined, allowList: string[]): string | null {
  if (isAllowedOrigin(origin, allowList)) {
    return origin!;
  }
  return null;
}
