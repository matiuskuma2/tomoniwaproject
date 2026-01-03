/**
 * Audit Log Utility
 * 
 * Purpose: 運用インシデント時の追跡を容易にする
 * - すべての書き込みイベントを記録
 * - request_id でリクエスト全体を追跡
 * - payload_json で差分を保存
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface ListItemEventPayload {
  userId: string;
  workspaceId: string;
  ownerUserId: string;
  listItemId: string;
  action: 'created' | 'updated' | 'status_changed' | 'deleted' | 'restored';
  payload: unknown;  // minimal diff
  requestId: string;
}

/**
 * Write list_item event to audit log
 */
export async function writeListItemEvent(
  db: D1Database,
  event: ListItemEventPayload
): Promise<void> {
  const payloadJson = JSON.stringify(event.payload ?? {});
  
  await db.prepare(`
    INSERT INTO list_item_events (
      workspace_id, owner_user_id, list_item_id, 
      action, payload_json, request_id
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(
      event.workspaceId,
      event.ownerUserId,
      event.listItemId,
      event.action,
      payloadJson,
      event.requestId
    )
    .run();
}

/**
 * Query events by list_item_id
 * 
 * 用途: 「このアイテムの履歴を見る」
 */
export async function getListItemEvents(
  db: D1Database,
  args: {
    workspaceId: string;
    ownerUserId: string;
    listItemId: string;
    limit?: number;
  }
): Promise<any[]> {
  const limit = Math.min(args.limit ?? 50, 100);
  
  const rows = await db.prepare(`
    SELECT 
      id, workspace_id, owner_user_id, list_item_id,
      action, payload_json, request_id, created_at
    FROM list_item_events
    WHERE workspace_id = ? AND owner_user_id = ? AND list_item_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `)
    .bind(args.workspaceId, args.ownerUserId, args.listItemId, limit)
    .all();
  
  return rows.results ?? [];
}

/**
 * Query events by request_id
 * 
 * 用途: 運用インシデント時に「このリクエストで何が起きたか」を追う
 */
export async function getEventsByRequestId(
  db: D1Database,
  requestId: string
): Promise<any[]> {
  const rows = await db.prepare(`
    SELECT 
      id, workspace_id, owner_user_id, list_item_id,
      action, payload_json, request_id, created_at
    FROM list_item_events
    WHERE request_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `)
    .bind(requestId)
    .all();
  
  return rows.results ?? [];
}
