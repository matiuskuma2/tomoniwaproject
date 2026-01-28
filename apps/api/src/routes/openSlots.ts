/**
 * Open Slots Routes (Phase B-4)
 * 
 * TimeRex型の空き枠公開ページ
 * - /open/:token - 空き枠一覧表示（public）
 * - /open/:token/select - 枠選択（public）
 * - /open/:token/thank-you - サンキューページ（public）
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// Helper Functions
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
 * 時刻のみフォーマット
 */
function formatTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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
          transition: all 0.2s ease;
        }
        .slot-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        .slot-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .slot-btn.selected {
          background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
          color: white;
          border-color: #2563EB;
        }
      </style>
    </head>
  `;
}

/**
 * エラーページHTML
 */
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
// Types
// ============================================================

interface OpenSlot {
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
  slot_interval_minutes: number;
  title: string | null;
  invitee_name: string | null;
  invitee_email: string | null;
  status: string;
  constraints_json: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface OpenSlotItem {
  id: string;
  open_slots_id: string;
  start_at: string;
  end_at: string;
  status: string;
  selected_at: string | null;
  selected_by: string | null;
  created_at: string;
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /open/:token - 空き枠一覧ページ
 */
app.get('/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OpenSlots', handler: 'view' });
  const token = c.req.param('token');

  try {
    // 1. open_slots を取得
    const openSlot = await env.DB.prepare(`
      SELECT * FROM open_slots WHERE token = ?
    `).bind(token).first<OpenSlot>();

    if (!openSlot) {
      return c.html(renderErrorPage('リンクが見つかりません', 'このリンクは無効か、すでに削除されています。'));
    }

    // 2. ステータスチェック
    if (openSlot.status === 'expired' || new Date(openSlot.expires_at) < new Date()) {
      return c.html(renderErrorPage('期限切れ', 'この空き枠の公開期間が終了しました。主催者に新しいリンクを依頼してください。'));
    }

    if (openSlot.status === 'cancelled') {
      return c.html(renderErrorPage('キャンセル済み', 'この空き枠の公開はキャンセルされました。'));
    }

    if (openSlot.status === 'completed') {
      return c.html(renderErrorPage('予約済み', 'すでに日時が確定しています。'));
    }

    // 3. 空き枠アイテムを取得
    const items = await env.DB.prepare(`
      SELECT * FROM open_slot_items 
      WHERE open_slots_id = ? 
      ORDER BY start_at ASC
    `).bind(openSlot.id).all<OpenSlotItem>();

    const availableItems = items.results?.filter(item => item.status === 'available') || [];

    if (availableItems.length === 0) {
      return c.html(renderErrorPage('空き枠がありません', '現在選択可能な空き枠がありません。主催者に連絡してください。'));
    }

    // 4. 日付ごとにグループ化
    const slotsByDate = new Map<string, OpenSlotItem[]>();
    for (const item of availableItems) {
      const dateKey = new Date(item.start_at).toISOString().split('T')[0];
      if (!slotsByDate.has(dateKey)) {
        slotsByDate.set(dateKey, []);
      }
      slotsByDate.get(dateKey)!.push(item);
    }

    // 5. HTML生成
    const title = openSlot.title || '打ち合わせ';
    const inviteeName = openSlot.invitee_name || 'ゲスト';

    let slotsHtml = '';
    for (const [dateKey, daySlots] of slotsByDate) {
      const dateLabel = formatDateJP(dateKey);
      slotsHtml += `
        <div class="mb-6">
          <h3 class="text-sm font-semibold text-gray-500 mb-2">${dateLabel}</h3>
          <div class="grid grid-cols-3 gap-2">
            ${daySlots.map(slot => `
              <button 
                class="slot-btn px-3 py-2 text-sm border-2 border-gray-200 rounded-lg bg-white hover:border-blue-500 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      `;
    }

    const html = `
      ${getHtmlHead(`${title} - 日程選択`)}
      <body class="bg-gradient-to-br from-blue-50 to-indigo-50 min-h-screen p-4">
        <div class="max-w-lg mx-auto fade-in">
          <!-- ヘッダー -->
          <div class="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <div class="text-center mb-4">
              <div class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
              </div>
              <h1 class="text-xl font-bold text-gray-800">${title}</h1>
              <p class="text-gray-500 text-sm mt-1">${inviteeName}さん、ご都合の良い時間を選んでください</p>
            </div>
            
            <div class="text-xs text-gray-400 text-center">
              所要時間: ${openSlot.duration_minutes}分
            </div>
          </div>

          <!-- 空き枠一覧 -->
          <div class="bg-white rounded-2xl shadow-lg p-6 mb-4">
            <h2 class="text-sm font-semibold text-gray-700 mb-4">空いている時間</h2>
            ${slotsHtml}
          </div>

          <!-- 選択確認 -->
          <div id="confirmSection" class="hidden bg-white rounded-2xl shadow-lg p-6 mb-4">
            <h2 class="text-sm font-semibold text-gray-700 mb-3">選択した日時</h2>
            <div id="selectedSlotDisplay" class="bg-blue-50 rounded-lg p-4 mb-4">
              <p class="text-lg font-bold text-blue-800" id="selectedDateTime">-</p>
            </div>
            <button 
              id="confirmBtn"
              onclick="confirmSelection()"
              class="w-full py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg"
            >
              この時間で確定する
            </button>
          </div>

          <!-- フッター -->
          <div class="text-center text-xs text-gray-400">
            <p>Powered by tomoniwao</p>
          </div>
        </div>

        <script>
          const TOKEN = '${token}';
          let selectedSlotId = null;
          let selectedStart = null;
          let selectedEnd = null;

          function selectSlot(btn) {
            // 前の選択を解除
            document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
            
            // 新しい選択
            btn.classList.add('selected');
            selectedSlotId = btn.dataset.slotId;
            selectedStart = btn.dataset.start;
            selectedEnd = btn.dataset.end;

            // 確認セクション表示
            document.getElementById('confirmSection').classList.remove('hidden');
            
            // 選択した日時を表示
            const startDate = new Date(selectedStart);
            const endDate = new Date(selectedEnd);
            const dateStr = startDate.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
            const startTime = startDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            const endTime = endDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            document.getElementById('selectedDateTime').textContent = dateStr + ' ' + startTime + ' 〜 ' + endTime;
          }

          async function confirmSelection() {
            if (!selectedSlotId) return;

            const btn = document.getElementById('confirmBtn');
            btn.disabled = true;
            btn.textContent = '処理中...';

            try {
              const response = await fetch('/open/' + TOKEN + '/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot_id: selectedSlotId })
              });

              const data = await response.json();
              
              if (data.success) {
                window.location.href = '/open/' + TOKEN + '/thank-you?slot_id=' + selectedSlotId;
              } else {
                alert(data.error || '予約に失敗しました');
                btn.disabled = false;
                btn.textContent = 'この時間で確定する';
              }
            } catch (error) {
              alert('通信エラーが発生しました');
              btn.disabled = false;
              btn.textContent = 'この時間で確定する';
            }
          }
        </script>
      </body>
      </html>
    `;

    return c.html(html);

  } catch (error) {
    log.error('Failed to render open slots page', { error: error instanceof Error ? error.message : String(error) });
    return c.html(renderErrorPage('エラー', '予期しないエラーが発生しました。しばらく経ってからお試しください。'));
  }
});

/**
 * POST /open/:token/select - 枠選択
 */
app.post('/:token/select', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'OpenSlots', handler: 'select' });
  const token = c.req.param('token');

  try {
    const body = await c.req.json();
    const { slot_id } = body as { slot_id: string };

    if (!slot_id) {
      return c.json({ success: false, error: '枠IDが必要です' }, 400);
    }

    // 1. open_slots を取得
    const openSlot = await env.DB.prepare(`
      SELECT * FROM open_slots WHERE token = ?
    `).bind(token).first<OpenSlot>();

    if (!openSlot) {
      return c.json({ success: false, error: 'リンクが見つかりません' }, 404);
    }

    if (openSlot.status !== 'active') {
      return c.json({ success: false, error: 'この空き枠は選択できません' }, 400);
    }

    // 2. slot_item を取得・検証
    const slotItem = await env.DB.prepare(`
      SELECT * FROM open_slot_items WHERE id = ? AND open_slots_id = ?
    `).bind(slot_id, openSlot.id).first<OpenSlotItem>();

    if (!slotItem) {
      return c.json({ success: false, error: '指定された枠が見つかりません' }, 404);
    }

    if (slotItem.status !== 'available') {
      return c.json({ success: false, error: 'この枠はすでに選択されています' }, 400);
    }

    const now = new Date().toISOString();

    // 3. slot_item を selected に更新
    await env.DB.prepare(`
      UPDATE open_slot_items 
      SET status = 'selected', selected_at = ?, selected_by = 'guest'
      WHERE id = ?
    `).bind(now, slot_id).run();

    // 4. open_slots を completed に更新
    await env.DB.prepare(`
      UPDATE open_slots 
      SET status = 'completed', updated_at = ?
      WHERE id = ?
    `).bind(now, openSlot.id).run();

    // 5. 他の枠を disabled に
    await env.DB.prepare(`
      UPDATE open_slot_items 
      SET status = 'disabled'
      WHERE open_slots_id = ? AND id != ?
    `).bind(openSlot.id, slot_id).run();

    // 6. scheduling_slots に記録（既存フローとの統合用）
    const slotRecordId = `slot-open-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    await env.DB.prepare(`
      INSERT INTO scheduling_slots (
        slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at
      ) VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, 1, ?)
    `).bind(
      slotRecordId,
      openSlot.thread_id,
      slotItem.start_at,
      slotItem.end_at,
      openSlot.title || '打ち合わせ',
      now
    ).run();

    log.debug('Open slot selected', { token, slot_id, thread_id: openSlot.thread_id });

    return c.json({ 
      success: true, 
      redirect_url: `/open/${token}/thank-you?slot_id=${slot_id}` 
    });

  } catch (error) {
    log.error('Failed to select open slot', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ success: false, error: '予約に失敗しました' }, 500);
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
    const openSlot = await env.DB.prepare(`
      SELECT * FROM open_slots WHERE token = ?
    `).bind(token).first<OpenSlot>();

    if (!openSlot) {
      return c.html(renderErrorPage('リンクが見つかりません', 'このリンクは無効です。'));
    }

    // 2. 選択された枠を取得
    let selectedItem: OpenSlotItem | null = null;
    if (slotId) {
      selectedItem = await env.DB.prepare(`
        SELECT * FROM open_slot_items WHERE id = ? AND open_slots_id = ?
      `).bind(slotId, openSlot.id).first<OpenSlotItem>();
    }

    if (!selectedItem) {
      // slot_id なしでも、selected の枠を探す
      selectedItem = await env.DB.prepare(`
        SELECT * FROM open_slot_items WHERE open_slots_id = ? AND status = 'selected'
      `).bind(openSlot.id).first<OpenSlotItem>();
    }

    if (!selectedItem) {
      return c.html(renderErrorPage('予約情報が見つかりません', '予約情報が見つかりませんでした。'));
    }

    const title = openSlot.title || '打ち合わせ';
    const startTime = formatDateTimeJP(selectedItem.start_at);
    const endTime = formatTimeJP(selectedItem.end_at);

    // Googleカレンダー追加URL
    const gcalUrl = generateGoogleCalendarUrl({
      title,
      startAt: selectedItem.start_at,
      endAt: selectedItem.end_at,
      description: `tomoniwaoで予約された打ち合わせです。`
    });

    const html = `
      ${getHtmlHead('予約完了 - ありがとうございます')}
      <body class="bg-gradient-to-br from-green-50 to-emerald-50 min-h-screen p-4">
        <div class="max-w-lg mx-auto fade-in">
          <!-- 完了カード -->
          <div class="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            
            <h1 class="text-2xl font-bold text-gray-800 mb-2">予約完了</h1>
            <p class="text-gray-500 mb-6">日程が確定しました</p>

            <!-- 確定した日時 -->
            <div class="bg-gray-50 rounded-xl p-4 mb-6">
              <p class="text-sm text-gray-500 mb-1">確定した日時</p>
              <p class="text-lg font-bold text-gray-800">${startTime}</p>
              <p class="text-gray-600">〜 ${endTime}</p>
              <p class="text-sm text-gray-500 mt-2">${title}</p>
            </div>

            <!-- Googleカレンダー追加 -->
            <a 
              href="${gcalUrl}" 
              target="_blank"
              class="flex items-center justify-center gap-2 w-full py-3 mb-4 bg-white border-2 border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M19.5 3.5h-2V2h-1.5v1.5h-8V2H6.5v1.5h-2A1.5 1.5 0 003 5v14.5A1.5 1.5 0 004.5 21h15a1.5 1.5 0 001.5-1.5V5a1.5 1.5 0 00-1.5-1.5zm0 16h-15V8h15v11.5z" fill="#4285F4"/>
                <path d="M8 10.5h2.5V13H8v-2.5zm0 4h2.5V17H8v-2.5zm5.5-4H16V13h-2.5v-2.5zm0 4H16V17h-2.5v-2.5z" fill="#4285F4"/>
              </svg>
              <span class="font-medium text-gray-700">Googleカレンダーに追加</span>
            </a>

            <!-- 成長導線 -->
            <div class="border-t pt-6 mt-6">
              <p class="text-sm text-gray-500 mb-3">tomoniwaoで日程調整をもっと簡単に</p>
              <a 
                href="https://app.tomoniwao.jp/signup" 
                class="inline-block px-6 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-medium rounded-lg hover:from-blue-600 hover:to-indigo-600 transition-all"
              >
                無料で始める
              </a>
            </div>
          </div>

          <!-- フッター -->
          <div class="text-center text-xs text-gray-400 mt-4">
            <p>Powered by tomoniwao</p>
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

export default app;
