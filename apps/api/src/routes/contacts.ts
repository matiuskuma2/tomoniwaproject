/**
 * Contacts API Routes
 * 
 * 予定調整ツールの台帳管理API
 * - POST /api/contacts: 台帳に登録
 * - POST /api/contacts/import: テキスト取り込み (PR-D-1)
 * - POST /api/contacts/import/confirm: 取り込み確定 (PR-D-1)
 * - GET /api/contacts: 検索（名前/メール/タグ）
 * - GET /api/contacts/:id: 詳細取得
 * - PATCH /api/contacts/:id: 更新
 * - DELETE /api/contacts/:id: 削除
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { getTenant, ensureOwnedOr404 } from '../utils/workspaceContext';
import {
  ContactsRepository,
  type ContactKind,
  type RelationshipType,
  type CreateContactInput,
  type UpdateContactInput,
} from '../repositories/contactsRepository';
import { createLogger } from '../utils/logger';

// =============================================================================
// PR-D-1: テキスト取り込みのための型定義・ユーティリティ
// =============================================================================

/**
 * 取り込み候補1件の型
 */
interface ImportCandidate {
  /** パース元の行 */
  raw_line: string;
  /** 名前（抽出成功時） */
  display_name: string | null;
  /** メールアドレス（抽出成功時） */
  email: string | null;
  /** パースステータス */
  status: 'ok' | 'missing_email' | 'invalid_email' | 'parse_error';
  /** パースエラーメッセージ */
  error_message?: string;
}

/**
 * 曖昧一致候補
 */
interface AmbiguousMatch {
  /** 取り込み行のインデックス */
  candidate_index: number;
  /** 候補名 */
  candidate_name: string | null;
  /** 候補メール */
  candidate_email: string | null;
  /** 既存の連絡先 */
  existing_contacts: Array<{
    id: string;
    display_name: string | null;
    email: string | null;
  }>;
  /** 曖昧一致の理由 */
  reason: 'same_name' | 'similar_name' | 'email_exists';
}

/**
 * テキスト取り込みの解析結果
 */
interface ImportParseResult {
  /** 解析成功した候補 */
  candidates: ImportCandidate[];
  /** 曖昧一致（要確認） */
  ambiguous_matches: AmbiguousMatch[];
  /** 合計行数 */
  total_lines: number;
  /** 有効行数 */
  valid_count: number;
  /** メール欠落行数 */
  missing_email_count: number;
  /** 無効メール行数 */
  invalid_email_count: number;
}

/**
 * メールアドレスの正規表現（RFC 5322に基づく簡易版）
 */
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * テキストから名前とメールを抽出
 * 
 * サポートフォーマット:
 * 1. "名前 メール" (スペース区切り)
 * 2. "名前<メール>" (カッコ区切り)
 * 3. "名前 <メール>" (スペース+カッコ)
 * 4. "メール" (メールのみ)
 * 5. "名前,メール" (カンマ区切り)
 * 6. "名前\tメール" (タブ区切り)
 */
function parseContactLine(line: string): { name: string | null; email: string | null } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { name: null, email: null };
  }

  // パターン1: "名前 <メール>" または "名前<メール>"
  const bracketMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (bracketMatch) {
    return { name: bracketMatch[1].trim(), email: bracketMatch[2].trim().toLowerCase() };
  }

  // パターン2: カンマ区切り "名前,メール"
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const emailPart = parts.find(p => EMAIL_REGEX.test(p));
      const namePart = parts.find(p => !EMAIL_REGEX.test(p));
      if (emailPart) {
        return { name: namePart || null, email: emailPart.toLowerCase() };
      }
    }
  }

  // パターン3: タブ区切り "名前\tメール"
  if (trimmed.includes('\t')) {
    const parts = trimmed.split('\t').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const emailPart = parts.find(p => EMAIL_REGEX.test(p));
      const namePart = parts.find(p => !EMAIL_REGEX.test(p));
      if (emailPart) {
        return { name: namePart || null, email: emailPart.toLowerCase() };
      }
    }
  }

  // パターン4: スペース区切り "名前 メール" または "メールのみ"
  const parts = trimmed.split(/\s+/);
  
  // メールのみの場合
  if (parts.length === 1) {
    if (EMAIL_REGEX.test(parts[0])) {
      return { name: null, email: parts[0].toLowerCase() };
    }
    // 名前のみの場合（メールなし）
    return { name: parts[0], email: null };
  }

  // 複数パーツの場合、メールを探す
  const emailPart = parts.find(p => EMAIL_REGEX.test(p));
  if (emailPart) {
    const nameParts = parts.filter(p => !EMAIL_REGEX.test(p));
    return { 
      name: nameParts.length > 0 ? nameParts.join(' ') : null, 
      email: emailPart.toLowerCase() 
    };
  }

  // メールが見つからない場合、全体を名前として扱う
  return { name: trimmed, email: null };
}

/**
 * 名前の類似度判定（簡易Levenshtein）
 * 閾値: 2文字以内の編集距離なら類似と判定
 */
function isSimilarName(name1: string | null, name2: string | null): boolean {
  if (!name1 || !name2) return false;
  
  const n1 = name1.toLowerCase().replace(/\s+/g, '');
  const n2 = name2.toLowerCase().replace(/\s+/g, '');
  
  // 完全一致
  if (n1 === n2) return true;
  
  // 片方が片方を含む（部分一致）
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // 編集距離が2以下
  const distance = levenshteinDistance(n1, n2);
  const threshold = Math.min(2, Math.floor(Math.max(n1.length, n2.length) * 0.3));
  
  return distance <= threshold;
}

/**
 * Levenshtein距離の計算
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  
  if (m === 0) return n;
  if (n === 0) return m;
  
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 削除
        dp[i][j - 1] + 1,      // 挿入
        dp[i - 1][j - 1] + cost // 置換
      );
    }
  }
  
  return dp[m][n];
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/contacts
 * Create a new contact
 */
app.post('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'create' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{
      kind: ContactKind;
      user_id?: string;
      email?: string;
      display_name?: string;
      relationship_type?: RelationshipType;
      tags?: string[];
      notes?: string;
      summary?: string;
    }>();

    // Validation
    if (!body.kind) {
      return c.json({ error: 'kind is required' }, 400);
    }

    if (body.kind === 'internal_user' && !body.user_id) {
      return c.json({ error: 'user_id is required for internal_user' }, 400);
    }

    if ((body.kind === 'external_person' || body.kind === 'list_member') && !body.email) {
      return c.json({ error: 'email is required for external contacts' }, 400);
    }

    const repo = new ContactsRepository(env.DB);

    // Check duplicate (with tenant isolation)
    if (body.kind === 'internal_user' && body.user_id) {
      const existing = await repo.getByUserId(body.user_id, workspaceId, ownerUserId);
      if (existing) {
        return c.json({ error: 'Contact already exists for this user' }, 409);
      }
    }

    if ((body.kind === 'external_person' || body.kind === 'list_member') && body.email) {
      const existing = await repo.getByEmail(body.email, workspaceId, ownerUserId);
      if (existing) {
        return c.json({ error: 'Contact already exists for this email' }, 409);
      }
    }

    const input: CreateContactInput = {
      workspace_id: workspaceId,  // P0-1: Use tenant context
      owner_user_id: ownerUserId,  // P0-1: Use tenant context
      kind: body.kind,
      user_id: body.user_id,
      email: body.email,
      display_name: body.display_name,
      relationship_type: body.relationship_type,
      tags: body.tags,
      notes: body.notes,
      summary: body.summary,
    };

    const contact = await repo.create(input);

    // Generate invitee_key for response
    const invitee_key = await ContactsRepository.generateInviteeKey(contact);

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key,
      },
    }, 201);
  } catch (error) {
    log.error('Error creating contact', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to create contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/contacts
 * Search contacts
 */
app.get('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'search' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const query = c.req.query();
    const repo = new ContactsRepository(env.DB);

    const result = await repo.search({
      workspace_id: workspaceId,
      owner_user_id: ownerUserId,
      q: query.q,
      kind: query.kind as ContactKind | undefined,
      relationship_type: query.relationship_type as RelationshipType | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });

    // Parse tags_json and add invitee_key
    const contacts = await Promise.all(
      result.contacts.map(async (contact) => ({
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      }))
    );

    return c.json({
      contacts,
      total: result.total,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    });
  } catch (error) {
    log.error('Error searching contacts', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to search contacts',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/contacts/:id
 * Get contact by ID
 */
app.get('/:id', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'get' });
  const userId = c.get('userId');

  if (!userId) {

    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const contactId = c.req.param('id');
    const repo = new ContactsRepository(env.DB);

    const contact = await repo.getById(contactId, workspaceId, ownerUserId);

    if (!contact) {
      return c.json({ error: 'Contact not found' }, 404);
    }

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      },
    });
  } catch (error) {
    log.error('Error getting contact', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to get contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PATCH /api/contacts/:id
 * Update contact
 */
app.patch('/:id', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'update' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const contactId = c.req.param('id');
    const body = await c.req.json<UpdateContactInput>();

    const repo = new ContactsRepository(env.DB);

    const contact = await repo.update(contactId, workspaceId, ownerUserId, body);

    return c.json({
      contact: {
        ...contact,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact),
      },
    });
  } catch (error) {
    log.error('Error updating contact', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to update contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/contacts/upsert
 * P2-E2: Upsert contact by email (for SMS phone number)
 * - If exists: update phone
 * - If not: create external_person with phone
 */
app.post('/upsert', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'upsert' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{
      email: string;
      phone: string;
      display_name?: string;
    }>();

    // Validation
    if (!body.email) {
      return c.json({ error: 'email is required' }, 400);
    }
    if (!body.phone) {
      return c.json({ error: 'phone is required' }, 400);
    }

    // E.164 format validation (basic)
    if (!body.phone.match(/^\+[1-9]\d{9,14}$/)) {
      return c.json({ error: 'phone must be in E.164 format (e.g., +819012345678)' }, 400);
    }

    const repo = new ContactsRepository(env.DB);
    const contact = await repo.upsertByEmail(
      workspaceId,
      ownerUserId,
      body.email,
      body.phone,
      body.display_name
    );

    log.debug('Upserted phone', { email: body.email, workspaceId });

    return c.json({
      success: true,
      contact: {
        id: contact.id,
        email: contact.email,
        phone: (contact as any).phone,
        display_name: contact.display_name,
      },
    });
  } catch (error) {
    log.error('Error upserting contact', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to upsert contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// =============================================================================
// PR-D-1: テキスト取り込みエンドポイント
// =============================================================================

/**
 * POST /api/contacts/import
 * 
 * テキストから連絡先を一括解析（プレビュー）
 * 
 * 事故ゼロ設計:
 * - メール必須 (Hard fail): メールがない行はスキップ
 * - 同姓同名・曖昧一致はpendingで停止
 * - 確認フローで明示的な承認を求める
 * 
 * Request:
 * {
 *   "text": "田中太郎 tanaka@example.com\n佐藤花子 sato@example.com",
 *   "source": "text" | "email" | "csv"
 * }
 * 
 * Response:
 * {
 *   "preview": {
 *     "candidates": [...],
 *     "ambiguous_matches": [...],
 *     "total_lines": 2,
 *     "valid_count": 2,
 *     "missing_email_count": 0
 *   },
 *   "requires_confirmation": true,
 *   "confirmation_token": "xxx" // 確認時に使用
 * }
 */
app.post('/import', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'import' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{
      text: string;
      source?: 'text' | 'email' | 'csv';
    }>();

    if (!body.text || typeof body.text !== 'string') {
      return c.json({ error: 'text is required' }, 400);
    }

    const source = body.source || 'text';
    const lines = body.text.split(/[\r\n]+/).filter(line => line.trim());

    if (lines.length === 0) {
      return c.json({ error: 'No valid lines found in input' }, 400);
    }

    if (lines.length > 100) {
      return c.json({ 
        error: 'Too many lines', 
        details: '一度に取り込める最大件数は100件です' 
      }, 400);
    }

    const repo = new ContactsRepository(env.DB);
    
    // 解析結果
    const candidates: ImportCandidate[] = [];
    const ambiguousMatches: AmbiguousMatch[] = [];
    let validCount = 0;
    let missingEmailCount = 0;
    let invalidEmailCount = 0;

    // 各行を解析
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { name, email } = parseContactLine(line);

      // メール必須チェック (Hard fail)
      if (!email) {
        candidates.push({
          raw_line: line,
          display_name: name,
          email: null,
          status: 'missing_email',
          error_message: 'メールアドレスが必要です',
        });
        missingEmailCount++;
        continue;
      }

      // メール形式チェック
      if (!EMAIL_REGEX.test(email)) {
        candidates.push({
          raw_line: line,
          display_name: name,
          email: email,
          status: 'invalid_email',
          error_message: 'メールアドレスの形式が正しくありません',
        });
        invalidEmailCount++;
        continue;
      }

      // 既存の連絡先との重複チェック
      const existingByEmail = await repo.getByEmail(email, workspaceId, ownerUserId);
      
      if (existingByEmail) {
        // メールが既に存在 → 曖昧一致として報告
        ambiguousMatches.push({
          candidate_index: i,
          candidate_name: name,
          candidate_email: email,
          existing_contacts: [{
            id: existingByEmail.id,
            display_name: existingByEmail.display_name,
            email: existingByEmail.email,
          }],
          reason: 'email_exists',
        });
        candidates.push({
          raw_line: line,
          display_name: name,
          email: email,
          status: 'ok', // パースは成功
        });
        validCount++;
        continue;
      }

      // 同姓同名・類似名チェック（名前がある場合のみ）
      if (name) {
        const searchResult = await repo.search({
          workspace_id: workspaceId,
          owner_user_id: ownerUserId,
          q: name,
          limit: 10,
        });

        const similarContacts = searchResult.contacts.filter(contact => 
          isSimilarName(contact.display_name, name)
        );

        if (similarContacts.length > 0) {
          ambiguousMatches.push({
            candidate_index: i,
            candidate_name: name,
            candidate_email: email,
            existing_contacts: similarContacts.map(c => ({
              id: c.id,
              display_name: c.display_name,
              email: c.email,
            })),
            reason: similarContacts.some(c => c.display_name?.toLowerCase() === name.toLowerCase()) 
              ? 'same_name' 
              : 'similar_name',
          });
        }
      }

      candidates.push({
        raw_line: line,
        display_name: name,
        email: email,
        status: 'ok',
      });
      validCount++;
    }

    // 確認トークンの生成（24時間有効）
    const confirmationToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // 確認トークンをDBに保存（後で確認時に使用）
    try {
      await env.DB.prepare(`
        INSERT INTO contact_import_tokens (id, workspace_id, owner_user_id, candidates_json, source, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        confirmationToken,
        workspaceId,
        ownerUserId,
        JSON.stringify(candidates.filter(c => c.status === 'ok')),
        source,
        expiresAt,
        new Date().toISOString()
      ).run();
    } catch (e) {
      // テーブルが存在しない場合は警告を出して続行
      log.warn('contact_import_tokens table may not exist', { error: e });
    }

    const preview: ImportParseResult = {
      candidates,
      ambiguous_matches: ambiguousMatches,
      total_lines: lines.length,
      valid_count: validCount,
      missing_email_count: missingEmailCount,
      invalid_email_count: invalidEmailCount,
    };

    const requiresConfirmation = ambiguousMatches.length > 0 || validCount > 0;

    log.debug('Import preview generated', {
      total: lines.length,
      valid: validCount,
      ambiguous: ambiguousMatches.length,
      missing_email: missingEmailCount,
    });

    return c.json({
      preview,
      requires_confirmation: requiresConfirmation,
      confirmation_token: confirmationToken,
      message: ambiguousMatches.length > 0
        ? `${ambiguousMatches.length}件の曖昧な一致があります。確認してください。`
        : validCount > 0
          ? `${validCount}件の連絡先を登録できます。確認してください。`
          : 'メールアドレス付きの有効な連絡先がありません。',
    });
  } catch (error) {
    log.error('Error parsing import text', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to parse import text',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/contacts/import/confirm
 * 
 * 取り込みの確定実行
 * 
 * Request:
 * {
 *   "confirmation_token": "xxx",
 *   "skip_ambiguous": false,        // 曖昧一致をスキップするか
 *   "selected_indices": [0, 1, 2],  // 選択した候補のインデックス（オプション）
 *   "ambiguous_actions": [          // 曖昧一致の処理方法
 *     { "candidate_index": 0, "action": "create_new" | "skip" | "update_existing", "existing_id": "xxx" }
 *   ]
 * }
 * 
 * Response:
 * {
 *   "created": [...],
 *   "skipped": [...],
 *   "updated": [...],
 *   "errors": [...]
 * }
 */
app.post('/import/confirm', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'importConfirm' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const body = await c.req.json<{
      confirmation_token: string;
      skip_ambiguous?: boolean;
      selected_indices?: number[];
      ambiguous_actions?: Array<{
        candidate_index: number;
        action: 'create_new' | 'skip' | 'update_existing';
        existing_id?: string;
      }>;
    }>();

    if (!body.confirmation_token) {
      return c.json({ error: 'confirmation_token is required' }, 400);
    }

    // トークンの取得と検証
    let tokenData: { candidates_json: string; source: string; expires_at: string } | null = null;
    
    try {
      tokenData = await env.DB.prepare(`
        SELECT candidates_json, source, expires_at
        FROM contact_import_tokens
        WHERE id = ? AND workspace_id = ? AND owner_user_id = ?
      `).bind(body.confirmation_token, workspaceId, ownerUserId).first();
    } catch (e) {
      log.warn('contact_import_tokens table may not exist', { error: e });
    }

    if (!tokenData) {
      return c.json({ error: 'Invalid or expired confirmation token' }, 400);
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      return c.json({ error: 'Confirmation token has expired' }, 400);
    }

    const candidates: ImportCandidate[] = JSON.parse(tokenData.candidates_json);
    const repo = new ContactsRepository(env.DB);

    const created: Array<{ id: string; display_name: string | null; email: string | null }> = [];
    const skipped: Array<{ raw_line: string; reason: string }> = [];
    const updated: Array<{ id: string; display_name: string | null; email: string | null }> = [];
    const errors: Array<{ raw_line: string; error: string }> = [];

    // 曖昧一致アクションのマップ
    const ambiguousActionsMap = new Map(
      (body.ambiguous_actions || []).map(a => [a.candidate_index, a])
    );

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // 選択されたインデックスのみ処理（指定されている場合）
      if (body.selected_indices && !body.selected_indices.includes(i)) {
        skipped.push({ raw_line: candidate.raw_line, reason: 'not_selected' });
        continue;
      }

      // 曖昧一致の処理
      const ambiguousAction = ambiguousActionsMap.get(i);
      if (ambiguousAction) {
        if (ambiguousAction.action === 'skip') {
          skipped.push({ raw_line: candidate.raw_line, reason: 'ambiguous_skipped' });
          continue;
        }
        if (ambiguousAction.action === 'update_existing' && ambiguousAction.existing_id) {
          // 既存の連絡先を更新
          try {
            const updatedContact = await repo.update(
              ambiguousAction.existing_id,
              workspaceId,
              ownerUserId,
              { display_name: candidate.display_name }
            );
            updated.push({
              id: updatedContact.id,
              display_name: updatedContact.display_name,
              email: updatedContact.email,
            });
          } catch (e) {
            errors.push({ raw_line: candidate.raw_line, error: String(e) });
          }
          continue;
        }
        // create_new: 新規作成（下記の通常フローへ）
      }

      // メールの重複チェック
      if (candidate.email) {
        const existingByEmail = await repo.getByEmail(candidate.email, workspaceId, ownerUserId);
        if (existingByEmail && !ambiguousAction) {
          // 曖昧一致の指示がない場合、スキップ
          if (body.skip_ambiguous) {
            skipped.push({ raw_line: candidate.raw_line, reason: 'email_exists' });
            continue;
          }
          // skip_ambiguousがfalseの場合、エラー
          errors.push({ 
            raw_line: candidate.raw_line, 
            error: `このメールアドレスは既に登録されています: ${existingByEmail.display_name || existingByEmail.email}` 
          });
          continue;
        }
      }

      // 新規登録
      try {
        const newContact = await repo.create({
          workspace_id: workspaceId,
          owner_user_id: ownerUserId,
          kind: 'external_person',
          email: candidate.email,
          display_name: candidate.display_name,
          relationship_type: 'external',
          notes: `チャット取り込み (${tokenData.source}): ${new Date().toISOString()}`,
        });
        created.push({
          id: newContact.id,
          display_name: newContact.display_name,
          email: newContact.email,
        });
      } catch (e) {
        errors.push({ raw_line: candidate.raw_line, error: String(e) });
      }
    }

    // 使用済みトークンを削除
    try {
      await env.DB.prepare(`
        DELETE FROM contact_import_tokens WHERE id = ?
      `).bind(body.confirmation_token).run();
    } catch (e) {
      log.warn('Failed to delete used token', { error: e });
    }

    log.debug('Import confirmed', {
      created: created.length,
      skipped: skipped.length,
      updated: updated.length,
      errors: errors.length,
    });

    return c.json({
      created,
      skipped,
      updated,
      errors,
      summary: {
        total_processed: candidates.length,
        created_count: created.length,
        skipped_count: skipped.length,
        updated_count: updated.length,
        error_count: errors.length,
      },
    });
  } catch (error) {
    log.error('Error confirming import', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to confirm import',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * DELETE /api/contacts/:id
 * Delete contact
 */
app.delete('/:id', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Contacts', handler: 'delete' });
  const userId = c.get('userId');

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // P0-1: Get tenant context
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    const contactId = c.req.param('id');
    const repo = new ContactsRepository(env.DB);

    await repo.delete(contactId, workspaceId, ownerUserId);

    return c.json({ success: true });
  } catch (error) {
    log.error('Error deleting contact', { error: error instanceof Error ? error.message : String(error) });
    return c.json(
      {
        error: 'Failed to delete contact',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
