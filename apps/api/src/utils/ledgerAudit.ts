/**
 * Ledger audit helper (運用インシデント防止)
 */

import type { D1Database } from '@cloudflare/workers-types';

export async function writeLedgerAudit(
  db: D1Database,
  args: {
    workspaceId: string;
    ownerUserId: string;
    actorUserId: string;
    targetType: 'contact' | 'channel' | 'list_member';
    targetId: string;
    action: 'create' | 'update' | 'delete' | 'access_denied';  // P0-2: Security incident logging
    payload: unknown;
    requestId: string;
    sourceIp?: string;
    userAgent?: string;
  }
) {
  const payloadJson = JSON.stringify(args.payload ?? {});
  
  await db
    .prepare(
      `INSERT INTO ledger_audit_events 
       (workspace_id, owner_user_id, actor_user_id, target_type, target_id, action, payload_json, request_id, source_ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      args.workspaceId,
      args.ownerUserId,
      args.actorUserId,
      args.targetType,
      args.targetId,
      args.action,
      payloadJson,
      args.requestId,
      args.sourceIp ?? null,
      args.userAgent ?? null
    )
    .run();
}
