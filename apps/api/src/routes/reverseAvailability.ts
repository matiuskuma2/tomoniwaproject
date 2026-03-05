/**
 * PR-B6: Reverse Availability Routes (逆アベイラビリティ / ご都合伺い)
 *
 * 目上の相手に候補日時を出してもらい、主催者が合わせるフロー。
 * Phase 1: 手動候補選択（ゲストOAuthなし）
 *
 * Protected (requireAuth):
 *   POST /api/reverse-availability/prepare   - RA作成 + メール送信
 *   POST /api/reverse-availability/:id/finalize - 主催者が候補を選んで確定
 *
 * Public (no auth):
 *   GET  /ra/:token              - ゲスト向け時間枠選択ページ
 *   POST /ra/:token/respond      - ゲストが候補送信
 *   GET  /ra/:token/thank-you    - サンキューページ
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';
import { requireAuth, type Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import { EmailQueueService } from '../services/emailQueue';
import { GoogleCalendarService } from '../services/googleCalendar';

// ============================================================
// Types
// ============================================================

interface ReverseAvailabilityRow {
  id: string;
  thread_id: string;
  token: string;
  workspace_id: string;
  requester_user_id: string;
  target_email: string;
  target_name: string | null;
  time_min: string;
  time_max: string;
  duration_minutes: number;
  preferred_slots_count: number;
  slot_interval_minutes: number;
  title: string;
  status: string;
  responded_at: string | null;
  finalized_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface ReverseAvailabilityResponseRow {
  id: string;
  reverse_availability_id: string;
  slot_start: string;
  slot_end: string;
  label: string | null;
  rank: number | null;
  created_at: string;
}

interface PrepareRequest {
  target: {
    name?: string;
    email: string;
  };
  title?: string;
  duration_minutes?: number;
  time_range?: {
    time_min?: string;
    time_max?: string;
  };
  preferred_slots_count?: number;
  send_email?: boolean;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * トークン生成（32文字のランダム文字列）
 */
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 32; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

/**
 * 翌営業日の09:00 (JST) を取得
 */
function getNextBusinessDay09(): Date {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now.getTime() + jstOffset);

  const result = new Date(jstNow);
  result.setUTCDate(result.getUTCDate() + 1);
  result.setUTCHours(0, 0, 0, 0); // 09:00 JST = 00:00 UTC

  let dayOfWeek = result.getUTCDay();
  while (dayOfWeek === 0 || dayOfWeek === 6) {
    result.setUTCDate(result.getUTCDate() + 1);
    dayOfWeek = result.getUTCDay();
  }

  return result;
}

/**
 * N週間後の日時を取得
 */
function getDateAfterWeeks(weeks: number): Date {
  return new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);
}

/**
 * 日本語日時フォーマット
 */
function formatDateTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}（${weekday}）${hours}:${minutes}`;
}

/**
 * 日付のみフォーマット
 */
function formatDateJP(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}（${weekday}）`;
}

/**
 * 時刻のみフォーマット
 */
function formatTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * invitee_key 生成（メールベース）
 */
async function generateInviteeKey(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `e:${hashHex.substring(0, 16)}`;
}

/**
 * Googleカレンダー追加用URL生成
 */
function generateGoogleCalendarUrl(params: {
  title: string;
  startAt: string;
  endAt: string;
  description?: string;
}): string {
  const start = new Date(params.startAt).toISOString().replace(/[-:]/g, '').replace('.000', '');
  const end = new Date(params.endAt).toISOString().replace(/[-:]/g, '').replace('.000', '');

  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title);
  url.searchParams.set('dates', `${start}/${end}`);
  if (params.description) {
    url.searchParams.set('details', params.description);
  }

  return url.toString();
}

// ============================================================
// HTML helpers (reused from openSlots pattern)
// ============================================================

function getHtmlHead(title: string): string {
  return `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Noto Sans JP', sans-serif; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in { animation: fadeIn 0.4s ease-out; }
        .slot-btn {
          transition: all 0.2s ease;
        }
        .slot-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }
        .slot-btn.selected {
          background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
          color: white;
          border-color: #7C3AED;
        }
        .slot-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      </style>
    </head>
  `;
}

function renderErrorPage(title: string, message: string): string {
  return `
    ${getHtmlHead(title)}
    <body class="bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center fade-in">
        <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <h1 class="text-xl font-bold text-gray-800 mb-2">${title}</h1>
        <p class="text-gray-600">${message}</p>
      </div>
    </body>
    </html>
  `;
}

// ============================================================
// Protected API Routes (used with /api/reverse-availability prefix)
// ============================================================

const protectedApp = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /api/reverse-availability/prepare
 *
 * 主催者（目下）がチャットから起動。
 * - scheduling_thread 作成 (kind='external', topology='one_on_one')
 * - reverse_availability レコード作成
 * - thread_invites 作成
 * - メール送信（オプション）
 */
protectedApp.post('/prepare', requireAuth, async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'ReverseAvailability', handler: 'prepare', requestId });

  try {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }

    const { workspaceId, ownerUserId } = getTenant(c);

    const body = await c.req.json<PrepareRequest>();
    const {
      target,
      title = '打ち合わせ',
      duration_minutes = 60,
      time_range,
      preferred_slots_count = 3,
      send_email = true,
    } = body;

    // --- Validation ---
    if (!target?.email) {
      return c.json({
        error: 'validation_error',
        details: 'target.email is required',
        request_id: requestId,
      }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(target.email)) {
      return c.json({
        error: 'validation_error',
        details: 'target.email is not a valid email address',
        request_id: requestId,
      }, 400);
    }

    if (duration_minutes < 15 || duration_minutes > 480) {
      return c.json({
        error: 'validation_error',
        details: 'duration_minutes must be between 15 and 480',
        request_id: requestId,
      }, 400);
    }

    if (preferred_slots_count < 1 || preferred_slots_count > 10) {
      return c.json({
        error: 'validation_error',
        details: 'preferred_slots_count must be between 1 and 10',
        request_id: requestId,
      }, 400);
    }

    // --- Compute time range ---
    const timeMin = time_range?.time_min
      ? new Date(time_range.time_min).toISOString()
      : getNextBusinessDay09().toISOString();

    const timeMax = time_range?.time_max
      ? new Date(time_range.time_max).toISOString()
      : getDateAfterWeeks(2).toISOString();

    if (new Date(timeMax) <= new Date(timeMin)) {
      return c.json({
        error: 'validation_error',
        details: 'time_range.time_max must be after time_range.time_min',
        request_id: requestId,
      }, 400);
    }

    log.debug('Creating reverse availability', {
      targetEmail: target.email,
      targetName: target.name,
      title,
      duration_minutes,
      timeMin,
      timeMax,
      preferred_slots_count,
    });

    // --- DB writes ---
    const threadId = uuidv4();
    const raId = uuidv4();
    const inviteId = uuidv4();
    const token = generateToken();
    const inviteeKey = await generateInviteeKey(target.email);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    // 1. scheduling_threads 作成
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description,
        status, mode, kind, topology,
        proposal_version, additional_propose_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'sent', 'one_on_one', 'external', 'one_on_one', 1, 0, ?, ?)
    `).bind(
      threadId,
      workspaceId,
      ownerUserId,
      title,
      `逆アベイラビリティ: ${target.name || target.email} にご都合伺い`,
      now,
      now,
    ).run();

    // 2. reverse_availability 作成
    await env.DB.prepare(`
      INSERT INTO reverse_availability (
        id, thread_id, token, workspace_id,
        requester_user_id, target_email, target_name,
        time_min, time_max, duration_minutes,
        preferred_slots_count, slot_interval_minutes,
        title, status, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(
      raId,
      threadId,
      token,
      workspaceId,
      ownerUserId,
      target.email,
      target.name || null,
      timeMin,
      timeMax,
      duration_minutes,
      preferred_slots_count,
      60, // slot_interval_minutes default
      title,
      expiresAt,
      now,
      now,
    ).run();

    // 3. thread_invites 作成
    await env.DB.prepare(`
      INSERT INTO thread_invites (
        id, thread_id, token, email, candidate_name,
        candidate_reason, invitee_key, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      inviteId,
      threadId,
      token,
      target.email,
      target.name || null,
      `逆アベイラビリティ: ご都合伺い`,
      inviteeKey,
      expiresAt,
      now,
    ).run();

    log.debug('Reverse availability created', { threadId, raId, token });

    // --- メール送信 ---
    let emailQueued = false;
    if (send_email) {
      try {
        const organizer = await env.DB.prepare(
          `SELECT display_name, email FROM users WHERE id = ?`
        ).bind(ownerUserId).first<{ display_name: string | null; email: string }>();

        const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || 'ユーザー';
        const targetName = target.name || target.email.split('@')[0];

        const baseUrl = (env as any).APP_URL || 'https://app.tomoniwao.jp';
        const shareUrl = `${baseUrl}/ra/${token}`;

        // EmailQueue: one_on_one タイプを再利用
        // （件名と本文はメール処理側でカスタム可能だが、当面はone_on_oneテンプレート流用）
        const emailQueue = new EmailQueueService(env.EMAIL_QUEUE, undefined);
        await emailQueue.sendOneOnOneEmail({
          to: target.email,
          token,
          organizerName,
          inviteeName: targetName,
          title: `日程調整のお願い — ご都合の良い日時をお知らせください`,
          slot: {
            // RA なので「枠」ではなく「期間」を伝える
            start_at: timeMin,
            end_at: timeMax,
          },
          messageHint: `${organizerName}が${title}のお時間をいただきたく、ご都合の良い日時をお知らせいただけますと幸いです。\n\n▶ ご都合の良い日時を選ぶ\n${shareUrl}`,
        });

        emailQueued = true;
        log.debug('RA email queued', { email: target.email, threadId });
      } catch (emailError) {
        log.warn('Failed to queue RA email, share_url still valid', {
          error: emailError instanceof Error ? emailError.message : String(emailError),
        });
      }
    }

    // --- Response ---
    const baseUrl = (env as any).APP_URL || 'https://app.tomoniwao.jp';
    const shareUrl = `${baseUrl}/ra/${token}`;
    const targetName = target.name || target.email.split('@')[0];

    const messageForChat = [
      `🙏 ご都合伺いモードで日程調整を開始しました。`,
      ``,
      `${targetName}さん (${target.email}) にご都合伺いのメールを${emailQueued ? 'お送りしました' : '送信できませんでした（下記リンクを直接共有してください）'}。`,
      ``,
      `📋 ${title}（${duration_minutes}分）`,
      `📅 候補範囲: ${formatDateTimeJP(timeMin)} 〜 ${formatDateTimeJP(timeMax)}`,
      `🔗 ${shareUrl}`,
      ``,
      `相手が候補を選んだら通知します。72時間有効です。`,
    ].join('\n');

    return c.json({
      success: true,
      thread_id: threadId,
      reverse_availability_id: raId,
      token,
      share_url: shareUrl,
      expires_at: expiresAt,
      message_for_chat: messageForChat,
      email_queued: emailQueued,
      request_id: requestId,
    });

  } catch (error) {
    log.error('Failed to create reverse availability', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'internal_error',
      message: 'ご都合伺いの作成に失敗しました',
      request_id: requestId,
    }, 500);
  }
});

/**
 * POST /api/reverse-availability/:id/finalize
 *
 * 主催者が相手の候補から1つを選んで確定。
 * → Meet生成 + Calendar登録 + 確定通知メール
 */
protectedApp.post('/:id/finalize', requireAuth, async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'ReverseAvailability', handler: 'finalize', requestId });

  try {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }

    const { workspaceId, ownerUserId } = getTenant(c);
    const raId = c.req.param('id');

    const body = await c.req.json<{ slot_index: number }>();
    const { slot_index } = body;

    if (slot_index === undefined || slot_index === null) {
      return c.json({
        error: 'validation_error',
        details: 'slot_index is required (0-based)',
        request_id: requestId,
      }, 400);
    }

    // 1. RA レコード取得 + 権限チェック
    const ra = await env.DB.prepare(`
      SELECT * FROM reverse_availability
      WHERE id = ? AND workspace_id = ? AND requester_user_id = ?
    `).bind(raId, workspaceId, ownerUserId).first<ReverseAvailabilityRow>();

    if (!ra) {
      return c.json({ error: 'Not found', request_id: requestId }, 404);
    }

    if (ra.status !== 'responded') {
      return c.json({
        error: 'invalid_status',
        details: `Cannot finalize: status is '${ra.status}', expected 'responded'`,
        request_id: requestId,
      }, 400);
    }

    // 2. 候補一覧取得
    const responses = await env.DB.prepare(`
      SELECT * FROM reverse_availability_responses
      WHERE reverse_availability_id = ?
      ORDER BY rank ASC, created_at ASC
    `).bind(raId).all<ReverseAvailabilityResponseRow>();

    const slots = responses.results || [];
    if (slot_index < 0 || slot_index >= slots.length) {
      return c.json({
        error: 'validation_error',
        details: `slot_index ${slot_index} is out of range (0..${slots.length - 1})`,
        request_id: requestId,
      }, 400);
    }

    const selectedSlot = slots[slot_index];
    const now = new Date().toISOString();

    // 3. RA status → finalized
    await env.DB.prepare(`
      UPDATE reverse_availability
      SET status = 'finalized', finalized_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(now, now, raId).run();

    // 4. scheduling_thread status → finalized
    await env.DB.prepare(`
      UPDATE scheduling_threads
      SET status = 'finalized', updated_at = ?
      WHERE id = ?
    `).bind(now, ra.thread_id).run();

    // 5. scheduling_slots に確定枠を記録
    const slotId = uuidv4();
    await env.DB.prepare(`
      INSERT INTO scheduling_slots (
        slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
      ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
    `).bind(
      slotId,
      ra.thread_id,
      selectedSlot.slot_start,
      selectedSlot.slot_end,
      selectedSlot.label || ra.title,
      now,
    ).run();

    // 6. thread_selections に確定記録
    const selectionId = uuidv4();
    const inviteeKey = await generateInviteeKey(ra.target_email);
    await env.DB.prepare(`
      INSERT INTO thread_selections (
        selection_id, thread_id, invitee_key, status, selected_slot_id, responded_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'selected', ?, ?, ?, ?)
    `).bind(selectionId, ra.thread_id, inviteeKey, slotId, now, now, now).run();

    log.debug('RA finalized', { raId, selectedSlot: selectedSlot.slot_start, threadId: ra.thread_id });

    // 7. Google Meet + Calendar 作成（ベストエフォート）
    let meetUrl: string | null = null;
    let calendarEventId: string | null = null;

    try {
      const accessToken = await GoogleCalendarService.getOrganizerAccessToken(
        env.DB, ownerUserId, env
      );

      if (accessToken) {
        const organizer = await env.DB.prepare(
          `SELECT display_name, email FROM users WHERE id = ?`
        ).bind(ownerUserId).first<{ display_name: string | null; email: string }>();

        const targetName = ra.target_name || ra.target_email.split('@')[0];
        const gcalService = new GoogleCalendarService(accessToken, env);

        const eventResult = await gcalService.createEventWithMeet({
          summary: ra.title,
          description: `tomoniwaoで作成 — ${targetName}さんとの${ra.title}`,
          start: selectedSlot.slot_start,
          end: selectedSlot.slot_end,
          organizerEmail: organizer?.email || undefined,
        });

        meetUrl = eventResult?.hangoutLink || null;
        calendarEventId = eventResult?.id || null;
        log.debug('Meet + Calendar created', { meetUrl, calendarEventId });
      } else {
        log.warn('No organizer access token, skipping Meet/Calendar creation');
      }
    } catch (calError) {
      log.warn('Meet/Calendar creation failed (non-fatal)', {
        error: calError instanceof Error ? calError.message : String(calError),
      });
    }

    // 8. thread_invites を accepted に更新
    await env.DB.prepare(`
      UPDATE thread_invites
      SET status = 'accepted', accepted_at = ?
      WHERE thread_id = ?
    `).bind(now, ra.thread_id).run();

    // 9. Inbox通知: 確定通知を主催者に送信
    try {
      const inboxId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO inbox (
          id, user_id, type, title, message,
          action_type, action_target_id, priority, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).bind(
        inboxId,
        ownerUserId,
        'scheduling_finalized',
        `✅ ${ra.title} の日程が確定しました`,
        `${ra.target_name || ra.target_email} さんとの${ra.title}: ${selectedSlot.label || formatDateTimeJP(selectedSlot.slot_start)}`,
        'thread',
        ra.thread_id,
        'normal',
        now,
      ).run();
    } catch (inboxError) {
      log.warn('Inbox notification failed (non-fatal)', {
        error: inboxError instanceof Error ? inboxError.message : String(inboxError),
      });
    }

    // 10. 確定通知メール（ベストエフォート）
    try {
      const organizer = await env.DB.prepare(
        `SELECT display_name, email FROM users WHERE id = ?`
      ).bind(ownerUserId).first<{ display_name: string | null; email: string }>();
      const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || 'ユーザー';
      const targetName = ra.target_name || ra.target_email.split('@')[0];

      const emailQueue = new EmailQueueService(env.EMAIL_QUEUE, undefined);
      await emailQueue.sendOneOnOneEmail({
        to: ra.target_email,
        token: ra.token,
        organizerName,
        inviteeName: targetName,
        title: `日程確定のお知らせ — ${ra.title}`,
        slot: {
          start_at: selectedSlot.slot_start,
          end_at: selectedSlot.slot_end,
        },
        messageHint: [
          `ご都合をお知らせいただきありがとうございます。`,
          `以下の日時で確定いたしました。`,
          ``,
          `📅 ${formatDateTimeJP(selectedSlot.slot_start)} 〜 ${formatTimeJP(selectedSlot.slot_end)}`,
          meetUrl ? `🔗 Google Meet: ${meetUrl}` : '',
          ``,
          `当日はよろしくお願いいたします。`,
        ].filter(Boolean).join('\n'),
      });
      log.debug('Finalization email sent', { email: ra.target_email });
    } catch (emailError) {
      log.warn('Finalization email failed (non-fatal)', {
        error: emailError instanceof Error ? emailError.message : String(emailError),
      });
    }

    // --- Response ---
    const slotLabel = `${formatDateTimeJP(selectedSlot.slot_start)} 〜 ${formatTimeJP(selectedSlot.slot_end)}`;
    const targetName = ra.target_name || ra.target_email.split('@')[0];

    const messageForChat = [
      `✅ ${ra.title} の日程が確定しました！`,
      ``,
      `📅 ${slotLabel}`,
      `👤 ${targetName}さん (${ra.target_email})`,
      meetUrl ? `🔗 Google Meet: ${meetUrl}` : '',
      calendarEventId ? `📅 カレンダーに追加済み` : '',
      ``,
      `確定通知メールを${targetName}さんに送信しました。`,
    ].filter(Boolean).join('\n');

    return c.json({
      success: true,
      thread_id: ra.thread_id,
      finalized_slot: {
        start: selectedSlot.slot_start,
        end: selectedSlot.slot_end,
        label: slotLabel,
      },
      meet_url: meetUrl,
      calendar_event_id: calendarEventId,
      message_for_chat: messageForChat,
      request_id: requestId,
    });

  } catch (error) {
    log.error('Failed to finalize reverse availability', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      error: 'internal_error',
      message: '日程の確定に失敗しました',
      request_id: requestId,
    }, 500);
  }
});

// ============================================================
// Public Routes (used with /ra prefix, no auth)
// ============================================================

const publicApp = new Hono<{ Bindings: Env }>();

/**
 * GET /ra/:token — ゲスト向け時間枠選択ページ
 *
 * 2週間分のカレンダー、平日09:00-18:00、duration刻み。
 * ゲストが2-3候補を選択して送信する。
 */
publicApp.get('/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ReverseAvailability', handler: 'guestPage' });
  const token = c.req.param('token');

  try {
    // 1. RA取得
    const ra = await env.DB.prepare(`
      SELECT * FROM reverse_availability WHERE token = ?
    `).bind(token).first<ReverseAvailabilityRow>();

    if (!ra) {
      return c.html(renderErrorPage('リンクが見つかりません', 'このリンクは無効か、すでに削除されています。'));
    }

    // 2. ステータスチェック
    if (ra.status === 'expired' || new Date(ra.expires_at) < new Date()) {
      return c.html(renderErrorPage('期限切れ', 'このご都合伺いの有効期間が終了しました。主催者に新しいリンクを依頼してください。'));
    }
    if (ra.status === 'responded') {
      return c.html(renderErrorPage('回答済み', 'すでにご都合をお知らせいただいています。ありがとうございます。'));
    }
    if (ra.status === 'finalized') {
      return c.html(renderErrorPage('確定済み', '日程はすでに確定しています。'));
    }
    if (ra.status === 'cancelled') {
      return c.html(renderErrorPage('キャンセル済み', 'このご都合伺いはキャンセルされました。'));
    }

    // 3. 主催者名を取得
    const organizer = await env.DB.prepare(
      `SELECT display_name, email FROM users WHERE id = ?`
    ).bind(ra.requester_user_id).first<{ display_name: string | null; email: string }>();
    const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || '主催者';

    // 4. 時間枠を生成（time_min ～ time_max, 平日 09:00-18:00, duration刻み）
    const timeMin = new Date(ra.time_min);
    const timeMax = new Date(ra.time_max);
    const duration = ra.duration_minutes;
    const interval = ra.slot_interval_minutes || 60;

    // 日ごとにスロットを生成
    interface SlotData {
      start: string; // ISO8601
      end: string;
      label: string;
    }
    const slotsByDate = new Map<string, SlotData[]>();

    const current = new Date(timeMin);
    // 日の開始を00:00に揃える（JSTベース）
    const jstOffset = 9 * 60 * 60 * 1000;

    while (current < timeMax) {
      const jstDate = new Date(current.getTime() + jstOffset);
      const dayOfWeek = jstDate.getUTCDay();

      // 平日のみ
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const dateKey = `${jstDate.getUTCFullYear()}-${String(jstDate.getUTCMonth() + 1).padStart(2, '0')}-${String(jstDate.getUTCDate()).padStart(2, '0')}`;

        // 09:00-18:00 (JST) のスロット
        for (let hour = 9; hour < 18; hour++) {
          for (let minute = 0; minute < 60; minute += interval) {
            // スロット終了がduration分後
            const slotStartJST = new Date(Date.UTC(
              jstDate.getUTCFullYear(),
              jstDate.getUTCMonth(),
              jstDate.getUTCDate(),
              hour - 9, // UTC = JST - 9
              minute,
              0
            ));
            const slotEnd = new Date(slotStartJST.getTime() + duration * 60 * 1000);

            // 18:00 JST (= 09:00 UTC) を超えないようにする
            const endLimitUTC = new Date(Date.UTC(
              jstDate.getUTCFullYear(),
              jstDate.getUTCMonth(),
              jstDate.getUTCDate(),
              18 - 9, // 18:00 JST = 09:00 UTC
              0,
              0
            ));

            if (slotEnd > endLimitUTC) continue;

            // time_min / time_max 範囲チェック
            if (slotStartJST < timeMin || slotEnd > timeMax) continue;

            // 過去のスロットはスキップ
            if (slotStartJST < new Date()) continue;

            if (!slotsByDate.has(dateKey)) {
              slotsByDate.set(dateKey, []);
            }
            slotsByDate.get(dateKey)!.push({
              start: slotStartJST.toISOString(),
              end: slotEnd.toISOString(),
              label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
            });
          }
        }
      }

      // 次の日へ
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }

    // 5. HTML生成
    const preferredCount = ra.preferred_slots_count || 3;
    const targetName = ra.target_name || 'ゲスト';

    let slotsHtml = '';
    for (const [dateKey, daySlots] of slotsByDate) {
      const dateLabel = formatDateJP(dateKey + 'T00:00:00+09:00');
      slotsHtml += `
        <div class="mb-6">
          <h3 class="text-sm font-semibold text-gray-500 mb-2 pl-1">${dateLabel}</h3>
          <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
            ${daySlots.map(slot => `
              <button
                class="slot-btn px-3 py-2.5 text-sm font-medium border-2 border-gray-200 rounded-lg bg-white hover:border-purple-400 hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-400"
                data-start="${slot.start}"
                data-end="${slot.end}"
                data-label="${dateLabel} ${slot.label}"
                onclick="toggleSlot(this)"
              >
                ${slot.label}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (slotsByDate.size === 0) {
      return c.html(renderErrorPage('選択可能な枠がありません', '現在選択可能な時間枠がありません。主催者に連絡してください。'));
    }

    const html = `
      ${getHtmlHead(`${ra.title} — ご都合をお知らせください`)}
      <body class="bg-gradient-to-br from-purple-50 to-indigo-50 min-h-screen p-4">
        <div class="max-w-lg mx-auto fade-in">
          <!-- ヘッダー -->
          <div class="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <div class="text-center mb-4">
              <div class="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg class="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
              </div>
              <p class="text-sm text-purple-600 font-medium mb-1">${organizerName}さんからのご都合伺い</p>
              <h1 class="text-xl font-bold text-gray-800">${ra.title}</h1>
              <p class="text-gray-500 text-sm mt-2">
                ご都合の良い日時を<span class="font-bold text-purple-600">${preferredCount}つ</span>お選びください
              </p>
            </div>
            <div class="flex items-center justify-center gap-4 text-xs text-gray-400">
              <span>⏱ 約${ra.duration_minutes}分</span>
              <span>📅 ${formatDateJP(ra.time_min)} 〜 ${formatDateJP(ra.time_max)}</span>
            </div>
          </div>

          <!-- 時間枠一覧 -->
          <div class="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <h2 class="text-sm font-semibold text-gray-700 mb-4">日時を選択</h2>
            ${slotsHtml}
          </div>

          <!-- 選択サマリー & 送信 -->
          <div id="summarySection" class="hidden bg-white rounded-2xl shadow-lg p-6 mb-4">
            <h2 class="text-sm font-semibold text-gray-700 mb-3">選択した候補</h2>
            <div id="selectedList" class="space-y-2 mb-4"></div>
            <p id="slotCountHint" class="text-xs text-gray-400 mb-4"></p>
            <button
              id="submitBtn"
              onclick="submitResponses()"
              disabled
              class="w-full py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white font-bold rounded-xl hover:from-purple-600 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              この候補を送る
            </button>
          </div>

          <!-- フッター -->
          <div class="text-center text-xs text-gray-400 mt-2 mb-8">
            <p>Powered by <a href="https://app.tomoniwao.jp" class="underline">tomoniwao</a></p>
          </div>
        </div>

        <script>
          const TOKEN = '${token}';
          const PREFERRED_COUNT = ${preferredCount};
          const MAX_SLOTS = ${preferredCount + 2}; // 少し多めも許容
          let selectedSlots = [];

          function toggleSlot(btn) {
            const start = btn.dataset.start;
            const idx = selectedSlots.findIndex(s => s.start === start);

            if (idx >= 0) {
              // 選択解除
              selectedSlots.splice(idx, 1);
              btn.classList.remove('selected');
            } else {
              if (selectedSlots.length >= MAX_SLOTS) {
                alert('最大' + MAX_SLOTS + '個まで選択できます');
                return;
              }
              // 選択追加
              selectedSlots.push({
                start: btn.dataset.start,
                end: btn.dataset.end,
                label: btn.dataset.label,
              });
              btn.classList.add('selected');
            }

            updateSummary();
          }

          function updateSummary() {
            const section = document.getElementById('summarySection');
            const list = document.getElementById('selectedList');
            const hint = document.getElementById('slotCountHint');
            const submitBtn = document.getElementById('submitBtn');

            if (selectedSlots.length === 0) {
              section.classList.add('hidden');
              return;
            }

            section.classList.remove('hidden');
            list.innerHTML = selectedSlots.map((s, i) => {
              const start = new Date(s.start);
              const end = new Date(s.end);
              const dateStr = start.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
              const startTime = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
              const endTime = end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
              return '<div class="flex items-center gap-2 bg-purple-50 rounded-lg px-3 py-2">' +
                '<span class="w-6 h-6 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs font-bold">' + (i + 1) + '</span>' +
                '<span class="text-sm font-medium text-gray-700">' + dateStr + ' ' + startTime + ' 〜 ' + endTime + '</span>' +
                '</div>';
            }).join('');

            const remaining = PREFERRED_COUNT - selectedSlots.length;
            if (remaining > 0) {
              hint.textContent = 'あと' + remaining + '個選んでください';
              submitBtn.disabled = true;
            } else {
              hint.textContent = selectedSlots.length + '個選択済み';
              submitBtn.disabled = false;
            }
          }

          async function submitResponses() {
            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.textContent = '送信中...';

            try {
              const response = await fetch('/ra/' + TOKEN + '/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  slots: selectedSlots.map((s, i) => ({
                    start: s.start,
                    end: s.end,
                    label: s.label,
                    rank: i + 1,
                  })),
                }),
              });

              const data = await response.json();

              if (data.success) {
                window.location.href = '/ra/' + TOKEN + '/thank-you';
              } else {
                alert(data.error || '送信に失敗しました');
                btn.disabled = false;
                btn.textContent = 'この候補を送る';
              }
            } catch (error) {
              alert('通信エラーが発生しました');
              btn.disabled = false;
              btn.textContent = 'この候補を送る';
            }
          }
        </script>
      </body>
      </html>
    `;

    return c.html(html);

  } catch (error) {
    log.error('Failed to render RA guest page', { error: error instanceof Error ? error.message : String(error) });
    return c.html(renderErrorPage('エラー', '予期しないエラーが発生しました。しばらく経ってからお試しください。'));
  }
});

/**
 * POST /ra/:token/respond — ゲストが候補を送信
 */
publicApp.post('/:token/respond', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ReverseAvailability', handler: 'respond' });
  const token = c.req.param('token');

  try {
    const body = await c.req.json<{
      slots: Array<{ start: string; end: string; label?: string; rank?: number }>;
      responder_name?: string;
    }>();

    if (!body.slots || body.slots.length === 0) {
      return c.json({ success: false, error: '候補を1つ以上選択してください' }, 400);
    }

    // 1. RA取得
    const ra = await env.DB.prepare(`
      SELECT * FROM reverse_availability WHERE token = ?
    `).bind(token).first<ReverseAvailabilityRow>();

    if (!ra) {
      return c.json({ success: false, error: 'リンクが見つかりません' }, 404);
    }

    if (ra.status !== 'pending') {
      return c.json({ success: false, error: 'すでに回答済みです' }, 400);
    }

    if (new Date(ra.expires_at) < new Date()) {
      return c.json({ success: false, error: '有効期限が切れています' }, 400);
    }

    const now = new Date().toISOString();

    // 2. responses を INSERT
    for (const slot of body.slots) {
      const responseId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO reverse_availability_responses (
          id, reverse_availability_id, slot_start, slot_end, label, rank, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        responseId,
        ra.id,
        slot.start,
        slot.end,
        slot.label || null,
        slot.rank || null,
        now,
      ).run();
    }

    // 3. RA status → responded
    await env.DB.prepare(`
      UPDATE reverse_availability
      SET status = 'responded', responded_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(now, now, ra.id).run();

    // 4. Inbox通知: 主催者に候補到着を通知
    try {
      const targetName = ra.target_name || ra.target_email.split('@')[0];
      const slotsDescription = body.slots.map((s, i) => {
        const label = s.label || formatDateTimeJP(s.start);
        return `${i + 1}. ${label}`;
      }).join('\n');

      const inboxId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO inbox (
          id, user_id, type, title, message,
          action_type, action_target_id, priority, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).bind(
        inboxId,
        ra.requester_user_id,
        'scheduling_response',
        `📬 ${targetName}さんからご都合の候補が届きました`,
        `${targetName}さんが${body.slots.length}つの候補日時を選びました。\n\n${slotsDescription}\n\nチャットで番号を選んで確定してください。`,
        'thread',
        ra.thread_id,
        'high',
        now,
      ).run();

      log.debug('Inbox notification sent to organizer', { raId: ra.id, organizerId: ra.requester_user_id });
    } catch (inboxError) {
      log.warn('Inbox notification failed (non-fatal)', {
        error: inboxError instanceof Error ? inboxError.message : String(inboxError),
      });
    }

    // 5. チャットメッセージを保存（主催者のチャット画面に表示するため）
    try {
      const targetName = ra.target_name || ra.target_email.split('@')[0];
      const slotsFormatted = body.slots.map((s, i) => {
        const label = s.label || formatDateTimeJP(s.start);
        return `${i + 1}. ${label}`;
      }).join('\n');

      const chatMessageId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO chat_messages (
          id, workspace_id, user_id, role, content, metadata, created_at
        ) VALUES (?, ?, ?, 'assistant', ?, ?, ?)
      `).bind(
        chatMessageId,
        ra.workspace_id,
        ra.requester_user_id,
        [
          `📬 ${targetName}さんからご都合の候補が届きました！`,
          ``,
          slotsFormatted,
          ``,
          `どの日時で確定しますか？（番号で答えてください）`,
        ].join('\n'),
        JSON.stringify({
          type: 'reverse_availability_response',
          thread_id: ra.thread_id,
          reverse_availability_id: ra.id,
          slots: body.slots,
        }),
        now,
      ).run();
    } catch (chatError) {
      log.warn('Chat message insertion failed (non-fatal)', {
        error: chatError instanceof Error ? chatError.message : String(chatError),
      });
    }

    return c.json({ success: true, slots_count: body.slots.length });

  } catch (error) {
    log.error('Failed to process RA response', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ success: false, error: '送信に失敗しました' }, 500);
  }
});

/**
 * GET /ra/:token/thank-you — サンキューページ
 */
publicApp.get('/:token/thank-you', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'ReverseAvailability', handler: 'thank-you' });
  const token = c.req.param('token');

  try {
    const ra = await env.DB.prepare(`
      SELECT * FROM reverse_availability WHERE token = ?
    `).bind(token).first<ReverseAvailabilityRow>();

    if (!ra) {
      return c.html(renderErrorPage('リンクが見つかりません', 'このリンクは無効です。'));
    }

    const organizer = await env.DB.prepare(
      `SELECT display_name, email FROM users WHERE id = ?`
    ).bind(ra.requester_user_id).first<{ display_name: string | null; email: string }>();
    const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || '主催者';

    // 選択された候補を取得
    const responses = await env.DB.prepare(`
      SELECT * FROM reverse_availability_responses
      WHERE reverse_availability_id = ?
      ORDER BY rank ASC, created_at ASC
    `).bind(ra.id).all<ReverseAvailabilityResponseRow>();

    const slots = responses.results || [];

    const slotsHtml = slots.map((s, i) => {
      const label = s.label || `${formatDateTimeJP(s.slot_start)} 〜 ${formatTimeJP(s.slot_end)}`;
      return `
        <div class="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
          <span class="w-6 h-6 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs font-bold">${i + 1}</span>
          <span class="text-sm text-gray-700 font-medium">${label}</span>
        </div>
      `;
    }).join('');

    const html = `
      ${getHtmlHead('ご回答ありがとうございます')}
      <body class="bg-gradient-to-br from-green-50 to-emerald-50 min-h-screen p-4">
        <div class="max-w-lg mx-auto fade-in">
          <div class="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
            </div>

            <h1 class="text-2xl font-bold text-gray-800 mb-2">ご回答ありがとうございます</h1>
            <p class="text-gray-500 mb-6">${organizerName}さんがご都合に合わせてお返事いたします。</p>

            ${slotsHtml ? `
              <div class="text-left space-y-2 mb-6">
                <p class="text-sm text-gray-500 mb-2">お送りいただいた候補:</p>
                ${slotsHtml}
              </div>
            ` : ''}

            <!-- 成長導線 -->
            <div class="border-t pt-6 mt-6">
              <p class="text-sm text-gray-500 mb-3">tomoniwaoで日程調整をもっと簡単に</p>
              <a
                href="https://app.tomoniwao.jp/signup"
                class="inline-block px-6 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-indigo-600 transition-all"
              >
                無料で始める
              </a>
            </div>
          </div>

          <div class="text-center text-xs text-gray-400 mt-4">
            <p>Powered by <a href="https://app.tomoniwao.jp" class="underline">tomoniwao</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    return c.html(html);

  } catch (error) {
    log.error('Failed to render thank-you page', { error: error instanceof Error ? error.message : String(error) });
    return c.html(renderErrorPage('エラー', '予期しないエラーが発生しました。'));
  }
});

// ============================================================
// Exports
// ============================================================

/** Protected routes: mount at /api/reverse-availability */
export const reverseAvailabilityApiRoutes = protectedApp;

/** Public routes: mount at /ra */
export const reverseAvailabilityPublicRoutes = publicApp;

export default protectedApp;
