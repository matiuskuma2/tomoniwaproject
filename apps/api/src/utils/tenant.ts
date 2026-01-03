/**
 * Tenant Isolation Utilities
 * 
 * CRITICAL: P0 for operational incident prevention
 * - workspace_id は必ず定数から取得（マジックナンバー禁止）
 * - 将来のマルチテナント対応を想定した境界設計
 */

/**
 * Default workspace ID (暫定)
 * 
 * NOTE: 現状は単一テナント前提で 'ws-default' を使用
 * 将来のマルチテナント対応時は users.workspace_id から取得に切り替え
 */
export const DEFAULT_WORKSPACE_ID = 'ws-default';

/**
 * Get workspace_id for a user
 * 
 * @param userId - User ID
 * @returns workspace_id
 * 
 * FUTURE: users テーブルから取得する実装に置き換え
 * ```typescript
 * const row = await env.DB.prepare(`
 *   SELECT workspace_id FROM users WHERE id = ?
 * `).bind(userId).first();
 * return row?.workspace_id || DEFAULT_WORKSPACE_ID;
 * ```
 */
export function getWorkspaceId(_userId: string): string {
  return DEFAULT_WORKSPACE_ID;
}
