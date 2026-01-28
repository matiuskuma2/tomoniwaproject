/**
 * Open Slots Routes (Phase B-4)
 * 
 * TimeRex型の公開枠選択体験
 * - 主催者の空き枠を一覧表示（予定は見えない）
 * - 相手が好きな1枠を選んで確定
 * - B-3の3回目誘導先
 */

import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// Helpers
// ============================================================

/**
 * 日本語日時フォーマット
 */
function formatDateTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  
  return `${year}年${month}月${day}日（${weekday}）${hours}:${minutes}`;
}

/**
 * 終了時刻のみフォーマット
 */
function formatTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 日付のみフォーマット（グループ表示用）
 */
function formatDateOnlyJP(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  
  return `${month}/${day}（${weekday}）`;
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

/**
 * 共通HTMLヘッダー
 */
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
        body {
          font-family: 'Noto Sans JP', sans-serif;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in {
          animation: fadeIn 0.4s ease-out;
        }
        .slot-btn {
          transition: all 0.15s ease;
        }
        .slot-btn:hover:not(:disabled) {
          background-color: #3B82F6;
          color: white;
        }
        .slot-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .slot-btn.selected {
          background-color: #3B82F6;
          color: white;
          border-color: #2563EB;
        }
      </style>
    </head>
  `;
}

/**
 * エラーページ
 */
function renderErrorPage(title: string, message: string, suggestion?: string): string {
  return `
    ${getHtmlHead('エラー - ' + title)}
    <body class="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center fade-in">
        <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 class="text-xl font-bold text-gray-800 mb-2">${title}</h1>
        <p class="text-gray-600 mb-4">${message}</p>
        ${suggestion ? `<p class="text-sm text-gray-500">${suggestion}</p>` : ''}
      </div>
    </body>
    </html>
  `;
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /open/:token - 公開枠一覧ページ
 */
app.get('/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OpenSlots', handler: 'view' });
  const token = c.req.param('token');

  try {
    // 1. open_slots を取得
    const openSlots = await env.DB.prepare(`
      SELECT * FROM open_slots WHERE token = ?
    `).bind(token).first<{
      id: string;
      thread_id: string;
      token: string;
      workspace_id: string;
      owner_user_id: string;
      time_min: string;
      time_max: string;
      duration_minutes: number;
      prefer: string;
      days_json: string;
      title: string;
      invitee_name: string;
      invitee_email: string;
      status: string;
      expires_at: string;
      created_at: string;
    }>();

    if (!openSlots) {
      log.warn('Open slots not found', { token });
      return c.html(renderErrorPage(
        'リンクが見つかりません',
        'このリンクは無効か、すでに使用済みです。',
        '主催者に新しいリンクを発行してもらってください。'
      ), 404);
    }

    // 2. ステータスチェック
    if (openSlots.status === 'expired' || new Date(openSlots.expires_at) < new Date()) {
      return c.html(renderErrorPage(
        '期限切れです',
        'このリンクの有効期限が切れました。',
        '主催者に新しいリンクを発行してもらってください。'
      ), 410);
    }

    if (openSlots.status === 'completed') {
      return c.html(renderErrorPage(
        '選択済みです',
        'この日程調整はすでに完了しています。',
        'ご協力ありがとうございました。'
      ), 410);
    }

    if (openSlots.status === 'cancelled') {
      return c.html(renderErrorPage(
        'キャンセルされました',
        'この日程調整はキャンセルされました。',
        '主催者にお問い合わせください。'
      ), 410);
    }

    // 3. 空き枠を取得
    const slotsResult = await env.DB.prepare(`
      SELECT * FROM open_slot_items 
      WHERE open_slots_id = ? AND status = 'available'
      ORDER BY start_at ASC
    `).bind(openSlots.id).all<{
      id: string;
      open_slots_id: string;
      start_at: string;
      end_at: string;
      status: string;
    }>();

    const slots = slotsResult.results || [];

    // 4. 日付ごとにグループ化
    const slotsByDate = new Map<string, typeof slots>();
    for (const slot of slots) {
      const dateKey = formatDateOnlyJP(slot.start_at);
      if (!slotsByDate.has(dateKey)) {
        slotsByDate.set(dateKey, []);
      }
      slotsByDate.get(dateKey)!.push(slot);
    }

    // 5. UI をレンダリング
    return c.html(renderOpenSlotsPage(openSlots, slotsByDate, token));

  } catch (error) {
    log.error('Failed to load open slots page', { 
      error: error instanceof Error ? error.message : String(error),
      token 
    });
    return c.html(renderErrorPage(
      'エラーが発生しました',
      'ページの読み込み中にエラーが発生しました。',
      'しばらく待ってから再度お試しください。'
    ), 500);
  }
});

/**
 * 公開枠一覧ページのHTML
 */
function renderOpenSlotsPage(
  openSlots: {
    title: string;
    invitee_name: string;
    duration_minutes: number;
    expires_at: string;
  },
  slotsByDate: Map<string, Array<{
    id: string;
    start_at: string;
    end_at: string;
  }>>,
  token: string
): string {
  const datesHtml = Array.from(slotsByDate.entries()).map(([dateKey, slots]) => `
    <div class="mb-6">
      <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center">
        <svg class="w-4 h-4 mr-2 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        ${dateKey}
      </h3>
      <div class="grid grid-cols-3 gap-2">
        ${slots.map(slot => `
          <button 
            type="button"
            class="slot-btn px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-blue-500 hover:text-white hover:border-blue-500"
            data-slot-id="${slot.id}"
            data-start="${slot.start_at}"
            data-end="${slot.end_at}"
            onclick="selectSlot(this)"
          >
            ${formatTimeJP(slot.start_at)}
          </button>
        `).join('')}
      </div>
    </div>
  `).join('');

  const totalSlots = Array.from(slotsByDate.values()).flat().length;

  return `
    ${getHtmlHead('日程を選択 - ' + openSlots.title)}
    <body class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div class="max-w-lg mx-auto p-4 pt-8">
        <div class="bg-white rounded-2xl shadow-lg p-6 fade-in">
          <!-- ヘッダー -->
          <div class="text-center mb-6">
            <div class="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg class="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 class="text-xl font-bold text-gray-800 mb-1">${openSlots.title}</h1>
            <p class="text-gray-600">
              ${openSlots.invitee_name}さん、ご都合の良い時間を選んでください
            </p>
            <p class="text-xs text-gray-500 mt-1">
              所要時間: ${openSlots.duration_minutes}分 / ${totalSlots}枠から選択可能
            </p>
          </div>

          <!-- 選択中の枠表示 -->
          <div id="selectedSlotInfo" class="hidden bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm text-blue-600 font-medium">選択中</p>
                <p id="selectedSlotText" class="text-lg font-bold text-blue-800"></p>
              </div>
              <button type="button" onclick="clearSelection()" class="text-blue-600 hover:text-blue-800">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 枠一覧 -->
          <div class="mb-6 max-h-80 overflow-y-auto">
            ${totalSlots > 0 ? datesHtml : `
              <div class="text-center py-8 text-gray-500">
                <p>選択可能な枠がありません</p>
                <p class="text-sm mt-1">主催者にお問い合わせください</p>
              </div>
            `}
          </div>

          <!-- 確定ボタン -->
          <button 
            id="confirmBtn"
            type="button"
            onclick="confirmSelection()"
            disabled
            class="w-full py-3 rounded-xl font-bold text-lg bg-gray-300 text-gray-500 cursor-not-allowed transition-all disabled:opacity-50"
          >
            時間を選択してください
          </button>

          <!-- 有効期限 -->
          <p class="text-xs text-gray-400 text-center mt-4">
            有効期限: ${formatDateTimeJP(openSlots.expires_at)}まで
          </p>
        </div>
      </div>

      <script>
        const TOKEN = '${token}';
        let selectedSlotId = null;
        let selectedSlotStart = null;
        let selectedSlotEnd = null;

        function selectSlot(btn) {
          // 以前の選択をクリア
          document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
          
          // 新しい選択
          btn.classList.add('selected');
          selectedSlotId = btn.dataset.slotId;
          selectedSlotStart = btn.dataset.start;
          selectedSlotEnd = btn.dataset.end;

          // 選択中表示を更新
          const infoDiv = document.getElementById('selectedSlotInfo');
          const textEl = document.getElementById('selectedSlotText');
          const confirmBtn = document.getElementById('confirmBtn');
          
          infoDiv.classList.remove('hidden');
          textEl.textContent = formatDateTime(selectedSlotStart) + ' 〜 ' + formatTime(selectedSlotEnd);
          
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'この時間で確定する';
          confirmBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
          confirmBtn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700');
        }

        function clearSelection() {
          document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
          selectedSlotId = null;
          selectedSlotStart = null;
          selectedSlotEnd = null;

          document.getElementById('selectedSlotInfo').classList.add('hidden');
          const confirmBtn = document.getElementById('confirmBtn');
          confirmBtn.disabled = true;
          confirmBtn.textContent = '時間を選択してください';
          confirmBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
          confirmBtn.classList.remove('bg-blue-600', 'text-white', 'hover:bg-blue-700');
        }

        async function confirmSelection() {
          if (!selectedSlotId) return;
          
          const confirmBtn = document.getElementById('confirmBtn');
          confirmBtn.disabled = true;
          confirmBtn.textContent = '確定中...';

          try {
            const res = await fetch('/open/' + TOKEN + '/select', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                slot_id: selectedSlotId,
                slot_start: selectedSlotStart,
                slot_end: selectedSlotEnd
              })
            });

            const data = await res.json();
            
            if (data.success && data.redirect_url) {
              window.location.href = data.redirect_url;
            } else {
              alert(data.error || 'エラーが発生しました');
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'この時間で確定する';
            }
          } catch (e) {
            alert('通信エラーが発生しました');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'この時間で確定する';
          }
        }

        function formatDateTime(isoStr) {
          const d = new Date(isoStr);
          const m = d.getMonth() + 1;
          const day = d.getDate();
          const wd = ['日','月','火','水','木','金','土'][d.getDay()];
          const h = String(d.getHours()).padStart(2,'0');
          const min = String(d.getMinutes()).padStart(2,'0');
          return m + '/' + day + '（' + wd + '）' + h + ':' + min;
        }

        function formatTime(isoStr) {
          const d = new Date(isoStr);
          const h = String(d.getHours()).padStart(2,'0');
          const min = String(d.getMinutes()).padStart(2,'0');
          return h + ':' + min;
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * POST /open/:token/select - 枠を選択して確定
 */
app.post('/:token/select', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OpenSlots', handler: 'select' });
  const token = c.req.param('token');

  try {
    const body = await c.req.json() as {
      slot_id: string;
      slot_start?: string;
      slot_end?: string;
      name?: string;
      email?: string;
    };

    const { slot_id, slot_start, slot_end, name, email } = body;

    if (!slot_id) {
      return c.json({ success: false, error: '枠IDが指定されていません' }, 400);
    }

    // 1. open_slots を取得
    const openSlots = await env.DB.prepare(`
      SELECT * FROM open_slots WHERE token = ?
    `).bind(token).first<{
      id: string;
      thread_id: string;
      status: string;
      expires_at: string;
      title: string;
      invitee_name: string;
      owner_user_id: string;
      workspace_id: string;
    }>();

    if (!openSlots) {
      return c.json({ success: false, error: 'リンクが見つかりません' }, 404);
    }

    // 2. ステータスチェック
    if (openSlots.status !== 'active') {
      return c.json({ success: false, error: 'このリンクは無効です' }, 410);
    }

    if (new Date(openSlots.expires_at) < new Date()) {
      return c.json({ success: false, error: '期限が切れています' }, 410);
    }

    // 3. 枠を取得・ロック
    const slot = await env.DB.prepare(`
      SELECT * FROM open_slot_items 
      WHERE id = ? AND open_slots_id = ? AND status = 'available'
    `).bind(slot_id, openSlots.id).first<{
      id: string;
      start_at: string;
      end_at: string;
      status: string;
    }>();

    if (!slot) {
      return c.json({ success: false, error: 'この枠はすでに選択されています' }, 409);
    }

    const now = new Date().toISOString();
    const inviteeKey = `ik-open-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // 4. トランザクション: 枠を selected に更新、他を disabled に
    await env.DB.prepare(`
      UPDATE open_slot_items 
      SET status = 'selected', selected_at = ?, selected_by = ?
      WHERE id = ?
    `).bind(now, inviteeKey, slot_id).run();

    // 他の枠を disabled に（1枠確定なので）
    await env.DB.prepare(`
      UPDATE open_slot_items 
      SET status = 'disabled'
      WHERE open_slots_id = ? AND id != ?
    `).bind(openSlots.id, slot_id).run();

    // open_slots を completed に
    await env.DB.prepare(`
      UPDATE open_slots 
      SET status = 'completed', updated_at = ?
      WHERE id = ?
    `).bind(now, openSlots.id).run();

    // 5. scheduling_slots に選択を記録（既存フローと連携）
    const selectedSlotId = `slot-open-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    await env.DB.prepare(`
      INSERT INTO scheduling_slots (
        slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
      ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
    `).bind(
      selectedSlotId,
      openSlots.thread_id,
      slot.start_at,
      slot.end_at,
      openSlots.title,
      now
    ).run();

    // 6. thread_selections に記録
    const selectionId = uuidv4();
    await env.DB.prepare(`
      INSERT INTO thread_selections (
        id, thread_id, invitee_key, selected_slot_id, status, 
        proposal_version_at_response, responded_at, created_at
      ) VALUES (?, ?, ?, ?, 'selected', 1, ?, ?)
    `).bind(
      selectionId,
      openSlots.thread_id,
      inviteeKey,
      selectedSlotId,
      now,
      now
    ).run();

    // 7. 主催者に通知（inbox）
    try {
      const inboxRepo = new InboxRepository(env.DB);
      await inboxRepo.create({
        user_id: openSlots.owner_user_id,
        workspace_id: openSlots.workspace_id,
        type: 'system',
        title: '日程が確定しました',
        body: `${openSlots.invitee_name || name || '相手'}さんが「${openSlots.title}」の日程を選択しました: ${formatDateTimeJP(slot.start_at)} 〜 ${formatTimeJP(slot.end_at)}`,
        metadata: JSON.stringify({
          thread_id: openSlots.thread_id,
          open_slots_id: openSlots.id,
          selected_slot_id: slot_id,
          start_at: slot.start_at,
          end_at: slot.end_at
        })
      });
    } catch (inboxError) {
      log.warn('Failed to send inbox notification', { error: inboxError });
      // 通知失敗は致命的ではないので続行
    }

    log.info('Slot selected successfully', { 
      token, 
      slot_id, 
      invitee_key: inviteeKey,
      start_at: slot.start_at 
    });

    return c.json({
      success: true,
      redirect_url: `/open/${token}/thank-you?slot_id=${slot_id}`
    });

  } catch (error) {
    log.error('Failed to select slot', { 
      error: error instanceof Error ? error.message : String(error),
      token 
    });
    return c.json({ success: false, error: 'エラーが発生しました' }, 500);
  }
});

/**
 * GET /open/:token/thank-you - サンキューページ
 */
app.get('/:token/thank-you', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OpenSlots', handler: 'thank-you' });
  const token = c.req.param('token');
  const slotId = c.req.query('slot_id');

  try {
    // 1. open_slots を取得
    const openSlots = await env.DB.prepare(`
      SELECT * FROM open_slots WHERE token = ?
    `).bind(token).first<{
      id: string;
      title: string;
      invitee_name: string;
    }>();

    if (!openSlots) {
      return c.html(renderErrorPage(
        'リンクが見つかりません',
        'このリンクは無効です。',
        ''
      ), 404);
    }

    // 2. 選択された枠を取得
    let selectedSlot: { start_at: string; end_at: string } | null = null;
    
    if (slotId) {
      selectedSlot = await env.DB.prepare(`
        SELECT start_at, end_at FROM open_slot_items WHERE id = ?
      `).bind(slotId).first<{ start_at: string; end_at: string }>();
    }

    // 3. サンキューページをレンダリング
    return c.html(renderThankYouPage(openSlots, selectedSlot));

  } catch (error) {
    log.error('Failed to load thank you page', { 
      error: error instanceof Error ? error.message : String(error),
      token 
    });
    return c.html(renderErrorPage(
      'エラーが発生しました',
      'ページの読み込み中にエラーが発生しました。',
      ''
    ), 500);
  }
});

/**
 * サンキューページのHTML
 */
function renderThankYouPage(
  openSlots: {
    title: string;
    invitee_name: string;
  },
  selectedSlot: { start_at: string; end_at: string } | null
): string {
  const googleCalendarUrl = selectedSlot 
    ? generateGoogleCalendarUrl({
        title: openSlots.title,
        startAt: selectedSlot.start_at,
        endAt: selectedSlot.end_at,
        description: `${openSlots.invitee_name || ''}さんとの予定`
      })
    : null;

  return `
    ${getHtmlHead('ありがとうございます - ' + openSlots.title)}
    <body class="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center fade-in">
        <!-- 成功アイコン -->
        <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 class="text-2xl font-bold text-gray-800 mb-2">
          日程が確定しました！
        </h1>
        
        <p class="text-gray-600 mb-6">
          ご協力ありがとうございます。<br>
          主催者に通知しました。
        </p>

        ${selectedSlot ? `
          <div class="bg-gray-50 rounded-xl p-4 mb-6">
            <p class="text-sm text-gray-500 mb-1">確定した日時</p>
            <p class="text-lg font-bold text-gray-800">
              ${formatDateTimeJP(selectedSlot.start_at)} 〜 ${formatTimeJP(selectedSlot.end_at)}
            </p>
            <p class="text-sm text-gray-600 mt-1">${openSlots.title}</p>
          </div>
        ` : ''}

        ${googleCalendarUrl ? `
          <a 
            href="${googleCalendarUrl}" 
            target="_blank"
            class="inline-flex items-center justify-center w-full py-3 px-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors mb-4"
          >
            <svg class="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
            </svg>
            Googleカレンダーに追加
          </a>
        ` : ''}

        <!-- 成長導線 -->
        <div class="border-t pt-6 mt-6">
          <p class="text-sm text-gray-500 mb-3">
            もっと簡単に日程調整しませんか？
          </p>
          <a 
            href="https://app.tomoniwao.jp/"
            class="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 font-medium"
          >
            tomoniwaoを無料で試す
            <svg class="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
}

export default app;
