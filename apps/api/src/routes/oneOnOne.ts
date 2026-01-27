/**
 * 1対1 予定調整 API（固定日時スタート）
 * 
 * Phase v1.0: 最小構成で「お願い→終わったよ」体験を実現
 * - ユーザーが固定日時を指定
 * - AIが招待リンク or メール送信
 * - 相手が承諾/別日希望を返答
 * 
 * @route POST /api/one-on-one/fixed/prepare
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';
import { requireAuth, type Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';

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
    if (mode === 'email' && invitee.email) {
      // v1: メール送信はキューに追加（非同期）
      // TODO: emailQueue に投入する実装
      log.debug('Email will be sent via queue', { email: invitee.email, threadId });
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
    if (mode === 'email') {
      messageForChat = `了解です。${invitee.name}さんにメールで確認を送りますね。\n（固定候補：${slotLabel}）\n返事が来たらお知らせします。`;
    } else {
      messageForChat = `了解です。${invitee.name}さんに共有するリンクを発行しました。\n\n📅 固定候補：${slotLabel}\n\n次のURLを${invitee.name}さんに送ってください：\n${shareUrl}`;
    }

    const response: OneOnOneFixedPrepareResponse = {
      success: true,
      thread_id: threadId,
      invite_token: token,
      share_url: shareUrl,
      message_for_chat: messageForChat,
      mode,
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
// GET /api/one-on-one/health
// ヘルスチェック（疎通確認用）
// ============================================================
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    module: 'one-on-one',
    version: '1.0',
    timestamp: Math.floor(Date.now() / 1000) 
  });
});

export default app;
