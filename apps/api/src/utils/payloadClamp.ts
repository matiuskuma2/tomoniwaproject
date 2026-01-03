/**
 * Payload Clamp Utility
 * 
 * P0-2: Prevent audit log bloat by limiting payload size
 * - Max 8KB per payload (configurable)
 * - Truncate with metadata if exceeded
 */

const MAX_PAYLOAD_BYTES = 8 * 1024; // 8KB

export interface ClampResult {
  payload: any;
  truncated: boolean;
  originalBytes?: number;
}

/**
 * Clamp payload to prevent log bloat
 * - If payload exceeds MAX_PAYLOAD_BYTES, truncate with metadata
 * - Preserves structure for small payloads
 * - Returns { payload, truncated, originalBytes }
 */
export function clampPayload(payload: any): ClampResult {
  const jsonString = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(jsonString).length;

  if (bytes <= MAX_PAYLOAD_BYTES) {
    return {
      payload,
      truncated: false,
    };
  }

  // Truncate: keep small keys, summarize large ones
  return {
    payload: {
      _truncated: true,
      _original_bytes: bytes,
      _max_bytes: MAX_PAYLOAD_BYTES,
      _summary: truncateSummary(payload),
    },
    truncated: true,
    originalBytes: bytes,
  };
}

/**
 * Create a summary of truncated payload
 * - Keep top-level keys
 * - Summarize array lengths
 * - Truncate long strings
 */
function truncateSummary(payload: any): any {
  if (Array.isArray(payload)) {
    return {
      _type: 'array',
      length: payload.length,
      sample: payload.slice(0, 3),
    };
  }

  if (typeof payload === 'object' && payload !== null) {
    const summary: any = {};
    for (const [key, value] of Object.entries(payload)) {
      if (Array.isArray(value)) {
        summary[key] = { _type: 'array', length: value.length };
      } else if (typeof value === 'string' && value.length > 100) {
        summary[key] = value.substring(0, 100) + '...[truncated]';
      } else if (typeof value === 'object' && value !== null) {
        summary[key] = { _type: 'object', keys: Object.keys(value) };
      } else {
        summary[key] = value;
      }
    }
    return summary;
  }

  if (typeof payload === 'string' && payload.length > 200) {
    return payload.substring(0, 200) + '...[truncated]';
  }

  return payload;
}
