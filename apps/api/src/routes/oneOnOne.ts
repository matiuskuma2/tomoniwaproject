/**
 * 1対1 予定調整 API
 * 
 * Phase v1.0: 最小構成で「お願い→終わったよ」体験を実現
 * - ユーザーが固定日時を指定
 * - AIが招待リンク or メール送信
 * - 相手が承諾/別日希望を返答
 * 
 * Phase B-1: 候補3つ提示
 * - 複数の候補枠を提示
 * - 相手が選択して承諾
 * 
 * Phase B-2: freebusy → 候補生成
 * - 主催者のGoogleカレンダーから空き時間を取得
 * - 自動で候補3つを生成して招待
 * 
 * @route POST /api/one-on-one/fixed/prepare      - 固定1枠（v1.0）
 * @route POST /api/one-on-one/candidates/prepare - 候補3つ（B-1）
 * @route POST /api/one-on-one/freebusy/prepare   - freebusy → 候補生成（B-2）
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';
import { requireAuth, type Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';
import { EmailQueueService } from '../services/emailQueue';
import { GoogleCalendarService } from '../services/googleCalendar';
import { generateAvailableSlots, getTimeWindowFromPrefer, type AvailableSlot } from '../utils/slotGenerator';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Types
// ============================================================

interface OneOnOneFixedPrepareRequest {
  /** 相手の情報 */
  invitee: {
    name: string;
    email?: string;          // 任意: メールアドレスが分かる場合
    contact_id?: string;     // 任意: contacts テーブルの ID
  };
  /** 固定枠 */
  slot: {
    start_at: string;        // ISO8601
    end_at: string;          // ISO8601
  };
  /** 予定タイトル（省略時: 打ち合わせ） */
  title?: string;
  /** 相手へのメッセージ（任意） */
  message_hint?: string;
  /** 送信手段: email | share_link（省略時は自動判定） */
  send_via?: 'email' | 'share_link';
}

interface OneOnOneFixedPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;  // v1.1: メール送信キュー投入済みフラグ
  request_id: string;
}

// ============================================================
// Types - 候補3つAPI（B-1）
// ============================================================

interface CandidateSlot {
  start_at: string;  // ISO8601
  end_at: string;    // ISO8601
}

interface OneOnOneCandidatesPrepareRequest {
  /** 相手の情報 */
  invitee: {
    name: string;
    email?: string;          // 任意: メールアドレスが分かる場合
    contact_id?: string;     // 任意: contacts テーブルの ID
  };
  /** 候補枠（1〜5件） */
  slots: CandidateSlot[];
  /** 予定タイトル（省略時: 打ち合わせ） */
  title?: string;
  /** 相手へのメッセージ（任意） */
  message_hint?: string;
  /** 送信手段: email | share_link（省略時は自動判定） */
  send_via?: 'email' | 'share_link';
}

interface OneOnOneCandidatesPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
  request_id: string;
}

// ============================================================
// Types - freebusy → 候補生成 API（B-2）
// ============================================================

interface FreebusyConstraints {
  time_min?: string;      // ISO8601, デフォルト: 翌営業日09:00
  time_max?: string;      // ISO8601, デフォルト: 2週間後
  prefer?: 'morning' | 'afternoon' | 'evening' | 'business' | 'any';  // デフォルト: afternoon
  days?: string[];        // ['mon','tue','wed','thu','fri'], デフォルト: 平日
  duration?: number;      // 分, デフォルト: 60
}

interface OneOnOneFreebusyPrepareRequest {
  /** 相手の情報 */
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  /** 制約条件（省略時はデフォルト値を使用） */
  constraints?: FreebusyConstraints;
  /** 候補数（デフォルト: 3, 最大: 5） */
  candidate_count?: number;
  /** 予定タイトル（省略時: 打ち合わせ） */
  title?: string;
  /** 相手へのメッセージ（任意） */
  message_hint?: string;
  /** 送信手段: email | share_link（省略時は自動判定） */
  send_via?: 'email' | 'share_link';
}

interface OneOnOneFreebusyPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
  constraints_used: {
    time_min: string;
    time_max: string;
    prefer: string;
    duration: number;
  };
  request_id: string;
}

// ============================================================
// Helpers
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
 * invitee_key 生成（メールベース or UUID）
 */
async function generateInviteeKey(email?: string): Promise<string> {
  if (email) {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `e:${hashHex.substring(0, 16)}`;
  }
  // メール不明の場合はゲストキー
  return `g:${uuidv4().replace(/-/g, '').substring(0, 16)}`;
}

/**
 * 日時フォーマット（日本語）
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
 * 時刻のみフォーマット（日本語）
 */
function formatTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * B-2: 翌営業日の指定時刻を取得
 * 土日をスキップして次の平日を返す
 */
function getNextBusinessDayAt(hour: number, minute: number = 0, timezone: string = 'Asia/Tokyo'): Date {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST = UTC+9
  
  // JST での現在時刻
  const jstNow = new Date(now.getTime() + jstOffset);
  
  // 翌日からスタート
  const result = new Date(jstNow);
  result.setUTCDate(result.getUTCDate() + 1);
  result.setUTCHours(hour - 9, minute, 0, 0); // JST → UTC 変換
  
  // 土日をスキップ
  let dayOfWeek = result.getUTCDay();
  while (dayOfWeek === 0 || dayOfWeek === 6) { // 0 = 日曜, 6 = 土曜
    result.setUTCDate(result.getUTCDate() + 1);
    dayOfWeek = result.getUTCDay();
  }
  
  return result;
}

/**
 * B-2: N週間後の日時を取得
 */
function getDateAfterWeeks(weeks: number): Date {
  const now = new Date();
  return new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

/**
 * B-2: 曜日フィルター（days配列に含まれる曜日のみ許可）
 * days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
 */
function filterSlotsByDays(slots: AvailableSlot[], days: string[], timezone: string = 'Asia/Tokyo'): AvailableSlot[] {
  const dayMap: Record<string, number> = {
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6
  };
  const allowedDays = new Set(days.map(d => dayMap[d.toLowerCase()]));
  
  return slots.filter(slot => {
    const date = new Date(slot.start_at);
    // JST での曜日を取得
    const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const dayOfWeek = jstDate.getUTCDay();
    return allowedDays.has(dayOfWeek);
  });
}

// ============================================================
// POST /api/one-on-one/fixed/prepare
// 固定1枠の招待を準備（リンク発行 or メール送信）
// ============================================================
app.post('/fixed/prepare', requireAuth, async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'OneOnOne', handler: 'fixed/prepare', requestId });

  try {
    // 認証チェック（requireAuth で保証されているが念のため）
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }

    // テナントコンテキスト取得
    const { workspaceId, ownerUserId } = getTenant(c);
    
    // リクエストボディ
    const body = await c.req.json<OneOnOneFixedPrepareRequest>();
    const { invitee, slot, title = '打ち合わせ', message_hint, send_via } = body;

    // バリデーション
    if (!invitee?.name) {
      return c.json({ 
        error: 'validation_error', 
        details: 'invitee.name is required',
        request_id: requestId 
      }, 400);
    }
    if (!slot?.start_at || !slot?.end_at) {
      return c.json({ 
        error: 'validation_error', 
        details: 'slot.start_at and slot.end_at are required',
        request_id: requestId 
      }, 400);
    }

    // 日時パース & 検証
    const startAt = new Date(slot.start_at);
    const endAt = new Date(slot.end_at);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return c.json({ 
        error: 'validation_error', 
        details: 'Invalid date format',
        request_id: requestId 
      }, 400);
    }
    if (endAt <= startAt) {
      return c.json({ 
        error: 'validation_error', 
        details: 'end_at must be after start_at',
        request_id: requestId 
      }, 400);
    }

    // v1.1: send_via=email 指定時はメールアドレス必須
    if (send_via === 'email' && !invitee.email) {
      return c.json({ 
        error: 'validation_error', 
        details: 'invitee.email is required when send_via is "email". Use send_via="share_link" if email is unknown.',
        request_id: requestId 
      }, 400);
    }

    // モード判定
    const mode: 'email' | 'share_link' = 
      send_via === 'email' && invitee.email ? 'email' : 
      send_via === 'share_link' ? 'share_link' :
      invitee.email ? 'email' : 'share_link';

    log.debug('Creating 1-on-1 fixed schedule', { 
      inviteeName: invitee.name,
      hasEmail: !!invitee.email,
      mode,
      startAt: slot.start_at,
      endAt: slot.end_at
    });

    // ============================================================
    // DB操作: scheduling_thread + scheduling_slots + thread_invites
    // ============================================================
    const threadId = uuidv4();
    const slotId = uuidv4();
    const inviteId = uuidv4();
    const token = generateToken();
    const inviteeKey = await generateInviteeKey(invitee.email);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72時間後

    // v1: メール未知の場合は placeholder を使用
    // （相手が /i/:token で入力したら UPDATE する設計）
    const inviteeEmail = invitee.email || `guest-${token.substring(0, 8)}@placeholder.local`;

    // 1. scheduling_threads 作成（draft で開始）
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description, status, mode, 
        proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'one_on_one', 1, 0, ?, ?)
    `).bind(
      threadId,
      workspaceId,
      ownerUserId,
      title,
      message_hint || null,
      now,
      now
    ).run();

    // 2. scheduling_slots 作成（固定1枠）
    await env.DB.prepare(`
      INSERT INTO scheduling_slots (
        slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
      ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
    `).bind(
      slotId,
      threadId,
      slot.start_at,
      slot.end_at,
      title,
      now
    ).run();

    // 3. thread_invites 作成
    await env.DB.prepare(`
      INSERT INTO thread_invites (
        id, thread_id, token, email, candidate_name, candidate_reason, 
        invitee_key, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      inviteId,
      threadId,
      token,
      inviteeEmail,
      invitee.name,
      message_hint || null,
      inviteeKey,
      expiresAt,
      now
    ).run();

    // 4. スレッド status を sent に更新（招待発行済み）
    await env.DB.prepare(`
      UPDATE scheduling_threads SET status = 'sent', updated_at = ? WHERE id = ?
    `).bind(now, threadId).run();

    log.debug('1-on-1 fixed schedule created', { threadId, slotId, inviteId, token, mode });

    // ============================================================
    // メール送信（mode === 'email' の場合）
    // ============================================================
    let emailQueued = false;
    if (mode === 'email' && invitee.email) {
      try {
        // v1.1: オーガナイザー名を取得
        const organizer = await env.DB.prepare(
          `SELECT display_name, email FROM users WHERE id = ?`
        ).bind(ownerUserId).first<{ display_name: string | null; email: string }>();
        
        const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || 'ユーザー';
        
        // v1.1: メール送信をキューに追加（非同期）
        // ANALYTICS は optional なので undefined を渡す
        const emailQueue = new EmailQueueService(env.EMAIL_QUEUE, undefined);
        await emailQueue.sendOneOnOneEmail({
          to: invitee.email,
          token,
          organizerName,
          inviteeName: invitee.name,
          title,
          slot: {
            start_at: slot.start_at,
            end_at: slot.end_at,
          },
          messageHint: message_hint,
        });
        
        emailQueued = true;
        log.debug('Email queued successfully', { email: invitee.email, threadId, token });
      } catch (emailError) {
        // メール送信失敗はログに記録するが、API レスポンスは成功として返す
        // （share_url は発行済みなので、ユーザーは手動共有できる）
        log.warn('Failed to queue email, falling back to share_link', { 
          email: invitee.email, 
          threadId,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        });
      }
    }

    // ============================================================
    // レスポンス生成
    // ============================================================
    // v1: 本番URLを直接使用（Env.APP_URLは未定義のため）
    const baseUrl = 'https://app.tomoniwao.jp';
    const shareUrl = `${baseUrl}/i/${token}`;
    const slotLabel = `${formatDateTimeJP(slot.start_at)}〜${new Date(slot.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;

    // チャット用メッセージ
    let messageForChat: string;
    if (mode === 'email' && emailQueued) {
      messageForChat = `了解です。${invitee.name}さん（${invitee.email}）にメールで確認を送りました📧\n\n📅 固定候補：${slotLabel}\n\n返事が来たらお知らせします。`;
    } else if (mode === 'email' && !emailQueued) {
      // メール送信失敗時は share_link と同じメッセージ
      messageForChat = `了解です。${invitee.name}さんに共有するリンクを発行しました。\n（メール送信に失敗したため、手動で共有してください）\n\n📅 固定候補：${slotLabel}\n\n次のメッセージを${invitee.name}さんに送ってください：\n\n---\n${invitee.name}さん、日程のご確認です。\n下記リンクから「承諾」か「別日希望」を選んでください。\n${shareUrl}\n---`;
    } else {
      messageForChat = `了解です。${invitee.name}さんに共有するリンクを発行しました。\n\n📅 固定候補：${slotLabel}\n\n次のメッセージを${invitee.name}さんに送ってください：\n\n---\n${invitee.name}さん、日程のご確認です。\n下記リンクから「承諾」か「別日希望」を選んでください。\n${shareUrl}\n---`;
    }

    const response: OneOnOneFixedPrepareResponse = {
      success: true,
      thread_id: threadId,
      invite_token: token,
      share_url: shareUrl,
      message_for_chat: messageForChat,
      mode,
      email_queued: emailQueued || undefined,
      request_id: requestId
    };

    return c.json(response, 201);

  } catch (error) {
    log.error('Failed to prepare 1-on-1 fixed schedule', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId 
    }, 500);
  }
});

// ============================================================
// POST /api/one-on-one/candidates/prepare
// 候補3つの招待を準備（リンク発行 or メール送信）
// Phase B-1: 複数候補を提示して相手に選んでもらう
// ============================================================
app.post('/candidates/prepare', requireAuth, async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'OneOnOne', handler: 'candidates/prepare', requestId });

  try {
    // 認証チェック（requireAuth で保証されているが念のため）
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }

    // テナントコンテキスト取得
    const { workspaceId, ownerUserId } = getTenant(c);
    
    // リクエストボディ
    const body = await c.req.json<OneOnOneCandidatesPrepareRequest>();
    const { invitee, slots, title = '打ち合わせ', message_hint, send_via } = body;

    // バリデーション: invitee.name
    if (!invitee?.name) {
      return c.json({ 
        error: 'validation_error', 
        details: 'invitee.name is required',
        request_id: requestId 
      }, 400);
    }

    // バリデーション: slots（1〜5件）
    if (!slots || !Array.isArray(slots) || slots.length === 0) {
      return c.json({ 
        error: 'validation_error', 
        details: 'slots is required and must be a non-empty array',
        request_id: requestId 
      }, 400);
    }
    if (slots.length > 5) {
      return c.json({ 
        error: 'validation_error', 
        details: 'slots must have at most 5 items',
        request_id: requestId 
      }, 400);
    }

    // 各スロットの検証
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.start_at || !slot.end_at) {
        return c.json({ 
          error: 'validation_error', 
          details: `slots[${i}].start_at and slots[${i}].end_at are required`,
          request_id: requestId 
        }, 400);
      }
      const startAt = new Date(slot.start_at);
      const endAt = new Date(slot.end_at);
      if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
        return c.json({ 
          error: 'validation_error', 
          details: `slots[${i}] has invalid date format`,
          request_id: requestId 
        }, 400);
      }
      if (endAt <= startAt) {
        return c.json({ 
          error: 'validation_error', 
          details: `slots[${i}].end_at must be after slots[${i}].start_at`,
          request_id: requestId 
        }, 400);
      }
    }

    // v1.1: send_via=email 指定時はメールアドレス必須
    if (send_via === 'email' && !invitee.email) {
      return c.json({ 
        error: 'validation_error', 
        details: 'invitee.email is required when send_via is "email". Use send_via="share_link" if email is unknown.',
        request_id: requestId 
      }, 400);
    }

    // モード判定
    const mode: 'email' | 'share_link' = 
      send_via === 'email' && invitee.email ? 'email' : 
      send_via === 'share_link' ? 'share_link' :
      invitee.email ? 'email' : 'share_link';

    log.debug('Creating 1-on-1 candidates schedule', { 
      inviteeName: invitee.name,
      hasEmail: !!invitee.email,
      mode,
      slotCount: slots.length
    });

    // ============================================================
    // DB操作: scheduling_thread + scheduling_slots + thread_invites
    // ============================================================
    const threadId = uuidv4();
    const inviteId = uuidv4();
    const token = generateToken();
    const inviteeKey = await generateInviteeKey(invitee.email);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72時間後

    // v1: メール未知の場合は placeholder を使用
    const inviteeEmail = invitee.email || `guest-${token.substring(0, 8)}@placeholder.local`;

    // 1. scheduling_threads 作成（draft で開始、slot_policy = 'fixed_multi'）
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description, status, mode, 
        slot_policy, proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'one_on_one', 'fixed_multi', 1, 0, ?, ?)
    `).bind(
      threadId,
      workspaceId,
      ownerUserId,
      title,
      message_hint || null,
      now,
      now
    ).run();

    // 2. scheduling_slots 作成（複数枠）
    const createdSlots: Array<{ slot_id: string; start_at: string; end_at: string }> = [];
    for (const slot of slots) {
      const slotId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (
          slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
        ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
      `).bind(
        slotId,
        threadId,
        slot.start_at,
        slot.end_at,
        title,
        now
      ).run();
      createdSlots.push({ slot_id: slotId, start_at: slot.start_at, end_at: slot.end_at });
    }

    // 3. thread_invites 作成
    await env.DB.prepare(`
      INSERT INTO thread_invites (
        id, thread_id, token, email, candidate_name, candidate_reason, 
        invitee_key, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      inviteId,
      threadId,
      token,
      inviteeEmail,
      invitee.name,
      message_hint || null,
      inviteeKey,
      expiresAt,
      now
    ).run();

    // 4. スレッド status を sent に更新（招待発行済み）
    await env.DB.prepare(`
      UPDATE scheduling_threads SET status = 'sent', updated_at = ? WHERE id = ?
    `).bind(now, threadId).run();

    log.debug('1-on-1 candidates schedule created', { 
      threadId, 
      slotCount: createdSlots.length, 
      inviteId, 
      token, 
      mode 
    });

    // ============================================================
    // メール送信（mode === 'email' の場合）
    // ============================================================
    let emailQueued = false;
    if (mode === 'email' && invitee.email) {
      try {
        // オーガナイザー名を取得
        const organizer = await env.DB.prepare(
          `SELECT display_name, email FROM users WHERE id = ?`
        ).bind(ownerUserId).first<{ display_name: string | null; email: string }>();
        
        const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || 'ユーザー';
        
        // B-1: 複数候補用メール送信
        // 現時点では最初のスロットを代表として使用（将来的に候補リストを含むメールに拡張可能）
        const emailQueue = new EmailQueueService(env.EMAIL_QUEUE, undefined);
        await emailQueue.sendOneOnOneEmail({
          to: invitee.email,
          token,
          organizerName,
          inviteeName: invitee.name,
          title,
          slot: {
            start_at: createdSlots[0].start_at,
            end_at: createdSlots[0].end_at,
          },
          messageHint: message_hint,
        });
        
        emailQueued = true;
        log.debug('Email queued successfully', { email: invitee.email, threadId, token });
      } catch (emailError) {
        log.warn('Failed to queue email, falling back to share_link', { 
          email: invitee.email, 
          threadId,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        });
      }
    }

    // ============================================================
    // レスポンス生成
    // ============================================================
    const baseUrl = 'https://app.tomoniwao.jp';
    const shareUrl = `${baseUrl}/i/${token}`;

    // スロットラベル生成（複数候補用）
    const slotsLabel = createdSlots.map((slot, i) => {
      const label = `${formatDateTimeJP(slot.start_at)}〜${new Date(slot.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
      return `  ${i + 1}. ${label}`;
    }).join('\n');

    // チャット用メッセージ
    let messageForChat: string;
    if (mode === 'email' && emailQueued) {
      messageForChat = `了解です。${invitee.name}さん（${invitee.email}）にメールで確認を送りました📧\n\n📅 候補日時（${createdSlots.length}件）：\n${slotsLabel}\n\n返事が来たらお知らせします。`;
    } else if (mode === 'email' && !emailQueued) {
      messageForChat = `了解です。${invitee.name}さんに共有するリンクを発行しました。\n（メール送信に失敗したため、手動で共有してください）\n\n📅 候補日時（${createdSlots.length}件）：\n${slotsLabel}\n\n次のメッセージを${invitee.name}さんに送ってください：\n\n---\n${invitee.name}さん、日程のご確認です。\n下記リンクから都合の良い日時を選んでください。\n${shareUrl}\n---`;
    } else {
      messageForChat = `了解です。${invitee.name}さんに共有するリンクを発行しました。\n\n📅 候補日時（${createdSlots.length}件）：\n${slotsLabel}\n\n次のメッセージを${invitee.name}さんに送ってください：\n\n---\n${invitee.name}さん、日程のご確認です。\n下記リンクから都合の良い日時を選んでください。\n${shareUrl}\n---`;
    }

    const response: OneOnOneCandidatesPrepareResponse = {
      success: true,
      thread_id: threadId,
      invite_token: token,
      share_url: shareUrl,
      slots: createdSlots,
      message_for_chat: messageForChat,
      mode,
      email_queued: emailQueued || undefined,
      request_id: requestId
    };

    return c.json(response, 201);

  } catch (error) {
    log.error('Failed to prepare 1-on-1 candidates schedule', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId 
    }, 500);
  }
});

// ============================================================
// POST /api/one-on-one/freebusy/prepare
// freebusy → 候補生成（B-2）
// 主催者のGoogleカレンダーから空き時間を取得し、候補3つを自動生成
// ============================================================
app.post('/freebusy/prepare', requireAuth, async (c) => {
  const requestId = crypto.randomUUID();
  const { env } = c;
  const log = createLogger(env, { module: 'OneOnOne', handler: 'freebusy/prepare', requestId });

  try {
    // 認証チェック
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }

    // テナントコンテキスト取得
    const { workspaceId, ownerUserId } = getTenant(c);
    
    // リクエストボディ
    const body = await c.req.json<OneOnOneFreebusyPrepareRequest>();
    const { 
      invitee, 
      constraints = {}, 
      candidate_count = 3,
      title = '打ち合わせ', 
      message_hint, 
      send_via 
    } = body;

    // バリデーション: invitee.name
    if (!invitee?.name) {
      return c.json({ 
        error: 'validation_error', 
        details: 'invitee.name is required',
        request_id: requestId 
      }, 400);
    }

    // バリデーション: candidate_count（1〜5）
    if (candidate_count < 1 || candidate_count > 5) {
      return c.json({ 
        error: 'validation_error', 
        details: 'candidate_count must be between 1 and 5',
        request_id: requestId 
      }, 400);
    }

    // send_via=email 指定時はメールアドレス必須
    if (send_via === 'email' && !invitee.email) {
      return c.json({ 
        error: 'validation_error', 
        details: 'invitee.email is required when send_via is "email"',
        request_id: requestId 
      }, 400);
    }

    // ============================================================
    // デフォルト値の適用
    // ============================================================
    const defaultTimeMin = getNextBusinessDayAt(9, 0); // 翌営業日 09:00
    const defaultTimeMax = getDateAfterWeeks(2);        // 2週間後
    const defaultPrefer = 'afternoon';
    const defaultDays = ['mon', 'tue', 'wed', 'thu', 'fri']; // 平日
    const defaultDuration = 60;

    const timeMin = constraints.time_min || defaultTimeMin.toISOString();
    const timeMax = constraints.time_max || defaultTimeMax.toISOString();
    const prefer = constraints.prefer || defaultPrefer;
    const days = constraints.days || defaultDays;
    const duration = constraints.duration || defaultDuration;

    log.debug('Creating 1-on-1 freebusy schedule', { 
      inviteeName: invitee.name,
      hasEmail: !!invitee.email,
      timeMin,
      timeMax,
      prefer,
      days,
      duration,
      candidate_count
    });

    // ============================================================
    // 1. 主催者のアクセストークンを取得
    // ============================================================
    const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, ownerUserId, env);
    if (!accessToken) {
      return c.json({ 
        error: 'calendar_unavailable', 
        message: 'Googleカレンダーが連携されていません。設定からカレンダー連携を行ってください。',
        request_id: requestId 
      }, 400);
    }

    // ============================================================
    // 2. freebusy を取得
    // ============================================================
    let busy: Array<{ start: string; end: string }>;
    try {
      const calendarService = new GoogleCalendarService(accessToken, env);
      busy = await calendarService.getFreeBusy(timeMin, timeMax);
    } catch (calendarError) {
      log.error('Failed to fetch freebusy', { 
        error: calendarError instanceof Error ? calendarError.message : String(calendarError) 
      });
      return c.json({ 
        error: 'calendar_unavailable', 
        message: 'カレンダーの空き時間を取得できませんでした。しばらく待ってから再試行してください。',
        request_id: requestId 
      }, 503);
    }

    // ============================================================
    // 3. 空き枠を生成
    // ============================================================
    const dayTimeWindow = prefer === 'any' ? undefined : getTimeWindowFromPrefer(prefer);
    const slotResult = generateAvailableSlots({
      timeMin,
      timeMax,
      busy,
      meetingLengthMin: duration,
      stepMin: 30,
      maxResults: candidate_count * 3, // 余裕を持って生成
      dayTimeWindow,
      timezone: 'Asia/Tokyo',
    });

    // 曜日フィルター適用
    let filteredSlots = filterSlotsByDays(slotResult.available_slots, days);
    
    // 候補数に絞る
    filteredSlots = filteredSlots.slice(0, candidate_count);

    // ============================================================
    // 4. 候補が0件の場合のエラーハンドリング
    // ============================================================
    if (filteredSlots.length === 0) {
      const suggestions = [
        prefer !== 'any' ? '時間帯の制約を「指定なし」に変更' : null,
        days.length < 7 ? '曜日の制約を緩和（週末も含める）' : null,
        '期間を広げる（例: 3週間後まで）',
        '所要時間を短くする（例: 30分）',
      ].filter(Boolean);

      return c.json({ 
        error: 'no_available_slots', 
        message: `指定期間（${formatDateTimeJP(timeMin)}〜${formatDateTimeJP(timeMax)}）に空きが見つかりませんでした。`,
        suggestions,
        constraints_used: {
          time_min: timeMin,
          time_max: timeMax,
          prefer,
          duration,
        },
        request_id: requestId 
      }, 422);
    }

    // モード判定
    const mode: 'email' | 'share_link' = 
      send_via === 'email' && invitee.email ? 'email' : 
      send_via === 'share_link' ? 'share_link' :
      invitee.email ? 'email' : 'share_link';

    // ============================================================
    // 5. DB操作: scheduling_thread + scheduling_slots + thread_invites
    // ============================================================
    const threadId = uuidv4();
    const inviteId = uuidv4();
    const token = generateToken();
    const inviteeKey = await generateInviteeKey(invitee.email);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72時間後

    const inviteeEmail = invitee.email || `guest-${token.substring(0, 8)}@placeholder.local`;

    // constraints_json に制約を保存
    const constraintsJson = JSON.stringify({
      time_min: timeMin,
      time_max: timeMax,
      prefer,
      days,
      duration,
      source: 'freebusy',
    });

    // 1. scheduling_threads 作成（slot_policy = 'freebusy_multi'）
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description, status, mode, 
        slot_policy, constraints_json, proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'one_on_one', 'freebusy_multi', ?, 1, 0, ?, ?)
    `).bind(
      threadId,
      workspaceId,
      ownerUserId,
      title,
      message_hint || null,
      constraintsJson,
      now,
      now
    ).run();

    // 2. scheduling_slots 作成（複数枠）
    const createdSlots: Array<{ slot_id: string; start_at: string; end_at: string }> = [];
    for (const slot of filteredSlots) {
      const slotId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (
          slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
        ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
      `).bind(
        slotId,
        threadId,
        slot.start_at,
        slot.end_at,
        slot.label || title,
        now
      ).run();
      createdSlots.push({ slot_id: slotId, start_at: slot.start_at, end_at: slot.end_at });
    }

    // 3. thread_invites 作成
    await env.DB.prepare(`
      INSERT INTO thread_invites (
        id, thread_id, token, email, candidate_name, candidate_reason, 
        invitee_key, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      inviteId,
      threadId,
      token,
      inviteeEmail,
      invitee.name,
      message_hint || null,
      inviteeKey,
      expiresAt,
      now
    ).run();

    // 4. スレッド status を sent に更新
    await env.DB.prepare(`
      UPDATE scheduling_threads SET status = 'sent', updated_at = ? WHERE id = ?
    `).bind(now, threadId).run();

    log.debug('1-on-1 freebusy schedule created', { 
      threadId, 
      slotCount: createdSlots.length, 
      inviteId, 
      token, 
      mode 
    });

    // ============================================================
    // 6. メール送信（mode === 'email' の場合）
    // ============================================================
    let emailQueued = false;
    if (mode === 'email' && invitee.email) {
      try {
        const organizer = await env.DB.prepare(
          `SELECT display_name, email FROM users WHERE id = ?`
        ).bind(ownerUserId).first<{ display_name: string | null; email: string }>();
        
        const organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || 'ユーザー';
        
        const emailQueue = new EmailQueueService(env.EMAIL_QUEUE, undefined);
        await emailQueue.sendOneOnOneEmail({
          to: invitee.email,
          token,
          organizerName,
          inviteeName: invitee.name,
          title,
          slot: {
            start_at: createdSlots[0].start_at,
            end_at: createdSlots[0].end_at,
          },
          messageHint: message_hint,
        });
        
        emailQueued = true;
        log.debug('Email queued successfully', { email: invitee.email, threadId, token });
      } catch (emailError) {
        log.warn('Failed to queue email, falling back to share_link', { 
          email: invitee.email, 
          threadId,
          error: emailError instanceof Error ? emailError.message : String(emailError)
        });
      }
    }

    // ============================================================
    // 7. レスポンス生成
    // ============================================================
    const baseUrl = 'https://app.tomoniwao.jp';
    const shareUrl = `${baseUrl}/i/${token}`;

    const slotsLabel = createdSlots.map((slot, i) => {
      const label = `${formatDateTimeJP(slot.start_at)}〜${new Date(slot.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
      return `  ${i + 1}. ${label}`;
    }).join('\n');

    // チャット用メッセージ
    let messageForChat: string;
    if (mode === 'email' && emailQueued) {
      messageForChat = `了解です。あなたの空き時間から${createdSlots.length}件の候補を選んで、${invitee.name}さん（${invitee.email}）にメールで確認を送りました📧\n\n📅 候補日時：\n${slotsLabel}\n\n返事が来たらお知らせします。`;
    } else if (mode === 'email' && !emailQueued) {
      messageForChat = `了解です。あなたの空き時間から${createdSlots.length}件の候補を選びました。\n（メール送信に失敗したため、手動で共有してください）\n\n📅 候補日時：\n${slotsLabel}\n\n次のメッセージを${invitee.name}さんに送ってください：\n\n---\n${invitee.name}さん、日程のご確認です。\n下記リンクから都合の良い日時を選んでください。\n${shareUrl}\n---`;
    } else {
      messageForChat = `了解です。あなたの空き時間から${createdSlots.length}件の候補を選びました。\n\n📅 候補日時：\n${slotsLabel}\n\n次のメッセージを${invitee.name}さんに送ってください：\n\n---\n${invitee.name}さん、日程のご確認です。\n下記リンクから都合の良い日時を選んでください。\n${shareUrl}\n---`;
    }

    const response: OneOnOneFreebusyPrepareResponse = {
      success: true,
      thread_id: threadId,
      invite_token: token,
      share_url: shareUrl,
      slots: createdSlots,
      message_for_chat: messageForChat,
      mode,
      email_queued: emailQueued || undefined,
      constraints_used: {
        time_min: timeMin,
        time_max: timeMax,
        prefer,
        duration,
      },
      request_id: requestId
    };

    return c.json(response, 201);

  } catch (error) {
    log.error('Failed to prepare 1-on-1 freebusy schedule', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId 
    }, 500);
  }
});

// ============================================================
// POST /api/one-on-one/open-slots/prepare (Phase B-4)
// TimeRex型: 主催者の空き枠を公開し、相手が好きな時間を選べる
// ============================================================
app.post('/open-slots/prepare', async (c) => {
  const { env } = c;
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const log = createLogger(env, { module: 'OneOnOne', handler: 'open-slots-prepare', requestId });

  try {
    // 認証チェック
    const userId = c.req.header('x-user-id');
    const workspaceId = c.req.header('x-workspace-id');

    if (!userId || !workspaceId) {
      return c.json({ error: 'Unauthorized', request_id: requestId }, 401);
    }

    const body = await c.req.json() as {
      invitee: { name: string; email?: string; contact_id?: string };
      constraints?: {
        time_min?: string;
        time_max?: string;
        prefer?: 'morning' | 'afternoon' | 'evening' | 'any';
        days?: string[];
        duration?: number;
        slot_interval?: number;
      };
      title?: string;
      message_hint?: string;
      send_via?: 'email' | 'share_link';
    };

    const { invitee, constraints = {}, title = '打ち合わせ', message_hint, send_via = 'share_link' } = body;

    // 必須パラメータのバリデーション
    if (!invitee?.name) {
      return c.json({ 
        error: 'validation_error', 
        details: '相手の名前（invitee.name）は必須です',
        request_id: requestId 
      }, 400);
    }

    const ownerUserId = userId;

    // デフォルト値の設定
    const now = new Date();
    
    // 翌営業日を計算
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    let dayOfWeek = tomorrow.getDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
      dayOfWeek = tomorrow.getDay();
    }
    
    const timeMin = constraints.time_min || tomorrow.toISOString();
    const timeMax = constraints.time_max || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const prefer = constraints.prefer || 'afternoon';
    const days = constraints.days || ['mon', 'tue', 'wed', 'thu', 'fri'];
    const duration = constraints.duration || 60;
    const slotInterval = constraints.slot_interval || 30;

    log.debug('Open slots prepare request', { 
      invitee, timeMin, timeMax, prefer, days, duration, slotInterval 
    });

    // ============================================================
    // 1. Google Calendar freebusy を取得
    // ============================================================
    const tokensRepo = new OAuthTokensRepository(env.DB);
    const googleTokens = await tokensRepo.getByUserAndProvider(ownerUserId, 'google');

    if (!googleTokens) {
      return c.json({ 
        error: 'calendar_unavailable', 
        message: 'Google連携が設定されていません。設定画面からGoogleアカウントを連携してください。',
        request_id: requestId 
      }, 400);
    }

    // freebusy API を呼び出し
    const freebusyResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/freeBusy`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${googleTokens.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: [{ id: 'primary' }],
        }),
      }
    );

    if (!freebusyResponse.ok) {
      log.error('Google freebusy API failed', { 
        status: freebusyResponse.status,
        statusText: freebusyResponse.statusText 
      });
      return c.json({ 
        error: 'calendar_unavailable', 
        message: 'Googleカレンダーから空き時間を取得できませんでした。',
        request_id: requestId 
      }, 500);
    }

    const freebusyData = await freebusyResponse.json() as {
      calendars: { primary: { busy: Array<{ start: string; end: string }> } };
    };

    const busyPeriods = freebusyData.calendars?.primary?.busy || [];

    // ============================================================
    // 2. 空き枠を生成（slotGeneratorを使用）
    // ============================================================
    const availableSlots = slotGenerator.generateAvailableSlots({
      timeMin,
      timeMax,
      busyPeriods,
      duration,
      prefer,
      days,
    });

    // slotInterval で枠をフィルタ（30分刻みなら00分/30分開始のみ）
    let filteredSlots = availableSlots.filter(slot => {
      const startDate = new Date(slot.start_at);
      const minutes = startDate.getMinutes();
      return minutes % slotInterval === 0;
    });

    // 上限チェック（1日8枠、全体40枠）
    const MAX_SLOTS_PER_DAY = 8;
    const MAX_TOTAL_SLOTS = 40;
    
    const slotCountByDate = new Map<string, number>();
    const limitedSlots: typeof filteredSlots = [];
    
    for (const slot of filteredSlots) {
      if (limitedSlots.length >= MAX_TOTAL_SLOTS) break;
      
      const dateKey = new Date(slot.start_at).toISOString().split('T')[0];
      const currentCount = slotCountByDate.get(dateKey) || 0;
      
      if (currentCount < MAX_SLOTS_PER_DAY) {
        limitedSlots.push(slot);
        slotCountByDate.set(dateKey, currentCount + 1);
      }
    }
    filteredSlots = limitedSlots;

    // ============================================================
    // 3. 候補が0件の場合のエラーハンドリング
    // ============================================================
    if (filteredSlots.length === 0) {
      return c.json({ 
        error: 'no_available_slots', 
        message: `指定期間（${formatDateTimeJP(timeMin)}〜${formatDateTimeJP(timeMax)}）に空きが見つかりませんでした。`,
        suggestions: [
          prefer !== 'any' ? '時間帯の制約を「指定なし」に変更' : null,
          days.length < 7 ? '曜日の制約を緩和（週末も含める）' : null,
          '期間を広げる（例: 3週間後まで）',
        ].filter(Boolean),
        request_id: requestId 
      }, 422);
    }

    // ============================================================
    // 4. DB操作: scheduling_thread + open_slots + open_slot_items
    // ============================================================
    const threadId = uuidv4();
    const openSlotsId = uuidv4();
    const openSlotsToken = `open-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const nowISO = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7日後

    const constraintsJson = JSON.stringify({
      time_min: timeMin,
      time_max: timeMax,
      prefer,
      days,
      duration,
      slot_interval: slotInterval,
      source: 'open_slots',
    });

    // 1. scheduling_threads 作成
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description, status, mode, 
        slot_policy, constraints_json, proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'one_on_one', 'open_slots', ?, 1, 0, ?, ?)
    `).bind(
      threadId,
      workspaceId,
      ownerUserId,
      title,
      message_hint || null,
      constraintsJson,
      nowISO,
      nowISO
    ).run();

    // 2. open_slots 作成
    await env.DB.prepare(`
      INSERT INTO open_slots (
        id, thread_id, token, workspace_id, owner_user_id,
        time_min, time_max, duration_minutes, prefer, days_json, slot_interval_minutes,
        title, invitee_name, invitee_email, status, constraints_json,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).bind(
      openSlotsId,
      threadId,
      openSlotsToken,
      workspaceId,
      ownerUserId,
      timeMin,
      timeMax,
      duration,
      prefer,
      JSON.stringify(days),
      slotInterval,
      title,
      invitee.name,
      invitee.email || null,
      constraintsJson,
      nowISO,
      nowISO,
      expiresAt
    ).run();

    // 3. open_slot_items 作成
    const createdItems: Array<{ item_id: string; start_at: string; end_at: string }> = [];
    for (const slot of filteredSlots) {
      const itemId = uuidv4();
      await env.DB.prepare(`
        INSERT INTO open_slot_items (
          id, open_slots_id, start_at, end_at, status, created_at
        ) VALUES (?, ?, ?, ?, 'available', ?)
      `).bind(
        itemId,
        openSlotsId,
        slot.start_at,
        slot.end_at,
        nowISO
      ).run();
      createdItems.push({ item_id: itemId, start_at: slot.start_at, end_at: slot.end_at });
    }

    // ============================================================
    // 5. レスポンス
    // ============================================================
    const baseUrl = env.ENVIRONMENT === 'development' 
      ? 'http://localhost:3000' 
      : 'https://app.tomoniwao.jp';
    
    const shareUrl = `${baseUrl}/open/${openSlotsToken}`;

    // メッセージ生成
    const slotPreview = createdItems.slice(0, 3).map(s => 
      `・${formatDateTimeJP(s.start_at)} 〜 ${formatTimeJP(s.end_at)}`
    ).join('\n');
    
    const messageForChat = `${invitee.name}さんへの空き時間共有リンクを作成しました。\n\n` +
      `📅 ${title}\n` +
      `⏱ ${duration}分\n` +
      `📊 ${createdItems.length}枠から選択可能\n\n` +
      `【一部の空き枠】\n${slotPreview}\n${createdItems.length > 3 ? `...他${createdItems.length - 3}枠\n` : ''}` +
      `\n以下のリンクを送ってください:\n${shareUrl}`;

    log.info('Open slots prepared successfully', { 
      threadId, openSlotsId, token: openSlotsToken, slotsCount: createdItems.length 
    });

    return c.json({
      success: true,
      thread_id: threadId,
      open_slots_id: openSlotsId,
      token: openSlotsToken,
      share_url: shareUrl,
      slots_count: createdItems.length,
      slots: createdItems,
      time_range: { min: timeMin, max: timeMax },
      constraints_used: {
        time_min: timeMin,
        time_max: timeMax,
        prefer,
        days,
        duration,
        slot_interval: slotInterval,
      },
      message_for_chat: messageForChat,
      expires_at: expiresAt,
      request_id: requestId
    }, 201);

  } catch (error) {
    log.error('Failed to prepare open slots', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return c.json({ 
      error: 'internal_error', 
      details: error instanceof Error ? error.message : 'Unknown error',
      request_id: requestId 
    }, 500);
  }
});

// ============================================================
// GET /api/one-on-one/health
// ヘルスチェック（疎通確認用）
// ============================================================
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    module: 'one-on-one',
    version: '1.3',  // B-4 追加に伴いバージョンアップ
    endpoints: [
      'POST /fixed/prepare',
      'POST /candidates/prepare',
      'POST /freebusy/prepare',
      'POST /open-slots/prepare'
    ],
    timestamp: Math.floor(Date.now() / 1000) 
  });
});

export default app;
