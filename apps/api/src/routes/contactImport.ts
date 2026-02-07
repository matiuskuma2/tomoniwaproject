/**
 * Contact Import API Routes (PR-D-API-1)
 * 
 * packages/ai の ClassifierChain/Executor を API層で接続
 * 事故ゼロ設計:
 *   - Gate-3: 全APIで owner_user_id 一致チェック（不一致=404）
 *   - Gate-4: confirm 以外は contacts 書き込みゼロ
 *   - 事故ゼロガード: all_ambiguous_resolved === true 必須 (confirm)
 *
 * Endpoints:
 *   POST /preview        — テキスト/CSV → パース → 曖昧一致検出 → pending作成
 *   POST /person-select  — 曖昧一致の番号選択（pending更新のみ）
 *   POST /confirm        — 全曖昧解決後の確定（contacts書き込み）
 *   POST /cancel         — キャンセル（書き込みゼロ保証）
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import { createLogger } from '../utils/logger';
import {
  ContactsRepository,
  type Contact,
} from '../repositories/contactsRepository';
import {
  type ContactImportPayload,
  type ContactImportSummary,
  type ContactImportEntry,
  type ContactMatchStatus,
  PENDING_CONFIRMATION_KIND,
} from '../../../../packages/shared/src/types/pendingAction';
import { parseCSV } from '../../../../packages/ai/src/parser/csvParser';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Constants
// ============================================================
const IMPORT_EXPIRATION_MINUTES = 15;
const MAX_TEXT_LINES = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================
// Gate-3 Helper: pending_action を owner_user_id 付きで取得
// 不一致/未存在 → null（呼び出し元で404返却）
// ============================================================
interface PendingActionRow {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  action_type: string;
  payload_json: string;
  summary_json: string;
  status: string;
  expires_at: string;
  created_at: string;
}

async function getPendingForUser(
  db: D1Database,
  pendingActionId: string,
  ownerUserId: string,
  log: ReturnType<typeof createLogger>
): Promise<PendingActionRow | null> {
  const row = await db.prepare(`
    SELECT id, workspace_id, owner_user_id, action_type,
           payload_json, summary_json, status, expires_at, created_at
    FROM pending_actions
    WHERE id = ?
      AND owner_user_id = ?
      AND action_type = 'contact_import'
  `).bind(pendingActionId, ownerUserId).first<PendingActionRow>();

  if (!row) {
    log.warn('pending_action not found or owner mismatch', {
      pending_action_id: pendingActionId,
      owner_user_id: ownerUserId,
    });
    return null;
  }

  // 期限切れチェック
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare(
      `UPDATE pending_actions SET status = 'expired' WHERE id = ? AND status = 'pending'`
    ).bind(row.id).run();
    log.info('pending_action expired', { pending_action_id: row.id });
    return null;
  }

  // status チェック（pending のみ操作可能）
  if (row.status !== 'pending') {
    log.warn('pending_action not in pending status', {
      pending_action_id: row.id,
      status: row.status,
    });
    return null;
  }

  return row;
}

// ============================================================
// Text Parser (simple: 1行1人)
// ============================================================
function parseTextLines(rawText: string): ContactImportEntry[] {
  const lines = rawText.split(/[\r\n]+/).filter(l => l.trim());
  const entries: ContactImportEntry[] = [];

  for (let i = 0; i < Math.min(lines.length, MAX_TEXT_LINES); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // メールアドレス抽出
    const emailMatch = line.match(/[\w.+-]+@[\w.-]+\.\w+/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : undefined;
    // 名前 = メール除去した残り
    const name = line.replace(/[\w.+-]+@[\w.-]+\.\w+/, '').trim() || (email ? email.split('@')[0] : `行${i + 1}`);

    entries.push({
      index: i,
      name,
      email,
      missing_email: !email,
      match_status: email ? 'new' : 'skipped',
      // new → create_new (自動解決)、missing_email → skip
      resolved_action: email ? { type: 'create_new' } : { type: 'skip' },
    });
  }

  return entries;
}

// ============================================================
// 曖昧一致検出
// ============================================================
async function detectAmbiguousMatches(
  entries: ContactImportEntry[],
  repo: ContactsRepository,
  workspaceId: string,
  ownerUserId: string
): Promise<ContactImportEntry[]> {
  for (const entry of entries) {
    if (entry.match_status === 'skipped' || !entry.email) continue;

    // 1) メール完全一致チェック
    const existingByEmail = await repo.getByEmail(entry.email, workspaceId, ownerUserId);
    if (existingByEmail) {
      entry.match_status = 'exact';
      entry.resolved_action = { type: 'select_existing', contact_id: existingByEmail.id };
      entry.ambiguous_candidates = [{
        number: 1,
        contact_id: existingByEmail.id,
        display_name: existingByEmail.display_name || '',
        email: existingByEmail.email || undefined,
        score: 1.0,
      }];
      continue;
    }

    // 2) 名前類似チェック
    if (entry.name) {
      const searchResult = await repo.search({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        q: entry.name,
        limit: 5,
      });

      const similar = searchResult.contacts.filter(c =>
        c.display_name && isSimilarName(c.display_name, entry.name)
      );

      if (similar.length > 0) {
        entry.match_status = 'ambiguous';
        entry.ambiguous_candidates = similar.map((c, idx) => ({
          number: idx + 1,
          contact_id: c.id,
          display_name: c.display_name || '',
          email: c.email || undefined,
          score: c.display_name?.toLowerCase() === entry.name.toLowerCase() ? 0.95 : 0.7,
        }));
        // 未解決のまま → person-select で解決
        entry.resolved_action = undefined;
      }
    }
  }

  return entries;
}

function isSimilarName(a: string | null, b: string): boolean {
  if (!a) return false;
  const la = a.toLowerCase().replace(/\s+/g, '');
  const lb = b.toLowerCase().replace(/\s+/g, '');
  return la === lb || la.includes(lb) || lb.includes(la);
}

// ============================================================
// Summary Builder
// ============================================================
function buildSummary(
  entries: ContactImportEntry[],
  source: 'text' | 'csv'
): ContactImportSummary {
  let exact = 0, ambiguous = 0, newCount = 0, skipped = 0, missingEmail = 0;

  for (const e of entries) {
    switch (e.match_status) {
      case 'exact': exact++; break;
      case 'ambiguous': ambiguous++; break;
      case 'new': newCount++; break;
      case 'skipped': skipped++; break;
    }
    if (e.missing_email) missingEmail++;
  }

  return {
    total_count: entries.length,
    exact_match_count: exact,
    ambiguous_count: ambiguous,
    new_count: newCount,
    skipped_count: skipped,
    missing_email_count: missingEmail,
    source,
    preview_entries: entries.slice(0, 10).map(e => ({
      name: e.name,
      email: e.email,
      match_status: e.match_status,
      candidate_count: e.ambiguous_candidates?.length,
    })),
  };
}

// ============================================================
// POST /preview
// ============================================================
app.post('/preview', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ContactImport', handler: 'preview' });
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{ source: 'text' | 'csv'; raw_text: string }>();

    if (!body.raw_text || typeof body.raw_text !== 'string') {
      return c.json({ error: 'raw_text is required' }, 400);
    }

    const source = body.source || 'text';

    // パース
    let entries: ContactImportEntry[];
    let csvWarnings: string[] = [];

    if (source === 'csv') {
      const csvResult = parseCSV(body.raw_text);
      entries = csvResult.entries;
      csvWarnings = csvResult.warnings;
    } else {
      entries = parseTextLines(body.raw_text);
    }

    if (entries.length === 0) {
      return c.json({ error: 'No valid entries found' }, 400);
    }

    // 曖昧一致検出
    const repo = new ContactsRepository(env.DB);
    entries = await detectAmbiguousMatches(entries, repo, workspaceId, ownerUserId);

    // unresolved count
    const unresolvedCount = entries.filter(
      e => e.match_status === 'ambiguous' && !e.resolved_action
    ).length;
    const allResolved = unresolvedCount === 0;
    const missingEmailCount = entries.filter(e => e.missing_email).length;

    // Payload/Summary 構築
    const payload: ContactImportPayload = {
      source,
      raw_text: body.raw_text,
      parsed_entries: entries,
      unresolved_count: unresolvedCount,
      all_ambiguous_resolved: allResolved,
      missing_email_count: missingEmailCount,
    };
    const summary = buildSummary(entries, source);

    // pending_action 作成
    const pendingId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_EXPIRATION_MINUTES * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO pending_actions
        (id, workspace_id, owner_user_id, thread_id,
         action_type, source_type,
         payload_json, summary_json,
         confirm_token, status, expires_at, created_at)
      VALUES (?, ?, ?, NULL,
              'contact_import', NULL,
              ?, ?,
              NULL, 'pending', ?, ?)
    `).bind(
      pendingId,
      workspaceId,
      ownerUserId,
      JSON.stringify(payload),
      JSON.stringify(summary),
      expiresAt,
      now
    ).run();

    const nextKind = allResolved
      ? PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM
      : PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT;

    log.info('Import preview created', {
      pending_action_id: pendingId,
      source,
      total: entries.length,
      ambiguous: unresolvedCount,
      missing_email: missingEmailCount,
    });

    return c.json({
      pending_action_id: pendingId,
      expires_at: expiresAt,
      summary,
      parsed_entries: entries,
      csv_warnings: csvWarnings,
      next_pending_kind: nextKind,
      message: allResolved
        ? '取り込み内容を確認してください。「はい」で確定します。'
        : `${unresolvedCount}件の曖昧な一致があります。番号を選択してください。`,
    }, 201);
  } catch (error) {
    log.error('Preview failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'Preview failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /person-select (pending更新のみ — contacts書き込みゼロ)
// ============================================================
app.post('/person-select', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ContactImport', handler: 'person-select' });
  const { ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{
      pending_action_id: string;
      entry_index: number;
      action: 'select' | 'new' | 'skip';
      selected_number?: number;
    }>();

    if (!body.pending_action_id) {
      return c.json({ error: 'pending_action_id is required' }, 400);
    }

    // Gate-3: owner_user_id 一致チェック
    const row = await getPendingForUser(env.DB, body.pending_action_id, ownerUserId, log);
    if (!row) return c.json({ error: 'Not found' }, 404);

    const payload: ContactImportPayload = JSON.parse(row.payload_json);
    const entry = payload.parsed_entries[body.entry_index];

    if (!entry) {
      return c.json({ error: 'Invalid entry_index' }, 400);
    }

    // アクション適用
    if (body.action === 'skip') {
      entry.resolved_action = { type: 'skip' };
      entry.match_status = 'skipped';
    } else if (body.action === 'new') {
      entry.resolved_action = { type: 'create_new' };
      // match_statusはnewに変更しない（元がambiguousでも選択結果としてcreate_new）
    } else if (body.action === 'select' && typeof body.selected_number === 'number') {
      const candidate = entry.ambiguous_candidates?.find(c => c.number === body.selected_number);
      if (!candidate) {
        return c.json({ error: 'Invalid selected_number' }, 400);
      }
      entry.resolved_action = { type: 'select_existing', contact_id: candidate.contact_id };
    } else {
      return c.json({ error: 'Invalid action' }, 400);
    }

    // unresolved再計算
    payload.unresolved_count = payload.parsed_entries.filter(
      e => e.match_status === 'ambiguous' && !e.resolved_action
    ).length;
    payload.all_ambiguous_resolved = payload.unresolved_count === 0;

    // summary 再構築
    const summary = buildSummary(payload.parsed_entries, payload.source);

    // pending_action 更新 (contacts書き込みゼロ)
    await env.DB.prepare(`
      UPDATE pending_actions
      SET payload_json = ?, summary_json = ?, status = 'pending'
      WHERE id = ? AND owner_user_id = ?
    `).bind(
      JSON.stringify(payload),
      JSON.stringify(summary),
      row.id,
      ownerUserId
    ).run();

    const nextKind = payload.all_ambiguous_resolved
      ? PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM
      : PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT;

    log.info('Person select applied', {
      pending_action_id: row.id,
      entry_index: body.entry_index,
      action: body.action,
      remaining_unresolved: payload.unresolved_count,
    });

    return c.json({
      updated_entry: entry,
      all_resolved: payload.all_ambiguous_resolved,
      remaining_unresolved: payload.unresolved_count,
      next_pending_kind: nextKind,
      message: payload.all_ambiguous_resolved
        ? 'すべての曖昧一致が解決しました。「はい」で確定できます。'
        : `残り ${payload.unresolved_count}件の曖昧一致があります。`,
    });
  } catch (error) {
    log.error('Person select failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'Person select failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /confirm (contacts書き込みはここだけ)
// ============================================================
app.post('/confirm', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ContactImport', handler: 'confirm' });
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{ pending_action_id: string }>();

    if (!body.pending_action_id) {
      return c.json({ error: 'pending_action_id is required' }, 400);
    }

    // Gate-3: owner_user_id 一致チェック
    const row = await getPendingForUser(env.DB, body.pending_action_id, ownerUserId, log);
    if (!row) return c.json({ error: 'Not found' }, 404);

    const payload: ContactImportPayload = JSON.parse(row.payload_json);

    // ■■■ 事故ゼロガード: all_ambiguous_resolved 必須 ■■■
    if (!payload.all_ambiguous_resolved) {
      const remaining = payload.parsed_entries.filter(
        e => e.match_status === 'ambiguous' && !e.resolved_action
      ).length;
      log.warn('Confirm rejected: ambiguous remaining', {
        pending_action_id: row.id,
        remaining,
      });
      return c.json({
        error: 'Ambiguous entries remaining',
        remaining_unresolved: remaining,
        message: `まだ ${remaining}件の曖昧な一致が未解決です。`,
      }, 409);
    }
    // ■■■ ガード終了 ■■■

    const repo = new ContactsRepository(env.DB);
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const createdContacts: Array<{ id: string; display_name: string; email?: string }> = [];

    for (const entry of payload.parsed_entries) {
      if (!entry.resolved_action) {
        skippedCount++;
        continue;
      }

      switch (entry.resolved_action.type) {
        case 'create_new': {
          if (!entry.email) {
            skippedCount++;
            break;
          }
          try {
            const contact = await repo.create({
              workspace_id: workspaceId,
              owner_user_id: ownerUserId,
              kind: 'external_person',
              email: entry.email,
              display_name: entry.name,
              notes: entry.notes || null,
            });
            createdContacts.push({
              id: contact.id,
              display_name: contact.display_name || entry.name,
              email: contact.email || undefined,
            });
            createdCount++;
          } catch (e) {
            log.warn('Contact creation failed (duplicate?)', {
              entry_name: entry.name,
              entry_email: entry.email,
              error: e instanceof Error ? e.message : String(e),
            });
            skippedCount++;
          }
          break;
        }
        case 'select_existing': {
          try {
            await repo.update(
              entry.resolved_action.contact_id,
              workspaceId,
              ownerUserId,
              { notes: entry.notes || null }
            );
            updatedCount++;
          } catch (e) {
            log.warn('Contact update failed', {
              contact_id: entry.resolved_action.contact_id,
              error: e instanceof Error ? e.message : String(e),
            });
            skippedCount++;
          }
          break;
        }
        case 'skip': {
          skippedCount++;
          break;
        }
      }
    }

    // pending_action を executed に
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE pending_actions
      SET status = 'executed', executed_at = ?, confirmed_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).bind(now, now, row.id, ownerUserId).run();

    log.info('Import confirmed', {
      pending_action_id: row.id,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
    });

    return c.json({
      success: true,
      created_count: createdCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      created_contacts: createdContacts,
    });
  } catch (error) {
    log.error('Confirm failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'Confirm failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================
// POST /cancel (書き込みゼロ保証)
// ============================================================
app.post('/cancel', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ContactImport', handler: 'cancel' });
  const { ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{ pending_action_id: string }>();

    if (!body.pending_action_id) {
      return c.json({ error: 'pending_action_id is required' }, 400);
    }

    // Gate-3: owner_user_id 一致チェック（cancel でも情報漏洩防止）
    const result = await env.DB.prepare(`
      UPDATE pending_actions
      SET status = 'cancelled'
      WHERE id = ?
        AND owner_user_id = ?
        AND action_type = 'contact_import'
        AND status = 'pending'
    `).bind(body.pending_action_id, ownerUserId).run();

    const changed = (result.meta?.changes || 0) > 0;

    if (!changed) {
      log.warn('Cancel target not found or already processed', {
        pending_action_id: body.pending_action_id,
        owner_user_id: ownerUserId,
      });
      return c.json({ error: 'Not found' }, 404);
    }

    log.info('Import cancelled', { pending_action_id: body.pending_action_id });

    return c.json({ success: true, message: '取り込みをキャンセルしました。データは書き込まれていません。' });
  } catch (error) {
    log.error('Cancel failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'Cancel failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
