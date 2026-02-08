/**
 * Business Cards API Routes
 * 
 * MVP: 名刺写メ → 即登録 → 「名刺登録」リスト自動追加
 * PR-D-3: 名刺写メ → OCR抽出 → pending確認フロー（事故ゼロ設計）
 * 
 * Endpoints:
 *   POST /api/business-cards       — MVP: 即登録（従来フロー）
 *   POST /api/business-cards/scan  — PR-D-3: OCR → preview → pending
 *   GET  /api/business-cards/:id/image — 画像表示
 *   GET  /api/business-cards       — 一覧取得
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { BusinessCardsRepository } from '../repositories/businessCardsRepository';
import { ContactsRepository } from '../repositories/contactsRepository';
import { ListsRepository } from '../repositories/listsRepository';
import { getUserIdFromContext } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import { createLogger } from '../utils/logger';
import { GeminiService, type BusinessCardExtraction } from '../services/geminiService';
import {
  type ContactImportPayload,
  type ContactImportEntry,
  PENDING_CONFIRMATION_KIND,
} from '../../../../packages/shared/src/types/pendingAction';
import {
  detectAmbiguousMatches,
  buildSummary,
  IMPORT_EXPIRATION_MINUTES,
} from './contactImport';

const DEFAULT_WORKSPACE = 'ws-default';
const BUSINESS_CARD_LIST_NAME = '名刺登録';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES_PER_SCAN = 5;

type Variables = {
  userId?: string;
  userRole?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/business-cards/scan
 * 
 * PR-D-3: 名刺画像 → OCR抽出 → pending確認フロー
 * 事故ゼロ設計:
 *   - Gate-1: emailが取れない名刺は登録しない（Hard fail → missing_email_count++）
 *   - Gate-2: 曖昧一致は必ず pending.person.select で止める
 *   - Gate-3: owner_user_id一致（pending_action_idで絞る）
 *   - Gate-4: confirm以外は contacts書き込みゼロ
 * 
 * @body multipart/form-data
 *   - images: 名刺画像1枚以上（最大5枚）
 */
app.post('/scan', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'BusinessCards', handler: 'scan' });
  const { workspaceId, ownerUserId } = getTenant(c);

  try {
    // GEMINI_API_KEY チェック
    if (!env.GEMINI_API_KEY) {
      return c.json({ error: 'OCR service not configured (GEMINI_API_KEY missing)' }, 503);
    }

    const formData = await c.req.formData();

    // 画像収集（複数対応: images[] or image）
    const imageFiles: File[] = [];
    const allEntries = formData.getAll('images');
    for (const entry of allEntries) {
      if (typeof entry !== 'string' && entry !== null) imageFiles.push(entry as File);
    }
    // 単数フォールバック
    if (imageFiles.length === 0) {
      const single = formData.get('image');
      if (single && typeof single !== 'string') imageFiles.push(single as File);
    }

    if (imageFiles.length === 0) {
      return c.json({ error: 'At least one image is required (field: images or image)' }, 400);
    }

    if (imageFiles.length > MAX_IMAGES_PER_SCAN) {
      return c.json({ error: `Maximum ${MAX_IMAGES_PER_SCAN} images per scan` }, 400);
    }

    // バリデーション
    for (const file of imageFiles) {
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: `File ${file.name} exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }, 400);
      }
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return c.json({ error: `Invalid file type: ${file.type}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` }, 400);
      }
    }

    const gemini = new GeminiService(env.GEMINI_API_KEY);
    const allExtractions: BusinessCardExtraction[] = [];
    const r2Keys: string[] = [];
    const bcIds: string[] = [];

    // 各画像を処理
    for (const file of imageFiles) {
      // 1. R2にアップロード（audit用）
      const arrayBuffer = await file.arrayBuffer();
      const ext = file.name.split('.').pop() || 'jpg';
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const id = crypto.randomUUID();
      const r2ObjectKey = `business_cards/${workspaceId}/${ownerUserId}/${year}/${month}/${id}.${ext}`;

      await env.STORAGE.put(r2ObjectKey, arrayBuffer, {
        httpMetadata: { contentType: file.type },
      });
      r2Keys.push(r2ObjectKey);

      log.debug('Image uploaded to R2', { r2ObjectKey, size: file.size });

      // 2. Gemini Vision OCRで抽出
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      let extractions: BusinessCardExtraction[];
      try {
        extractions = await gemini.extractBusinessCard(base64, file.type);
      } catch (ocrError) {
        log.warn('OCR extraction failed for image', {
          filename: file.name,
          error: ocrError instanceof Error ? ocrError.message : String(ocrError),
        });
        // OCR失敗 → この画像はスキップ（全体は止めない）
        extractions = [];
      }

      // 3. business_cards レコード作成（extraction_status記録）
      const bcRepo = new BusinessCardsRepository(env.DB);
      const businessCard = await bcRepo.create({
        workspace_id: workspaceId,
        owner_user_id: ownerUserId,
        r2_object_key: r2ObjectKey,
        original_filename: file.name,
        mime_type: file.type,
        byte_size: file.size,
        occurred_at: now.toISOString(),
      });
      bcIds.push(businessCard.id);

      // extracted_json を更新
      await env.DB.prepare(
        `UPDATE business_cards SET extracted_json = ?, extraction_status = ? WHERE id = ?`
      ).bind(
        JSON.stringify(extractions),
        extractions.length > 0 ? 'done' : 'failed',
        businessCard.id
      ).run();

      allExtractions.push(...extractions);
    }

    if (allExtractions.length === 0) {
      return c.json({
        error: 'No contacts could be extracted from the images',
        business_card_ids: bcIds,
        message: '名刺から情報を読み取れませんでした。画像が鮮明か確認してください。',
      }, 422);
    }

    // 4. ContactImportEntry に変換
    const entries: ContactImportEntry[] = allExtractions.map((ext, idx) => {
      const hasEmail = !!ext.email && ext.email.includes('@');
      return {
        index: idx,
        name: ext.name,
        email: hasEmail ? ext.email!.toLowerCase() : undefined,
        phone: ext.phone || undefined,
        company: ext.company || undefined,
        title: ext.title || undefined,
        missing_email: !hasEmail,
        match_status: hasEmail ? 'new' as const : 'skipped' as const,
        resolved_action: hasEmail ? { type: 'create_new' as const } : { type: 'skip' as const },
        notes: [ext.company, ext.title].filter(Boolean).join(' / ') || undefined,
      };
    });

    // 5. 曖昧一致検出（既存contactImportロジック再利用）
    const contactsRepo = new ContactsRepository(env.DB);
    const enrichedEntries = await detectAmbiguousMatches(entries, contactsRepo, workspaceId, ownerUserId);

    // 6. unresolved計算
    const unresolvedCount = enrichedEntries.filter(
      e => e.match_status === 'ambiguous' && !e.resolved_action
    ).length;
    const allResolved = unresolvedCount === 0;
    const missingEmailCount = enrichedEntries.filter(e => e.missing_email).length;

    // 7. Payload/Summary
    const payload: ContactImportPayload = {
      source: 'business_card',
      raw_text: JSON.stringify(allExtractions), // OCR生データ保存
      parsed_entries: enrichedEntries,
      unresolved_count: unresolvedCount,
      all_ambiguous_resolved: allResolved,
      missing_email_count: missingEmailCount,
    };
    const summary = buildSummary(enrichedEntries, 'business_card');

    // 8. pending_action 作成
    const pendingId = crypto.randomUUID();
    const confirmToken = crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + IMPORT_EXPIRATION_MINUTES * 60 * 1000).toISOString();
    const nowStr = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO pending_actions
        (id, workspace_id, owner_user_id, thread_id,
         action_type, source_type,
         payload_json, summary_json,
         confirm_token, status, expires_at, created_at)
      VALUES (?, ?, ?, NULL,
              'contact_import', 'contacts',
              ?, ?,
              ?, 'pending', ?, ?)
    `).bind(
      pendingId,
      workspaceId,
      ownerUserId,
      JSON.stringify(payload),
      JSON.stringify(summary),
      confirmToken,
      expiresAt,
      nowStr
    ).run();

    const nextKind = allResolved
      ? PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM
      : PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT;

    log.info('Business card scan completed', {
      pending_action_id: pendingId,
      images_count: imageFiles.length,
      extractions_count: allExtractions.length,
      ambiguous: unresolvedCount,
      missing_email: missingEmailCount,
      business_card_ids: bcIds,
    });

    return c.json({
      pending_action_id: pendingId,
      expires_at: expiresAt,
      summary,
      parsed_entries: enrichedEntries,
      business_card_ids: bcIds,
      next_pending_kind: nextKind,
      message: allResolved
        ? missingEmailCount > 0
          ? `${enrichedEntries.length}件中${missingEmailCount}件はメール未取得のためスキップされます。残りの内容を確認して「はい」で確定してください。`
          : '名刺の内容を確認してください。「はい」で確定します。'
        : `${unresolvedCount}件の曖昧な一致があります。番号を選択してください。`,
    }, 201);
  } catch (error) {
    log.error('Business card scan failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'Business card scan failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * POST /api/business-cards
 * 
 * 名刺アップロード → 即登録（MVP最短フロー）
 * 1. 画像をR2に保存
 * 2. Contactsに登録（最小情報）
 * 3. business_cards レコード作成
 * 4. contact_touchpoints作成
 * 5. 「名刺登録」リストに追加
 * 
 * @body multipart/form-data
 *   - file: 名刺画像 (required)
 *   - display_name: 表示名 (optional)
 *   - email: メールアドレス (optional)
 *   - relationship_type: 関係性 (optional, default: external)
 *   - tags: タグ (optional, CSV or JSON string)
 *   - occurred_at: 会った日時 (optional, default: now)
 */
app.post('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'BusinessCards', handler: 'upload' });
  const userId = await getUserIdFromContext(c as any);

  try {
    // Parse multipart form
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'Missing required field: file' }, 400);
    }

    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }, 400);
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return c.json({ error: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` }, 400);
    }

    // Parse optional fields
    const displayName = formData.get('display_name') as string | null;
    const email = formData.get('email') as string | null;
    const relationshipType = (formData.get('relationship_type') as string) || 'external';
    const tagsRaw = formData.get('tags') as string | null;
    const occurredAtRaw = formData.get('occurred_at') as string | null;

    // Parse tags
    let tags: string[] = [];
    if (tagsRaw) {
      try {
        tags = JSON.parse(tagsRaw);
      } catch {
        // Try CSV parsing
        tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }

    // occurred_at: user input or now
    const occurredAt = occurredAtRaw || new Date().toISOString();

    // Generate R2 object key
    const ext = file.name.split('.').pop() || 'jpg';
    const date = new Date(occurredAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const id = crypto.randomUUID();
    const r2ObjectKey = `business_cards/${DEFAULT_WORKSPACE}/${userId}/${year}/${month}/${id}.${ext}`;

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await env.STORAGE.put(r2ObjectKey, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    });

    log.debug('Uploaded to R2', { r2ObjectKey });

    // Create or get contact
    const contactsRepo = new ContactsRepository(env.DB);
    let contact;

    const finalDisplayName = displayName || `名刺_${date.toISOString().slice(0, 16).replace('T', '_')}`;

    try {
      contact = await contactsRepo.create({
        workspace_id: DEFAULT_WORKSPACE,
        owner_user_id: userId,
        kind: 'external_person',
        email: email || undefined,
        display_name: finalDisplayName,
        relationship_type: relationshipType as any,
        tags,
        notes: `名刺登録: ${occurredAt}`,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        // Contact already exists (by email), get it
        const existing = await env.DB
          .prepare(
            `SELECT * FROM contacts 
             WHERE workspace_id = ? AND owner_user_id = ? AND email = ?`
          )
          .bind(DEFAULT_WORKSPACE, userId, email)
          .first();

        if (existing) {
          contact = existing as any;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    log.debug('Contact created/found', { contactId: contact.id });

    // Create business_cards record
    const bcRepo = new BusinessCardsRepository(env.DB);
    const businessCard = await bcRepo.create({
      workspace_id: DEFAULT_WORKSPACE,
      owner_user_id: userId,
      contact_id: contact.id,
      r2_object_key: r2ObjectKey,
      original_filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
      occurred_at: occurredAt,
    });

    log.debug('Business card created', { businessCardId: businessCard.id });

    // Create touchpoint
    await bcRepo.createTouchpoint({
      workspace_id: DEFAULT_WORKSPACE,
      owner_user_id: userId,
      contact_id: contact.id,
      occurred_at: occurredAt,
      channel: 'business_card',
      note: '名刺登録',
      metadata_json: JSON.stringify({
        business_card_id: businessCard.id,
        original_filename: file.name,
      }),
    });

    log.debug('Touchpoint created');

    // Get or create "名刺登録" list
    const listsRepo = new ListsRepository(env.DB);
    let list;

    const existingLists = await listsRepo.getAll(DEFAULT_WORKSPACE, userId, 100, 0);
    list = existingLists.lists.find((l: any) => l.name === BUSINESS_CARD_LIST_NAME);

    if (!list) {
      list = await listsRepo.create({
        workspace_id: DEFAULT_WORKSPACE,
        owner_user_id: userId,
        name: BUSINESS_CARD_LIST_NAME,
        description: '名刺登録で自動追加されたコンタクト',
      });
      log.debug('Created 名刺登録 list', { listId: list.id });
    }

    // Add to list (ignore if already exists)
    try {
      await listsRepo.addMember(list.id, contact.id, DEFAULT_WORKSPACE);
      log.debug('Added to 名刺登録 list');
    } catch (error) {
      if (error instanceof Error && error.message.includes('already a member')) {
        log.debug('Contact already in list');
      } else {
        throw error;
      }
    }

    // Generate signed URL for image preview (24 hours)
    const imageUrl = await env.STORAGE.get(r2ObjectKey);
    const signedUrl = imageUrl
      ? `https://webapp.snsrilarc.workers.dev/api/business-cards/${businessCard.id}/image`
      : null;

    return c.json({
      business_card: {
        id: businessCard.id,
        occurred_at: businessCard.occurred_at,
        image_url: signedUrl,
        created_at: businessCard.created_at,
      },
      contact: {
        id: contact.id,
        display_name: contact.display_name,
        email: contact.email,
        relationship_type: contact.relationship_type,
        tags: JSON.parse(contact.tags_json),
        invitee_key: await ContactsRepository.generateInviteeKey(contact as any),
      },
      list: {
        id: list.id,
        name: list.name,
      },
    });
  } catch (error) {
    log.error('Upload error', error);
    return c.json(
      {
        error: 'Failed to upload business card',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/business-cards/:id/image
 * 
 * 名刺画像を返す（R2からストリーム）
 */
app.get('/:id/image', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'BusinessCards', handler: 'getImage' });
  const userId = await getUserIdFromContext(c as any);
  const id = c.req.param('id');

  try {
    const bcRepo = new BusinessCardsRepository(env.DB);
    const businessCard = await bcRepo.getById(id, DEFAULT_WORKSPACE, userId);

    if (!businessCard) {
      return c.json({ error: 'Business card not found' }, 404);
    }

    const object = await env.STORAGE.get(businessCard.r2_object_key);

    if (!object) {
      return c.json({ error: 'Image not found in storage' }, 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': businessCard.mime_type,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    log.error('Get image error', error);
    return c.json({ error: 'Failed to get image' }, 500);
  }
});

/**
 * GET /api/business-cards
 * 
 * 名刺一覧取得
 */
app.get('/', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'BusinessCards', handler: 'list' });
  const userId = await getUserIdFromContext(c as any);

  try {
    const query = c.req.query();
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const bcRepo = new BusinessCardsRepository(env.DB);
    const result = await bcRepo.listByOwner(DEFAULT_WORKSPACE, userId, limit, offset);

    return c.json({
      cards: result.cards.map((card) => ({
        ...card,
        image_url: `/api/business-cards/${card.id}/image`,
      })),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    log.error('List error', error);
    return c.json({ error: 'Failed to list business cards' }, 500);
  }
});

export default app;
