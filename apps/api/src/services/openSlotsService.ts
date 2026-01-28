/**
 * openSlotsService.ts
 * 
 * Phase B-5: Open Slots 作成の共通サービス
 * 
 * 以下から呼び出される:
 * - POST /api/one-on-one/open-slots/prepare (直接作成)
 * - POST /i/:token/request-alternate (再提案3回目で自動作成)
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { GoogleCalendarService } from './googleCalendar';
import { generateAvailableSlots, type AvailableSlot } from '../utils/slotGenerator';
import type { Env } from '../../../../packages/shared/src/types/env';

// ============================================================
// Types
// ============================================================

export interface CreateOpenSlotsParams {
  env: Env;
  userId: string;
  workspaceId: string;
  threadId?: string;  // 既存スレッドがある場合（request-alternate）
  invitee: {
    name: string;
    email?: string;
  };
  constraints?: {
    time_min?: string;
    time_max?: string;
    prefer?: 'morning' | 'afternoon' | 'evening' | 'any';
    days?: string[];
    duration?: number;
    slot_interval?: number;
  };
  title?: string;
  messageHint?: string;
  expiresInDays?: number;
  source?: string;  // 'direct' | 'auto_from_alternate'
}

export interface CreateOpenSlotsResult {
  success: boolean;
  threadId: string;
  openSlotsId: string;
  token: string;
  shareUrl: string;
  slotsCount: number;
  slots: Array<{ item_id: string; start_at: string; end_at: string }>;
  timeRange: { min: string; max: string };
  constraintsUsed: {
    time_min: string;
    time_max: string;
    prefer: string;
    days: string[];
    duration: number;
    slot_interval: number;
  };
  messageForChat: string;
  expiresAt: string;
}

export interface CreateOpenSlotsError {
  success: false;
  error: string;
  message: string;
  suggestions?: string[];
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 日時を日本語フォーマット（例: 1/28（火）14:00）
 */
function formatDateTimeJP(isoString: string): string {
  const date = new Date(isoString);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}（${weekday}）${hours}:${minutes}`;
}

/**
 * 時刻フォーマット（例: 15:00）
 */
function formatTimeJP(isoString: string): string {
  const date = new Date(isoString);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * prefer から時間帯ウィンドウを取得
 */
function getTimeWindowFromPrefer(prefer: string): { startHour: number; endHour: number } {
  switch (prefer) {
    case 'morning':
      return { startHour: 9, endHour: 12 };
    case 'afternoon':
      return { startHour: 13, endHour: 17 };
    case 'evening':
      return { startHour: 17, endHour: 21 };
    case 'any':
    default:
      return { startHour: 9, endHour: 18 };
  }
}

// ============================================================
// Main Service Function
// ============================================================

/**
 * Open Slots を作成する共通関数
 * 
 * @param params - 作成パラメータ
 * @returns 作成結果またはエラー
 */
export async function createOpenSlotsInternal(
  params: CreateOpenSlotsParams
): Promise<CreateOpenSlotsResult | CreateOpenSlotsError> {
  const { env, userId, workspaceId, invitee, constraints = {}, title = '打ち合わせ', messageHint, expiresInDays = 7, source = 'direct' } = params;
  
  const log = createLogger(env, { module: 'OpenSlotsService', handler: 'createOpenSlotsInternal' });

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

  // 上限定数
  const MAX_SLOTS_PER_DAY = 8;
  const MAX_TOTAL_SLOTS = 40;

  log.debug('Creating open slots', { 
    invitee, timeMin, timeMax, prefer, days, duration, slotInterval, source 
  });

  // ============================================================
  // 1. 主催者のアクセストークンを取得し、freebusy を取得
  // ============================================================
  const accessToken = await GoogleCalendarService.getOrganizerAccessToken(env.DB, userId, env);
  if (!accessToken) {
    return { 
      success: false,
      error: 'calendar_unavailable', 
      message: 'Googleカレンダーが連携されていません。設定からカレンダー連携を行ってください。',
    };
  }

  // freebusy を取得
  let busyPeriods: Array<{ start: string; end: string }>;
  try {
    const freebusyResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
      return { 
        success: false,
        error: 'calendar_unavailable', 
        message: 'Googleカレンダーから空き時間を取得できませんでした。',
      };
    }

    const freebusyData = await freebusyResponse.json() as {
      calendars: { primary: { busy: Array<{ start: string; end: string }> } };
    };
    busyPeriods = freebusyData.calendars?.primary?.busy || [];
  } catch (freebusyError) {
    log.error('Failed to fetch freebusy', { error: freebusyError });
    return { 
      success: false,
      error: 'calendar_unavailable', 
      message: 'Googleカレンダーとの通信でエラーが発生しました。',
    };
  }

  // ============================================================
  // 2. 空き枠を生成（slotGeneratorを使用）
  // ============================================================
  const dayTimeWindow = getTimeWindowFromPrefer(prefer);
  const slotResult = generateAvailableSlots({
    timeMin,
    timeMax,
    busy: busyPeriods,
    meetingLengthMin: duration,
    stepMin: slotInterval,
    maxResults: MAX_TOTAL_SLOTS,
    dayTimeWindow,
  });

  // slotInterval で枠をフィルタ（30分刻みなら00分/30分開始のみ）
  let filteredSlots = slotResult.available_slots.filter((slot: AvailableSlot) => {
    const startDate = new Date(slot.start_at);
    const minutes = startDate.getMinutes();
    return minutes % slotInterval === 0;
  });

  // 上限チェック（1日8枠）
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
    return { 
      success: false,
      error: 'no_available_slots', 
      message: `指定期間（${formatDateTimeJP(timeMin)}〜${formatDateTimeJP(timeMax)}）に空きが見つかりませんでした。`,
      suggestions: [
        prefer !== 'any' ? '時間帯の制約を「指定なし」に変更' : null,
        days.length < 7 ? '曜日の制約を緩和（週末も含める）' : null,
        '期間を広げる（例: 3週間後まで）',
      ].filter(Boolean) as string[],
    };
  }

  // ============================================================
  // 4. DB操作: scheduling_thread + open_slots + open_slot_items
  // ============================================================
  const threadId = params.threadId || uuidv4();
  const openSlotsId = uuidv4();
  const openSlotsToken = `open-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const nowISO = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const constraintsJson = JSON.stringify({
    time_min: timeMin,
    time_max: timeMax,
    prefer,
    days,
    duration,
    slot_interval: slotInterval,
    source,
  });

  // 既存スレッドがない場合のみ作成
  if (!params.threadId) {
    await env.DB.prepare(`
      INSERT INTO scheduling_threads (
        id, workspace_id, organizer_user_id, title, description, status, mode, 
        slot_policy, constraints_json, proposal_version, additional_propose_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'one_on_one', 'open_slots', ?, 1, 0, ?, ?)
    `).bind(
      threadId,
      workspaceId,
      userId,
      title,
      messageHint || null,
      constraintsJson,
      nowISO,
      nowISO
    ).run();
  }

  // open_slots 作成
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
    userId,
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

  // open_slot_items 作成
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
  
  const messageForChat = source === 'auto_from_alternate'
    ? `何度も調整ありがとうございます。\n` +
      `${invitee.name}さんが空き時間から直接選べるリンクを作成しました。\n\n` +
      `📅 ${title}\n` +
      `⏱ ${duration}分\n` +
      `📊 ${createdItems.length}枠から選択可能\n\n` +
      `以下のリンクを送ってください:\n${shareUrl}`
    : `${invitee.name}さんへの空き時間共有リンクを作成しました。\n\n` +
      `📅 ${title}\n` +
      `⏱ ${duration}分\n` +
      `📊 ${createdItems.length}枠から選択可能\n\n` +
      `【一部の空き枠】\n${slotPreview}\n${createdItems.length > 3 ? `...他${createdItems.length - 3}枠\n` : ''}` +
      `\n以下のリンクを送ってください:\n${shareUrl}`;

  log.info('Open slots created successfully', { 
    threadId, openSlotsId, token: openSlotsToken, slotsCount: createdItems.length, source 
  });

  return {
    success: true,
    threadId,
    openSlotsId,
    token: openSlotsToken,
    shareUrl,
    slotsCount: createdItems.length,
    slots: createdItems,
    timeRange: { min: timeMin, max: timeMax },
    constraintsUsed: {
      time_min: timeMin,
      time_max: timeMax,
      prefer,
      days,
      duration,
      slot_interval: slotInterval,
    },
    messageForChat,
    expiresAt,
  };
}
