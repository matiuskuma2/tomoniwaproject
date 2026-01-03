/**
 * Audit Log Pruning (P0-2: Prevent log bloat)
 * 
 * Retention Policy:
 * - ledger_audit_events: 90 days
 * - list_item_events: 90 days
 * - billing_events: 180 days (longer for accounting/compliance)
 * - access_denied logs: 30 days (high volume)
 * 
 * Execution:
 * - Runs daily via Cron (0 2 * * *)
 * - Deletes in chunks (5000 rows per table) to avoid timeout
 * - Uses created_at index for efficient deletion
 */

import type { D1Database } from '@cloudflare/workers-types';

const CHUNK_SIZE = 5000;

export async function pruneAuditLogs(db: D1Database): Promise<{
  ledger: number;
  listItems: number;
  billing: number;
  accessDenied: number;
}> {
  const now = new Date();
  
  // Calculate cutoff dates
  const ledgerCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const billingCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const accessDeniedCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  console.log('[Prune] Starting audit log pruning...');
  console.log('[Prune] Cutoffs:', {
    ledger: ledgerCutoff,
    billing: billingCutoff,
    accessDenied: accessDeniedCutoff,
  });

  // 1. Prune ledger_audit_events (90 days, except access_denied)
  const ledgerResult = await db
    .prepare(
      `DELETE FROM ledger_audit_events 
       WHERE created_at < ? AND action != 'access_denied'
       LIMIT ?`
    )
    .bind(ledgerCutoff, CHUNK_SIZE)
    .run();

  // 2. Prune access_denied logs (30 days, high volume)
  const accessDeniedResult = await db
    .prepare(
      `DELETE FROM ledger_audit_events 
       WHERE created_at < ? AND action = 'access_denied'
       LIMIT ?`
    )
    .bind(accessDeniedCutoff, CHUNK_SIZE)
    .run();

  // 3. Prune list_item_events (90 days)
  const listItemsResult = await db
    .prepare(
      `DELETE FROM list_item_events 
       WHERE created_at < ?
       LIMIT ?`
    )
    .bind(ledgerCutoff, CHUNK_SIZE)
    .run();

  // 4. Prune billing_events (180 days)
  const billingResult = await db
    .prepare(
      `DELETE FROM billing_events 
       WHERE created_at < ?
       LIMIT ?`
    )
    .bind(billingCutoff, CHUNK_SIZE)
    .run();

  const deleted = {
    ledger: ledgerResult.meta.changes,
    listItems: listItemsResult.meta.changes,
    billing: billingResult.meta.changes,
    accessDenied: accessDeniedResult.meta.changes,
  };

  console.log('[Prune] Deleted rows:', deleted);

  return deleted;
}
